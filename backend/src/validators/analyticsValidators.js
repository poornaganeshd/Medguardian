'use strict';

const { z } = require('zod');
const { objectId } = require('./medicineValidators');

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Dates must be YYYY-MM-DD');

const adherenceQuerySchema = z.object({
  from: dateKey.optional(),
  to: dateKey.optional(),
  days: z.coerce.number().int().min(1).max(365).optional(),
  medicine: objectId.optional(),
  patientId: objectId.optional()
});

const refillQuerySchema = z.object({
  lookbackDays: z.coerce.number().int().min(7).max(180).optional(),
  patientId: objectId.optional()
});

const medicineIdParam = z.object({ medicineId: objectId });

module.exports = { adherenceQuerySchema, refillQuerySchema, medicineIdParam, dateKey };
