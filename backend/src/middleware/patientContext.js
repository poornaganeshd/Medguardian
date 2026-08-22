'use strict';

const mongoose = require('mongoose');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const auditService = require('../services/auditService');

/**
 * Establishes which patient the request operates on and enforces caregiver
 * permissions.
 *
 * - A `patient` always acts on their own data. Supplying someone else's
 *   `patientId` is refused outright.
 * - A `caregiver` must pass `patientId` (query or body) and hold an accepted
 *   caregiver link that grants the required permission. Every such access is
 *   written to the audit log.
 *
 * Sets `req.patientId` for downstream controllers.
 *
 * @param {{permission?: string, writeAccess?: boolean}} options
 */
function resolvePatientContext(options = {}) {
  const { permission, writeAccess = false } = options;

  return asyncHandler(async (req, res, next) => {
    const requested = req.query?.patientId || req.body?.patientId || req.params?.patientId;

    if (req.user.role === 'patient') {
      if (requested && String(requested) !== String(req.user._id)) {
        await auditService.record({
          req,
          action: 'ACCESS_DENIED',
          status: 'failure',
          entityType: 'Patient',
          description: 'Patient attempted to access another patient record'
        });
        throw ApiError.forbidden('You can only access your own records');
      }
      req.patientId = req.user._id;
      req.patientTimezone = req.user.timezone;
      req.isCaregiverAccess = false;
      return next();
    }

    // ---- caregiver path -------------------------------------------------
    if (!requested) {
      throw ApiError.badRequest(
        'A patientId is required - caregivers must select the patient they are helping'
      );
    }
    if (!mongoose.isValidObjectId(requested)) {
      throw ApiError.badRequest('Invalid patientId');
    }

    const CaregiverLink = mongoose.models.CaregiverLink;
    if (!CaregiverLink) {
      throw ApiError.forbidden('Caregiver access is not available');
    }

    const link = await CaregiverLink.findOne({
      caregiver: req.user._id,
      patient: requested,
      status: 'accepted'
    });

    if (!link) {
      await auditService.record({
        req,
        patient: requested,
        action: 'ACCESS_DENIED',
        status: 'failure',
        entityType: 'Patient',
        entityId: requested,
        description: 'Caregiver without an accepted link attempted patient data access'
      });
      throw ApiError.forbidden('You do not have caregiver access to this patient');
    }

    if (permission && !link.permissions?.[permission]) {
      await auditService.record({
        req,
        patient: requested,
        action: 'ACCESS_DENIED',
        status: 'failure',
        entityType: 'Patient',
        entityId: requested,
        description: `Caregiver lacks the "${permission}" permission`
      });
      throw ApiError.forbidden(`Your caregiver access does not include "${permission}"`);
    }

    // Caregivers hold read-oriented access; write actions must be explicitly allowed.
    if (writeAccess && !link.permissions?.canRecordIntake) {
      throw ApiError.forbidden('Your caregiver access is read-only for this action');
    }

    req.patientId = link.patient;
    req.caregiverLink = link;
    req.isCaregiverAccess = true;

    // Calendar decisions must follow the patient's timezone, not the caregiver's.
    const User = mongoose.models.User;
    const patient = User ? await User.findById(link.patient).select('timezone name') : null;
    req.patientTimezone = patient?.timezone;
    req.patientName = patient?.name;

    await auditService.record({
      req,
      patient: link.patient,
      action: 'CAREGIVER_ACCESSED_PATIENT_DATA',
      entityType: 'Patient',
      entityId: link.patient,
      description: `Caregiver accessed ${req.method} ${req.originalUrl.split('?')[0]}`
    });

    return next();
  });
}

module.exports = { resolvePatientContext };
