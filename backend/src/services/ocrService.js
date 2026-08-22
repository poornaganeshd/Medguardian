'use strict';

const fs = require('fs/promises');
const sharp = require('sharp');

const { config } = require('../config/env');
const logger = require('../config/logger');
const { normalizeDrugName } = require('../utils/drugNameNormalizer');
const { knownSubstances } = require('./drugInteractionService');

/**
 * ============================================================================
 * OCR + medicine-name extraction
 * ============================================================================
 *
 * Tesseract reads the text off an uploaded prescription or report. The parser
 * below then looks for lines that *look like* a medicine entry and turns them
 * into SUGGESTIONS.
 *
 * The rule this module exists to enforce:
 *
 *   **OCR output is never trusted and never written to the medicine list
 *   automatically.** Suggestions are returned with a confidence score, the
 *   record is marked `awaiting_verification`, and only an explicit
 *   confirmation from the patient (POST .../ocr/confirm) creates medicines.
 *
 * Everything in the parser is regex/dictionary based, so it is inspectable and
 * repeatable. No language model is used to invent or complete a drug name.
 */

const KNOWN_SUBSTANCES = new Set(knownSubstances());

/** Words that commonly appear on prescriptions but are not medicines. */
const STOP_LINES = [
  /^(dr|doctor|hospital|clinic|pharmacy|patient|name|age|sex|gender|date|address|phone|mobile|reg|regd|licence|license|gst|bill|invoice|total|amount|qty|rate|signature|advice|diagnosis|follow|review|next|visit)\b/i,
  /^\s*[-=_*]{3,}\s*$/,
  /^\d+[.)]?\s*$/
];

/** "500 mg", "5ml", "10 mcg", "1 g" */
const STRENGTH_RE = /(\d+(?:\.\d+)?)\s*(mg|mcg|µg|g|ml|iu|units?|%)\b/i;

const DOSAGE_FORM_RE =
  /\b(tab|tabs|tablet|tablets|cap|caps|capsule|capsules|syrup|syp|suspension|susp|injection|inj|drops?|cream|ointment|gel|inhaler|spray|patch|sachet|solution)\b/i;

/** "1-0-1", "1 0 1", "bd", "tds", "od", "qid", "twice daily", "once a day" */
const FREQUENCY_RE =
  /(\b\d\s*[-–]\s*\d\s*[-–]\s*\d\b|\b(od|bd|bid|tds|tid|qid|qds|hs|sos|prn|stat)\b|\b(once|twice|thrice|one|two|three|four)\s+(a\s+)?(times?\s+)?(daily|a\s+day|per\s+day|weekly)\b|\bevery\s+\d+\s+(hours?|days?)\b)/i;

/** Leading "Tab.", "1)", "2.", "Rx" noise. */
const LINE_PREFIX_RE = /^\s*(?:rx[:.]?\s*)?(?:\d+\s*[.)]\s*)?(?:tab\.?|cap\.?|syp\.?|inj\.?)?\s*/i;

/**
 * Runs Tesseract over an image file.
 *
 * @param {string} absolutePath
 * @param {string} [language]
 * @returns {Promise<{text: string, confidence: number}>}
 */
async function recogniseImage(absolutePath, language = config.ocr.lang) {
  // Required lazily: tesseract.js pulls in worker assets, and OCR can be
  // switched off entirely via OCR_ENABLED.
  // eslint-disable-next-line global-require
  const Tesseract = require('tesseract.js');

  // Pre-process for legibility: greyscale, normalise contrast, upscale small
  // scans. This measurably improves recognition on phone photos.
  const prepared = await sharp(absolutePath)
    .rotate()
    .greyscale()
    .normalise()
    .resize({ width: 1600, fit: 'inside', withoutEnlargement: false })
    .png()
    .toBuffer();

  const result = await Tesseract.recognize(prepared, language, {
    logger: () => undefined
  });

  return {
    text: result?.data?.text || '',
    confidence: Math.round(result?.data?.confidence ?? 0)
  };
}

/**
 * Extracts candidate medicine entries from raw OCR text.
 *
 * A line becomes a candidate when it contains a plausible drug token AND at
 * least one supporting signal (a strength, a dosage form, or a frequency).
 * Confidence is a transparent additive score, not a model output.
 *
 * @param {string} text
 * @returns {Array<{rawText: string, normalizedName: string, strength?: string,
 *   dosageForm?: string, frequencyHint?: string, confidence: number,
 *   matchedKnownSubstance: boolean}>}
 */
