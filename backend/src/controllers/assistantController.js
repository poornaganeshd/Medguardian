'use strict';

const Medicine = require('../models/Medicine');
const Schedule = require('../models/Schedule');
const Intake = require('../models/Intake');
const MedicalRecord = require('../models/MedicalRecord');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { ok } = require('../utils/apiResponse');
const medicineInfoService = require('../services/medicineInfoService');
const visitSummaryService = require('../services/visitSummaryService');
const insightsService = require('../services/insightsService');
const refillService = require('../services/refillPredictionService');
const auditService = require('../services/auditService');
const { resolvePatientId } = require('./medicineController');
const { patientTimezone } = require('./scheduleController');
const { toLocalDateKey, addDays } = require('../utils/dateTime');

// ------------------------------------------ medicine information assistant
const askMedicineInfo = asyncHandler(async (req, res) => {
  const { question, medicineName, medicineId, topic } = req.body;

  let name = medicineName;
  if (medicineId) {
    const medicine = await Medicine.findOne({
      _id: medicineId,
      patient: resolvePatientId(req)
    });
    if (!medicine) throw ApiError.notFound('Medicine not found');
    name = medicine.genericName || medicine.name;
  }

  const result = medicineInfoService.answer({ question, medicineName: name, topic });
  return ok(res, result);
});

const getKnowledgeBase = asyncHandler(async (req, res) =>
  ok(res, { knowledgeBase: medicineInfoService.knowledgeBaseInfo() })
);

// ----------------------------------------------------------- visit summary
/**
 * Summarises text the user supplies directly, or the OCR text already stored
 * on one of their medical records.
 */
const summariseVisit = asyncHandler(async (req, res) => {
  const patientId = resolvePatientId(req);
  const { text, recordId, title } = req.body;

  let sourceText = text;
  let record = null;

  if (recordId) {
    record = await MedicalRecord.findOne({ _id: recordId, patient: patientId });
    if (!record) throw ApiError.notFound('Medical record not found');
    sourceText = record.ocr?.extractedText;
    if (!sourceText) {
      throw ApiError.badRequest(
        'This record has no extracted text yet. Run OCR on it first, or paste the text directly.'
      );
    }
  }

  if (!sourceText) throw ApiError.badRequest('Provide either "text" or a "recordId" to summarise');

  const summary = visitSummaryService.summariseVisit(sourceText, {
    title: title || record?.title || 'Visit summary'
  });

  // Compare the document's medicines against the patient's current list.
  const patientMedicines = await Medicine.find({ patient: patientId, isActive: true }).select(
    'name genericName normalizedName strength'
  );
  summary.reconciliation = visitSummaryService.reconcileMedicines(
    summary.medicines || [],
    patientMedicines.map((m) => m.toJSON())
  );

  if (record) {
    await auditService.record({
      req,
      patient: patientId,
      action: 'RECORD_VIEWED',
      entityType: 'MedicalRecord',
      entityId: record._id,
      description: `Generated a visit summary from "${record.title}"`
    });
  }

  return ok(res, summary);
});

// ---------------------------------------------------------------- insights
const getInsights = asyncHandler(async (req, res) => {
  const patientId = resolvePatientId(req);
  const tz = patientTimezone(req);
  const now = new Date();
  const windowDays = req.query.windowDays || 30;
  const todayKey = toLocalDateKey(now, tz);

  // Two equal windows so the trend comparison has a baseline.
  const historyFromKey = addDays(todayKey, -(windowDays * 2));

  const [schedules, intakes, medicines] = await Promise.all([
    Schedule.find({ patient: patientId }),
    Intake.find({ patient: patientId, dateKey: { $gte: historyFromKey, $lte: todayKey } }),
    Medicine.find({ patient: patientId, isActive: true })
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

  const refillPredictions = medicines.map((medicine) =>
    refillService.predictRefill({
      medicine,
      schedules: schedulesByMedicine.get(String(medicine._id)) || [],
      intakes: intakesByMedicine.get(String(medicine._id)) || [],
      now,
      timezone: tz
    })
  );

  const result = insightsService.generateInsights({
    schedules,
    intakes,
    medicines,
    refillPredictions,
    now,
    timezone: tz,
    windowDays
  });

  return ok(res, result);
});

module.exports = { askMedicineInfo, getKnowledgeBase, summariseVisit, getInsights };
