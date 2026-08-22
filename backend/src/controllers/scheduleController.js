'use strict';

const Schedule = require('../models/Schedule');
const Medicine = require('../models/Medicine');
const Intake = require('../models/Intake');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { ok, created } = require('../utils/apiResponse');
const auditService = require('../services/auditService');
const scheduleService = require('../services/scheduleService');
const { resolvePatientId } = require('./medicineController');
const { toLocalDateKey, startOfLocalDay, endOfLocalDay, addDays } = require('../utils/dateTime');

/** Patient timezone drives every calendar decision. */
function patientTimezone(req) {
  return req.patientTimezone || req.user.timezone || 'Asia/Kolkata';
}

async function findOwnedSchedule(id, patientId) {
  const schedule = await Schedule.findOne({ _id: id, patient: patientId }).populate(
    'medicine',
    'name genericName strength dosageForm unit image currentStock refillThreshold instructions'
  );
  if (!schedule) throw ApiError.notFound('Schedule not found');
  return schedule;
}

const AUDITED = [
  'frequency',
  'daysOfWeek',
  'intervalDays',
  'cycleDaysOn',
  'cycleDaysOff',
  'times',
  'startDate',
  'endDate',
  'graceMinutes',
  'isActive'
];

// -------------------------------------------------------------------- list
const listSchedules = asyncHandler(async (req, res) => {
  const patientId = resolvePatientId(req);
  const { medicine, status } = req.query;

  const query = { patient: patientId };
  if (medicine) query.medicine = medicine;
  if (status !== 'all') query.isActive = status === 'active';

  const schedules = await Schedule.find(query)
    .populate('medicine', 'name genericName strength dosageForm unit image currentStock refillThreshold')
    .sort({ createdAt: -1 });

  return ok(res, { items: schedules.map((s) => s.toJSON()), total: schedules.length });
});

const getSchedule = asyncHandler(async (req, res) => {
  const schedule = await findOwnedSchedule(req.params.id, resolvePatientId(req));
  return ok(res, { schedule: schedule.toJSON() });
});

// ------------------------------------------------------------------ create
const createSchedule = asyncHandler(async (req, res) => {
  const patientId = resolvePatientId(req);

  const medicine = await Medicine.findOne({ _id: req.body.medicine, patient: patientId });
  if (!medicine) throw ApiError.notFound('Medicine not found');

  const schedule = await Schedule.create({
    ...req.body,
    patient: patientId,
    startDate: req.body.startDate || new Date()
  });
  await schedule.populate('medicine', 'name genericName strength dosageForm unit image');

  await auditService.record({
    req,
    patient: patientId,
    action: 'SCHEDULE_CREATED',
    entityType: 'Schedule',
    entityId: schedule._id,
    newValue: {
      medicine: medicine.name,
      frequency: schedule.frequency,
      times: schedule.times.map((t) => `${t.time} x${t.doseQuantity}`)
    },
    description: `Created a ${schedule.frequency} schedule for "${medicine.displayName}"`
  });

  return created(res, { schedule: schedule.toJSON() }, 'Schedule created');
});

// ------------------------------------------------------------------ update
const updateSchedule = asyncHandler(async (req, res) => {
  const patientId = resolvePatientId(req);
  const schedule = await findOwnedSchedule(req.params.id, patientId);

  if (req.body.medicine && String(req.body.medicine) !== String(schedule.medicine._id)) {
    const medicine = await Medicine.findOne({ _id: req.body.medicine, patient: patientId });
    if (!medicine) throw ApiError.notFound('Medicine not found');
  }

  const before = {};
  const after = {};
  for (const [key, value] of Object.entries(req.body)) {
    if (value === undefined) continue;
    if (AUDITED.includes(key)) {
      before[key] = JSON.parse(JSON.stringify(schedule[key] ?? null));
      after[key] = value;
    }
    schedule[key] = value === null ? undefined : value;
  }

  await schedule.save();
  await schedule.populate('medicine', 'name genericName strength dosageForm unit image');

  await auditService.record({
    req,
    patient: patientId,
    action: 'SCHEDULE_UPDATED',
    entityType: 'Schedule',
    entityId: schedule._id,
    oldValue: before,
    newValue: after,
    description: `Updated the schedule for "${schedule.medicine.name}"`
  });

  return ok(res, { schedule: schedule.toJSON() }, 'Schedule updated');
});

// ---------------------------------------------------------- pause / resume
const setStatus = asyncHandler(async (req, res) => {
  const patientId = resolvePatientId(req);
  const schedule = await findOwnedSchedule(req.params.id, patientId);

  const previous = schedule.isActive;
  schedule.isActive = req.body.isActive;
  schedule.pausedAt = req.body.isActive ? undefined : new Date();
  schedule.pauseReason = req.body.isActive ? undefined : req.body.pauseReason;
  await schedule.save();

  await auditService.record({
    req,
    patient: patientId,
    action: 'SCHEDULE_STATUS_CHANGED',
    entityType: 'Schedule',
    entityId: schedule._id,
    oldValue: { isActive: previous },
    newValue: { isActive: schedule.isActive, pauseReason: schedule.pauseReason },
    description: `${schedule.isActive ? 'Resumed' : 'Paused'} the schedule for "${schedule.medicine.name}"`
  });

  return ok(
    res,
    { schedule: schedule.toJSON() },
    schedule.isActive ? 'Schedule resumed' : 'Schedule paused'
  );
});

