'use strict';

const CaregiverLink = require('../models/CaregiverLink');
const User = require('../models/User');
const Medicine = require('../models/Medicine');
const Schedule = require('../models/Schedule');
const Intake = require('../models/Intake');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { ok, created } = require('../utils/apiResponse');
const auditService = require('../services/auditService');
const adherenceService = require('../services/adherenceService');
const scheduleService = require('../services/scheduleService');
const { toLocalDateKey, addDays, localDateTime, startOfLocalDay, endOfLocalDay } = require('../utils/dateTime');

// ------------------------------------------------------------------ invite
/**
 * The patient invites someone to help them. The invitation is addressed to an
 * email; the recipient must sign in with that address and present the token
 * before any access is granted.
 */
const inviteCaregiver = asyncHandler(async (req, res) => {
  if (req.user.role !== 'patient') {
    throw ApiError.forbidden('Only a patient can invite a caregiver');
  }

  const { caregiverEmail, caregiverName, relationship, permissions, note } = req.body;

  if (caregiverEmail === req.user.email) {
    throw ApiError.badRequest('You cannot invite yourself as your own caregiver');
  }

  const existing = await CaregiverLink.findOne({
    patient: req.user._id,
    caregiverEmail,
    status: { $in: ['invited', 'accepted'] }
  });
  if (existing) {
    throw ApiError.conflict(
      existing.status === 'accepted'
        ? 'This person is already one of your caregivers'
        : 'An invitation for this email is already pending'
    );
  }

  const caregiverUser = await User.findOne({ email: caregiverEmail });

  const link = new CaregiverLink({
    patient: req.user._id,
    caregiverEmail,
    caregiverName: caregiverName || caregiverUser?.name,
    relationship,
    permissions: permissions || {},
    note,
    status: 'invited'
  });
  const inviteToken = link.issueInviteToken();
  await link.save();

  await auditService.record({
    req,
    patient: req.user._id,
    action: 'CAREGIVER_INVITED',
    entityType: 'CaregiverLink',
    entityId: link._id,
    newValue: {
      caregiverEmail,
      permissions: link.permissions.toObject ? link.permissions.toObject() : link.permissions
    },
    description: `Invited ${caregiverEmail} as a caregiver`
  });

  return created(
    res,
    {
      link: link.toJSON(),
      /**
       * Returned once so the patient can pass it on (this project has no email
       * service). It is stored only as a SHA-256 hash.
       */
      inviteToken,
      inviteExpiresAt: link.inviteExpiresAt,
      recipientHasAccount: Boolean(caregiverUser)
    },
    'Caregiver invitation created'
  );
});

// ------------------------------------------------------- accept / decline
const respondToInvite = asyncHandler(async (req, res) => {
  const { token, accept } = req.body;

  const link = await CaregiverLink.findOne({
    inviteTokenHash: CaregiverLink.hashToken(token),
    status: 'invited'
  }).select('+inviteTokenHash');

  if (!link) throw ApiError.notFound('This invitation is not valid or has already been used');
  if (link.inviteExpired) throw ApiError.badRequest('This invitation has expired');

  // The invitation is bound to the email it was addressed to.
  if (link.caregiverEmail !== req.user.email) {
    await auditService.record({
      req,
      patient: link.patient,
      action: 'ACCESS_DENIED',
      status: 'failure',
      entityType: 'CaregiverLink',
      entityId: link._id,
      description: 'Invitation token presented by an account it was not addressed to'
    });
    throw ApiError.forbidden(
      `This invitation was sent to ${link.caregiverEmail}. Sign in with that address to accept it.`
    );
  }

  link.status = accept ? 'accepted' : 'declined';
  link.caregiver = accept ? req.user._id : undefined;
  link.respondedAt = new Date();
  link.inviteTokenHash = undefined;
  link.inviteExpiresAt = undefined;
  await link.save();

  // Accepting makes this account a caregiver as well as whatever it was.
  if (accept && req.user.role !== 'caregiver') {
    await User.updateOne({ _id: req.user._id }, { role: 'caregiver' });
  }

  await auditService.record({
    req,
    patient: link.patient,
    action: accept ? 'CAREGIVER_ACCEPTED' : 'CAREGIVER_DECLINED',
    entityType: 'CaregiverLink',
    entityId: link._id,
    newValue: { status: link.status },
    description: `${req.user.email} ${accept ? 'accepted' : 'declined'} the caregiver invitation`
  });

  return ok(
    res,
    { link: link.toJSON() },
    accept ? 'You are now a caregiver for this patient' : 'Invitation declined'
  );
});

