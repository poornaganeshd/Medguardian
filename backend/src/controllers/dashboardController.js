'use strict';

const Medicine = require('../models/Medicine');
const Schedule = require('../models/Schedule');
const Intake = require('../models/Intake');
const MedicalRecord = require('../models/MedicalRecord');
const CaregiverLink = require('../models/CaregiverLink');
const asyncHandler = require('../utils/asyncHandler');
const { ok } = require('../utils/apiResponse');
const scheduleService = require('../services/scheduleService');
const adherenceService = require('../services/adherenceService');
const refillService = require('../services/refillPredictionService');
const interactionService = require('../services/drugInteractionService');
const { resolvePatientId } = require('./medicineController');
const { patientTimezone } = require('./scheduleController');
const {
  toLocalDateKey,
  addDays,
  localDateTime,
  startOfLocalDay,
  endOfLocalDay
} = require('../utils/dateTime');

/**
 * One call that assembles everything the patient dashboard shows:
 * today's doses, upcoming reminders, adherence, stock and refill warnings,
 * recent records, caregiver status and any interaction alerts.
 */
const getDashboard = asyncHandler(async (req, res) => {
  const patientId = resolvePatientId(req);
  const tz = patientTimezone(req);
  const now = new Date();
  const todayKey = toLocalDateKey(now, tz);
  const adherenceFromKey = addDays(todayKey, -29);

  const [medicines, schedules, recentIntakes, records, caregiverLinks] = await Promise.all([
    Medicine.find({ patient: patientId, isActive: true }),
    Schedule.find({ patient: patientId }).populate(
      'medicine',
      'name genericName strength dosageForm unit image currentStock refillThreshold instructions'
    ),
    Intake.find({
      patient: patientId,
      dateKey: { $gte: adherenceFromKey, $lte: addDays(todayKey, 1) }
    }),
    MedicalRecord.find({ patient: patientId })
      .select('title category recordDate description file.originalName createdAt')
      .sort({ recordDate: -1 })
      .limit(5),
    CaregiverLink.find({
      $or: [{ patient: patientId }, { caregiver: patientId }],
      status: { $in: ['invited', 'accepted'] }
    })
      .populate('caregiver', 'name email')
      .populate('patient', 'name email')
  ]);

  const medicineById = new Map(medicines.map((m) => [String(m._id), m.toJSON()]));

  // ---------------------------------------------------------------- today
  const todayOccurrences = scheduleService.attachIntakes(
    scheduleService.expandSchedules(schedules, {
      from: startOfLocalDay(todayKey, tz),
      to: endOfLocalDay(todayKey, tz),
      timezone: tz
    }),
    recentIntakes,
    now
  );

  const today = todayOccurrences.map((occ) => ({
    ...occ,
    medicine: medicineById.get(occ.medicineId) || null
  }));

  const todaySummary = today.reduce(
    (acc, item) => {
      acc[item.status] = (acc[item.status] || 0) + 1;
      acc.total += 1;
      return acc;
    },
    { total: 0 }
  );

  // ------------------------------------------------------------- upcoming
  const upcoming = scheduleService
    .attachIntakes(
      scheduleService.expandSchedules(schedules, {
        from: now,
        to: endOfLocalDay(addDays(todayKey, 2), tz),
        timezone: tz
      }),
      recentIntakes,
      now
    )
    .filter((occ) => ['upcoming', 'due', 'late'].includes(occ.status))
    .slice(0, 8)
    .map((occ) => ({ ...occ, medicine: medicineById.get(occ.medicineId) || null }));

  // ------------------------------------------------------------ adherence
  const adherence = adherenceService.computeAdherence({
    schedules,
    intakes: recentIntakes,
    from: localDateTime(adherenceFromKey, '00:00', tz),
    to: localDateTime(todayKey, '23:59', tz),
    timezone: tz,
    now
  });

  // --------------------------------------------------------------- refill
  const schedulesByMedicine = new Map();
  for (const schedule of schedules) {
    const key = String(schedule.medicine?._id ?? schedule.medicine);
    if (!schedulesByMedicine.has(key)) schedulesByMedicine.set(key, []);
    schedulesByMedicine.get(key).push(schedule);
  }
  const intakesByMedicine = new Map();
  for (const intake of recentIntakes) {
    const key = String(intake.medicine);
    if (!intakesByMedicine.has(key)) intakesByMedicine.set(key, []);
    intakesByMedicine.get(key).push(intake);
  }

  const refills = medicines
    .map((medicine) =>
      refillService.predictRefill({
        medicine,
        schedules: schedulesByMedicine.get(String(medicine._id)) || [],
        intakes: intakesByMedicine.get(String(medicine._id)) || [],
        now,
        timezone: tz
      })
    )
    .filter((p) => p.prediction.urgency !== 'ok')
    .sort((a, b) => (a.prediction.daysOfSupply ?? 1e9) - (b.prediction.daysOfSupply ?? 1e9));

  // --------------------------------------------------------- interactions
  const interactions = interactionService.checkInteractions(
    medicines.map((m) => ({
      id: String(m._id),
      name: m.name,
      genericName: m.genericName,
      normalizedName: m.normalizedName
    }))
  );

  // ----------------------------------------------------------- caregivers
  const myCaregivers = caregiverLinks
    .filter((l) => String(l.patient?._id ?? l.patient) === String(patientId))
    .map((l) => ({
      id: l._id,
      name: l.caregiverName || l.caregiver?.name,
      email: l.caregiverEmail,
      relationship: l.relationship,
      status: l.status,
      permissions: l.permissions
    }));

  const patientsIHelp = caregiverLinks
    .filter((l) => String(l.caregiver?._id ?? l.caregiver) === String(patientId))
    .map((l) => ({
      id: l._id,
      patientId: l.patient?._id,
      patientName: l.patient?.name,
      status: l.status
    }));

  return ok(res, {
    date: todayKey,
    timezone: tz,
    generatedAt: now.toISOString(),

    today,
    todaySummary,
    upcoming,

    adherence: adherence.summary,
    adherenceDaily: adherence.daily.slice(-14),

    stock: {
      total: medicines.length,
      needingRefill: medicines.filter((m) => m.currentStock <= m.refillThreshold).length,
      outOfStock: medicines.filter((m) => m.currentStock <= 0).length
    },
    refillWarnings: refills.slice(0, 5).map((p) => ({
      medicineId: p.medicineId,
      medicineName: p.medicineName,
      currentStock: p.stock.currentStock,
      unit: p.unit,
      daysOfSupply: p.prediction.daysOfSupply,
      runOutDate: p.prediction.runOutDate,
      suggestedRefillDate: p.prediction.suggestedRefillDate,
      urgency: p.prediction.urgency
    })),

    interactionAlerts: {
      total: interactions.summary.total,
      major: interactions.summary.major,
      moderate: interactions.summary.moderate,
      highestSeverity: interactions.summary.highestSeverity,
      duplicateTherapyGroups: interactions.summary.duplicateTherapyGroups,
      isDemoData: interactions.dataset.isDemoData
    },

    recentRecords: records.map((r) => r.toJSON()),

    caregivers: {
      myCaregivers,
      patientsIHelp,
      activeCount: myCaregivers.filter((c) => c.status === 'accepted').length,
      pendingInvites: myCaregivers.filter((c) => c.status === 'invited').length
    }
  });
});

module.exports = { getDashboard };
