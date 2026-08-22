'use strict';

const mongoose = require('mongoose');

const { Schema } = mongoose;

/**
 * Append-only record of security- and privacy-relevant actions.
 *
 * Requirement coverage: user, action, entity, old value, new value,
 * authentication method and timestamp are all captured.
 */
const AUDIT_ACTIONS = [
  // authentication & account security
  'AUTH_REGISTER',
  'AUTH_LOGIN_SUCCESS',
  'AUTH_LOGIN_FAILED',
  'AUTH_LOGOUT',
  'AUTH_TOKEN_REFRESH',
  'AUTH_PASSWORD_CHANGED',
  'AUTH_PIN_SET',
  'AUTH_PIN_CHANGED',
  'AUTH_PIN_VERIFIED',
  'AUTH_PIN_FAILED',
  'AUTH_STEPUP_GRANTED',
  'AUTH_WEBAUTHN_REGISTERED',
  'AUTH_WEBAUTHN_REMOVED',
  'AUTH_WEBAUTHN_VERIFIED',
  'PROFILE_UPDATED',
  // medicines & schedules
  'MEDICINE_CREATED',
  'MEDICINE_UPDATED',
  'MEDICINE_DELETED',
  'MEDICINE_IMAGE_UPLOADED',
  'MEDICINE_STOCK_ADJUSTED',
  'SCHEDULE_CREATED',
  'SCHEDULE_UPDATED',
  'SCHEDULE_DELETED',
  'SCHEDULE_STATUS_CHANGED',
  // intake
  'INTAKE_RECORDED',
  'INTAKE_UPDATED',
  // records & files
  'RECORD_CREATED',
  'RECORD_UPDATED',
  'RECORD_DELETED',
  'RECORD_VIEWED',
  'RECORD_FILE_DOWNLOADED',
  'RECORD_SHARED',
  'OCR_PERFORMED',
  'OCR_RESULT_CONFIRMED',
  // caregiver / permissions
  'CAREGIVER_INVITED',
  'CAREGIVER_ACCEPTED',
  'CAREGIVER_DECLINED',
  'CAREGIVER_REVOKED',
  'CAREGIVER_PERMISSIONS_CHANGED',
  'CAREGIVER_ACCESSED_PATIENT_DATA',
  // misc
  'ACCESS_DENIED',
  'DATA_EXPORTED'
];

const auditLogSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    // Populated when a caregiver acts on behalf of / against a patient record.
    patient: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    actorEmail: { type: String, trim: true, lowercase: true },
    actorRole: { type: String, enum: ['patient', 'caregiver', 'system', 'anonymous'] },

    action: { type: String, enum: AUDIT_ACTIONS, required: true, index: true },
    entityType: { type: String, trim: true },
    entityId: { type: Schema.Types.ObjectId },
    description: { type: String, trim: true, maxlength: 500 },

    oldValue: { type: Schema.Types.Mixed },
    newValue: { type: Schema.Types.Mixed },

    authMethod: {
      type: String,
      enum: ['password', 'jwt', 'refresh_token', 'pin', 'webauthn', 'none'],
      default: 'jwt'
    },
    status: { type: String, enum: ['success', 'failure'], default: 'success', index: true },

    ipAddress: { type: String, trim: true },
    userAgent: { type: String, trim: true, maxlength: 400 }
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    toJSON: { transform: (doc, ret) => { delete ret.__v; return ret; } }
  }
);

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ user: 1, createdAt: -1 });

// Audit entries are immutable once written.
auditLogSchema.pre('findOneAndUpdate', function block(next) {
  next(new Error('Audit log entries are immutable'));
});
auditLogSchema.pre('updateOne', function block(next) {
  next(new Error('Audit log entries are immutable'));
});

module.exports = mongoose.model('AuditLog', auditLogSchema);
module.exports.AUDIT_ACTIONS = AUDIT_ACTIONS;
