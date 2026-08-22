'use strict';

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { config } = require('../config/env');

const { Schema } = mongoose;

/**
 * Credential registered through WebAuthn (platform authenticator = fingerprint
 * / face unlock on the user's own device). Only public key material is stored.
 */
const webAuthnCredentialSchema = new Schema(
  {
    credentialId: { type: String, required: true },
    publicKey: { type: String, required: true },
    counter: { type: Number, default: 0 },
    transports: [{ type: String }],
    deviceLabel: { type: String, trim: true, default: 'Registered device' },
    createdAt: { type: Date, default: Date.now },
    lastUsedAt: { type: Date }
  },
  { _id: true }
);

const notificationPrefsSchema = new Schema(
  {
    visualReminders: { type: Boolean, default: true },
    browserNotifications: { type: Boolean, default: true },
    refillAlerts: { type: Boolean, default: true },
    missedDoseAlerts: { type: Boolean, default: true },
    reminderLeadMinutes: { type: Number, default: 0, min: 0, max: 120 }
  },
  { _id: false }
);

const userSchema = new Schema(
  {
    name: { type: String, required: [true, 'Name is required'], trim: true, maxlength: 120 },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Please provide a valid email address']
    },
    password: { type: String, required: true, select: false },

    role: {
      type: String,
      enum: ['patient', 'caregiver'],
      default: 'patient'
    },

    phone: { type: String, trim: true, maxlength: 32 },
    dateOfBirth: { type: Date },
    gender: { type: String, enum: ['male', 'female', 'other', 'prefer_not_to_say'] },
    bloodGroup: { type: String, enum: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'unknown'] },
    allergies: [{ type: String, trim: true, maxlength: 120 }],
    conditions: [{ type: String, trim: true, maxlength: 120 }],
    emergencyContact: {
      name: { type: String, trim: true, maxlength: 120 },
      relationship: { type: String, trim: true, maxlength: 60 },
      phone: { type: String, trim: true, maxlength: 32 }
    },
    timezone: { type: String, default: 'Asia/Kolkata', trim: true },

    // ---- Sensitive-action re-authentication -------------------------------
    pinHash: { type: String, select: false },
    pinSetAt: { type: Date },
    pinAttempts: { type: Number, default: 0, select: false },
    pinLockedUntil: { type: Date, select: false },

    // ---- WebAuthn ---------------------------------------------------------
    webAuthnCredentials: { type: [webAuthnCredentialSchema], default: [], select: false },
    currentChallenge: { type: String, select: false },

    // ---- Sessions / security ---------------------------------------------
    refreshTokenHashes: { type: [String], default: [], select: false },
    passwordChangedAt: { type: Date },
    loginAttempts: { type: Number, default: 0, select: false },
    lockUntil: { type: Date, select: false },
    lastLoginAt: { type: Date },

    notificationPreferences: { type: notificationPrefsSchema, default: () => ({}) },
    isActive: { type: Boolean, default: true }
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(doc, ret) {
        delete ret.password;
        delete ret.pinHash;
        delete ret.refreshTokenHashes;
        delete ret.currentChallenge;
        delete ret.loginAttempts;
        delete ret.lockUntil;
        delete ret.pinAttempts;
        delete ret.pinLockedUntil;
        delete ret.__v;
        return ret;
      }
    },
    toObject: { virtuals: true }
  }
);

userSchema.virtual('hasPin').get(function hasPin() {
  return Boolean(this.pinHash);
});

userSchema.virtual('isLocked').get(function isLocked() {
  return Boolean(this.lockUntil && this.lockUntil > Date.now());
});

// ---------------------------------------------------------------- hooks
userSchema.pre('save', async function hashPassword(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, config.security.bcryptRounds);
  if (!this.isNew) this.passwordChangedAt = new Date(Date.now() - 1000);
  return next();
});

// ---------------------------------------------------------------- methods
userSchema.methods.comparePassword = function comparePassword(candidate) {
  return bcrypt.compare(candidate, this.password);
};

userSchema.methods.setPin = async function setPin(pin) {
  this.pinHash = await bcrypt.hash(pin, config.security.bcryptRounds);
  this.pinSetAt = new Date();
  this.pinAttempts = 0;
  this.pinLockedUntil = undefined;
};

userSchema.methods.comparePin = function comparePin(candidate) {
  if (!this.pinHash) return Promise.resolve(false);
  return bcrypt.compare(candidate, this.pinHash);
};

/** True when the password changed after the supplied JWT was issued. */
userSchema.methods.passwordChangedAfter = function passwordChangedAfter(issuedAtSeconds) {
  if (!this.passwordChangedAt) return false;
  return Math.floor(this.passwordChangedAt.getTime() / 1000) > issuedAtSeconds;
};

userSchema.index({ role: 1 });

module.exports = mongoose.model('User', userSchema);
