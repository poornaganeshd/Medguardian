'use strict';

const path = require('path');
const dotenv = require('dotenv');

// Load backend/.env (falls back silently when the file is absent, e.g. in CI)
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const num = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const bool = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
};

const list = (value, fallback = []) => {
  if (!value) return fallback;
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
};

const NODE_ENV = process.env.NODE_ENV || 'development';
const isProd = NODE_ENV === 'production';
const isTest = NODE_ENV === 'test';

/**
 * Development/test fallbacks exist purely so the project can be cloned and run
 * without configuration. In production every secret must come from the
 * environment - the guard below refuses to boot otherwise.
 */
const devFallback = (name, fallback) => {
  const value = process.env[name];
  if (value) return value;
  if (isProd) return undefined;
  return fallback;
};

const config = {
  env: NODE_ENV,
  isProd,
  isTest,
  isDev: NODE_ENV === 'development',
  port: num(process.env.PORT, 5000),
  clientOrigins: list(process.env.CLIENT_ORIGIN, [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:4173'
  ]),

  mongoUri: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/medguardian',

  jwt: {
    secret: devFallback('JWT_SECRET', 'medguardian-dev-access-secret-change-me'),
    refreshSecret: devFallback('JWT_REFRESH_SECRET', 'medguardian-dev-refresh-secret-change-me'),
    expiresIn: process.env.JWT_EXPIRES_IN || '2h',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
    issuer: 'medguardian'
  },

  security: {
    bcryptRounds: num(process.env.BCRYPT_SALT_ROUNDS, isTest ? 4 : 12),
    stepUpTtlMinutes: num(process.env.STEPUP_TOKEN_TTL_MINUTES, 10),
    maxLoginAttempts: num(process.env.MAX_LOGIN_ATTEMPTS, 8),
    lockMinutes: num(process.env.ACCOUNT_LOCK_MINUTES, 15),
    maxPinAttempts: num(process.env.MAX_PIN_ATTEMPTS, 5)
  },

  webauthn: {
    rpName: process.env.WEBAUTHN_RP_NAME || 'MedGuardian',
    rpId: process.env.WEBAUTHN_RP_ID || 'localhost',
    origin: process.env.WEBAUTHN_ORIGIN || 'http://localhost:5173'
  },

  uploads: {
    dir: path.resolve(__dirname, '../../', process.env.UPLOAD_DIR || 'uploads'),
    maxBytes: num(process.env.MAX_UPLOAD_MB, 10) * 1024 * 1024,
    imageMimes: ['image/jpeg', 'image/png', 'image/webp'],
    documentMimes: [
      'image/jpeg',
      'image/png',
      'image/webp',
      'application/pdf',
      'text/plain'
    ]
  },

  ocr: {
    enabled: bool(process.env.OCR_ENABLED, true),
    lang: process.env.OCR_LANG || 'eng'
  },

  rateLimit: {
    windowMs: num(process.env.RATE_LIMIT_WINDOW_MINUTES, 15) * 60 * 1000,
    max: num(process.env.RATE_LIMIT_MAX, 300),
    authMax: num(process.env.AUTH_RATE_LIMIT_MAX, 25)
  },

  logLevel: process.env.LOG_LEVEL || 'info',
  seedReferenceData: bool(process.env.SEED_REFERENCE_DATA, true)
};

/**
 * Fail fast in production when a required secret is missing, rather than
 * silently signing tokens with a well-known development key.
 */
function assertProductionSecrets() {
  if (!isProd) return;
  const missing = [];
  if (!process.env.JWT_SECRET) missing.push('JWT_SECRET');
  if (!process.env.JWT_REFRESH_SECRET) missing.push('JWT_REFRESH_SECRET');
  if (!process.env.MONGO_URI) missing.push('MONGO_URI');
  if (missing.length) {
    throw new Error(
      `Missing required production environment variables: ${missing.join(', ')}`
    );
  }
  if (process.env.JWT_SECRET === process.env.JWT_REFRESH_SECRET) {
    throw new Error('JWT_SECRET and JWT_REFRESH_SECRET must be different values');
  }
}

module.exports = { config, assertProductionSecrets };
