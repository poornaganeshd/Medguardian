'use strict';

const express = require('express');

const ctrl = require('../controllers/caregiverController');
const validate = require('../middleware/validate');
const { protect, requireStepUp } = require('../middleware/auth');
const schemas = require('../validators/caregiverValidators');

const router = express.Router();

router.use(protect);

router
  .route('/')
  .get(validate({ query: schemas.listLinksSchema }), ctrl.listLinks)
  .post(validate({ body: schemas.inviteCaregiverSchema }), ctrl.inviteCaregiver);

router.post('/respond', validate({ body: schemas.respondToInviteSchema }), ctrl.respondToInvite);

/** Widening or narrowing caregiver access requires PIN / biometric step-up. */
router.patch(
  '/:id/permissions',
  validate({ params: schemas.linkIdParam, body: schemas.updatePermissionsSchema }),
  requireStepUp,
  ctrl.updatePermissions
);

router.delete('/:id', validate({ params: schemas.linkIdParam }), ctrl.revokeLink);

/** Caregiver-facing read-only patient summary. */
router.get(
  '/patients/:patientId/summary',
  validate({ params: schemas.patientIdParam }),
  ctrl.getPatientSummary
);

module.exports = router;
