'use strict';

const express = require('express');

const ctrl = require('../controllers/analyticsController');
const validate = require('../middleware/validate');
const { protect } = require('../middleware/auth');
const { resolvePatientContext } = require('../middleware/patientContext');
const schemas = require('../validators/analyticsValidators');

const router = express.Router();

router.use(protect, resolvePatientContext({ permission: 'viewAdherence' }));

router.get('/adherence', validate({ query: schemas.adherenceQuerySchema }), ctrl.getAdherence);

/** DRPA — Dynamic Refill Prediction Algorithm. */
router.get('/refill', validate({ query: schemas.refillQuerySchema }), ctrl.getRefillOverview);
router.get(
  '/refill/:medicineId',
  validate({ params: schemas.medicineIdParam, query: schemas.refillQuerySchema }),
  ctrl.getRefillPrediction
);

module.exports = router;
