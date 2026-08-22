'use strict';

const mongoose = require('mongoose');

const { Schema } = mongoose;

const RECORD_CATEGORIES = [
  'prescription',
  'pharmacy_bill',
  'lab_report',
  'discharge_summary',
  'imaging',
  'vaccination',
  'insurance',
  'referral',
  'consultation_note',
  'other'
];

const fileSchema = new Schema(
  {
    filename: { type: String, required: true, trim: true },
    originalName: { type: String, trim: true },
    mimeType: { type: String, trim: true },
    size: { type: Number, min: 0 },
    /** Authenticated download endpoint - never a static path. */
    url: { type: String, trim: true },
    checksum: { type: String, trim: true },
    uploadedAt: { type: Date, default: Date.now }
  },
  { _id: false }
);

/** Result of running OCR over an uploaded document. */
const ocrSchema = new Schema(
  {
    status: {
      type: String,
      enum: ['not_run', 'pending', 'completed', 'failed', 'unsupported'],
      default: 'not_run'
    },
    engine: { type: String, default: 'tesseract.js' },
    language: { type: String, default: 'eng' },
    confidence: { type: Number, min: 0, max: 100 },
    extractedText: { type: String, maxlength: 60000 },
    /**
     * Candidate medicine names found in the text. These are SUGGESTIONS ONLY.
     * Nothing is written to the medicine list until the patient reviews and
     * confirms them - see `verificationStatus`.
     */
    suggestedMedicines: [
      {
        rawText: { type: String, trim: true },
        normalizedName: { type: String, trim: true },
        strength: { type: String, trim: true },
        dosageForm: { type: String, trim: true },
        frequencyHint: { type: String, trim: true },
        confidence: { type: Number, min: 0, max: 1 },
        matchedKnownSubstance: { type: Boolean, default: false }
      }
    ],
    verificationStatus: {
      type: String,
      enum: ['not_required', 'awaiting_verification', 'verified', 'rejected'],
      default: 'not_required'
    },
    verifiedAt: { type: Date },
    processedAt: { type: Date },
    error: { type: String, trim: true, maxlength: 500 }
  },
  { _id: false }
);

const medicalRecordSchema = new Schema(
  {
    patient: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    title: { type: String, required: [true, 'Title is required'], trim: true, maxlength: 200 },
    category: { type: String, enum: RECORD_CATEGORIES, required: true, index: true },
    /** Date the document itself refers to (visit date, test date, bill date). */
    recordDate: { type: Date, required: true, default: () => new Date(), index: true },
    description: { type: String, trim: true, maxlength: 2000 },

    provider: { type: String, trim: true, maxlength: 200 },
    doctorName: { type: String, trim: true, maxlength: 160 },
    /** Free-form structured extras (test values, bill amount, etc.). */
    metadata: { type: Map, of: String, default: undefined },
    tags: [{ type: String, trim: true, lowercase: true, maxlength: 40 }],

    /** Medicines this record relates to, if the patient links them. */
    relatedMedicines: [{ type: Schema.Types.ObjectId, ref: 'Medicine' }],

    file: { type: fileSchema, default: undefined },
    ocr: { type: ocrSchema, default: () => ({}) },

    /**
     * Records are private by default. A caregiver sees a record only when the
     * patient marks it shareable AND holds the viewRecords permission.
     */
    shareableWithCaregivers: { type: Boolean, default: false, index: true },

    /** Extra sensitivity flag - these always require PIN step-up to open. */
    isSensitive: { type: Boolean, default: false },

    lastAccessedAt: { type: Date },
    accessCount: { type: Number, default: 0 }
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(doc, ret) {
        delete ret.__v;
        return ret;
      }
    },
    toObject: { virtuals: true }
  }
);

medicalRecordSchema.index({ patient: 1, recordDate: -1 });
medicalRecordSchema.index({ patient: 1, category: 1, recordDate: -1 });
medicalRecordSchema.index({ title: 'text', description: 'text' });

medicalRecordSchema.virtual('hasFile').get(function hasFile() {
  return Boolean(this.file?.filename);
});

module.exports = mongoose.model('MedicalRecord', medicalRecordSchema);
module.exports.RECORD_CATEGORIES = RECORD_CATEGORIES;
