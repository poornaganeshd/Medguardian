'use strict';

const { z } = require('zod');
const { DOSAGE_FORMS, UNITS } = require('../models/Medicine');

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid identifier');

const baseMedicine = {
  name: z.string().trim().min(1, 'Medicine name is required').max(160),
  genericName: z.string().trim().max(160).optional().or(z.literal('')),
  manufacturer: z.string().trim().max(160).optional().or(z.literal('')),
  strength: z.string().trim().max(60).optional().or(z.literal('')),
  dosageForm: z.enum(DOSAGE_FORMS).optional(),
  unit: z.enum(UNITS).optional(),
  color: z.string().trim().max(40).optional().or(z.literal('')),
  shape: z.string().trim().max(40).optional().or(z.literal('')),
  instructions: z.string().trim().max(1000).optional().or(z.literal('')),
  prescriberNotes: z.string().trim().max(1000).optional().or(z.literal('')),
  prescribedBy: z.string().trim().max(160).optional().or(z.literal('')),
  purpose: z.string().trim().max(240).optional().or(z.literal('')),
  storageInstructions: z.string().trim().max(500).optional().or(z.literal('')),
  initialQuantity: z.coerce.number().min(0).max(100000).optional(),
  currentStock: z.coerce.number().min(0).max(100000).optional(),
  refillThreshold: z.coerce.number().min(0).max(100000).optional(),
  expiryDate: z.coerce.date().optional()
};

const createMedicineSchema = z
  .object(baseMedicine)
  .refine(
    (data) =>
      data.currentStock === undefined ||
      data.initialQuantity === undefined ||
      data.currentStock <= data.initialQuantity,
    { message: 'Current stock cannot exceed the initial quantity', path: ['currentStock'] }
  );

const updateMedicineSchema = z
  .object({ ...baseMedicine, isActive: z.coerce.boolean().optional() })
  .partial()
  .refine((data) => Object.keys(data).length > 0, 'No fields supplied to update');

const listMedicinesSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(120).optional(),
  dosageForm: z.enum(DOSAGE_FORMS).optional(),
  status: z.enum(['active', 'inactive', 'all']).default('active'),
  needsRefill: z.enum(['true', 'false']).optional(),
  sort: z.enum(['name', '-name', 'createdAt', '-createdAt', 'currentStock', '-currentStock'])
    .default('name')
});

/**
 * Stock adjustment. `mode` decides how `quantity` is applied:
 *  - refill    : add to current stock and record a refill event
 *  - correction: set the absolute current stock (stock count / spillage)
 */
const adjustStockSchema = z.object({
  mode: z.enum(['refill', 'correction']),
  quantity: z.coerce.number().min(0).max(100000),
  note: z.string().trim().max(300).optional()
});

const idParam = z.object({ id: objectId });

module.exports = {
  createMedicineSchema,
  updateMedicineSchema,
  listMedicinesSchema,
  adjustStockSchema,
  idParam,
  objectId
};
