'use strict';

const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

const MedicalRecord = require('../models/MedicalRecord');
const Medicine = require('../models/Medicine');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { ok, created } = require('../utils/apiResponse');
const auditService = require('../services/auditService');
const fileService = require('../services/fileService');
const ocrService = require('../services/ocrService');
const { resolvePatientId } = require('./medicineController');
const { config } = require('../config/env');

const SUB_DIR = 'records';

async function checksumOf(absolutePath) {
  const buffer = await fs.readFile(absolutePath);
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Loads a record the caller is entitled to see.
 *
 * A caregiver may only open records the patient marked shareable, and never a
 * record flagged sensitive.
 */
async function findAccessibleRecord(id, req) {
  const patientId = resolvePatientId(req);
  const record = await MedicalRecord.findOne({ _id: id, patient: patientId }).populate(
    'relatedMedicines',
    'name genericName strength dosageForm unit'
  );
  if (!record) throw ApiError.notFound('Medical record not found');

  if (req.isCaregiverAccess) {
    if (!record.shareableWithCaregivers || record.isSensitive) {
      await auditService.record({
        req,
        patient: patientId,
        action: 'ACCESS_DENIED',
        status: 'failure',
        entityType: 'MedicalRecord',
        entityId: record._id,
        description: 'Caregiver attempted to open a record that is not shared with them'
      });
      throw ApiError.forbidden('This record has not been shared with caregivers');
    }
  }

  return record;
}

// -------------------------------------------------------------------- list
const listRecords = asyncHandler(async (req, res) => {
  const patientId = resolvePatientId(req);
  const { page, limit, category, search, from, to, tag, hasFile, sort } = req.query;

  const query = { patient: patientId };
  if (category) query.category = category;
  if (tag) query.tags = tag.toLowerCase();
  if (hasFile === 'true') query['file.filename'] = { $exists: true };
  if (hasFile === 'false') query['file.filename'] = { $exists: false };
  if (from || to) {
    query.recordDate = {};
    if (from) query.recordDate.$gte = from;
    if (to) query.recordDate.$lte = to;
  }
  if (search) {
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp(escaped, 'i');
    query.$or = [{ title: rx }, { description: rx }, { provider: rx }, { doctorName: rx }];
  }
  // Caregivers only ever see the shared, non-sensitive subset.
  if (req.isCaregiverAccess) {
    query.shareableWithCaregivers = true;
    query.isSensitive = { $ne: true };
  }

  const skip = (page - 1) * limit;
  const [items, total] = await Promise.all([
    MedicalRecord.find(query)
      .select('-ocr.extractedText')
      .sort(sort)
      .skip(skip)
      .limit(limit),
    MedicalRecord.countDocuments(query)
  ]);

  return ok(res, {
    items: items.map((r) => r.toJSON()),
    total,
    page,
    limit,
    pages: Math.max(1, Math.ceil(total / limit))
  });
});

// --------------------------------------------------------------------- get
const getRecord = asyncHandler(async (req, res) => {
  const record = await findAccessibleRecord(req.params.id, req);

  record.lastAccessedAt = new Date();
  record.accessCount += 1;
  await record.save({ validateBeforeSave: false });

  await auditService.record({
    req,
    patient: record.patient,
    action: 'RECORD_VIEWED',
    entityType: 'MedicalRecord',
    entityId: record._id,
    description: `Opened "${record.title}" (${record.category})`
  });

  return ok(res, { record: record.toJSON() });
});

// ------------------------------------------------------------------ create
const createRecord = asyncHandler(async (req, res) => {
  const patientId = resolvePatientId(req);
  const { runOcr, patientId: _ignored, ...fields } = req.body;

  if (fields.relatedMedicines?.length) {
    const owned = await Medicine.countDocuments({
      _id: { $in: fields.relatedMedicines },
      patient: patientId
    });
    if (owned !== fields.relatedMedicines.length) {
      if (req.file) await fileService.removeStoredFile(SUB_DIR, req.file.filename);
      throw ApiError.badRequest('One or more linked medicines do not belong to you');
    }
  }

  const payload = {
    ...fields,
    patient: patientId,
    recordDate: fields.recordDate || new Date()
  };

  if (req.file) {
    const absolutePath = fileService.resolveStoredPath(SUB_DIR, req.file.filename);
    payload.file = {
      filename: req.file.filename,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      size: req.file.size,
      checksum: await checksumOf(absolutePath),
      uploadedAt: new Date()
    };
  }

  const record = await MedicalRecord.create(payload);

  if (req.file) {
    record.file.url = `/api/records/${record._id}/file`;

    // OCR runs by default for prescriptions and lab reports.
    const shouldRunOcr =
      runOcr !== undefined
        ? runOcr
        : ['prescription', 'lab_report', 'discharge_summary'].includes(record.category);

    if (shouldRunOcr) {
      record.ocr = await ocrService.processDocument({
        absolutePath: fileService.resolveStoredPath(SUB_DIR, req.file.filename),
        mimeType: req.file.mimetype
      });

      await auditService.record({
        req,
        patient: patientId,
        action: 'OCR_PERFORMED',
        entityType: 'MedicalRecord',
        entityId: record._id,
        newValue: {
          status: record.ocr.status,
          suggestions: record.ocr.suggestedMedicines?.length || 0
        },
        description: `Ran OCR over "${record.title}" - ${record.ocr.suggestedMedicines?.length || 0} medicine suggestion(s) awaiting your confirmation`
      });
    }
    await record.save();
  }

  await auditService.record({
    req,
    patient: patientId,
    action: 'RECORD_CREATED',
    entityType: 'MedicalRecord',
    entityId: record._id,
    newValue: {
      title: record.title,
      category: record.category,
      hasFile: record.hasFile,
      shareableWithCaregivers: record.shareableWithCaregivers
    },
    description: `Added medical record "${record.title}"`
  });

  return created(res, { record: record.toJSON() }, 'Medical record saved');
});

// ------------------------------------------------------------------ update
const updateRecord = asyncHandler(async (req, res) => {
  const patientId = resolvePatientId(req);
  const record = await MedicalRecord.findOne({ _id: req.params.id, patient: patientId });
  if (!record) throw ApiError.notFound('Medical record not found');
  if (req.isCaregiverAccess) throw ApiError.forbidden('Caregivers cannot edit medical records');

  const AUDITED = [
    'title',
    'category',
    'recordDate',
    'description',
    'shareableWithCaregivers',
    'isSensitive',
    'tags'
  ];
  const before = {};
  const after = {};

  for (const [key, value] of Object.entries(req.body)) {
    if (value === undefined || key === 'patientId' || key === 'runOcr') continue;
    if (AUDITED.includes(key)) {
      before[key] = record[key];
      after[key] = value;
    }
    record[key] = value;
  }
  await record.save();

  const sharingChanged =
    'shareableWithCaregivers' in after || 'isSensitive' in after;

  await auditService.record({
    req,
    patient: patientId,
    action: sharingChanged ? 'RECORD_SHARED' : 'RECORD_UPDATED',
    entityType: 'MedicalRecord',
    entityId: record._id,
    oldValue: before,
    newValue: after,
    description: sharingChanged
      ? `Changed caregiver sharing for "${record.title}" to ${record.shareableWithCaregivers ? 'shared' : 'private'}`
      : `Updated medical record "${record.title}"`
  });

  return ok(res, { record: record.toJSON() }, 'Medical record updated');
});

// ------------------------------------------------------------------ delete
const deleteRecord = asyncHandler(async (req, res) => {
  const patientId = resolvePatientId(req);
  const record = await MedicalRecord.findOne({ _id: req.params.id, patient: patientId });
  if (!record) throw ApiError.notFound('Medical record not found');
  if (req.isCaregiverAccess) throw ApiError.forbidden('Caregivers cannot delete medical records');

  const snapshot = {
    title: record.title,
    category: record.category,
    recordDate: record.recordDate,
    file: record.file?.originalName
  };

  if (record.file?.filename) {
    await fileService.removeStoredFile(SUB_DIR, record.file.filename);
  }
  await record.deleteOne();

  await auditService.record({
    req,
    patient: patientId,
    action: 'RECORD_DELETED',
    entityType: 'MedicalRecord',
    entityId: record._id,
    oldValue: snapshot,
    description: `Deleted medical record "${snapshot.title}" and its file`
  });

  return ok(res, null, 'Medical record deleted');
});

// -------------------------------------------------------------- file access
/**
 * Authenticated download. Ownership and caregiver sharing are re-checked on
 * every request, and every download is written to the audit log.
 */
const downloadFile = asyncHandler(async (req, res) => {
  const record = await findAccessibleRecord(req.params.id, req);
  if (!record.file?.filename) throw ApiError.notFound('This record has no attached file');

  const absolutePath = fileService.resolveStoredPath(SUB_DIR, record.file.filename);
  if (!(await fileService.fileExists(SUB_DIR, record.file.filename))) {
    throw ApiError.notFound('The stored file is missing');
  }

  await auditService.record({
    req,
    patient: record.patient,
    action: 'RECORD_FILE_DOWNLOADED',
    entityType: 'MedicalRecord',
    entityId: record._id,
    description: `Downloaded "${record.file.originalName || record.file.filename}" from "${record.title}"`
  });

  res.type(record.file.mimeType || 'application/octet-stream');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Attachment (never inline) so an uploaded SVG/HTML can never execute in the
  // application's origin.
  const safeName = (record.file.originalName || 'document').replace(/["\r\n]/g, '');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
  return res.sendFile(absolutePath);
});

// --------------------------------------------------------------------- OCR
/** Re-runs OCR on demand (e.g. after the user re-uploads a clearer photo). */
const runOcr = asyncHandler(async (req, res) => {
  const patientId = resolvePatientId(req);
  const record = await MedicalRecord.findOne({ _id: req.params.id, patient: patientId });
  if (!record) throw ApiError.notFound('Medical record not found');
  if (!record.file?.filename) throw ApiError.badRequest('This record has no attached file');

  record.ocr = await ocrService.processDocument({
    absolutePath: fileService.resolveStoredPath(SUB_DIR, record.file.filename),
    mimeType: record.file.mimeType
  });
  await record.save();

  await auditService.record({
    req,
    patient: patientId,
    action: 'OCR_PERFORMED',
    entityType: 'MedicalRecord',
    entityId: record._id,
    newValue: {
      status: record.ocr.status,
      suggestions: record.ocr.suggestedMedicines?.length || 0
    },
    description: `Re-ran OCR over "${record.title}"`
  });

  return ok(
    res,
    { ocr: record.ocr },
    record.ocr.status === 'completed'
      ? 'Text extracted. Please review the suggestions before saving them.'
      : 'OCR could not process this file'
  );
});

/**
 * The verification step. Nothing extracted by OCR becomes a medicine until the
 * patient reviews it here and explicitly accepts it - the accepted entries are
 * taken from THIS request body, not from the stored suggestions, so the user
 * can correct anything OCR got wrong.
 */
const confirmOcr = asyncHandler(async (req, res) => {
  const patientId = resolvePatientId(req);
  const record = await MedicalRecord.findOne({ _id: req.params.id, patient: patientId });
  if (!record) throw ApiError.notFound('Medical record not found');
  if (record.ocr?.status !== 'completed') {
    throw ApiError.badRequest('There are no OCR results to confirm for this record');
  }

  const { accepted = [], rejectAll } = req.body;

  if (rejectAll || accepted.length === 0) {
    record.ocr.verificationStatus = 'rejected';
    record.ocr.verifiedAt = new Date();
    await record.save();

    await auditService.record({
      req,
      patient: patientId,
      action: 'OCR_RESULT_CONFIRMED',
      entityType: 'MedicalRecord',
      entityId: record._id,
      newValue: { accepted: 0, rejected: record.ocr.suggestedMedicines?.length || 0 },
      description: `Rejected all OCR medicine suggestions from "${record.title}"`
    });

    return ok(res, { createdMedicines: [], record: record.toJSON() }, 'Suggestions discarded');
  }

  const createdMedicines = [];
  for (const entry of accepted) {
    const medicine = await Medicine.create({
      patient: patientId,
      name: entry.name,
      genericName: entry.genericName || undefined,
      strength: entry.strength || undefined,
      dosageForm: entry.dosageForm || undefined,
      instructions: entry.instructions || undefined,
      initialQuantity: entry.initialQuantity ?? 0,
      currentStock: entry.currentStock ?? entry.initialQuantity ?? 0,
      refillThreshold: entry.refillThreshold ?? 5,
      prescriberNotes: `Added from medical record "${record.title}" after user verification of OCR output`
    });
    createdMedicines.push(medicine.toJSON());

    await auditService.record({
      req,
      patient: patientId,
      action: 'MEDICINE_CREATED',
      entityType: 'Medicine',
      entityId: medicine._id,
      newValue: { name: medicine.name, strength: medicine.strength, source: 'ocr_verified' },
      description: `Created "${medicine.displayName}" from a user-verified OCR suggestion`
    });
  }

  record.ocr.verificationStatus = 'verified';
  record.ocr.verifiedAt = new Date();
  record.relatedMedicines = [
    ...new Set([
      ...record.relatedMedicines.map(String),
      ...createdMedicines.map((m) => String(m.id))
    ])
  ];
  await record.save();

  await auditService.record({
    req,
    patient: patientId,
    action: 'OCR_RESULT_CONFIRMED',
    entityType: 'MedicalRecord',
    entityId: record._id,
    newValue: { accepted: createdMedicines.length },
    description: `Verified and saved ${createdMedicines.length} medicine(s) from "${record.title}"`
  });

  return created(
    res,
    { createdMedicines, record: record.toJSON() },
    `${createdMedicines.length} medicine(s) added after your verification`
  );
});

module.exports = {
  listRecords,
  getRecord,
  createRecord,
  updateRecord,
  deleteRecord,
  downloadFile,
  runOcr,
  confirmOcr,
  findAccessibleRecord
};
