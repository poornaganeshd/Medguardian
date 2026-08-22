'use strict';

const { z } = require('zod');

const password = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password is too long')
  .regex(/[a-z]/, 'Password must contain a lowercase letter')
  .regex(/[A-Z]/, 'Password must contain an uppercase letter')
  .regex(/[0-9]/, 'Password must contain a number');

const pin = z
  .string()
  .regex(/^\d{4,8}$/, 'PIN must be 4 to 8 digits')
  .refine((v) => new Set(v).size > 1, 'PIN cannot be a single repeated digit');

const email = z.string().trim().toLowerCase().email('Please provide a valid email address');

const registerSchema = z.object({
  name: z.string().trim().min(2, 'Name is required').max(120),
  email,
  password,
  role: z.enum(['patient', 'caregiver']).optional().default('patient'),
  phone: z.string().trim().max(32).optional(),
  dateOfBirth: z.coerce.date().optional(),
  timezone: z.string().trim().max(64).optional()
});

const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Password is required')
});

const refreshSchema = z.object({
  refreshToken: z.string().min(10, 'Refresh token is required').optional()
});

const updateProfileSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  phone: z.string().trim().max(32).optional(),
  dateOfBirth: z.coerce.date().optional(),
  gender: z.enum(['male', 'female', 'other', 'prefer_not_to_say']).optional(),
  bloodGroup: z
    .enum(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'unknown'])
    .optional(),
  allergies: z.array(z.string().trim().max(120)).max(50).optional(),
  conditions: z.array(z.string().trim().max(120)).max(50).optional(),
  emergencyContact: z
    .object({
      name: z.string().trim().max(120).optional(),
      relationship: z.string().trim().max(60).optional(),
      phone: z.string().trim().max(32).optional()
    })
    .optional(),
  timezone: z.string().trim().max(64).optional(),
  notificationPreferences: z
    .object({
      visualReminders: z.boolean().optional(),
      browserNotifications: z.boolean().optional(),
      refillAlerts: z.boolean().optional(),
      missedDoseAlerts: z.boolean().optional(),
      reminderLeadMinutes: z.number().int().min(0).max(120).optional()
    })
    .optional()
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: password
});

const setPinSchema = z.object({
  pin,
  currentPin: z.string().optional(),
  password: z.string().min(1, 'Your account password is required to set a PIN')
});

const verifyPinSchema = z.object({ pin: z.string().min(1, 'PIN is required') });

module.exports = {
  registerSchema,
  loginSchema,
  refreshSchema,
  updateProfileSchema,
  changePasswordSchema,
  setPinSchema,
  verifyPinSchema
};
