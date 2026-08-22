'use strict';

const path = require('path');

const Medicine = require('../models/Medicine');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { ok, created } = require('../utils/apiResponse');
const auditService = require('../services/auditService');
const fileService = require('../services/fileService');

/**
 * Resolves the patient whose data this request operates on.
 * A patient always works on their own record; a caregiver must supply
 * `patientId` and pass the caregiver access middleware, which sets
 * `req.patientId`.
 */
function resolvePatientId(req) {
  return req.patientId || req.user._id;
}

const AUDITED_FIELDS = [
  'name',
  'genericName',
  'strength',
  'dosageForm',
  'unit',
  'instructions',
  'prescriberNotes',
  'initialQuantity',
  'currentStock',
  'refillThreshold',
  'expiryDate',
  'isActive'
];

// -------------------------------------------------------------------- list
const listMedicines = asyncHandler(async (req, res) => {
  const patientId = resolvePatientId(req);
  const { page, limit, search, dosageForm, status, needsRefill, sort } = req.query;

  const query = { patient: patientId };
  if (status !== 'all') query.isActive = status === 'active';
  if (dosageForm) query.dosageForm = dosageForm;
  if (search) {
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp(escaped, 'i');
    query.$or = [{ name: rx }, { genericName: rx }, { purpose: rx }];
  }
  if (needsRefill === 'true') {
    query.$expr = { $lte: ['$currentStock', '$refillThreshold'] };
  } else if (needsRefill === 'false') {
    query.$expr = { $gt: ['$currentStock', '$refillThreshold'] };
  }

  const skip = (page - 1) * limit;
  const [items, total] = await Promise.all([
    Medicine.find(query).sort(sort).skip(skip).limit(limit),
    Medicine.countDocuments(query)
  ]);

  return ok(res, {
    items: items.map((m) => m.toJSON()),
    total,
    page,
    limit,
    pages: Math.max(1, Math.ceil(total / limit))
  });
});

// --------------------------------------------------------------------- get
async function findOwnedMedicine(id, patientId) {
  const medicine = await Medicine.findOne({ _id: id, patient: patientId });
  if (!medicine) throw ApiError.notFound('Medicine not found');
  return medicine;
}

const getMedicine = asyncHandler(async (req, res) => {
  const medicine = await findOwnedMedicine(req.params.id, resolvePatientId(req));
  return ok(res, { medicine: medicine.toJSON() });
});

// ------------------------------------------------------------------ create
const createMedicine = asyncHandler(async (req, res) => {
  const patientId = resolvePatientId(req);
  const payload = { ...req.body, patient: patientId };

  // Default current stock to the initial quantity when it is not supplied.
  if (payload.currentStock === undefined && payload.initialQuantity !== undefined) {
    payload.currentStock = payload.initialQuantity;
  }

  const medicine = await Medicine.create(payload);

  await auditService.record({
    req,
    patient: patientId,
    action: 'MEDICINE_CREATED',
    entityType: 'Medicine',
    entityId: medicine._id,
    newValue: {
      name: medicine.name,
      strength: medicine.strength,
      currentStock: medicine.currentStock,
      refillThreshold: medicine.refillThreshold
    },
    description: `Added medicine "${medicine.displayName}"`
  });

  return created(res, { medicine: medicine.toJSON() }, 'Medicine added');
});

// ------------------------------------------------------------------ update
const updateMedicine = asyncHandler(async (req, res) => {
  const patientId = resolvePatientId(req);
  const medicine = await findOwnedMedicine(req.params.id, patientId);

  const before = {};
  const after = {};
  for (const [key, value] of Object.entries(req.body)) {
    if (value === undefined) continue;
    if (AUDITED_FIELDS.includes(key) && String(medicine[key]) !== String(value)) {
      before[key] = medicine[key];
      after[key] = value;
    }
    medicine[key] = value;
  }

  if (medicine.currentStock > medicine.initialQuantity) {
    // Keep initialQuantity meaningful as the largest amount ever held.
    medicine.initialQuantity = medicine.currentStock;
  }

  await medicine.save();

  await auditService.record({
    req,
    patient: patientId,
    action: 'MEDICINE_UPDATED',
    entityType: 'Medicine',
    entityId: medicine._id,
    oldValue: before,
    newValue: after,
    description: `Updated ${Object.keys(after).join(', ') || 'details'} for "${medicine.displayName}"`
  });

  return ok(res, { medicine: medicine.toJSON() }, 'Medicine updated');
});

// ------------------------------------------------------------------ delete
/**
 * Deleting a medicine also removes its image. Schedules and intake history are
 * cleaned up by the schedule module once it exists (Phase 5) - see
 * `services/medicineCleanupService`.
 */
const deleteMedicine = asyncHandler(async (req, res) => {
  const patientId = resolvePatientId(req);
  const medicine = await findOwnedMedicine(req.params.id, patientId);

  const snapshot = {
    name: medicine.name,
    strength: medicine.strength,
    currentStock: medicine.currentStock
  };

  if (medicine.image?.filename) {
    await fileService.removeStoredFile('medicines', medicine.image.filename);
  }

  // eslint-disable-next-line global-require
  const cleanup = require('../services/medicineCleanupService');
  const removed = await cleanup.purgeMedicineDependencies(medicine._id);

  await medicine.deleteOne();

  await auditService.record({
    req,
    patient: patientId,
    action: 'MEDICINE_DELETED',
    entityType: 'Medicine',
    entityId: medicine._id,
    oldValue: snapshot,
    description: `Deleted medicine "${snapshot.name}" (${removed.schedules} schedule(s), ${removed.intakes} intake record(s) removed)`
  });

  return ok(res, { removed }, 'Medicine deleted');
});

