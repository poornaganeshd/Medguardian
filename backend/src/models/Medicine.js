'use strict';

const mongoose = require('mongoose');
const { normalizeDrugName } = require('../utils/drugNameNormalizer');

const { Schema } = mongoose;

const DOSAGE_FORMS = [
  'tablet',
  'capsule',
  'syrup',
  'suspension',
  'injection',
  'drops',
  'inhaler',
  'cream',
  'ointment',
  'gel',
  'patch',
  'suppository',
  'powder',
  'spray',
  'other'
];

const UNITS = ['tablet', 'capsule', 'ml', 'mg', 'drop', 'puff', 'unit', 'sachet', 'application'];

const imageSchema = new Schema(
  {
    filename: { type: String, trim: true },
    originalName: { type: String, trim: true },
    mimeType: { type: String, trim: true },
    size: { type: Number, min: 0 },
    // Served through an authenticated endpoint, never as a public static path.
    url: { type: String, trim: true },
    thumbnailUrl: { type: String, trim: true },
    uploadedAt: { type: Date }
  },
  { _id: false }
);

const medicineSchema = new Schema(
  {
    patient: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    // ---- identity -------------------------------------------------------
    name: { type: String, required: [true, 'Medicine name is required'], trim: true, maxlength: 160 },
    genericName: { type: String, trim: true, maxlength: 160 },
    /**
     * Lower-cased, punctuation-stripped form of `genericName || name`.
     * The drug-interaction engine matches on this field only, so that
     * "Aspirin 75mg" and "aspirin" resolve to the same substance.
     */
    normalizedName: { type: String, trim: true, index: true },
    manufacturer: { type: String, trim: true, maxlength: 160 },

    // ---- presentation ---------------------------------------------------
    strength: { type: String, trim: true, maxlength: 60 }, // e.g. "500 mg"
    dosageForm: { type: String, enum: DOSAGE_FORMS, default: 'tablet' },
    unit: { type: String, enum: UNITS, default: 'tablet' },
    color: { type: String, trim: true, maxlength: 40 },
    shape: { type: String, trim: true, maxlength: 40 },

    // ---- guidance -------------------------------------------------------
    instructions: { type: String, trim: true, maxlength: 1000 },
    prescriberNotes: { type: String, trim: true, maxlength: 1000 },
    prescribedBy: { type: String, trim: true, maxlength: 160 },
    purpose: { type: String, trim: true, maxlength: 240 },
    storageInstructions: { type: String, trim: true, maxlength: 500 },

    // ---- stock ----------------------------------------------------------
    initialQuantity: { type: Number, min: 0, default: 0 },
    currentStock: { type: Number, min: 0, default: 0 },
    refillThreshold: { type: Number, min: 0, default: 5 },
    lastRefillAt: { type: Date },
    lastRefillQuantity: { type: Number, min: 0 },
    expiryDate: { type: Date },

    image: { type: imageSchema, default: undefined },

    isActive: { type: Boolean, default: true, index: true },
    archivedAt: { type: Date }
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

// A patient should not hold two active entries for the same product.
medicineSchema.index({ patient: 1, name: 1 }, { unique: false });
medicineSchema.index({ patient: 1, isActive: 1, name: 1 });

medicineSchema.virtual('needsRefill').get(function needsRefill() {
  return this.currentStock <= this.refillThreshold;
});

medicineSchema.virtual('isExpired').get(function isExpired() {
  return Boolean(this.expiryDate && this.expiryDate.getTime() < Date.now());
});

medicineSchema.virtual('displayName').get(function displayName() {
  return this.strength ? `${this.name} ${this.strength}` : this.name;
});

/** Keep `normalizedName` in sync with the substance identity fields. */
medicineSchema.pre('validate', function syncNormalized(next) {
  if (this.isModified('name') || this.isModified('genericName') || !this.normalizedName) {
    this.normalizedName = normalizeDrugName(this.genericName || this.name);
  }
  next();
});

module.exports = mongoose.model('Medicine', medicineSchema);
module.exports.DOSAGE_FORMS = DOSAGE_FORMS;
module.exports.UNITS = UNITS;
