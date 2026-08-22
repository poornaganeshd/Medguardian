'use strict';

/**
 * Operational error carrying an HTTP status code. Anything thrown that is not
 * an ApiError is treated as an unexpected failure by the error handler.
 */
class ApiError extends Error {
  constructor(statusCode, message, options = {}) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.isOperational = true;
    this.code = options.code || undefined;
    this.details = options.details || undefined;
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(message = 'Bad request', options) {
    return new ApiError(400, message, options);
  }

  static unauthorized(message = 'Authentication required', options) {
    return new ApiError(401, message, options);
  }

  static forbidden(message = 'You do not have access to this resource', options) {
    return new ApiError(403, message, options);
  }

  static notFound(message = 'Resource not found', options) {
    return new ApiError(404, message, options);
  }

  static conflict(message = 'Resource conflict', options) {
    return new ApiError(409, message, options);
  }

  static unprocessable(message = 'Unprocessable request', options) {
    return new ApiError(422, message, options);
  }

  static tooMany(message = 'Too many requests', options) {
    return new ApiError(429, message, options);
  }

  static internal(message = 'Internal server error', options) {
    return new ApiError(500, message, options);
  }
}

module.exports = ApiError;
