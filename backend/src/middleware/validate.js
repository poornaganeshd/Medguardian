'use strict';

const ApiError = require('../utils/ApiError');

/**
 * Validates req.body / req.query / req.params against zod schemas and replaces
 * the raw input with the parsed (typed, stripped) result.
 *
 * @param {{body?: import('zod').ZodTypeAny, query?: import('zod').ZodTypeAny, params?: import('zod').ZodTypeAny}} schemas
 */
function validate(schemas = {}) {
  return (req, res, next) => {
    for (const key of ['params', 'query', 'body']) {
      const schema = schemas[key];
      if (!schema) continue;
      const result = schema.safeParse(req[key]);
      if (!result.success) {
        const details = result.error.issues.map((issue) => ({
          field: [key, ...issue.path].join('.'),
          message: issue.message
        }));
        return next(
          ApiError.unprocessable('Validation failed', { details, code: 'VALIDATION_ERROR' })
        );
      }
      // req.query is a getter on newer Express versions; assign defensively.
      try {
        req[key] = result.data;
      } catch {
        Object.defineProperty(req, key, { value: result.data, writable: true });
      }
    }
    return next();
  };
}

module.exports = validate;
