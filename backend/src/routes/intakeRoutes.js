'use strict';

const express = require('express');

const ctrl = require('../controllers/intakeController');
const validate = require('../middleware/validate');
const { protect } = require('../middleware/auth');
const { resolvePatientContext } = require('../middleware/patientContext');
const schemas = require('../validators/intakeValidators');
const { idParam } = require('../validators/medicineValidators');

const router = express.Router();

router.use(protect);

/** Reading the history needs the schedule-view permission. */
const readContext = resolvePatientContext({ permission: 'viewSchedules' });
/** Recording a dose changes stock, so a caregiver also needs canRecordIntake. */
const writeContext = resolvePatientContext({ permission: 'viewSchedules', writeAccess: true });

router
  .route('/')
  .get(readContext, validate({ query: schemas.listIntakesSchema }), ctrl.listIntakes)
  .post(writeContext, validate({ body: schemas.recordIntakeSchema }), ctrl.recordIntake);

router.post(
  '/as-needed',
  writeContext,
  validate({ body: schemas.recordAsNeededSchema }),
  ctrl.recordAsNeeded
);

router
  .route('/:id')
  .patch(
    writeContext,
    validate({ params: idParam, body: schemas.updateIntakeSchema }),
    ctrl.updateIntake
  )
  .delete(writeContext, validate({ params: idParam }), ctrl.deleteIntake);

module.exports = router;
