'use strict';

const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { ok, created } = require('../utils/apiResponse');
const tokenService = require('../services/tokenService');
const auditService = require('../services/auditService');
const { config } = require('../config/env');

const MAX_ACTIVE_SESSIONS = 5;

const refreshCookieOptions = () => ({
  httpOnly: true,
  secure: config.isProd,
  sameSite: config.isProd ? 'strict' : 'lax',
  path: '/api/auth',
  maxAge: 7 * 24 * 60 * 60 * 1000
});

/** Issues a token pair and stores the refresh hash (capped session count). */
async function issueSession(user) {
  const { accessToken, refreshToken, refreshTokenHash } = tokenService.issueTokenPair(user);
  const hashes = [...(user.refreshTokenHashes || []), refreshTokenHash].slice(
    -MAX_ACTIVE_SESSIONS
  );
  await User.updateOne({ _id: user._id }, { refreshTokenHashes: hashes });
  return { accessToken, refreshToken };
}

// ---------------------------------------------------------------- register
const register = asyncHandler(async (req, res) => {
  const { name, email, password, role, phone, dateOfBirth, timezone } = req.body;

  if (await User.exists({ email })) {
    throw ApiError.conflict('An account with this email already exists');
  }

  const user = await User.create({ name, email, password, role, phone, dateOfBirth, timezone });
  const { accessToken, refreshToken } = await issueSession(user);

  await auditService.record({
    req,
    user: user._id,
    actorEmail: user.email,
    actorRole: user.role,
    action: 'AUTH_REGISTER',
    entityType: 'User',
    entityId: user._id,
    authMethod: 'password',
    description: `New ${user.role} account created`
  });

  res.cookie('refreshToken', refreshToken, refreshCookieOptions());
  return created(res, { user: user.toJSON(), accessToken, refreshToken }, 'Account created');
});

// ------------------------------------------------------------------- login
const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email }).select(
    '+password +loginAttempts +lockUntil +refreshTokenHashes'
  );

  const genericFailure = ApiError.unauthorized('Invalid email or password');

  if (!user) {
    await auditService.record({
      req,
      action: 'AUTH_LOGIN_FAILED',
      status: 'failure',
      actorEmail: email,
      actorRole: 'anonymous',
      authMethod: 'password',
      description: 'Login attempted for an unknown email address'
    });
    throw genericFailure;
  }

  if (user.isLocked) {
    const minutes = Math.ceil((user.lockUntil - Date.now()) / 60000);
    await auditService.record({
      req,
      user: user._id,
      actorEmail: user.email,
      action: 'AUTH_LOGIN_FAILED',
      status: 'failure',
      authMethod: 'password',
      description: 'Login attempted on a temporarily locked account'
    });
    throw ApiError.tooMany(
      `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`
    );
  }

  if (!user.isActive) throw ApiError.forbidden('This account has been deactivated');

  const matches = await user.comparePassword(password);
  if (!matches) {
    const attempts = (user.loginAttempts || 0) + 1;
    const update = { loginAttempts: attempts };
    if (attempts >= config.security.maxLoginAttempts) {
      update.lockUntil = new Date(Date.now() + config.security.lockMinutes * 60000);
      update.loginAttempts = 0;
    }
    await User.updateOne({ _id: user._id }, update);

    await auditService.record({
      req,
      user: user._id,
      actorEmail: user.email,
      actorRole: user.role,
      action: 'AUTH_LOGIN_FAILED',
      status: 'failure',
      authMethod: 'password',
      description: `Incorrect password (attempt ${attempts})`
    });
    throw genericFailure;
  }

  user.loginAttempts = 0;
  user.lockUntil = undefined;
  user.lastLoginAt = new Date();
  await user.save({ validateBeforeSave: false });

  const { accessToken, refreshToken } = await issueSession(user);

  await auditService.record({
    req,
    user: user._id,
    actorEmail: user.email,
    actorRole: user.role,
    action: 'AUTH_LOGIN_SUCCESS',
    entityType: 'User',
    entityId: user._id,
    authMethod: 'password',
    description: 'Signed in successfully'
  });

  res.cookie('refreshToken', refreshToken, refreshCookieOptions());
  return ok(res, { user: user.toJSON(), accessToken, refreshToken }, 'Signed in');
});

