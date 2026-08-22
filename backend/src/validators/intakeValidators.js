'use strict';

const { z } = require('zod');
const { objectId } = require('./medicineValidators');

const SKIP_REASONS = [
  'forgot',
  'felt_better',
  'side_effects',
  'ran_out',
  'doctor_advice',
  'not_needed',
  'other'
];

/**
 * Records one scheduled dose. `dateKey` + `scheduledTime` identify the slot
 * produced by the schedule expansion, so the client sends back exactly what
 * the occurrence feed gave it.
 */
const recordIntakeSchema = z
  .object({
    schedule: objectId,
    dateKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dateKey must be YYYY-MM-DD'),
    scheduledTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'scheduledTime must be HH:mm'),
    status: z.enum(['taken', 'skipped']),
    takenAt: z.coerce.date().optional(),
    doseQuantity: z.coerce.number().min(0).max(1000).optional(),
    skipReason: z.enum(SKIP_REASONS).optional(),
    notes: z.string().trim().max(500).optional().or(z.literal('')),
    patientId: objectId.optional()
  })
  .refine((d) => d.status !== 'skipped' || Boolean(d.skipReason), {
    message: 'Please say why the dose was skipped',
    path: ['skipReason']
  });

/** Records an as-needed (PRN) dose - no schedule slot involved. */
const recordAsNeededSchema = z.object({
  medicine: objectId,
  schedule: objectId.optional(),
  takenAt: z.coerce.date().optional(),
  doseQuantity: z.coerce.number().positive().max(1000).optional(),
  notes: z.string().trim().max(500).optional().or(z.literal('')),
  patientId: objectId.optional()
});

const updateIntakeSchema = z
  .object({
    status: z.enum(['taken', 'skipped']).optional(),
    takenAt: z.coerce.date().optional(),
    doseQuantity: z.coerce.number().min(0).max(1000).optional(),
    skipReason: z.enum(SKIP_REASONS).optional().nullable(),
    notes: z.string().trim().max(500).optional().or(z.literal(''))
  })
  .refine((d) => Object.keys(d).length > 0, 'No fields supplied to update');

const listIntakesSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  medicine: objectId.optional(),
  status: z.enum(['taken', 'skipped', 'all']).default('all'),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  patientId: objectId.optional()
});

module.exports = {
  recordIntakeSchema,
  recordAsNeededSchema,
  updateIntakeSchema,
  listIntakesSchema,
  SKIP_REASONS
};
