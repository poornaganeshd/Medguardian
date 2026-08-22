'use strict';

const Schedule = require('../models/Schedule');
const Medicine = require('../models/Medicine');
const Intake = require('../models/Intake');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { ok } = require('../utils/apiResponse');
const adherenceService = require('../services/adherenceService');
const refillService = require('../services/refillPredictionService');
const { resolvePatientId } = require('./medicineController');
const { patientTimezone } = require('./scheduleController');
const { toLocalDateKey, addDays, localDateTime } = require('../utils/dateTime');

/** Resolves the analysis window, defaulting to the last 30 days. */
function resolveWindow(req, tz, defaultDays = 30) {
  const now = new Date();
  const todayKey = toLocalDateKey(now, tz);
  const fromKey = req.query.from || addDays(todayKey, -(defaultDays - 1));
  const toKey = req.query.to || todayKey;
  if (fromKey > toKey) throw ApiError.badRequest('"from" must not be after "to"');
  return {
    now,
    todayKey,
    fromKey,
    toKey,
    from: localDateTime(fromKey, '00:00', tz),
    to: localDateTime(toKey, '23:59', tz)
  };
}

async function loadPatientData(patientId, window, medicineFilter) {
  const scheduleQuery = { patient: patientId };
  if (medicineFilter) scheduleQuery.medicine = medicineFilter;

  const [schedules, intakes] = await Promise.all([
    Schedule.find(scheduleQuery).populate(
      'medicine',
      'name genericName strength dosageForm unit image currentStock refillThreshold'
    ),
    Intake.find({
      patient: patientId,
      ...(medicineFilter ? { medicine: medicineFilter } : {}),
      dateKey: { $gte: window.fromKey, $lte: window.toKey }
    })
  ]);
  return { schedules, intakes };
}

// -------------------------------------------------------------- adherence
const getAdherence = asyncHandler(async (req, res) => {
  const patientId = resolvePatientId(req);
  const tz = patientTimezone(req);
  const window = resolveWindow(req, tz, req.query.days || 30);

  const { schedules, intakes } = await loadPatientData(patientId, window, req.query.medicine);

  const report = adherenceService.computeAdherence({
    schedules,
    intakes,
    from: window.from,
    to: window.to,
    timezone: tz,
    now: window.now
  });

  // Attach medicine details to the per-medicine breakdown.
  const medicineById = new Map(
    schedules.filter((s) => s.medicine).map((s) => [String(s.medicine._id), s.medicine.toJSON()])
  );
  report.byMedicine = report.byMedicine.map((entry) => ({
    ...entry,
    medicine: medicineById.get(entry.medicineId) || null
  }));

  return ok(res, report);
});

// ------------------------------------------------------------------- DRPA
/** Refill prediction for a single medicine. */
const getRefillPrediction = asyncHandler(async (req, res) => {
  const patientId = resolvePatientId(req);
  const tz = patientTimezone(req);

  const medicine = await Medicine.findOne({ _id: req.params.medicineId, patient: patientId });
  if (!medicine) throw ApiError.notFound('Medicine not found');

  const now = new Date();
  const todayKey = toLocalDateKey(now, tz);
  const lookbackDays = req.query.lookbackDays || refillService.LOOKBACK_DAYS;

  const [schedules, intakes] = await Promise.all([
    Schedule.find({ patient: patientId, medicine: medicine._id }),
    Intake.find({
      patient: patientId,
      medicine: medicine._id,
      dateKey: { $gte: addDays(todayKey, -lookbackDays), $lte: todayKey }
    })
  ]);

  const prediction = refillService.predictRefill({
    medicine,
    schedules,
    intakes,
    now,
    timezone: tz,
    lookbackDays
  });

  return ok(res, { prediction });
});

/** Refill predictions across every active medicine, most urgent first. */
const getRefillOverview = asyncHandler(async (req, res) => {
  const patientId = resolvePatientId(req);
  const tz = patientTimezone(req);
  const now = new Date();
  const todayKey = toLocalDateKey(now, tz);
  const lookbackDays = refillService.LOOKBACK_DAYS;

  const medicines = await Medicine.find({ patient: patientId, isActive: true });
  if (!medicines.length) return ok(res, { items: [], summary: { total: 0, needingRefill: 0 } });

  const medicineIds = medicines.map((m) => m._id);
  const [schedules, intakes] = await Promise.all([
    Schedule.find({ patient: patientId, medicine: { $in: medicineIds } }),
    Intake.find({
      patient: patientId,
      medicine: { $in: medicineIds },
      dateKey: { $gte: addDays(todayKey, -lookbackDays), $lte: todayKey }
    })
  ]);

  const schedulesByMedicine = new Map();
  for (const schedule of schedules) {
    const key = String(schedule.medicine);
    if (!schedulesByMedicine.has(key)) schedulesByMedicine.set(key, []);
    schedulesByMedicine.get(key).push(schedule);
  }
  const intakesByMedicine = new Map();
  for (const intake of intakes) {
    const key = String(intake.medicine);
    if (!intakesByMedicine.has(key)) intakesByMedicine.set(key, []);
    intakesByMedicine.get(key).push(intake);
  }

  const URGENCY_ORDER = {
    out_of_stock: 0,
    refill_now: 1,
    critical: 2,
    urgent: 3,
    soon: 4,
    ok: 5
  };

  const items = medicines
    .map((medicine) =>
      refillService.predictRefill({
        medicine,
        schedules: schedulesByMedicine.get(String(medicine._id)) || [],
        intakes: intakesByMedicine.get(String(medicine._id)) || [],
        now,
        timezone: tz,
        lookbackDays
      })
    )
    .sort((a, b) => {
      const byUrgency =
        URGENCY_ORDER[a.prediction.urgency] - URGENCY_ORDER[b.prediction.urgency];
      if (byUrgency !== 0) return byUrgency;
      return (a.prediction.daysOfSupply ?? 1e9) - (b.prediction.daysOfSupply ?? 1e9);
    });

  const needingRefill = items.filter((i) =>
    ['out_of_stock', 'refill_now', 'critical', 'urgent'].includes(i.prediction.urgency)
  ).length;

  return ok(res, {
    items,
    summary: { total: items.length, needingRefill, generatedAt: now.toISOString() }
  });
});

module.exports = { getAdherence, getRefillPrediction, getRefillOverview, resolveWindow, loadPatientData };
