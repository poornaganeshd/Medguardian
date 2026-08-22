'use strict';

const { normalizeDrugName } = require('../utils/drugNameNormalizer');
const { extractMedicineCandidates } = require('./ocrService');

/**
 * ============================================================================
 * Visit / treatment summary - extractive, non-diagnostic
 * ============================================================================
 *
 * Turns a user-supplied visit note, discharge summary or prescription text
 * into an organised, readable summary.
 *
 * It is **extractive**: every line in the output is a sentence or fragment
 * lifted from the source document, grouped under a heading by rule-based
 * pattern matching. Nothing is paraphrased, inferred or invented, so the
 * summary can never introduce a clinical claim the document did not make.
 *
 * It is **non-diagnostic**: the service never interprets findings, never
 * assigns a condition, and attaches an explicit notice to every result.
 */

/** Section detectors, checked in order. The first match wins for each line. */
const SECTION_RULES = [
  {
    key: 'medications',
    title: 'Medicines mentioned',
    pattern:
      /\b(rx|tab\.?|cap\.?|syp\.?|inj\.?|tablet|capsule|syrup|mg\b|mcg\b|ml\b|\d\s*-\s*\d\s*-\s*\d|\b(od|bd|bid|tds|tid|qid|hs|sos|prn)\b)/i
  },
  {
    key: 'followUp',
    title: 'Follow-up and next steps',
    pattern:
      /\b(follow[- ]?up|review|revisit|come back|next (visit|appointment)|repeat (after|in)|recheck|refer(red)? to)\b/i
  },
  {
    key: 'investigations',
    title: 'Tests and investigations',
    pattern:
      /\b(test|investigation|lab|blood|urine|x[- ]?ray|scan|ecg|ekg|mri|ct\b|ultrasound|biopsy|hba1c|cbc|lft|kft|lipid|culture)\b/i
  },
  {
    key: 'advice',
    title: 'Advice given',
    pattern:
      /\b(advice|advised|instructed|recommend(ed)?|diet|exercise|rest|avoid|stop smoking|reduce|increase (water|fluid)|lifestyle|precaution)\b/i
  },
  {
    key: 'complaints',
    title: 'Reported symptoms and history',
    pattern:
      /\b(complain(t|s|ed)?|c\/o|history|h\/o|presenting|since \d|symptom|pain|fever|cough|since (last )?(week|month|day))\b/i
  },
  {
    key: 'observations',
    title: 'Recorded observations',
    pattern:
      /\b(bp|blood pressure|pulse|temp(erature)?|spo2|weight|height|bmi|sugar|glucose|\d{2,3}\s*\/\s*\d{2,3})\b/i
  },
  {
    key: 'diagnosisNotes',
    title: 'Notes recorded by the clinician',
    // Captured verbatim and clearly labelled as the clinician's words - the
    // service itself never asserts a diagnosis.
    pattern: /\b(diagnos(is|ed)|impression|assessment|provisional|k\/c\/o|known case)\b/i
  }
];

/** Lines that carry no clinical content. */
const NOISE_PATTERNS = [
  /^\s*[-=_*.]{3,}\s*$/,
  /^\s*(page\s*\d+|signature|sign|stamp|thank you|regards)\s*$/i,
  /^\s*\d+\s*$/
];

const HEADER_PATTERN =
  /^\s*(dr\.?|doctor|hospital|clinic|centre|center|pharmacy|reg(d)?\.?\s*no|licen[cs]e|gstin?)\b/i;

const PATIENT_FIELD_PATTERN =
  /^\s*(patient|name|age|sex|gender|address|phone|mobile|uhid|mrn|ip no|op no)\s*[:\-]/i;

const DATE_PATTERN =
  /\b(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{2,4})\b/i;

/**
 * @param {string} text raw document text (typed, pasted, or from OCR)
 * @param {{title?: string}} [options]
 * @returns {object} the structured summary
 */
