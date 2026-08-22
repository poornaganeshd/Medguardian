'use strict';

const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const { config } = require('../config/env');
const ApiError = require('../utils/ApiError');

/**
 * Uploads are written with a random, extension-checked filename into a
 * directory outside the public web root. Files are only ever served back
 * through an authenticated controller, never by express.static.
 */
const EXTENSION_BY_MIME = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
  'text/plain': '.txt'
};

function buildStorage(subdir) {
  const destination = path.join(config.uploads.dir, subdir);
  fs.mkdirSync(destination, { recursive: true });

  return multer.diskStorage({
    destination: (req, file, cb) => cb(null, destination),
    filename: (req, file, cb) => {
      const ext = EXTENSION_BY_MIME[file.mimetype] || '';
      cb(null, `${Date.now()}-${crypto.randomBytes(12).toString('hex')}${ext}`);
    }
  });
}

function buildFilter(allowedMimes) {
  return (req, file, cb) => {
    if (!allowedMimes.includes(file.mimetype)) {
      return cb(
        ApiError.badRequest(
          `Unsupported file type "${file.mimetype}". Allowed: ${allowedMimes.join(', ')}`
        )
      );
    }
    return cb(null, true);
  };
}

const uploadMedicineImage = multer({
  storage: buildStorage('medicines'),
  limits: { fileSize: config.uploads.maxBytes, files: 1 },
  fileFilter: buildFilter(config.uploads.imageMimes)
}).single('image');

const uploadRecordFile = multer({
  storage: buildStorage('records'),
  limits: { fileSize: config.uploads.maxBytes, files: 1 },
  fileFilter: buildFilter(config.uploads.documentMimes)
}).single('file');

/** Wraps a multer middleware so its errors flow through the error handler. */
const handleUpload = (uploader) => (req, res, next) =>
  uploader(req, res, (err) => (err ? next(err) : next()));

module.exports = {
  medicineImage: handleUpload(uploadMedicineImage),
  recordFile: handleUpload(uploadRecordFile),
  EXTENSION_BY_MIME
};
