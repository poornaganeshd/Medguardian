'use strict';

const Intake = require('../models/Intake');
const Schedule = require('../models/Schedule');
const Medicine = require('../models/Medicine');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { ok, created } = require('../utils/apiResponse');
const auditService = require('../services/auditService');
const intakeService = require('../services/intakeService');
const scheduleService = require('../services/scheduleService');
const { resolvePatientId } = require('./medicineController');
const { patientTimezone } = require('./scheduleController');
const { localDateTime, toLocalDateKey } = require('../utils/dateTime');

/**
 * Applies a stock change to a medicine and returns the resulting figures.
 * Skipped doses produce a delta of 0, so nothing is deducted (see
 * `intakeService.stockDelta`).
 */
async function applyStock(medicine, previous, next) {
  const delta = intakeService.stockDelta(previous, next);
  if (delta === 0) return { stock: medicine.currentStock, clamped: false, shortfall: 0, delta };

  const result = intakeService.applyStockDelta(medicine.currentStock, delta);
  medicine.currentStock = result.stock;
  if (medicine.currentStock > medicine.initialQuantity) {
    medicine.initialQuantity = medicine.currentStock;
  }
  await medicine.save();
  return { ...result, delta };
}

// ------------------------------------------------------- record a scheduled dose
/**
 * Records TAKEN or SKIPPED for one scheduled slot. Re-recording the same slot
 * updates the existing record and adjusts stock by the difference only.
 */
const recordIntake = asyncHandler(async (req, res) => {
  const patientId = resolvePatientId(req);
  const tz = patientTimezone(req);
  const { schedule: scheduleId, dateKey, scheduledTime, status, skipReason, notes } = req.body;

  const schedule = await Schedule.findOne({ _id: scheduleId, patient: patientId }).populate(
    'medicine'
  );
  if (!schedule) throw ApiError.notFound('Schedule not found');
  if (schedule.frequency === 'as_needed') {
    throw ApiError.badRequest('Use the as-needed endpoint for this medicine');
  }
  if (!schedule.medicine) throw ApiError.notFound('The medicine for this schedule no longer exists');

  // The slot must really exist in the schedule - this stops a client inventing
  // doses to inflate its adherence score.
  if (!scheduleService.isDueOnDate(schedule, dateKey, tz)) {
    throw ApiError.badRequest(`This medicine is not scheduled on ${dateKey}`);
  }
  const slot = schedule.times.find((t) => t.time === scheduledTime);
  if (!slot) throw ApiError.badRequest(`There is no ${scheduledTime} dose in this schedule`);

  const scheduledAt = localDateTime(dateKey, scheduledTime, tz);
  const takenAt = status === 'taken' ? req.body.takenAt || new Date() : undefined;
  const doseQuantity =
    status === 'skipped' ? slot.doseQuantity : req.body.doseQuantity ?? slot.doseQuantity;

  const { minutesLate, wasLate } = intakeService.computeLateness(
    scheduledAt,
    takenAt,
    schedule.graceMinutes
  );

  const existing = await Intake.findOne({
    schedule: schedule._id,
    dateKey,
    scheduledTime,
    isAsNeeded: false
  });

  const nextState = { status, doseQuantity };
  const previousState = existing
    ? { status: existing.status, doseQuantity: existing.doseQuantity }
    : null;

  const stockResult = await applyStock(schedule.medicine, previousState, nextState);

  const payload = {
    patient: patientId,
    medicine: schedule.medicine._id,
    schedule: schedule._id,
    dateKey,
    scheduledTime,
    scheduledAt,
    status,
    takenAt: takenAt || null,
    doseQuantity,
    wasLate,
    minutesLate,
    skipReason: status === 'skipped' ? skipReason : null,
    notes,
    isAsNeeded: false,
    recordedBy: req.isCaregiverAccess ? req.user._id : undefined,
    stockAfter: stockResult.stock
  };

  let intake;
  if (existing) {
    Object.assign(existing, payload);
    intake = await existing.save();
  } else {
    intake = await Intake.create(payload);
  }

  await auditService.record({
    req,
    patient: patientId,
    action: existing ? 'INTAKE_UPDATED' : 'INTAKE_RECORDED',
    entityType: 'Intake',
    entityId: intake._id,
    oldValue: previousState || undefined,
    newValue: { status, doseQuantity, stockAfter: stockResult.stock },
    description: `${status === 'taken' ? 'Took' : 'Skipped'} the ${scheduledTime} dose of "${schedule.medicine.displayName}" on ${dateKey}`
  });

  return (existing ? ok : created)(
    res,
    {
      intake: intake.toJSON(),
      medicine: {
        id: schedule.medicine._id,
        currentStock: schedule.medicine.currentStock,
        refillThreshold: schedule.medicine.refillThreshold,
        needsRefill: schedule.medicine.needsRefill
      },
      stockWarning: stockResult.clamped
        ? `Recorded, but your stock was already empty (${stockResult.shortfall} ${schedule.medicine.unit}(s) unaccounted for). Please correct the stock count.`
        : null
    },
    existing ? 'Dose record updated' : 'Dose recorded'
  );
});

