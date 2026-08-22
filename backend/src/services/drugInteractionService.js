'use strict';

const dataset = require('../data/drugInteractions.json');
const { normalizeDrugName, splitCombination } = require('../utils/drugNameNormalizer');

/**
 * ============================================================================
 * Drug interaction engine - deterministic, dataset driven
 * ============================================================================
 *
 * This module answers exactly one question: "does the loaded dataset contain a
 * documented interaction between these two substances?" It performs a lookup,
 * nothing more.
 *
 * Design rules (these are hard requirements of the project, not preferences):
 *
 *  1. NO language model is involved at any point. Every fact returned -
 *     severity, description, mechanism, precautions - is copied verbatim from
 *     `data/drugInteractions.json`.
 *  2. The engine is DETERMINISTIC: the same two medicines always produce the
 *     same result, and a pair absent from the dataset returns "no known
 *     interaction *in this dataset*" rather than a guess.
 *  3. Matching happens on NORMALISED names (see `utils/drugNameNormalizer`),
 *     so "Tab. Ecosprin 75mg" and "aspirin" resolve to the same substance.
 *  4. Combination products are decomposed, so "Amoxicillin + Clavulanic acid"
 *     is checked as each of its substances.
 *  5. The dataset is bundled DEMO data. Every response carries the demo notice
 *     so a reviewer or patient is never misled about its completeness.
 */

/** Order-independent key for a substance pair. */
function pairKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Index built once at module load - lookups are then O(1). */
const interactionIndex = new Map();
for (const entry of dataset.interactions) {
  const a = normalizeDrugName(entry.drugA);
  const b = normalizeDrugName(entry.drugB);
  interactionIndex.set(pairKey(a, b), { ...entry, normalizedA: a, normalizedB: b });
}

const duplicateGroups = dataset.duplicateTherapyGroups.map((group) => ({
  ...group,
  normalizedMembers: group.members.map((m) => normalizeDrugName(m))
}));

const SEVERITY_RANK = { major: 3, moderate: 2, minor: 1 };

/**
 * Expands one medicine into the substances it contains.
 *
 * @param {{id?: string, name: string, genericName?: string, normalizedName?: string}} medicine
 * @returns {{id: ?string, label: string, substances: string[]}}
 */
function toSubstances(medicine) {
  const normalized =
    medicine.normalizedName || normalizeDrugName(medicine.genericName || medicine.name);
  return {
    id: medicine.id ?? medicine._id ?? null,
    label: medicine.name || medicine.genericName || normalized,
    normalized,
    substances: splitCombination(normalized)
  };
}

/**
 * Looks up a single substance pair.
 * @returns {?object} the dataset record, or null when the dataset has no entry
 */
function lookupPair(substanceA, substanceB) {
  if (!substanceA || !substanceB || substanceA === substanceB) return null;
  return interactionIndex.get(pairKey(substanceA, substanceB)) || null;
}

/**
 * Checks every pair among the supplied medicines.
 *
 * @param {Array<object>} medicines medicine records (or `{name}` objects)
 * @returns {{findings: Array, duplicateTherapy: Array, checkedPairs: number,
 *            summary: object, dataset: object, disclaimer: string}}
 */
function checkInteractions(medicines = []) {
  const items = medicines
    .map(toSubstances)
    .filter((item) => item.substances.length > 0);

  const findings = [];
  const seen = new Set();
  let checkedPairs = 0;

  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const left = items[i];
      const right = items[j];

      for (const substanceA of left.substances) {
        for (const substanceB of right.substances) {
          checkedPairs += 1;
          const match = lookupPair(substanceA, substanceB);
          if (!match) continue;

          // One finding per medicine pair per dataset record.
          const dedupeKey = `${left.id ?? left.label}|${right.id ?? right.label}|${match.id}`;
          if (seen.has(dedupeKey)) continue;
          seen.add(dedupeKey);

          findings.push({
            interactionId: match.id,
            severity: match.severity,
            medicineA: { id: left.id, name: left.label, substance: substanceA },
            medicineB: { id: right.id, name: right.label, substance: substanceB },
            description: match.description,
            mechanism: match.mechanism,
            precautions: match.precautions,
            source: 'dataset'
          });
        }
      }
    }
  }

  findings.sort(
    (a, b) => (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0)
  );

  const duplicateTherapy = findDuplicateTherapy(items);

  const summary = {
    medicinesChecked: items.length,
    checkedPairs,
    total: findings.length,
    major: findings.filter((f) => f.severity === 'major').length,
    moderate: findings.filter((f) => f.severity === 'moderate').length,
    minor: findings.filter((f) => f.severity === 'minor').length,
    duplicateTherapyGroups: duplicateTherapy.length,
    highestSeverity: findings.length ? findings[0].severity : null
  };

  return {
    findings,
    duplicateTherapy,
    summary,
    dataset: {
      name: dataset.datasetName,
      version: dataset.version,
      isDemoData: dataset.isDemoData,
      demoDataNotice: dataset.demoDataNotice,
      sourceNotes: dataset.sourceNotes,
      lastReviewed: dataset.lastReviewed,
      recordCount: dataset.interactions.length,
      severityScale: dataset.severityScale
    },
    disclaimer:
      'This check is a lookup against a bundled demo dataset and is not a substitute for professional advice. A result of "no interactions found" only means this dataset holds no record for these medicines. Always confirm with your pharmacist or doctor.',
    method: 'deterministic-dataset-lookup'
  };
}

/**
 * Flags two or more medicines from the same therapeutic group.
 * Duplicate paracetamol is treated as a special case: many combination
 * products hide it, so any two products containing it are worth flagging.
 */
function findDuplicateTherapy(items) {
  const results = [];

  for (const group of duplicateGroups) {
    const matches = items.filter((item) =>
      item.substances.some((s) => group.normalizedMembers.includes(s))
    );
    if (matches.length < 2) continue;

    results.push({
      groupId: group.id,
      groupName: group.groupName,
      severity: group.severity,
      description: group.description,
      precautions: group.precautions,
      medicines: matches.map((m) => ({ id: m.id, name: m.label })),
      source: 'dataset'
    });
  }

  return results.sort(
    (a, b) => (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0)
  );
}

/** Every substance the dataset knows about - used for client-side hints. */
function knownSubstances() {
  const set = new Set();
  for (const entry of dataset.interactions) {
    set.add(normalizeDrugName(entry.drugA));
    set.add(normalizeDrugName(entry.drugB));
  }
  for (const group of duplicateGroups) {
    group.normalizedMembers.forEach((m) => set.add(m));
  }
  return [...set].sort();
}

function datasetInfo() {
  return {
    name: dataset.datasetName,
    version: dataset.version,
    isDemoData: dataset.isDemoData,
    demoDataNotice: dataset.demoDataNotice,
    sourceNotes: dataset.sourceNotes,
    lastReviewed: dataset.lastReviewed,
    severityScale: dataset.severityScale,
    interactionCount: dataset.interactions.length,
    duplicateGroupCount: dataset.duplicateTherapyGroups.length,
    knownSubstanceCount: knownSubstances().length,
    method: 'deterministic-dataset-lookup',
    llmInvolved: false
  };
}

module.exports = {
  checkInteractions,
  lookupPair,
  findDuplicateTherapy,
  knownSubstances,
  datasetInfo,
  toSubstances,
  pairKey
};
