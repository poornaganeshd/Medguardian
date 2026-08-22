'use strict';

const express = require('express');

const ctrl = require('../controllers/scheduleController');
const validate = require('../middleware/validate');
const { protect } = require('../middleware/auth');
const { resolvePatientContext } = require('../middleware/patientContext');
const schemas = require('../validators/scheduleValidators');
const { idParam } = require('../validators/medicineValidators');

const router = express.Router();

router.use(protect, resolvePatientContext({ permission: 'viewSchedules' }));

/** Dose feed powering the visual reminders and medication history. */
router.get(
  '/occurrences',
  validate({ query: schemas.occurrencesQuerySchema }),
  ctrl.listOccurrences
);

router
  .route('/')
  .get(validate({ query: schemas.listSchedulesSchema }), ctrl.listSchedules)
  .post(validate({ body: schemas.createScheduleSchema }), ctrl.createSchedule);

router
  .route('/:id')
  .get(validate({ params: idParam }), ctrl.getSchedule)
  .patch(validate({ params: idParam, body: schemas.updateScheduleSchema }), ctrl.updateSchedule)
  .delete(validate({ params: idParam }), ctrl.deleteSchedule);

router.patch(
  '/:id/status',
  validate({ params: idParam, body: schemas.setStatusSchema }),
  ctrl.setStatus
);

module.exports = router;
