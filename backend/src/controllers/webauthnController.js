'use strict';

const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse
} = require('@simplewebauthn/server');

const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { ok } = require('../utils/apiResponse');
const tokenService = require('../services/tokenService');
const auditService = require('../services/auditService');
const { config } = require('../config/env');

const b64 = (buf) => Buffer.from(buf).toString('base64url');
const fromB64 = (str) => Buffer.from(str, 'base64url');

/**
 * Step 1 of registering a platform authenticator (fingerprint / face unlock).
 * The browser signs the returned challenge with a key that never leaves the
 * device; MedGuardian only ever stores the resulting public key.
 */
const registrationOptions = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select('+webAuthnCredentials');

  const options = await generateRegistrationOptions({
    rpName: config.webauthn.rpName,
    rpID: config.webauthn.rpId,
    userID: Buffer.from(String(user._id)),
    userName: user.email,
    userDisplayName: user.name,
    attestationType: 'none',
    excludeCredentials: (user.webAuthnCredentials || []).map((cred) => ({
      id: cred.credentialId,
      transports: cred.transports
    })),
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
      authenticatorAttachment: 'platform'
    }
  });

  user.currentChallenge = options.challenge;
  await user.save({ validateBeforeSave: false });

  return ok(res, options, 'Registration options generated');
});

/** Step 2: verify the attestation and persist the credential. */
const verifyRegistration = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select(
    '+webAuthnCredentials +currentChallenge'
  );
  if (!user.currentChallenge) {
    throw ApiError.badRequest('No registration in progress - request options first');
  }

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: req.body.credential || req.body,
      expectedChallenge: user.currentChallenge,
      expectedOrigin: config.webauthn.origin,
      expectedRPID: config.webauthn.rpId,
      requireUserVerification: false
    });
  } catch (err) {
    throw ApiError.badRequest(`Biometric registration failed: ${err.message}`);
  }

  if (!verification.verified || !verification.registrationInfo) {
    throw ApiError.badRequest('Biometric registration could not be verified');
  }

  const info = verification.registrationInfo;
  // @simplewebauthn/server v9 nests these under `credential`; v8 exposes them flat.
  const credentialId = info.credential?.id ?? b64(info.credentialID);
  const publicKey = info.credential?.publicKey
    ? b64(info.credential.publicKey)
    : b64(info.credentialPublicKey);
  const counter = info.credential?.counter ?? info.counter ?? 0;

  user.webAuthnCredentials.push({
    credentialId,
    publicKey,
    counter,
    transports: req.body.credential?.response?.transports || [],
    deviceLabel: (req.body.deviceLabel || 'This device').slice(0, 80)
  });
  user.currentChallenge = undefined;
  await user.save({ validateBeforeSave: false });

  await auditService.record({
    req,
    user: user._id,
    actorEmail: user.email,
    actorRole: user.role,
    action: 'AUTH_WEBAUTHN_REGISTERED',
    entityType: 'User',
    entityId: user._id,
    authMethod: 'webauthn',
    description: 'Biometric / platform authenticator registered'
  });

  return ok(res, { verified: true }, 'Biometric authentication enabled');
});

/**
 * Step-up authentication options. Used instead of the PIN when the user has a
 * platform authenticator registered.
 */
const authenticationOptions = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select('+webAuthnCredentials');
  if (!user.webAuthnCredentials?.length) {
    throw ApiError.badRequest('No biometric credential is registered on this account');
  }

  const options = await generateAuthenticationOptions({
    rpID: config.webauthn.rpId,
    userVerification: 'preferred',
    allowCredentials: user.webAuthnCredentials.map((cred) => ({
      id: cred.credentialId,
      transports: cred.transports
    }))
  });

  user.currentChallenge = options.challenge;
  await user.save({ validateBeforeSave: false });

  return ok(res, options, 'Authentication options generated');
});

/** Verifies the assertion and issues a step-up token. */
const verifyAuthentication = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select(
    '+webAuthnCredentials +currentChallenge'
  );
  if (!user.currentChallenge) {
    throw ApiError.badRequest('No authentication in progress - request options first');
  }

  const response = req.body.credential || req.body;
  const stored = user.webAuthnCredentials.find((c) => c.credentialId === response.id);
  if (!stored) throw ApiError.badRequest('Unknown credential for this account');

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: user.currentChallenge,
      expectedOrigin: config.webauthn.origin,
      expectedRPID: config.webauthn.rpId,
      credential: {
        id: stored.credentialId,
        publicKey: fromB64(stored.publicKey),
        counter: stored.counter,
        transports: stored.transports
      },
      requireUserVerification: false
    });
  } catch (err) {
    await auditService.record({
      req,
      user: user._id,
      actorEmail: user.email,
      action: 'AUTH_PIN_FAILED',
      status: 'failure',
      authMethod: 'webauthn',
      description: `Biometric verification failed: ${err.message}`
    });
    throw ApiError.unauthorized('Biometric verification failed');
  }

  if (!verification.verified) throw ApiError.unauthorized('Biometric verification failed');

  stored.counter = verification.authenticationInfo.newCounter;
  stored.lastUsedAt = new Date();
  user.currentChallenge = undefined;
  await user.save({ validateBeforeSave: false });

  const stepUpToken = tokenService.signStepUpToken(user, 'webauthn');

  await auditService.record({
    req,
    user: user._id,
    actorEmail: user.email,
    actorRole: user.role,
    action: 'AUTH_WEBAUTHN_VERIFIED',
    authMethod: 'webauthn',
    description: 'Step-up granted via platform authenticator'
  });

  return ok(
    res,
    { stepUpToken, expiresInMinutes: config.security.stepUpTtlMinutes, method: 'webauthn' },
    'Identity confirmed'
  );
});

const removeCredential = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select('+webAuthnCredentials');
  const before = user.webAuthnCredentials.length;
  user.webAuthnCredentials = user.webAuthnCredentials.filter(
    (c) => String(c._id) !== String(req.params.credentialId)
  );
  if (user.webAuthnCredentials.length === before) {
    throw ApiError.notFound('Credential not found');
  }
  await user.save({ validateBeforeSave: false });

  await auditService.record({
    req,
    user: user._id,
    actorEmail: user.email,
    actorRole: user.role,
    action: 'AUTH_WEBAUTHN_REMOVED',
    entityType: 'User',
    entityId: user._id,
    description: 'Biometric credential removed'
  });

  return ok(res, null, 'Device removed');
});

module.exports = {
  registrationOptions,
  verifyRegistration,
  authenticationOptions,
  verifyAuthentication,
  removeCredential
};
