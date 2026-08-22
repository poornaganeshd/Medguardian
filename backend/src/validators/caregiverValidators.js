'use strict';

const { z } = require('zod');
const { objectId } = require('./medicineValidators');

const permissions = z.object({
  viewMedicines: z.coerce.boolean().optional(),
  viewSchedules: z.coerce.boolean().optional(),
  viewAdherence: z.coerce.boolean().optional(),
  viewRecords: z.coerce.boolean().optional(),
  canRecordIntake: z.coerce.boolean().optional(),
  receiveMissedDoseAlerts: z.coerce.boolean().optional(),
  receiveRefillAlerts: z.coerce.boolean().optional()
});

const inviteCaregiverSchema = z.object({
  caregiverEmail: z.string().trim().toLowerCase().email('Enter a valid email address'),
  caregiverName: z.string().trim().max(120).optional().or(z.literal('')),
  relationship: z.string().trim().max(60).optional().or(z.literal('')),
  permissions: permissions.optional(),
  note: z.string().trim().max(300).optional().or(z.literal(''))
});

const respondToInviteSchema = z.object({
  token: z.string().trim().min(10, 'An invitation token is required'),
  accept: z.coerce.boolean()
});

const updatePermissionsSchema = z.object({
  permissions,
  relationship: z.string().trim().max(60).optional().or(z.literal(''))
});

const listLinksSchema = z.object({
  status: z.enum(['invited', 'accepted', 'declined', 'revoked', 'all']).default('all'),
  role: z.enum(['as_patient', 'as_caregiver', 'both']).default('both')
});

const patientIdParam = z.object({ patientId: objectId });
const linkIdParam = z.object({ id: objectId });

module.exports = {
  inviteCaregiverSchema,
  respondToInviteSchema,
  updatePermissionsSchema,
  listLinksSchema,
  patientIdParam,
  linkIdParam
};
