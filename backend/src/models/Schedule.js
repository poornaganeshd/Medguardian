'use strict';

const mongoose = require('mongoose');

const { Schema } = mongoose;

/**
 * How often a medicine is taken.
 *
 *  daily         - every day at the listed times
 *  specific_days - only on the listed weekdays (0 = Sunday .. 6 = Saturday)
 *  interval      - every N days, counted from startDate
 *  cycle         - N days on, M days off (e.g. some hormonal or steroid courses)
 *  as_needed     - no fixed times; the patient records a dose when they take one.
 *                  As-needed schedules produce NO expected doses, so they never
 *                  affect the adherence score.
 */
const FREQUENCIES = ['daily', 'specific_days', 'interval', 'cycle', 'as_needed'];

const MEAL_RELATIONS = ['any', 'before_meal', 'with_meal', 'after_meal', 'empty_stomach'];

const reminderTimeSchema = new Schema(
  {
    /** 24-hour local time, "HH:mm". */
    time: {
      type: String,
      required: true,
      match: [/^([01]\d|2[0-3]):[0-5]\d$/, 'Reminder time must be in HH:mm format']
    },
    /** Amount taken at this time, in the medicine's own unit. */
    doseQuantity: { type: Number, required: true, min: 0.001, default: 1 },
    label: { type: String, trim: true, maxlength: 40 }
  },
  { _id: true }
);

const scheduleSchema = new Schema(
  {
    patient: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    medicine: { type: Schema.Types.ObjectId, ref: 'Medicine', required: true, index: true },

    frequency: { type: String, enum: FREQUENCIES, required: true, default: 'daily' },

    /** Used when frequency = specific_days. 0 = Sunday. */
    daysOfWeek: {
      type: [{ type: Number, min: 0, max: 6 }],
      default: undefined
    },
    /** Used when frequency = interval: take every N days. */
    intervalDays: { type: Number, min: 1, max: 90 },
    /** Used when frequency = cycle. */
    cycleDaysOn: { type: Number, min: 1, max: 365 },
    cycleDaysOff: { type: Number, min: 1, max: 365 },

    /** One entry per dose per day. Empty for as-needed schedules. */
    times: { type: [reminderTimeSchema], default: [] },

    /** Dose used when an as-needed medicine is recorded. */
    asNeededDoseQuantity: { type: Number, min: 0.001, default: 1 },
    /** Safety cap shown to the user for as-needed medicines. */
    maxDosesPerDay: { type: Number, min: 1, max: 24 },

    startDate: { type: Date, required: true, default: () => new Date() },
    endDate: { type: Date },

    mealRelation: { type: String, enum: MEAL_RELATIONS, default: 'any' },
    notes: { type: String, trim: true, maxlength: 500 },

    /** Minutes after the scheduled time before a dose counts as LATE. */
    graceMinutes: { type: Number, min: 0, max: 720, default: 60 },

    isActive: { type: Boolean, default: true, index: true },
    pausedAt: { type: Date },
    pauseReason: { type: String, trim: true, maxlength: 200 }
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

scheduleSchema.index({ patient: 1, isActive: 1 });
scheduleSchema.index({ medicine: 1, isActive: 1 });

scheduleSchema.virtual('dosesPerDay').get(function dosesPerDay() {
  if (this.frequency === 'as_needed') return 0;
  return this.times.reduce((sum, t) => sum + (t.doseQuantity || 0), 0);
});

/** Validates that the fields required by the chosen frequency are present. */
scheduleSchema.pre('validate', function validateFrequency(next) {
  if (this.frequency === 'as_needed') {
    this.times = [];
  } else if (!this.times || this.times.length === 0) {
    return next(new Error('At least one reminder time is required for a fixed schedule'));
  }

  if (this.frequency === 'specific_days' && (!this.daysOfWeek || this.daysOfWeek.length === 0)) {
    return next(new Error('Select at least one day of the week'));
  }
  if (this.frequency === 'interval' && !this.intervalDays) {
    return next(new Error('An interval in days is required'));
  }
  if (this.frequency === 'cycle' && (!this.cycleDaysOn || !this.cycleDaysOff)) {
    return next(new Error('Both the "days on" and "days off" values are required for a cycle'));
  }
  if (this.endDate && this.startDate && this.endDate < this.startDate) {
    return next(new Error('The end date cannot be before the start date'));
  }

  // Duplicate times would create two reminders for the same moment.
  const seen = new Set();
  for (const entry of this.times) {
    if (seen.has(entry.time)) {
      return next(new Error(`Duplicate reminder time ${entry.time}`));
    }
    seen.add(entry.time);
  }

  return next();
});

module.exports = mongoose.model('Schedule', scheduleSchema);
module.exports.FREQUENCIES = FREQUENCIES;
module.exports.MEAL_RELATIONS = MEAL_RELATIONS;
