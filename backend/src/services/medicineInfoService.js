'use strict';

const knowledgeBase = require('../data/medicineKnowledgeBase.json');
const { normalizeDrugName } = require('../utils/drugNameNormalizer');

/**
 * ============================================================================
 * Medicine Information Assistant - retrieval over a curated corpus
 * ============================================================================
 *
 * This is a retrieval system, not a generator. Every sentence it returns was
 * written by hand into `data/medicineKnowledgeBase.json` and is returned
 * verbatim. The service's job is to decide (a) whether a question is inside
 * the allowed scope and (b) which stored entry answers it.
 *
 * Guardrails, applied in this order:
 *
 *   1. REFUSE  A rule set matches questions asking for a diagnosis, a
 *              prescription, a dose change, a stop/continue decision, an
 *              interaction verdict, or urgent clinical advice. These are
 *              refused with a specific, useful redirection - never answered.
 *   2. RETRIEVE Exact match on the normalised substance name, then alias
 *              match, then a transparent keyword score over the entry text.
 *   3. GROUND  Only stored fields are returned, each labelled with the entry
 *              it came from. A medicine absent from the corpus produces
 *              "not in the knowledge base", never an invented answer.
 *
 * Because retrieval is scored arithmetic over a fixed corpus, the same
 * question always produces the same answer, and every answer is traceable to
 * a line in the JSON file.
 */

