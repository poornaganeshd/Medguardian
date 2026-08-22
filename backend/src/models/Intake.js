'use strict';

const mongoose = require('mongoose');

const { Schema } = mongoose;

const INTAKE_STATUSES = ['taken', 'skipped'];

/**
 * A recorded action against one scheduled dose (or one as-needed dose).
 *
 * Only doses the patient acted on are stored. Everything else is derived at
 * read time by `scheduleService.expandSchedule`, which keeps the collection
 * proportional to real activity rather than to elapsed time.
 *
 * `status` is deliberately limited to what the patient asserts. LATE / DUE /
 * MISSED are *derived* states (see `scheduleService.deriveStatus`) - storing
 * them would let the database drift out of step with the clock.
 */
const intakeSchema = new Schema(
  {
    patient: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    medicine: { type: Schema.Types.ObjectId, ref: 'Medicine', required: true, index: true },
    schedule: { type: Schema.Types.ObjectId, ref: 'Schedule', index: true },

    /** Local calendar date of the dose, "YYYY-MM-DD" in the patient timezone. */
    dateKey: {
      type: String,
      required: true,
      match: [/^\d{4}-\d{2}-\d{2}$/, 'dateKey must be YYYY-MM-DD']
    },
    /** "HH:mm" of the scheduled slot; "prn" for an as-needed dose. */
    scheduledTime: { type: String, required: true, maxlength: 5 },
    /** Absolute instant the dose was scheduled for (null for as-needed). */
    scheduledAt: { type: Date },

    status: { type: String, enum: INTAKE_STATUSES, required: true },

    /** When the patient actually took it (may differ from scheduledAt). */
    takenAt: { type: Date },
    /** True when recorded after the schedule's grace window expired. */
    wasLate: { type: Boolean, default: false },
    /** Minutes between the scheduled instant and takenAt (negative = early). */
    minutesLate: { type: Number },

    /** Amount consumed, in the medicine's unit. 0 for a skipped dose. */
    doseQuantity: { type: Number, required: true, min: 0, default: 1 },

    skipReason: {
      type: String,
      enum: [
        'forgot',
        'felt_better',
        'side_effects',
        'ran_out',
        'doctor_advice',
        'not_needed',
        'other',
        null
      ],
      default: null
    },
    notes: { type: String, trim: true, maxlength: 500 },

    /** True when the medicine has no fixed schedule (as-needed / PRN). */
    isAsNeeded: { type: Boolean, default: false },

    /** Set when a caregiver recorded the dose on the patient's behalf. */
    recordedBy: { type: Schema.Types.ObjectId, ref: 'User' },

    /** Stock left immediately after this record was applied (audit aid). */
    stockAfter: { type: Number, min: 0 }
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

/**
 * One record per scheduled slot. The partial filter keeps as-needed doses
 * (which legitimately repeat within a day) out of the uniqueness constraint.
 */
intakeSchema.index(
  { schedule: 1, dateKey: 1, scheduledTime: 1 },
  { unique: true, partialFilterExpression: { isAsNeeded: false } }
);
intakeSchema.index({ patient: 1, dateKey: -1 });
intakeSchema.index({ medicine: 1, dateKey: -1 });
intakeSchema.index({ patient: 1, createdAt: -1 });

module.exports = mongoose.model('Intake', intakeSchema);
module.exports.INTAKE_STATUSES = INTAKE_STATUSES;