// ------------------------------------------------------------ stock change
const adjustStock = asyncHandler(async (req, res) => {
  const patientId = resolvePatientId(req);
  const medicine = await findOwnedMedicine(req.params.id, patientId);
  const { mode, quantity, note } = req.body;

  const previousStock = medicine.currentStock;

  if (mode === 'refill') {
    medicine.currentStock = previousStock + quantity;
    medicine.lastRefillAt = new Date();
    medicine.lastRefillQuantity = quantity;
    if (medicine.currentStock > medicine.initialQuantity) {
      medicine.initialQuantity = medicine.currentStock;
    }
  } else {
    medicine.currentStock = quantity;
  }

  await medicine.save();

  await auditService.record({
    req,
    patient: patientId,
    action: 'MEDICINE_STOCK_ADJUSTED',
    entityType: 'Medicine',
    entityId: medicine._id,
    oldValue: { currentStock: previousStock },
    newValue: { currentStock: medicine.currentStock, mode, note },
    description:
      mode === 'refill'
        ? `Refilled "${medicine.displayName}" with ${quantity} ${medicine.unit}(s)`
        : `Corrected stock of "${medicine.displayName}" to ${quantity} ${medicine.unit}(s)`
  });

  return ok(
    res,
    { medicine: medicine.toJSON(), previousStock },
    mode === 'refill' ? 'Refill recorded' : 'Stock corrected'
  );
});

// ------------------------------------------------------------ image upload
/**
 * Stores the medicine photograph used by the visual reminder card.
 * The file is normalised to webp (EXIF stripped) plus a square thumbnail, and
 * is served back only through the authenticated `GET /:id/image` endpoint.
 */
const uploadImage = asyncHandler(async (req, res) => {
  if (!req.file) throw ApiError.badRequest('No image file was uploaded');

  const patientId = resolvePatientId(req);
  let medicine;
  try {
    medicine = await findOwnedMedicine(req.params.id, patientId);
  } catch (err) {
    await fileService.removeStoredFile('medicines', req.file.filename);
    throw err;
  }

  const previous = medicine.image?.filename;

  let processed;
  try {
    processed = await fileService.processMedicineImage(req.file);
  } catch (err) {
    await fileService.removeStoredFile('medicines', req.file.filename);
    throw ApiError.badRequest('The uploaded file could not be read as an image');
  }

  medicine.image = {
    filename: processed.filename,
    originalName: req.file.originalname,
    mimeType: 'image/webp',
    size: processed.size,
    url: `/api/medicines/${medicine._id}/image`,
    thumbnailUrl: `/api/medicines/${medicine._id}/image?variant=thumbnail`,
    uploadedAt: new Date()
  };
  await medicine.save();

  if (previous && previous !== processed.filename) {
    await fileService.removeStoredFile('medicines', previous);
  }

  await auditService.record({
    req,
    patient: patientId,
    action: 'MEDICINE_IMAGE_UPLOADED',
    entityType: 'Medicine',
    entityId: medicine._id,
    newValue: { filename: processed.filename, size: processed.size },
    description: `Uploaded a photo for "${medicine.displayName}"`
  });

  return ok(res, { medicine: medicine.toJSON() }, 'Medicine image uploaded');
});

/** Authenticated image delivery - ownership is re-checked on every request. */
const getImage = asyncHandler(async (req, res) => {
  const medicine = await findOwnedMedicine(req.params.id, resolvePatientId(req));
  if (!medicine.image?.filename) throw ApiError.notFound('This medicine has no image');

  const wantsThumb = req.query.variant === 'thumbnail';
  const parsed = path.parse(medicine.image.filename);
  const filename = wantsThumb ? `${parsed.name}-thumb.webp` : medicine.image.filename;

  const exists = await fileService.fileExists('medicines', filename);
  const finalName = exists ? filename : medicine.image.filename;
  if (!(await fileService.fileExists('medicines', finalName))) {
    throw ApiError.notFound('The stored image file is missing');
  }

  res.type(medicine.image.mimeType || 'image/webp');
  res.setHeader('Cache-Control', 'private, max-age=300');
  return res.sendFile(fileService.resolveStoredPath('medicines', finalName));
});

const deleteImage = asyncHandler(async (req, res) => {
  const patientId = resolvePatientId(req);
  const medicine = await findOwnedMedicine(req.params.id, patientId);
  if (!medicine.image?.filename) throw ApiError.notFound('This medicine has no image');

  const removed = medicine.image.filename;
  await fileService.removeStoredFile('medicines', removed);
  medicine.image = undefined;
  await medicine.save();

  await auditService.record({
    req,
    patient: patientId,
    action: 'MEDICINE_UPDATED',
    entityType: 'Medicine',
    entityId: medicine._id,
    oldValue: { image: removed },
    newValue: { image: null },
    description: `Removed the photo for "${medicine.displayName}"`
  });

  return ok(res, { medicine: medicine.toJSON() }, 'Medicine image removed');
});

module.exports = {
  uploadImage,
  getImage,
  deleteImage,
  listMedicines,
  getMedicine,
  createMedicine,
  updateMedicine,
  deleteMedicine,
  adjustStock,
  findOwnedMedicine,
  resolvePatientId
};