// ----------------------------------------------------------------- refresh
const refresh = asyncHandler(async (req, res) => {
  const supplied = req.body?.refreshToken || req.cookies?.refreshToken;
  if (!supplied) throw ApiError.unauthorized('Refresh token missing');

  const payload = tokenService.verifyRefreshToken(supplied);
  if (payload.type !== 'refresh') throw ApiError.unauthorized('Invalid refresh token');

  const user = await User.findById(payload.sub).select('+refreshTokenHashes');
  if (!user || !user.isActive) throw ApiError.unauthorized('Session is no longer valid');

  const suppliedHash = tokenService.hashToken(supplied);
  if (!user.refreshTokenHashes.includes(suppliedHash)) {
    // Token was already rotated away or revoked - treat as compromised and
    // drop every session for this account.
    await User.updateOne({ _id: user._id }, { refreshTokenHashes: [] });
    await auditService.record({
      req,
      user: user._id,
      actorEmail: user.email,
      action: 'AUTH_LOGIN_FAILED',
      status: 'failure',
      authMethod: 'refresh_token',
      description: 'Reuse of a revoked refresh token - all sessions revoked'
    });
    throw ApiError.unauthorized('Session is no longer valid, please sign in again');
  }

  // Rotate: remove the used hash, add the new one.
  const rotated = tokenService.issueTokenPair(user);
  const hashes = user.refreshTokenHashes
    .filter((h) => h !== suppliedHash)
    .concat(rotated.refreshTokenHash)
    .slice(-MAX_ACTIVE_SESSIONS);
  await User.updateOne({ _id: user._id }, { refreshTokenHashes: hashes });

  await auditService.record({
    req,
    user: user._id,
    actorEmail: user.email,
    actorRole: user.role,
    action: 'AUTH_TOKEN_REFRESH',
    authMethod: 'refresh_token',
    description: 'Access token refreshed'
  });

  res.cookie('refreshToken', rotated.refreshToken, refreshCookieOptions());
  return ok(
    res,
    { accessToken: rotated.accessToken, refreshToken: rotated.refreshToken },
    'Session refreshed'
  );
});

// ------------------------------------------------------------------ logout
const logout = asyncHandler(async (req, res) => {
  const supplied = req.body?.refreshToken || req.cookies?.refreshToken;
  const user = await User.findById(req.user._id).select('+refreshTokenHashes');

  if (supplied) {
    const hash = tokenService.hashToken(supplied);
    user.refreshTokenHashes = (user.refreshTokenHashes || []).filter((h) => h !== hash);
  } else {
    user.refreshTokenHashes = [];
  }
  await user.save({ validateBeforeSave: false });

  await auditService.record({
    req,
    user: user._id,
    actorEmail: user.email,
    actorRole: user.role,
    action: 'AUTH_LOGOUT',
    description: supplied ? 'Signed out of this device' : 'Signed out of all devices'
  });

  res.clearCookie('refreshToken', { path: '/api/auth' });
  return ok(res, null, 'Signed out');
});

// ---------------------------------------------------------------- profile
const me = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select('+webAuthnCredentials');
  const json = user.toJSON();
  json.webAuthnDevices = (user.webAuthnCredentials || []).map((c) => ({
    id: c._id,
    deviceLabel: c.deviceLabel,
    createdAt: c.createdAt,
    lastUsedAt: c.lastUsedAt
  }));
  delete json.webAuthnCredentials;
  return ok(res, { user: json });
});

const updateProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  const before = {};
  const after = {};

  for (const [key, value] of Object.entries(req.body)) {
    if (value === undefined) continue;
    if (key === 'notificationPreferences') {
      before[key] = user.notificationPreferences?.toObject?.() ?? user.notificationPreferences;
      user.notificationPreferences = { ...before[key], ...value };
      after[key] = value;
      continue;
    }
    before[key] = user[key];
    user[key] = value;
    after[key] = value;
  }

  await user.save();

  await auditService.record({
    req,
    user: user._id,
    actorEmail: user.email,
    actorRole: user.role,
    action: 'PROFILE_UPDATED',
    entityType: 'User',
    entityId: user._id,
    oldValue: before,
    newValue: after,
    description: `Updated profile fields: ${Object.keys(after).join(', ') || 'none'}`
  });

  return ok(res, { user: user.toJSON() }, 'Profile updated');
});