function summariseVisit(text, options = {}) {
  const raw = String(text || '');
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .filter((l) => !NOISE_PATTERNS.some((p) => p.test(l)));

  if (!lines.length) {
    return {
      summarised: false,
      reason: 'empty_document',
      message: 'There was no readable text to summarise. Paste the note, or upload a clearer photo.',
      disclaimer: DISCLAIMER
    };
  }

  const sections = {};
  const unclassified = [];
  const provider = [];
  const dates = new Set();

  for (const line of lines) {
    const dateMatch = line.match(DATE_PATTERN);
    if (dateMatch) dates.add(dateMatch[0]);

    if (HEADER_PATTERN.test(line)) {
      provider.push(line);
      continue;
    }
    if (PATIENT_FIELD_PATTERN.test(line)) continue; // never echo patient identifiers

    const rule = SECTION_RULES.find((r) => r.pattern.test(line));
    if (rule) {
      if (!sections[rule.key]) sections[rule.key] = { title: rule.title, lines: [] };
      sections[rule.key].lines.push(line);
    } else if (line.length > 12) {
      unclassified.push(line);
    }
  }

  // Medicines get the same structured treatment as an OCR prescription.
  const medicines = extractMedicineCandidates(
    (sections.medications?.lines || []).join('\n') || raw
  ).map((c) => ({
    rawText: c.rawText,
    suggestedName: c.suggestedName,
    normalizedName: c.normalizedName,
    strength: c.strength,
    dosageForm: c.dosageForm,
    frequencyHint: c.frequencyHint,
    confidence: c.confidence
  }));

  const orderedSections = SECTION_RULES.filter((r) => sections[r.key]).map((r) => ({
    key: r.key,
    title: sections[r.key].title,
    lines: sections[r.key].lines
  }));

  return {
    summarised: true,
    title: options.title || 'Visit summary',
    provider: provider.slice(0, 3),
    datesFound: [...dates].slice(0, 5),
    sections: orderedSections,
    medicines,
    otherNotes: unclassified.slice(0, 15),
    stats: {
      sourceLines: lines.length,
      classifiedLines: orderedSections.reduce((n, s) => n + s.lines.length, 0),
      medicinesFound: medicines.length
    },
    method: 'rule-based-extractive',
    generatedByModel: false,
    isDiagnostic: false,
    disclaimer: DISCLAIMER
  };
}

const DISCLAIMER =
  'This summary only reorganises the text you supplied - every line is taken from your own document and nothing has been interpreted, diagnosed or added. It is not medical advice. Check anything important against the original document and with your doctor or pharmacist.';

/**
 * Compares the medicines a document mentions against the patient's own list,
 * so they can spot something that was started, stopped or renamed.
 * This is a set comparison only - it makes no clinical judgement.
 */
function reconcileMedicines(documentMedicines = [], patientMedicines = []) {
  const inDocument = new Map();
  for (const m of documentMedicines) {
    const key = m.normalizedName || normalizeDrugName(m.suggestedName || m.name);
    if (key) inDocument.set(key, m);
  }

  const onList = new Map();
  for (const m of patientMedicines) {
    const key = m.normalizedName || normalizeDrugName(m.genericName || m.name);
    if (key) onList.set(key, m);
  }

  const inBoth = [];
  const onlyInDocument = [];
  const onlyOnYourList = [];

  for (const [key, value] of inDocument) {
    if (onList.has(key)) inBoth.push({ substance: key, document: value, yourList: onList.get(key) });
    else onlyInDocument.push({ substance: key, document: value });
  }
  for (const [key, value] of onList) {
    if (!inDocument.has(key)) onlyOnYourList.push({ substance: key, yourList: value });
  }

  return {
    inBoth,
    onlyInDocument,
    onlyOnYourList,
    note:
      'This is a name comparison only. A medicine appearing in just one list is not necessarily an error - your doctor or pharmacist can confirm what you should be taking.'
  };
}

module.exports = { summariseVisit, reconcileMedicines, SECTION_RULES, DISCLAIMER };
