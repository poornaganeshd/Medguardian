'use strict';

/**
 * Deterministic drug-name normalisation.
 *
 * Used by both the medicine records and the drug-interaction engine so that
 * user-typed brand strings resolve to a single canonical key. Everything here
 * is rule based - there is no model, no guessing, and the same input always
 * produces the same output.
 */

/** Dosage / packaging noise that carries no identity information. */
const NOISE_TOKENS = new Set([
  'tab', 'tabs', 'tablet', 'tablets',
  'cap', 'caps', 'capsule', 'capsules',
  'syrup', 'syp', 'suspension', 'susp', 'solution', 'soln',
  'injection', 'inj', 'ampoule', 'vial',
  'drops', 'drop', 'eye', 'ear',
  'cream', 'ointment', 'gel', 'lotion', 'patch', 'spray', 'inhaler', 'sachet',
  'oral', 'topical', 'iv', 'im', 'sc',
  'sr', 'xr', 'cr', 'er', 'la', 'md', 'dt', 'ds', 'mr', 'od',
  'film', 'coated', 'filmcoated', 'extended', 'release', 'sustained',
  'prolonged', 'delayed', 'dispersible', 'chewable', 'effervescent',
  'forte', 'plus', 'strip', 'pack', 'bottle', 'tube'
]);

/** Common brand -> active-substance mappings used by the demo dataset. */
const BRAND_TO_GENERIC = new Map(
  Object.entries({
    crocin: 'paracetamol',
    calpol: 'paracetamol',
    dolo: 'paracetamol',
    tylenol: 'paracetamol',
    acetaminophen: 'paracetamol',
    panadol: 'paracetamol',
    brufen: 'ibuprofen',
    combiflam: 'ibuprofen',
    advil: 'ibuprofen',
    motrin: 'ibuprofen',
    disprin: 'aspirin',
    ecosprin: 'aspirin',
    acetylsalicylicacid: 'aspirin',
    augmentin: 'amoxicillin',
    amoxil: 'amoxicillin',
    zithromax: 'azithromycin',
    azithral: 'azithromycin',
    glucophage: 'metformin',
    glycomet: 'metformin',
    coumadin: 'warfarin',
    lipitor: 'atorvastatin',
    atorva: 'atorvastatin',
    zocor: 'simvastatin',
    prilosec: 'omeprazole',
    omez: 'omeprazole',
    pantop: 'pantoprazole',
    pan: 'pantoprazole',
    losar: 'losartan',
    amlong: 'amlodipine',
    norvasc: 'amlodipine',
    lasix: 'furosemide',
    concor: 'bisoprolol',
    telma: 'telmisartan',
    thyronorm: 'levothyroxine',
    eltroxin: 'levothyroxine',
    synthroid: 'levothyroxine',
    zoloft: 'sertraline',
    prozac: 'fluoxetine',
    ciplox: 'ciprofloxacin',
    cipro: 'ciprofloxacin',
    flagyl: 'metronidazole',
    metrogyl: 'metronidazole',
    allegra: 'fexofenadine',
    cetzine: 'cetirizine',
    zyrtec: 'cetirizine',
    montair: 'montelukast',
    deriphyllin: 'theophylline',
    wysolone: 'prednisolone',
    omnacortil: 'prednisolone',
    shelcal: 'calciumcarbonate',
    'digene': 'antacid'
  })
);

/**
 * @param {string} input raw medicine name as typed by the user
 * @returns {string} canonical key, e.g. "Tab. Ecosprin 75mg" -> "aspirin"
 */
function normalizeDrugName(input) {
  if (!input || typeof input !== 'string') return '';

  let text = input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents
    .replace(/[®™©]/g, ' ')
    .replace(/\(.*?\)/g, ' ')              // drop parenthetical notes
    .replace(/\d+(\.\d+)?\s*(mg|mcg|µg|g|ml|l|iu|units?|%)\b/g, ' ') // dosages
    .replace(/[^a-z0-9\s+/-]/g, ' ');      // keep + and / for combinations

  // Combination products keep every substance, joined with '+'.
  const parts = text.split(/[+/]/).map((part) => cleanTokens(part)).filter(Boolean);

  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];
  return parts.sort().join('+');
}

function cleanTokens(segment) {
  const tokens = segment
    .split(/\s+/)
    .map((t) => t.replace(/[-]/g, '').trim())
    .filter(Boolean)
    .filter((t) => !NOISE_TOKENS.has(t))
    .filter((t) => !/^\d+$/.test(t));

  if (!tokens.length) return '';

  const joined = tokens.join('');
  if (BRAND_TO_GENERIC.has(joined)) return BRAND_TO_GENERIC.get(joined);

  // A leading brand token wins over trailing descriptors ("dolo 650" -> paracetamol)
  for (const token of tokens) {
    if (BRAND_TO_GENERIC.has(token)) return BRAND_TO_GENERIC.get(token);
  }
  return joined;
}

/** Splits a normalised combination key into its individual substances. */
function splitCombination(normalized) {
  if (!normalized) return [];
  return normalized.split('+').filter(Boolean);
}

module.exports = { normalizeDrugName, splitCombination, BRAND_TO_GENERIC, NOISE_TOKENS };