const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const user = await User.findById(req.user._id).select('+password +refreshTokenHashes');

  if (!(await user.comparePassword(currentPassword))) {
    throw ApiError.unauthorized('Your current password is incorrect');
  }
  if (currentPassword === newPassword) {
    throw ApiError.badRequest('The new password must be different from the current one');
  }

  user.password = newPassword;
  user.refreshTokenHashes = []; // force re-login everywhere
  await user.save();

  await auditService.record({
    req,
    user: user._id,
    actorEmail: user.email,
    actorRole: user.role,
    action: 'AUTH_PASSWORD_CHANGED',
    entityType: 'User',
    entityId: user._id,
    authMethod: 'password',
    description: 'Password changed - all other sessions revoked'
  });

  res.clearCookie('refreshToken', { path: '/api/auth' });
  return ok(res, null, 'Password changed. Please sign in again.');
});

// --------------------------------------------------------------------- PIN
const setPin = asyncHandler(async (req, res) => {
  const { pin, currentPin, password } = req.body;
  const user = await User.findById(req.user._id).select('+password +pinHash');

  if (!(await user.comparePassword(password))) {
    throw ApiError.unauthorized('Your account password is incorrect');
  }

  const hadPin = Boolean(user.pinHash);
  if (hadPin) {
    if (!currentPin) throw ApiError.badRequest('Your current PIN is required to change it');
    if (!(await user.comparePin(currentPin))) {
      throw ApiError.unauthorized('Your current PIN is incorrect');
    }
  }

  await user.setPin(pin);
  await user.save();

  await auditService.record({
    req,
    user: user._id,
    actorEmail: user.email,
    actorRole: user.role,
    action: hadPin ? 'AUTH_PIN_CHANGED' : 'AUTH_PIN_SET',
    entityType: 'User',
    entityId: user._id,
    authMethod: 'password',
    description: hadPin ? 'Security PIN changed' : 'Security PIN created'
  });

  return ok(res, { hasPin: true }, hadPin ? 'PIN changed' : 'PIN created');
});

const verifyPin = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select('+pinHash +pinAttempts +pinLockedUntil');

  if (!user.pinHash) {
    throw ApiError.badRequest('No security PIN is set for this account');
  }
  if (user.pinLockedUntil && user.pinLockedUntil > new Date()) {
    const minutes = Math.ceil((user.pinLockedUntil - Date.now()) / 60000);
    throw ApiError.tooMany(`PIN entry is locked. Try again in ${minutes} minute(s).`);
  }

  if (!(await user.comparePin(req.body.pin))) {
    user.pinAttempts = (user.pinAttempts || 0) + 1;
    if (user.pinAttempts >= config.security.maxPinAttempts) {
      user.pinLockedUntil = new Date(Date.now() + config.security.lockMinutes * 60000);
      user.pinAttempts = 0;
    }
    await user.save({ validateBeforeSave: false });

    await auditService.record({
      req,
      user: user._id,
      actorEmail: user.email,
      actorRole: user.role,
      action: 'AUTH_PIN_FAILED',
      status: 'failure',
      authMethod: 'pin',
      description: 'Incorrect PIN entered for a sensitive action'
    });
    throw ApiError.unauthorized('Incorrect PIN');
  }

  user.pinAttempts = 0;
  user.pinLockedUntil = undefined;
  await user.save({ validateBeforeSave: false });

  const stepUpToken = tokenService.signStepUpToken(user, 'pin');

  await auditService.record({
    req,
    user: user._id,
    actorEmail: user.email,
    actorRole: user.role,
    action: 'AUTH_STEPUP_GRANTED',
    authMethod: 'pin',
    description: `Step-up granted for ${config.security.stepUpTtlMinutes} minutes`
  });

  return ok(
    res,
    { stepUpToken, expiresInMinutes: config.security.stepUpTtlMinutes, method: 'pin' },
    'Identity confirmed'
  );
});

module.exports = {
  register,
  login,
  refresh,
  logout,
  me,
  updateProfile,
  changePassword,
  setPin,
  verifyPin
};
