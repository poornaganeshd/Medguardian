'use strict';

const express = require('express');

const ctrl = require('../controllers/medicineController');
const validate = require('../middleware/validate');
const { protect, requireStepUp } = require('../middleware/auth');
const { resolvePatientContext } = require('../middleware/patientContext');
const upload = require('../middleware/upload');
const schemas = require('../validators/medicineValidators');

const router = express.Router();

router.use(protect, resolvePatientContext({ permission: 'viewMedicines' }));

router
  .route('/')
  .get(validate({ query: schemas.listMedicinesSchema }), ctrl.listMedicines)
  .post(validate({ body: schemas.createMedicineSchema }), ctrl.createMedicine);

router
  .route('/:id')
  .get(validate({ params: schemas.idParam }), ctrl.getMedicine)
  .patch(
    validate({ params: schemas.idParam, body: schemas.updateMedicineSchema }),
    ctrl.updateMedicine
  )
  // Deleting a medicine destroys its schedules and intake history, so it is
  // treated as a sensitive action requiring PIN / biometric re-authentication.
  .delete(validate({ params: schemas.idParam }), requireStepUp, ctrl.deleteMedicine);

router
  .route('/:id/image')
  .get(validate({ params: schemas.idParam }), ctrl.getImage)
  .post(validate({ params: schemas.idParam }), upload.medicineImage, ctrl.uploadImage)
  .delete(validate({ params: schemas.idParam }), ctrl.deleteImage);

router.post(
  '/:id/stock',
  validate({ params: schemas.idParam, body: schemas.adjustStockSchema }),
  ctrl.adjustStock
);

module.exports = router;
