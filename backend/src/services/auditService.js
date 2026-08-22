'use strict';

const AuditLog = require('../models/AuditLog');
const logger = require('../config/logger');

/** Fields that must never be written into an audit diff. */
const REDACTED_KEYS = new Set([
  'password',
  'newPassword',
  'currentPassword',
  'pin',
  'newPin',
  'currentPin',
  'pinHash',
  'token',
  'refreshToken',
  'accessToken',
  'stepUpToken',
  'refreshTokenHashes',
  'currentChallenge',
  'publicKey'
]);

function redact(value, depth = 0) {
  if (value === null || value === undefined || depth > 4) return value;
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (value instanceof Date) return value;
  if (typeof value !== 'object') return value;
  if (value._bsontype || typeof value.toHexString === 'function') return String(value);

  const out = {};
  for (const [key, val] of Object.entries(value)) {
    out[key] = REDACTED_KEYS.has(key) ? '[REDACTED]' : redact(val, depth + 1);
  }
  return out;
}

/**
 * Writes an audit entry. Never throws - a logging failure must not break the
 * user-facing operation, but it is reported to the server log.
 *
 * @param {object} entry
 * @param {import('express').Request} [entry.req] request used for IP / UA / actor
 */
async function record(entry = {}) {
  try {
    const { req, ...rest } = entry;
    const actor = rest.actor || req?.user || null;

    const doc = {
      user: rest.user ?? actor?._id ?? null,
      patient: rest.patient ?? null,
      actorEmail: rest.actorEmail ?? actor?.email ?? null,
      actorRole: rest.actorRole ?? actor?.role ?? (actor ? 'patient' : 'anonymous'),
      action: rest.action,
      entityType: rest.entityType,
      entityId: rest.entityId,
      description: rest.description,
      oldValue: rest.oldValue === undefined ? undefined : redact(rest.oldValue),
      newValue: rest.newValue === undefined ? undefined : redact(rest.newValue),
      authMethod: rest.authMethod || req?.authMethod || (actor ? 'jwt' : 'none'),
      status: rest.status || 'success',
      ipAddress: rest.ipAddress || req?.ip,
      userAgent: rest.userAgent || req?.headers?.['user-agent']
    };

    return await AuditLog.create(doc);
  } catch (err) {
    logger.error('Failed to write audit log:', err.message);
    return null;
  }
}

/** Paginated audit trail for one user (their own actions and actions on them). */
async function listForUser(userId, { page = 1, limit = 25, action, from, to } = {}) {
  const query = { $or: [{ user: userId }, { patient: userId }] };
  if (action) query.action = action;
  if (from || to) {
    query.createdAt = {};
    if (from) query.createdAt.$gte = new Date(from);
    if (to) query.createdAt.$lte = new Date(to);
  }

  const skip = (page - 1) * limit;
  const [items, total] = await Promise.all([
    AuditLog.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    AuditLog.countDocuments(query)
  ]);

  return { items, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) };
}

module.exports = { record, listForUser, redact };
