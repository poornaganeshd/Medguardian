'use strict';

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { config } = require('../config/env');

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

/** Short-lived access token used on every API call. */
function signAccessToken(user) {
  return jwt.sign(
    { sub: String(user._id), role: user.role, type: 'access' },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn, issuer: config.jwt.issuer }
  );
}

/** Long-lived refresh token; only its hash is persisted on the user. */
function signRefreshToken(user) {
  const jti = crypto.randomUUID();
  const token = jwt.sign(
    { sub: String(user._id), type: 'refresh', jti },
    config.jwt.refreshSecret,
    { expiresIn: config.jwt.refreshExpiresIn, issuer: config.jwt.issuer }
  );
  return { token, hash: sha256(token) };
}

/**
 * Step-up token proving the user just re-authenticated with a PIN or a
 * platform authenticator. Required by sensitive endpoints.
 */
function signStepUpToken(user, method) {
  return jwt.sign(
    { sub: String(user._id), type: 'stepup', method },
    config.jwt.secret,
    { expiresIn: `${config.security.stepUpTtlMinutes}m`, issuer: config.jwt.issuer }
  );
}

function verifyAccessToken(token) {
  return jwt.verify(token, config.jwt.secret, { issuer: config.jwt.issuer });
}

function verifyRefreshToken(token) {
  return jwt.verify(token, config.jwt.refreshSecret, { issuer: config.jwt.issuer });
}

function hashToken(token) {
  return sha256(token);
}

/** Issues both tokens and returns the refresh hash for persistence. */
function issueTokenPair(user) {
  const accessToken = signAccessToken(user);
  const { token: refreshToken, hash } = signRefreshToken(user);
  return { accessToken, refreshToken, refreshTokenHash: hash };
}

module.exports = {
  signAccessToken,
  signRefreshToken,
  signStepUpToken,
  verifyAccessToken,
  verifyRefreshToken,
  hashToken,
  issueTokenPair
};
