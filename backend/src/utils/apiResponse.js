'use strict';

/** Uniform success envelope used by every controller. */
function ok(res, data = null, message = 'OK', statusCode = 200, extra = {}) {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
    ...extra
  });
}

function created(res, data = null, message = 'Created') {
  return ok(res, data, message, 201);
}

module.exports = { ok, created };
