'use strict';

const mongoose = require('mongoose');
const ApiError = require('../utils/ApiError');
const logger = require('../config/logger');
const { config } = require('../config/env');

/** 404 catch-all mounted after every route. */
function notFoundHandler(req, res, next) {
  next(ApiError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
}

/** Translates known error shapes into an ApiError. */
function normalise(err) {
  if (err instanceof ApiError) return err;

  if (err instanceof mongoose.Error.ValidationError) {
    const details = Object.values(err.errors).map((e) => ({
      field: e.path,
      message: e.message
    }));
    return ApiError.unprocessable('Validation failed', { details, code: 'VALIDATION_ERROR' });
  }

  if (err instanceof mongoose.Error.CastError) {
    return ApiError.badRequest(`Invalid value for "${err.path}"`, { code: 'CAST_ERROR' });
  }

  if (err && err.code === 11000) {
    const field = Object.keys(err.keyPattern || { value: 1 })[0];
    return ApiError.conflict(`A record with that ${field} already exists`, {
      code: 'DUPLICATE_KEY'
    });
  }

  if (err && (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError')) {
    return ApiError.unauthorized('Session expired or invalid, please sign in again', {
      code: 'INVALID_TOKEN'
    });
  }

  if (err && err.name === 'MulterError') {
    const message =
      err.code === 'LIMIT_FILE_SIZE' ? 'File is larger than the allowed limit' : err.message;
    return ApiError.badRequest(message, { code: err.code });
  }

  if (err && err.type === 'entity.parse.failed') {
    return ApiError.badRequest('Malformed JSON body', { code: 'BAD_JSON' });
  }

  return null;
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const known = normalise(err);
  const error = known || ApiError.internal(err.message || 'Internal server error');

  if (!known || error.statusCode >= 500) {
    logger.error(`${req.method} ${req.originalUrl} ->`, err.stack || err.message);
  } else {
    logger.debug(`${req.method} ${req.originalUrl} -> ${error.statusCode}: ${error.message}`);
  }

  const body = {
    success: false,
    message: error.statusCode >= 500 && config.isProd ? 'Internal server error' : error.message
  };
  if (error.code) body.code = error.code;
  if (error.details) body.details = error.details;
  if (!config.isProd && error.statusCode >= 500) body.stack = err.stack;

  res.status(error.statusCode).json(body);
}

module.exports = { errorHandler, notFoundHandler };
