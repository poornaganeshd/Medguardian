'use strict';

const express = require('express');
const { z } = require('zod');

const ctrl = require('../controllers/interactionController');
const validate = require('../middleware/validate');
const { protect } = require('../middleware/auth');
const { resolvePatientContext } = require('../middleware/patientContext');
const { objectId } = require('../validators/medicineValidators');

const router = express.Router();

const checkNamesSchema = z.object({
  names: z
    .array(z.string().trim().min(1).max(160))
    .min(1, 'Provide at least one medicine name')
    .max(25, 'You can check up to 25 medicines at once'),
  includeMyMedicines: z.coerce.boolean().optional().default(true),
  patientId: objectId.optional()
});

router.use(protect, resolvePatientContext({ permission: 'viewMedicines' }));

router.get('/dataset', ctrl.getDatasetInfo);
router.get('/my-medicines', ctrl.checkMyMedicines);
router.post('/check', validate({ body: checkNamesSchema }), ctrl.checkNames);

module.exports = router;