// --------------------------------------------------- record an as-needed dose
const recordAsNeeded = asyncHandler(async (req, res) => {
  const patientId = resolvePatientId(req);
  const tz = patientTimezone(req);

  const medicine = await Medicine.findOne({ _id: req.body.medicine, patient: patientId });
  if (!medicine) throw ApiError.notFound('Medicine not found');

  let schedule = null;
  if (req.body.schedule) {
    schedule = await Schedule.findOne({ _id: req.body.schedule, patient: patientId });
    if (!schedule) throw ApiError.notFound('Schedule not found');
  } else {
    schedule = await Schedule.findOne({
      medicine: medicine._id,
      patient: patientId,
      frequency: 'as_needed'
    });
  }

  const takenAt = req.body.takenAt || new Date();
  const dateKey = toLocalDateKey(takenAt, tz);
  const doseQuantity =
    req.body.doseQuantity ?? schedule?.asNeededDoseQuantity ?? 1;

  if (schedule?.maxDosesPerDay) {
    const takenToday = await Intake.countDocuments({
      patient: patientId,
      medicine: medicine._id,
      dateKey,
      status: 'taken'
    });
    if (takenToday >= schedule.maxDosesPerDay) {
      throw ApiError.badRequest(
        `You have already recorded the daily maximum of ${schedule.maxDosesPerDay} dose(s) for this medicine today.`
      );
    }
  }

  const stockResult = await applyStock(medicine, null, { status: 'taken', doseQuantity });

  const intake = await Intake.create({
    patient: patientId,
    medicine: medicine._id,
    schedule: schedule?._id,
    dateKey,
    scheduledTime: 'prn',
    scheduledAt: null,
    status: 'taken',
    takenAt,
    doseQuantity,
    wasLate: false,
    minutesLate: null,
    notes: req.body.notes,
    isAsNeeded: true,
    recordedBy: req.isCaregiverAccess ? req.user._id : undefined,
    stockAfter: stockResult.stock
  });

  await auditService.record({
    req,
    patient: patientId,
    action: 'INTAKE_RECORDED',
    entityType: 'Intake',
    entityId: intake._id,
    newValue: { status: 'taken', doseQuantity, asNeeded: true, stockAfter: stockResult.stock },
    description: `Recorded an as-needed dose of "${medicine.displayName}"`
  });

  return created(
    res,
    {
      intake: intake.toJSON(),
      medicine: {
        id: medicine._id,
        currentStock: medicine.currentStock,
        needsRefill: medicine.needsRefill
      },
      stockWarning: stockResult.clamped
        ? 'Recorded, but your stock was already empty. Please correct the stock count.'
        : null
    },
    'As-needed dose recorded'
  );
});

