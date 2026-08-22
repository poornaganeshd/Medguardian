'use strict';

const { z } = require('zod');
const { RECORD_CATEGORIES } = require('../models/MedicalRecord');
const { objectId } = require('./medicineValidators');

/**
 * Multipart form fields arrive as strings, so booleans, arrays and objects are
 * coerced here rather than in the controller.
 */
const looseBoolean = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0', 'on', 'off'])])
  .transform((v) => v === true || v === 'true' || v === '1' || v === 'on');

const tagList = z
  .union([z.array(z.string()), z.string()])
  .transform((v) => (Array.isArray(v) ? v : v.split(',')))
  .transform((list) =>
    list.map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 20)
  );

const idList = z
  .union([z.array(objectId), objectId])
  .transform((v) => (Array.isArray(v) ? v : [v]));

const metadataObject = z
  .union([z.record(z.string()), z.string()])
  .transform((v) => {
    if (typeof v !== 'string') return v;
    try {
      const parsed = JSON.parse(v);
      return typeof parsed === 'object' && parsed !== null ? parsed : {};
    } catch {
      return {};
    }
  });

const baseRecord = {
  title: z.string().trim().min(1, 'Title is required').max(200),
  category: z.enum(RECORD_CATEGORIES),
  recordDate: z.coerce.date().optional(),
  description: z.string().trim().max(2000).optional().or(z.literal('')),
  provider: z.string().trim().max(200).optional().or(z.literal('')),
  doctorName: z.string().trim().max(160).optional().or(z.literal('')),
  tags: tagList.optional(),
  metadata: metadataObject.optional(),
  relatedMedicines: idList.optional(),
  shareableWithCaregivers: looseBoolean.optional(),
  isSensitive: looseBoolean.optional(),
  runOcr: looseBoolean.optional(),
  patientId: objectId.optional()
};

const createRecordSchema = z.object(baseRecord);

const updateRecordSchema = z
  .object({ ...baseRecord, title: baseRecord.title.optional(), category: z.enum(RECORD_CATEGORIES).optional() })
  .refine((d) => Object.keys(d).length > 0, 'No fields supplied to update');

const listRecordsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  category: z.enum(RECORD_CATEGORIES).optional(),
  search: z.string().trim().max(160).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  tag: z.string().trim().max(40).optional(),
  hasFile: z.enum(['true', 'false']).optional(),
  sort: z
    .enum(['recordDate', '-recordDate', 'createdAt', '-createdAt', 'title', '-title'])
    .default('-recordDate'),
  patientId: objectId.optional()
});

/** Confirmation payload for OCR-suggested medicines. */
const confirmOcrSchema = z.object({
  accepted: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(160),
        genericName: z.string().trim().max(160).optional().or(z.literal('')),
        strength: z.string().trim().max(60).optional().or(z.literal('')),
        dosageForm: z.string().trim().max(40).optional().or(z.literal('')),
        initialQuantity: z.coerce.number().min(0).max(100000).optional(),
        currentStock: z.coerce.number().min(0).max(100000).optional(),
        refillThreshold: z.coerce.number().min(0).max(100000).optional(),
        instructions: z.string().trim().max(1000).optional().or(z.literal(''))
      })
    )
    .max(20)
    .default([]),
  rejectAll: z.coerce.boolean().optional(),
  patientId: objectId.optional()
});

module.exports = {
  createRecordSchema,
  updateRecordSchema,
  listRecordsSchema,
  confirmOcrSchema
};