// -------------------------------------------------------------------- list
/** Lists links in both directions: people helping me, and people I help. */
const listLinks = asyncHandler(async (req, res) => {
  const { status, role } = req.query;

  const statusFilter = status === 'all' ? {} : { status };

  const [myCaregivers, patientsIHelp] = await Promise.all([
    role === 'as_caregiver'
      ? []
      : CaregiverLink.find({ patient: req.user._id, ...statusFilter })
          .populate('caregiver', 'name email')
          .sort({ createdAt: -1 }),
    role === 'as_patient'
      ? []
      : CaregiverLink.find({ caregiver: req.user._id, ...statusFilter })
          .populate('patient', 'name email timezone')
          .sort({ createdAt: -1 })
  ]);

  return ok(res, {
    myCaregivers: myCaregivers.map((l) => l.toJSON()),
    patientsIHelp: patientsIHelp.map((l) => l.toJSON())
  });
});

// ------------------------------------------------------------ permissions
/**
 * Changing what a caregiver can see is a sensitive action, so the route
 * requires PIN / biometric step-up in addition to the patient's session.
 */
const updatePermissions = asyncHandler(async (req, res) => {
  const link = await CaregiverLink.findOne({ _id: req.params.id, patient: req.user._id });
  if (!link) throw ApiError.notFound('Caregiver link not found');
  if (link.status === 'revoked') throw ApiError.badRequest('This caregiver link has been revoked');

  const before = link.permissions.toObject ? link.permissions.toObject() : { ...link.permissions };

  for (const [key, value] of Object.entries(req.body.permissions)) {
    if (value === undefined) continue;
    link.permissions[key] = value;
  }
  if (req.body.relationship !== undefined) link.relationship = req.body.relationship;
  await link.save();

  const after = link.permissions.toObject ? link.permissions.toObject() : { ...link.permissions };
  const changed = Object.keys(after).filter((k) => after[k] !== before[k]);

  await auditService.record({
    req,
    patient: req.user._id,
    action: 'CAREGIVER_PERMISSIONS_CHANGED',
    entityType: 'CaregiverLink',
    entityId: link._id,
    oldValue: before,
    newValue: after,
    authMethod: req.stepUp?.method === 'webauthn' ? 'webauthn' : 'pin',
    description: `Changed caregiver permissions for ${link.caregiverEmail}: ${changed.join(', ') || 'no effective change'}`
  });

  return ok(res, { link: link.toJSON() }, 'Caregiver permissions updated');
});

// ----------------------------------------------------------------- revoke
/** Either side can end the relationship. */
const revokeLink = asyncHandler(async (req, res) => {
  const link = await CaregiverLink.findOne({
    _id: req.params.id,
    $or: [{ patient: req.user._id }, { caregiver: req.user._id }]
  });
  if (!link) throw ApiError.notFound('Caregiver link not found');
  if (link.status === 'revoked') return ok(res, { link: link.toJSON() }, 'Already revoked');

  const previous = link.status;
  link.status = 'revoked';
  link.revokedAt = new Date();
  link.revokedBy = req.user._id;
  link.inviteTokenHash = undefined;
  await link.save();

  await auditService.record({
    req,
    patient: link.patient,
    action: 'CAREGIVER_REVOKED',
    entityType: 'CaregiverLink',
    entityId: link._id,
    oldValue: { status: previous },
    newValue: { status: 'revoked' },
    description: `Caregiver access for ${link.caregiverEmail} was revoked by ${req.user.email}`
  });

  return ok(res, { link: link.toJSON() }, 'Caregiver access revoked');
});