// ------------------------------------------------------------------ history
const listIntakes = asyncHandler(async (req, res) => {
  const patientId = resolvePatientId(req);
  const { page, limit, medicine, status, from, to } = req.query;

  const query = { patient: patientId };
  if (medicine) query.medicine = medicine;
  if (status !== 'all') query.status = status;
  if (from || to) {
    query.dateKey = {};
    if (from) query.dateKey.$gte = from;
    if (to) query.dateKey.$lte = to;
  }

  const skip = (page - 1) * limit;
  const [items, total] = await Promise.all([
    Intake.find(query)
      .populate('medicine', 'name genericName strength dosageForm unit image')
      .sort({ dateKey: -1, scheduledTime: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Intake.countDocuments(query)
  ]);

  return ok(res, {
    items: items.map((i) => i.toJSON()),
    total,
    page,
    limit,
    pages: Math.max(1, Math.ceil(total / limit))
  });
});

// ------------------------------------------------------------------- amend
const updateIntake = asyncHandler(async (req, res) => {
  const patientId = resolvePatientId(req);
  const intake = await Intake.findOne({ _id: req.params.id, patient: patientId });
  if (!intake) throw ApiError.notFound('Dose record not found');

  const medicine = await Medicine.findById(intake.medicine);
  if (!medicine) throw ApiError.notFound('The medicine for this record no longer exists');

  const previousState = { status: intake.status, doseQuantity: intake.doseQuantity };
  const nextState = {
    status: req.body.status ?? intake.status,
    doseQuantity: req.body.doseQuantity ?? intake.doseQuantity
  };

  const stockResult = await applyStock(medicine, previousState, nextState);

  intake.status = nextState.status;
  intake.doseQuantity = nextState.doseQuantity;
  if (req.body.takenAt !== undefined) intake.takenAt = req.body.takenAt;
  if (req.body.notes !== undefined) intake.notes = req.body.notes;
  if (req.body.skipReason !== undefined) intake.skipReason = req.body.skipReason;
  if (intake.status === 'skipped') intake.takenAt = null;
  if (intake.status === 'taken' && !intake.takenAt) intake.takenAt = new Date();

  const lateness = intakeService.computeLateness(intake.scheduledAt, intake.takenAt);
  intake.minutesLate = lateness.minutesLate;
  intake.wasLate = lateness.wasLate;
  intake.stockAfter = stockResult.stock;
  await intake.save();

  await auditService.record({
    req,
    patient: patientId,
    action: 'INTAKE_UPDATED',
    entityType: 'Intake',
    entityId: intake._id,
    oldValue: previousState,
    newValue: { ...nextState, stockAfter: stockResult.stock },
    description: `Amended the ${intake.scheduledTime} dose of "${medicine.displayName}" on ${intake.dateKey}`
  });

  return ok(
    res,
    {
      intake: intake.toJSON(),
      medicine: { id: medicine._id, currentStock: medicine.currentStock }
    },
    'Dose record updated'
  );
});

// ------------------------------------------------------------------ delete
const deleteIntake = asyncHandler(async (req, res) => {
  const patientId = resolvePatientId(req);
  const intake = await Intake.findOne({ _id: req.params.id, patient: patientId });
  if (!intake) throw ApiError.notFound('Dose record not found');

  const medicine = await Medicine.findById(intake.medicine);
  const snapshot = { status: intake.status, doseQuantity: intake.doseQuantity };

  // Removing a "taken" record returns the dose to stock.
  if (medicine) await applyStock(medicine, snapshot, null);
  await intake.deleteOne();

  await auditService.record({
    req,
    patient: patientId,
    action: 'INTAKE_UPDATED',
    entityType: 'Intake',
    entityId: intake._id,
    oldValue: snapshot,
    newValue: null,
    description: `Removed the ${intake.scheduledTime} dose record for ${intake.dateKey}`
  });

  return ok(
    res,
    { medicine: medicine ? { id: medicine._id, currentStock: medicine.currentStock } : null },
    'Dose record removed'
  );
});

module.exports = { recordIntake, recordAsNeeded, listIntakes, updateIntake, deleteIntake };
