'use strict';

const express = require('express');
const { z } = require('zod');

const ctrl = require('../controllers/assistantController');
const validate = require('../middleware/validate');
const { protect } = require('../middleware/auth');
const { resolvePatientContext } = require('../middleware/patientContext');
const { objectId } = require('../validators/medicineValidators');

const router = express.Router();

const askSchema = z
  .object({
    question: z.string().trim().max(500).optional().or(z.literal('')),
    medicineName: z.string().trim().max(160).optional().or(z.literal('')),
    medicineId: objectId.optional(),
    topic: z
      .enum(['uses', 'howItWorks', 'precautions', 'storage', 'sideEffects', 'whenToSeekHelp'])
      .optional(),
    patientId: objectId.optional()
  })
  .refine((d) => d.question || d.medicineName || d.medicineId, {
    message: 'Ask a question or name a medicine'
  });

const summariseSchema = z
  .object({
    text: z.string().trim().max(50000).optional(),
    recordId: objectId.optional(),
    title: z.string().trim().max(200).optional(),
    patientId: objectId.optional()
  })
  .refine((d) => d.text || d.recordId, { message: 'Provide text or a recordId to summarise' });

const insightsSchema = z.object({
  windowDays: z.coerce.number().int().min(7).max(180).optional(),
  patientId: objectId.optional()
});

router.use(protect, resolvePatientContext({ permission: 'viewMedicines' }));

/** Medicine information assistant - curated corpus retrieval only. */
router.post('/medicine-info', validate({ body: askSchema }), ctrl.askMedicineInfo);
router.get('/medicine-info/knowledge-base', ctrl.getKnowledgeBase);

/** Visit / treatment summary - extractive, non-diagnostic. */
router.post('/visit-summary', validate({ body: summariseSchema }), ctrl.summariseVisit);

/** Non-diagnostic health insights from the patient's own records. */
router.get('/insights', validate({ query: insightsSchema }), ctrl.getInsights);

module.exports = router;
