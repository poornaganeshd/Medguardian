'use strict';

const { z } = require('zod');
const { FREQUENCIES, MEAL_RELATIONS } = require('../models/Schedule');
const { objectId } = require('./medicineValidators');

const timeString = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Reminder time must be in HH:mm format');

const reminderTime = z.object({
  time: timeString,
  doseQuantity: z.coerce.number().positive('Dose quantity must be greater than zero').max(1000),
  label: z.string().trim().max(40).optional().or(z.literal(''))
});

const baseSchedule = {
  medicine: objectId,
  frequency: z.enum(FREQUENCIES),
  daysOfWeek: z.array(z.coerce.number().int().min(0).max(6)).max(7).optional(),
  intervalDays: z.coerce.number().int().min(1).max(90).optional(),
  cycleDaysOn: z.coerce.number().int().min(1).max(365).optional(),
  cycleDaysOff: z.coerce.number().int().min(1).max(365).optional(),
  times: z.array(reminderTime).max(12).optional(),
  asNeededDoseQuantity: z.coerce.number().positive().max(1000).optional(),
  maxDosesPerDay: z.coerce.number().int().min(1).max(24).optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional().nullable(),
  mealRelation: z.enum(MEAL_RELATIONS).optional(),
  notes: z.string().trim().max(500).optional().or(z.literal('')),
  graceMinutes: z.coerce.number().int().min(0).max(720).optional(),
  isActive: z.coerce.boolean().optional()
};

/** Cross-field rules mirroring the model's pre-validate hook. */
function applyFrequencyRules(schema) {
  return schema
    .refine(
      (d) =>
        d.frequency === 'as_needed' || (Array.isArray(d.times) && d.times.length > 0),
      { message: 'Add at least one reminder time', path: ['times'] }
    )
    .refine(
      (d) => d.frequency !== 'specific_days' || (d.daysOfWeek && d.daysOfWeek.length > 0),
      { message: 'Select at least one day of the week', path: ['daysOfWeek'] }
    )
    .refine((d) => d.frequency !== 'interval' || Boolean(d.intervalDays), {
      message: 'An interval in days is required',
      path: ['intervalDays']
    })
    .refine((d) => d.frequency !== 'cycle' || Boolean(d.cycleDaysOn && d.cycleDaysOff), {
      message: 'Both "days on" and "days off" are required',
      path: ['cycleDaysOn']
    })
    .refine((d) => !d.endDate || !d.startDate || d.endDate >= d.startDate, {
      message: 'The end date cannot be before the start date',
      path: ['endDate']
    })
    .refine(
      (d) => !d.times || new Set(d.times.map((t) => t.time)).size === d.times.length,
      { message: 'Reminder times must be unique', path: ['times'] }
    );
}

const createScheduleSchema = applyFrequencyRules(z.object(baseSchedule));

const updateScheduleSchema = applyFrequencyRules(
  z.object({ ...baseSchedule, medicine: objectId.optional(), frequency: z.enum(FREQUENCIES) })
);

const listSchedulesSchema = z.object({
  medicine: objectId.optional(),
  status: z.enum(['active', 'inactive', 'all']).default('active'),
  patientId: objectId.optional()
});

const setStatusSchema = z.object({
  isActive: z.coerce.boolean(),
  pauseReason: z.string().trim().max(200).optional()
});

/** Occurrence feed used by the reminder screen and medication history. */
const occurrencesQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  medicine: objectId.optional(),
  status: z
    .enum(['all', 'taken', 'skipped', 'upcoming', 'due', 'late', 'missed', 'pending'])
    .default('all'),
  patientId: objectId.optional()
});

module.exports = {
  createScheduleSchema,
  updateScheduleSchema,
  listSchedulesSchema,
  setStatusSchema,
  occurrencesQuerySchema,
  reminderTime
};