// ------------------------------------------------------------------ delete
const deleteSchedule = asyncHandler(async (req, res) => {
  const patientId = resolvePatientId(req);
  const schedule = await findOwnedSchedule(req.params.id, patientId);

  const snapshot = {
    medicine: schedule.medicine?.name,
    frequency: schedule.frequency,
    times: schedule.times.map((t) => t.time)
  };

  const { deletedCount } = await Intake.deleteMany({ schedule: schedule._id });
  await schedule.deleteOne();

  await auditService.record({
    req,
    patient: patientId,
    action: 'SCHEDULE_DELETED',
    entityType: 'Schedule',
    entityId: schedule._id,
    oldValue: snapshot,
    description: `Deleted the schedule for "${snapshot.medicine}" (${deletedCount} intake record(s) removed)`
  });

  return ok(res, { removedIntakes: deletedCount }, 'Schedule deleted');
});

// ------------------------------------------------------------- occurrences
/**
 * The reminder / history feed. Expands the patient's schedules across the
 * requested window and attaches whatever intake records exist, so the client
 * receives one uniform list of doses with derived statuses.
 */
const listOccurrences = asyncHandler(async (req, res) => {
  const patientId = resolvePatientId(req);
  const tz = patientTimezone(req);
  const now = new Date();

  let from;
  let to;
  if (req.query.date) {
    from = startOfLocalDay(req.query.date, tz);
    to = endOfLocalDay(req.query.date, tz);
  } else {
    const todayKey = toLocalDateKey(now, tz);
    from = req.query.from || startOfLocalDay(todayKey, tz);
    to = req.query.to || endOfLocalDay(addDays(todayKey, 6), tz);
  }

  if (to < from) throw ApiError.badRequest('The "to" date must not be before the "from" date');
  const spanDays = Math.ceil((to - from) / 86400000);
  if (spanDays > 400) throw ApiError.badRequest('Please request a window of 400 days or fewer');

  const scheduleQuery = { patient: patientId };
  if (req.query.medicine) scheduleQuery.medicine = req.query.medicine;

  const schedules = await Schedule.find(scheduleQuery).populate(
    'medicine',
    'name genericName strength dosageForm unit image currentStock refillThreshold instructions'
  );

  const occurrences = scheduleService.expandSchedules(schedules, {
    from,
    to,
    timezone: tz,
    includeInactive: false
  });

  const intakes = await Intake.find({
    patient: patientId,
    ...(req.query.medicine ? { medicine: req.query.medicine } : {}),
    dateKey: { $gte: toLocalDateKey(from, tz), $lte: toLocalDateKey(to, tz) }
  });

  const medicineById = new Map(
    schedules
      .filter((s) => s.medicine)
      .map((s) => [String(s.medicine._id), s.medicine.toJSON()])
  );
  const scheduleById = new Map(schedules.map((s) => [String(s._id), s]));

  let items = scheduleService.attachIntakes(occurrences, intakes, now).map((occ) => ({
    ...occ,
    medicine: medicineById.get(occ.medicineId) || null,
    mealRelation: scheduleById.get(occ.scheduleId)?.mealRelation || 'any'
  }));

  // As-needed doses have no generated occurrence, so surface the stored records.
  const asNeeded = intakes
    .filter((i) => i.isAsNeeded)
    .map((i) => ({
      scheduleId: i.schedule ? String(i.schedule) : null,
      medicineId: String(i.medicine),
      dateKey: i.dateKey,
      time: 'prn',
      scheduledAt: i.takenAt || i.createdAt,
      doseQuantity: i.doseQuantity,
      graceMinutes: 0,
      status: i.status,
      intakeId: String(i._id),
      takenAt: i.takenAt,
      notes: i.notes,
      isAsNeeded: true,
      medicine: medicineById.get(String(i.medicine)) || null,
      mealRelation: 'any'
    }));

  items = items.concat(asNeeded).sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt));

  const { status } = req.query;
  if (status && status !== 'all') {
    const wanted =
      status === 'pending' ? new Set(['upcoming', 'due', 'late']) : new Set([status]);
    items = items.filter((i) => wanted.has(i.status));
  }

  const summary = items.reduce(
    (acc, item) => {
      acc[item.status] = (acc[item.status] || 0) + 1;
      acc.total += 1;
      return acc;
    },
    { total: 0 }
  );

  return ok(res, {
    items,
    summary,
    range: { from, to, timezone: tz }
  });
});

module.exports = {
  listSchedules,
  getSchedule,
  createSchedule,
  updateSchedule,
  setStatus,
  deleteSchedule,
  listOccurrences,
  findOwnedSchedule,
  patientTimezone
};
