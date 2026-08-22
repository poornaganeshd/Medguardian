'use strict';

const express = require('express');

const ctrl = require('../controllers/recordController');
const validate = require('../middleware/validate');
const { protect, requireStepUp } = require('../middleware/auth');
const { resolvePatientContext } = require('../middleware/patientContext');
const upload = require('../middleware/upload');
const schemas = require('../validators/recordValidators');
const { idParam } = require('../validators/medicineValidators');

const router = express.Router();

router.use(protect, resolvePatientContext({ permission: 'viewRecords' }));

router
  .route('/')
  .get(validate({ query: schemas.listRecordsSchema }), ctrl.listRecords)
  .post(upload.recordFile, validate({ body: schemas.createRecordSchema }), ctrl.createRecord);

router
  .route('/:id')
  .get(validate({ params: idParam }), ctrl.getRecord)
  .patch(validate({ params: idParam, body: schemas.updateRecordSchema }), ctrl.updateRecord)
  // Deleting a record destroys the stored document, so PIN/biometric
  // re-authentication is required.
  .delete(validate({ params: idParam }), requireStepUp, ctrl.deleteRecord);

router.get('/:id/file', validate({ params: idParam }), ctrl.downloadFile);

router.post('/:id/ocr', validate({ params: idParam }), ctrl.runOcr);
router.post(
  '/:id/ocr/confirm',
  validate({ params: idParam, body: schemas.confirmOcrSchema }),
  ctrl.confirmOcr
);

module.exports = router;