function extractMedicineCandidates(text) {
  if (!text || typeof text !== 'string') return [];

  const candidates = [];
  const seen = new Set();

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+/g, ' ').trim();
    if (line.length < 3 || line.length > 160) continue;
    if (STOP_LINES.some((re) => re.test(line))) continue;

    const strengthMatch = line.match(STRENGTH_RE);
    const formMatch = line.match(DOSAGE_FORM_RE);
    const frequencyMatch = line.match(FREQUENCY_RE);

    // The name is the text before the strength, with list/form prefixes removed.
    let namePart = (strengthMatch ? line.slice(0, strengthMatch.index) : line)
      .replace(LINE_PREFIX_RE, '')
      .replace(DOSAGE_FORM_RE, ' ')
      .replace(FREQUENCY_RE, ' ')
      .replace(/[^A-Za-z0-9 +/-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // Drop trailing single letters and stray digits left behind by cleaning.
    namePart = namePart.replace(/\b[a-z]\b/gi, ' ').replace(/\s+/g, ' ').trim();
    if (namePart.length < 3) continue;
    // A plausible drug name has at least three consecutive letters.
    if (!/[A-Za-z]{3,}/.test(namePart)) continue;
    // Keep it to the first few words - prescriptions often append instructions.
    namePart = namePart.split(' ').slice(0, 4).join(' ');

    const normalized = normalizeDrugName(namePart);
    if (!normalized || normalized.length < 3) continue;

    const matchedKnownSubstance = normalized
      .split('+')
      .some((part) => KNOWN_SUBSTANCES.has(part));

    // ---- transparent additive confidence ------------------------------
    let confidence = 0.2;
    if (matchedKnownSubstance) confidence += 0.45;
    if (strengthMatch) confidence += 0.2;
    if (formMatch) confidence += 0.1;
    if (frequencyMatch) confidence += 0.1;
    confidence = Math.min(1, Math.round(confidence * 100) / 100);

    // Require at least one supporting signal beyond a bare word.
    if (!matchedKnownSubstance && !strengthMatch && !formMatch && !frequencyMatch) continue;

    if (seen.has(normalized)) continue;
    seen.add(normalized);

    candidates.push({
      rawText: line,
      suggestedName: namePart,
      normalizedName: normalized,
      strength: strengthMatch ? `${strengthMatch[1]} ${strengthMatch[2].toLowerCase()}` : undefined,
      dosageForm: formMatch ? canonicalForm(formMatch[1]) : undefined,
      frequencyHint: frequencyMatch ? frequencyMatch[0].trim() : undefined,
      confidence,
      matchedKnownSubstance
    });
  }

  return candidates.sort((a, b) => b.confidence - a.confidence).slice(0, 20);
}

const FORM_ALIASES = {
  tab: 'tablet',
  tabs: 'tablet',
  tablets: 'tablet',
  cap: 'capsule',
  caps: 'capsule',
  capsules: 'capsule',
  syp: 'syrup',
  susp: 'suspension',
  inj: 'injection',
  drop: 'drops',
  solution: 'suspension'
};

function canonicalForm(raw) {
  const key = raw.toLowerCase();
  return FORM_ALIASES[key] || key;
}

/**
 * Full pipeline for one uploaded file.
 *
 * @param {{absolutePath: string, mimeType: string}} file
 * @returns {Promise<object>} an `ocr` sub-document ready to store
 */
async function processDocument({ absolutePath, mimeType }) {
  if (!config.ocr.enabled) {
    return { status: 'not_run', error: 'OCR is disabled on this server' };
  }

  const isImage = ['image/jpeg', 'image/png', 'image/webp'].includes(mimeType);
  if (!isImage) {
    return {
      status: 'unsupported',
      error:
        mimeType === 'application/pdf'
          ? 'PDF text extraction is not enabled. Upload a photo or screenshot of the page to run OCR.'
          : `OCR is not supported for ${mimeType}`
    };
  }

  try {
    await fs.access(absolutePath);
  } catch {
    return { status: 'failed', error: 'The uploaded file could not be read' };
  }

  try {
    const { text, confidence } = await recogniseImage(absolutePath);
    const suggestedMedicines = extractMedicineCandidates(text);

    return {
      status: 'completed',
      engine: 'tesseract.js',
      language: config.ocr.lang,
      confidence,
      extractedText: text.slice(0, 60000),
      suggestedMedicines,
      // Nothing is saved to the medicine list until the patient confirms.
      verificationStatus: suggestedMedicines.length ? 'awaiting_verification' : 'not_required',
      processedAt: new Date()
    };
  } catch (err) {
    logger.error('OCR failed:', err.message);
    return { status: 'failed', error: err.message.slice(0, 500), processedAt: new Date() };
  }
}

module.exports = { processDocument, extractMedicineCandidates, recogniseImage };