// ---------------------------------------------------------------- refusal rules
const REFUSAL_RULES = [
  {
    id: 'DIAGNOSIS',
    // "do I have", "what is wrong with me", "is this cancer", "why am I dizzy"
    pattern:
      /\b(do i have|have i got|am i having|is (this|it) (a |an )?(sign|symptom|cancer|infection|stroke|heart attack)|what('| i)s wrong with me|diagnos(e|is)|what condition|why (am|do) i (feel|have|get)|what causes my)\b/i,
    reason: 'diagnosis',
    message:
      'I cannot tell you what a symptom means or diagnose a condition. Please describe this to your doctor or pharmacist, who can examine you and see your full history.'
  },
  {
    id: 'PRESCRIBING',
    pattern:
      /\b(what (should|can|medicine|drug|tablet) (should |can )?i take|which medicine (should|can) i|prescribe|recommend a (medicine|drug|tablet|treatment)|what (do you|would you) recommend for my|best medicine for)\b/i,
    reason: 'prescribing',
    message:
      'I cannot recommend or prescribe a medicine. Choosing a treatment depends on your diagnosis, other conditions and other medicines - that decision belongs to your doctor.'
  },
  {
    id: 'DOSAGE_CHANGE',
    pattern:
      /\b(increase|decrease|reduce|double|halve|change|adjust|raise|lower)\b.{0,30}\b(dose|dosage|tablets?|mg)\b|\b(how (much|many)|what dose|which dose)\b.{0,40}\b(should i|can i|do i|to take)\b|\btake (two|three|extra|double)\b/i,
    reason: 'dosage_change',
    message:
      'I cannot suggest or change a dose. Your dose was chosen for you - please check with your doctor or pharmacist before altering anything, and follow the label on your pack.'
  },
  {
    id: 'STOP_CONTINUE',
    pattern:
      /\b(should i (stop|quit|continue|keep taking|carry on)|can i stop|is it (ok|okay|safe) to stop|do i (still )?need to (take|keep))\b/i,
    reason: 'stop_or_continue',
    message:
      'I cannot advise you to stop or continue a medicine. Stopping some medicines suddenly is harmful - please speak to your doctor or pharmacist first.'
  },
  {
    id: 'INTERACTION',
    pattern:
      /\b(interact|interaction|take .{1,40} (together|with|alongside) .{1,40}|safe to (take|combine|mix)|mix .{1,30} with)\b/i,
    reason: 'interaction',
    message:
      'Interaction questions are answered by the Drug Interactions screen, which checks your medicines against a fixed, reviewed dataset rather than describing them in prose. Please use that check, and confirm anything important with your pharmacist.',
    redirectTo: 'drug_interaction_checker'
  },
  {
    id: 'EMERGENCY',
    pattern:
      /\b(overdose|took too (many|much)|chest pain|can'?t breathe|cannot breathe|struggling to breathe|unconscious|bleeding heavily|suicid|poison|emergency|anaphyla)\b/i,
    reason: 'emergency',
    message:
      'This sounds urgent. Please contact your local emergency number or go to the nearest emergency department now. If you suspect an overdose, take the medicine pack with you.',
    urgent: true
  },
  {
    id: 'PERSONAL_CIRCUMSTANCE',
    pattern:
      /\b(i am pregnant|i'?m pregnant|while pregnant|during pregnancy|breastfeed|my (child|baby|son|daughter) (is|has|takes)|for my (child|baby)|my kidney|my liver disease)\b/i,
    reason: 'personal_circumstance',
    message:
      'Advice for pregnancy, breastfeeding, children or an existing medical condition has to be tailored to the individual. Please ask your doctor or pharmacist - they can check your specific situation.'
  }
];

// ---------------------------------------------------------------- index build
const bySubstance = new Map();
const byAlias = new Map();

for (const entry of knowledgeBase.entries) {
  const key = normalizeDrugName(entry.substance);
  bySubstance.set(key, entry);
  for (const alias of entry.aliases || []) {
    byAlias.set(normalizeDrugName(alias), entry);
  }
}

const STOP_WORDS = new Set([
  'the','a','an','is','are','was','were','of','for','to','in','on','and','or','it','its','my','me',
  'i','you','your','what','how','why','when','can','do','does','with','about','tell','this','that',
  'be','been','have','has','from','at','by','as','if','so','not','no','yes','please','know','more'
]);

function tokenise(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP_WORDS.has(t));
}

/** Flattened searchable text per entry, built once. */
const searchCorpus = knowledgeBase.entries.map((entry) => ({
  entry,
  tokens: tokenise(
    [
      entry.substance,
      entry.displayName,
      entry.drugClass,
      ...(entry.aliases || []),
      ...entry.commonUses,
      entry.howItWorks,
      ...entry.generalPrecautions,
      entry.storage,
      ...entry.commonSideEffects,
      ...entry.talkToYourDoctorIf
    ].join(' ')
  )
}));


// ---------------------------------------------------------------- public API

/**
 * Checks a free-text question against the refusal rules.
 * @returns {?{allowed: false, reason: string, message: string, ruleId: string}}
 */
function checkScope(question) {
  const text = String(question || '');
  for (const rule of REFUSAL_RULES) {
    if (rule.pattern.test(text)) {
      return {
        allowed: false,
        ruleId: rule.id,
        reason: rule.reason,
        message: rule.message,
        urgent: Boolean(rule.urgent),
        redirectTo: rule.redirectTo || null
      };
    }
  }
  return null;
}

/** Exact / alias lookup for one medicine name. */
function lookupMedicine(name) {
  const normalized = normalizeDrugName(name);
  if (!normalized) return null;
  return bySubstance.get(normalized) || byAlias.get(normalized) || null;
}

/**
 * Transparent keyword scoring: each query token that appears in an entry adds
 * to that entry's score, with a large bonus when the token is the entry's own
 * substance name or alias.
 */
function searchEntries(query, limit = 5) {
  const queryTokens = tokenise(query);
  if (!queryTokens.length) return [];

  const scored = searchCorpus.map(({ entry, tokens }) => {
    const tokenSet = new Set(tokens);
    let score = 0;
    const matchedTerms = [];

    for (const token of queryTokens) {
      if (!tokenSet.has(token)) continue;
      matchedTerms.push(token);
      const isName =
        normalizeDrugName(token) === normalizeDrugName(entry.substance) ||
        (entry.aliases || []).some((a) => normalizeDrugName(a) === normalizeDrugName(token));
      score += isName ? 10 : 1;
    }

    return { entry, score, matchedTerms };
  });

  return scored
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.entry.substance.localeCompare(b.entry.substance))
    .slice(0, limit);
}

/**
 * Answers a question about a medicine.
 *
 * @param {{question?: string, medicineName?: string, topic?: string}} input
 * @returns {object} an answer grounded entirely in the knowledge base
 */
function answer({ question = '', medicineName = '', topic } = {}) {
  const refusal = checkScope(`${question} ${medicineName}`.trim());
  if (refusal) {
    return {
      answered: false,
      ...refusal,
      disclaimer: knowledgeBase.demoDataNotice,
      source: 'guardrail'
    };
  }

  // Prefer an explicit medicine name; otherwise pull the best candidate from
  // the question text itself.
  let entry = medicineName ? lookupMedicine(medicineName) : null;
  let matchType = entry ? 'exact_name' : null;
  let alternatives = [];

  if (!entry) {
    const results = searchEntries(`${medicineName} ${question}`.trim());
    if (results.length) {
      entry = results[0].entry;
      matchType = 'keyword_search';
      alternatives = results.slice(1, 4).map((r) => ({
        substance: r.entry.substance,
        displayName: r.entry.displayName,
        score: r.score
      }));
    }
  }

  if (!entry) {
    return {
      answered: false,
      reason: 'not_in_knowledge_base',
      message: medicineName
        ? `"${medicineName}" is not in the MedGuardian medicine information base, so there is nothing reliable I can tell you about it. Please read the leaflet in the pack or ask your pharmacist.`
        : 'I could not match your question to any medicine in the information base. Try naming the medicine directly, for example "storage advice for metformin".',
      availableMedicines: knowledgeBase.entries.map((e) => e.displayName),
      disclaimer: knowledgeBase.demoDataNotice,
      source: 'knowledge_base'
    };
  }

  const sections = buildSections(entry, topic, question);

  return {
    answered: true,
    matchType,
    medicine: {
      substance: entry.substance,
      displayName: entry.displayName,
      drugClass: entry.drugClass
    },
    sections,
    alternatives,
    disclaimer: knowledgeBase.demoDataNotice,
    safetyNote:
      'This is general information only. It is not advice for your situation, it does not replace the leaflet in your pack, and it must not be used to change how you take your medicine.',
    source: 'curated_knowledge_base',
    knowledgeBaseVersion: knowledgeBase.version,
    generatedByModel: false
  };
}

const TOPIC_KEYWORDS = {
  uses: /\b(use|used|uses|what.*for|purpose|treat|indication)\b/i,
  howItWorks: /\b(how.*work|mechanism|what does it do|action)\b/i,
  precautions: /\b(precaution|careful|caution|warning|advice|before taking|avoid)\b/i,
  storage: /\b(stor(e|age)|keep|fridge|refrigerat|temperature|expire|expiry)\b/i,
  sideEffects: /\b(side effect|adverse|reaction|make me feel)\b/i,
  whenToSeekHelp: /\b(when.*(doctor|help|pharmacist)|worry|worried|concern|seek)\b/i
};

/**
 * Chooses which stored sections to return. An explicit `topic` wins; otherwise
 * the question's wording selects sections; otherwise everything is returned.
 */
function buildSections(entry, topic, question) {
  const all = {
    uses: { title: 'What it is commonly used for', items: entry.commonUses },
    howItWorks: { title: 'How it generally works', text: entry.howItWorks },
    precautions: { title: 'General precautions', items: entry.generalPrecautions },
    storage: { title: 'Storage', text: entry.storage },
    sideEffects: { title: 'Commonly reported side effects', items: entry.commonSideEffects },
    whenToSeekHelp: { title: 'Talk to your doctor or pharmacist if', items: entry.talkToYourDoctorIf }
  };

  if (topic && all[topic]) return { [topic]: all[topic] };

  const requested = Object.entries(TOPIC_KEYWORDS)
    .filter(([, pattern]) => pattern.test(question || ''))
    .map(([key]) => key);

  if (!requested.length) return all;

  const picked = {};
  for (const key of requested) picked[key] = all[key];
  // Safety guidance is always included.
  picked.whenToSeekHelp = all.whenToSeekHelp;
  return picked;
}

function knowledgeBaseInfo() {
  return {
    name: knowledgeBase.knowledgeBaseName,
    version: knowledgeBase.version,
    isDemoData: knowledgeBase.isDemoData,
    demoDataNotice: knowledgeBase.demoDataNotice,
    sourceNotes: knowledgeBase.sourceNotes,
    lastReviewed: knowledgeBase.lastReviewed,
    scopeRules: knowledgeBase.scopeRules,
    entryCount: knowledgeBase.entries.length,
    medicines: knowledgeBase.entries.map((e) => ({
      substance: e.substance,
      displayName: e.displayName,
      drugClass: e.drugClass
    })),
    method: 'curated-corpus-retrieval',
    generatedByModel: false,
    refusalRules: REFUSAL_RULES.map((r) => ({ id: r.id, reason: r.reason }))
  };
}

module.exports = {
  answer,
  checkScope,
  lookupMedicine,
  searchEntries,
  knowledgeBaseInfo,
  REFUSAL_RULES
};
