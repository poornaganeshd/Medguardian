'use strict';

const crypto = require('crypto');
const mongoose = require('mongoose');

const { Schema } = mongoose;

const LINK_STATUSES = ['invited', 'accepted', 'declined', 'revoked'];

/**
 * Granular, per-link caregiver permissions.
 *
 * Every flag defaults to the *least* access that still makes the link useful:
 * a caregiver can see medicines, schedules and adherence, but medical records
 * and the ability to record a dose must be granted deliberately by the
 * patient. There is no "full access" switch anywhere in the system.
 */
const permissionsSchema = new Schema(
  {
    viewMedicines: { type: Boolean, default: true },
    viewSchedules: { type: Boolean, default: true },
    viewAdherence: { type: Boolean, default: true },
    /** Access to stored documents - and then only those marked shareable. */
    viewRecords: { type: Boolean, default: false },
    /** Permission to mark a dose taken/skipped on the patient's behalf. */
    canRecordIntake: { type: Boolean, default: false },
    receiveMissedDoseAlerts: { type: Boolean, default: true },
    receiveRefillAlerts: { type: Boolean, default: true }
  },
  { _id: false }
);

const caregiverLinkSchema = new Schema(
  {
    patient: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    /** Set once the invited person accepts (or already has an account). */
    caregiver: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    /** The address the invitation was sent to - the join key before acceptance. */
    caregiverEmail: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true
    },
    caregiverName: { type: String, trim: true, maxlength: 120 },
    relationship: { type: String, trim: true, maxlength: 60 },

    status: { type: String, enum: LINK_STATUSES, default: 'invited', index: true },
    permissions: { type: permissionsSchema, default: () => ({}) },

    /** SHA-256 of the invite token; the raw token is returned once, on creation. */
    inviteTokenHash: { type: String, select: false },
    inviteExpiresAt: { type: Date },

    invitedAt: { type: Date, default: Date.now },
    respondedAt: { type: Date },
    revokedAt: { type: Date },
    revokedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    lastAccessAt: { type: Date },

    note: { type: String, trim: true, maxlength: 300 }
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(doc, ret) {
        delete ret.inviteTokenHash;
        delete ret.__v;
        return ret;
      }
    },
    toObject: { virtuals: true }
  }
);

// A patient may hold only one live link per caregiver email.
caregiverLinkSchema.index(
  { patient: 1, caregiverEmail: 1 },
  { unique: true, partialFilterExpression: { status: { $in: ['invited', 'accepted'] } } }
);

caregiverLinkSchema.virtual('isActive').get(function isActive() {
  return this.status === 'accepted';
});

caregiverLinkSchema.virtual('inviteExpired').get(function inviteExpired() {
  return Boolean(this.inviteExpiresAt && this.inviteExpiresAt < new Date());
});

/**
 * Generates an invitation token. Only the hash is stored, so a leaked database
 * dump cannot be used to accept invitations.
 *
 * @returns {string} the raw token, shown to the patient exactly once
 */
caregiverLinkSchema.methods.issueInviteToken = function issueInviteToken(ttlDays = 14) {
  const token = crypto.randomBytes(24).toString('base64url');
  this.inviteTokenHash = crypto.createHash('sha256').update(token).digest('hex');
  this.inviteExpiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);
  return token;
};

caregiverLinkSchema.statics.hashToken = (token) =>
  crypto.createHash('sha256').update(token).digest('hex');

module.exports = mongoose.model('CaregiverLink', caregiverLinkSchema);
module.exports.LINK_STATUSES = LINK_STATUSES;
module.exports.PERMISSION_KEYS = Object.keys(permissionsSchema.paths);
