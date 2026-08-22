'use strict';

const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const tokenService = require('../services/tokenService');
const auditService = require('../services/auditService');

function extractToken(req) {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) return header.slice(7).trim();
  if (req.cookies && req.cookies.accessToken) return req.cookies.accessToken;
  return null;
}

/**
 * Verifies the access token and attaches the live user document to req.user.
 * Rejects tokens issued before the last password change.
 */
const protect = asyncHandler(async (req, res, next) => {
  const token = extractToken(req);
  if (!token) throw ApiError.unauthorized('Authentication required');

  const payload = tokenService.verifyAccessToken(token);
  if (payload.type !== 'access') {
    throw ApiError.unauthorized('Invalid token type for this request');
  }

  const user = await User.findById(payload.sub);
  if (!user) throw ApiError.unauthorized('The account for this session no longer exists');
  if (!user.isActive) throw ApiError.forbidden('This account has been deactivated');
  if (user.passwordChangedAfter(payload.iat)) {
    throw ApiError.unauthorized('Password was changed recently, please sign in again');
  }

  req.user = user;
  req.authMethod = 'jwt';
  return next();
});

/**
 * Role gate. Usage: authorize('patient') or authorize('patient', 'caregiver').
 */
function authorize(...roles) {
  return asyncHandler(async (req, res, next) => {
    if (!req.user) throw ApiError.unauthorized('Authentication required');
    if (!roles.includes(req.user.role)) {
      await auditService.record({
        req,
        action: 'ACCESS_DENIED',
        status: 'failure',
        entityType: 'Route',
        description: `Role "${req.user.role}" attempted ${req.method} ${req.originalUrl}`
      });
      throw ApiError.forbidden('Your role does not permit this action');
    }
    return next();
  });
}

/**
 * Sensitive-action gate. The client must send a step-up token obtained from
 * POST /api/auth/pin/verify (PIN) or the WebAuthn assertion endpoint.
 *
 * Header: `x-step-up-token: <token>`
 */
const requireStepUp = asyncHandler(async (req, res, next) => {
  const token =
    req.headers['x-step-up-token'] || req.body?.stepUpToken || req.query?.stepUpToken;

  if (!token) {
    throw new ApiError(401, 'This action requires PIN or biometric re-authentication', {
      code: 'STEP_UP_REQUIRED'
    });
  }

  let payload;
  try {
    payload = tokenService.verifyAccessToken(token);
  } catch {
    throw new ApiError(401, 'Re-authentication expired, please confirm your PIN again', {
      code: 'STEP_UP_REQUIRED'
    });
  }

  if (payload.type !== 'stepup' || String(payload.sub) !== String(req.user._id)) {
    throw new ApiError(401, 'Invalid re-authentication token', { code: 'STEP_UP_REQUIRED' });
  }

  req.stepUp = { method: payload.method, verifiedAt: new Date(payload.iat * 1000) };
  req.authMethod = payload.method === 'webauthn' ? 'webauthn' : 'pin';
  return next();
});

/** Attaches req.user when a valid token is present, but never rejects. */
const optionalAuth = asyncHandler(async (req, res, next) => {
  const token = extractToken(req);
  if (!token) return next();
  try {
    const payload = tokenService.verifyAccessToken(token);
    const user = await User.findById(payload.sub);
    if (user && user.isActive) {
      req.user = user;
      req.authMethod = 'jwt';
    }
  } catch {
    /* ignore - anonymous request */
  }
  return next();
});

module.exports = { protect, authorize, requireStepUp, optionalAuth };