// ------------------------------------------------- caregiver patient view
/**
 * The caregiver's read-only summary for one patient. Every section is gated on
 * the specific permission that covers it, so a caregiver who may see schedules
 * but not adherence gets exactly that.
 */
const getPatientSummary = asyncHandler(async (req, res) => {
  const link = await CaregiverLink.findOne({
    caregiver: req.user._id,
    patient: req.params.patientId,
    status: 'accepted'
  }).populate('patient', 'name email timezone');

  if (!link) throw ApiError.forbidden('You do not have caregiver access to this patient');

  link.lastAccessAt = new Date();
  await link.save({ validateBeforeSave: false });

  const tz = link.patient?.timezone || 'Asia/Kolkata';
  const now = new Date();
  const todayKey = toLocalDateKey(now, tz);
  const patientId = link.patient._id;

  const summary = {
    patient: { id: patientId, name: link.patient.name, email: link.patient.email, timezone: tz },
    permissions: link.permissions,
    generatedAt: now.toISOString()
  };

  if (link.permissions.viewMedicines) {
    const medicines = await Medicine.find({ patient: patientId, isActive: true }).select(
      'name genericName strength dosageForm unit currentStock refillThreshold image'
    );
    summary.medicines = medicines.map((m) => m.toJSON());
    summary.lowStock = medicines
      .filter((m) => m.currentStock <= m.refillThreshold)
      .map((m) => ({ id: m._id, name: m.name, currentStock: m.currentStock }));
  }

  if (link.permissions.viewSchedules) {
    const schedules = await Schedule.find({ patient: patientId, isActive: true }).populate(
      'medicine',
      'name strength unit image'
    );
    const intakes = await Intake.find({ patient: patientId, dateKey: todayKey });
    const occurrences = scheduleService.expandSchedules(schedules, {
      from: startOfLocalDay(todayKey, tz),
      to: endOfLocalDay(todayKey, tz),
      timezone: tz
    });
    const medicineById = new Map(
      schedules.filter((s) => s.medicine).map((s) => [String(s.medicine._id), s.medicine.toJSON()])
    );
    summary.today = scheduleService.attachIntakes(occurrences, intakes, now).map((o) => ({
      ...o,
      medicine: medicineById.get(o.medicineId) || null
    }));
    summary.missedToday = summary.today.filter((o) =>
      ['missed', 'late'].includes(o.status)
    ).length;
  }

  if (link.permissions.viewAdherence) {
    const fromKey = addDays(todayKey, -29);
    const [schedules, intakes] = await Promise.all([
      Schedule.find({ patient: patientId }),
      Intake.find({ patient: patientId, dateKey: { $gte: fromKey, $lte: todayKey } })
    ]);
    const report = adherenceService.computeAdherence({
      schedules,
      intakes,
      from: localDateTime(fromKey, '00:00', tz),
      to: localDateTime(todayKey, '23:59', tz),
      timezone: tz,
      now
    });
    summary.adherence = report.summary;
    summary.adherenceDaily = report.daily;
  }

  await auditService.record({
    req,
    patient: patientId,
    action: 'CAREGIVER_ACCESSED_PATIENT_DATA',
    entityType: 'User',
    entityId: patientId,
    description: `Caregiver opened the patient summary for ${link.patient.name}`
  });

  return ok(res, summary);
});

module.exports = {
  inviteCaregiver,
  respondToInvite,
  listLinks,
  updatePermissions,
  revokeLink,
  getPatientSummary
};
