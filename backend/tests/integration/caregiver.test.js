'use strict';

const request = require('supertest');
const app = require('../../src/app');
const CaregiverLink = require('../../src/models/CaregiverLink');
const AuditLog = require('../../src/models/AuditLog');
const { describeIfDb, itIfDb } = require('../helpers/dbGuard');
const { registerUser, authHeader, getStepUpToken } = require('../helpers/factories');
const { toLocalDateKey } = require('../../src/utils/dateTime');

const todayKey = () => toLocalDateKey(new Date(), 'Asia/Kolkata');

/** Patient invites a caregiver; the caregiver accepts. Returns both sessions. */
async function linkedPair(permissions = {}) {
  const patient = await registerUser();
  const caregiver = await registerUser();

  const inviteRes = await request(app)
    .post('/api/caregivers')
    .set(authHeader(patient.accessToken))
    .send({
      caregiverEmail: caregiver.user.email,
      caregiverName: caregiver.user.name,
      relationship: 'Daughter',
      permissions
    })
    .expect(201);

  await request(app)
    .post('/api/caregivers/respond')
    .set(authHeader(caregiver.accessToken))
    .send({ token: inviteRes.body.data.inviteToken, accept: true })
    .expect(200);

  // The caregiver's role changed, so re-issue their session.
  const refreshed = await request(app)
    .post('/api/auth/login')
    .send({ email: caregiver.user.email, password: caregiver.password })
    .expect(200);

  return {
    patient,
    caregiver: { ...caregiver, accessToken: refreshed.body.data.accessToken },
    link: inviteRes.body.data.link
  };
}

async function addMedicine(session, name = 'Metformin') {
  const res = await request(app)
    .post('/api/medicines')
    .set(authHeader(session.accessToken))
    .send({ name, initialQuantity: 30, currentStock: 30, refillThreshold: 5 })
    .expect(201);
  return res.body.data.medicine;
}

describeIfDb('caregiver invitations', () => {
  itIfDb('creates an invitation and returns the token exactly once', async () => {
    const patient = await registerUser();
    const res = await request(app)
      .post('/api/caregivers')
      .set(authHeader(patient.accessToken))
      .send({ caregiverEmail: 'helper@example.com', relationship: 'Son' })
      .expect(201);

    expect(res.body.data.inviteToken).toBeTruthy();
    expect(res.body.data.link.status).toBe('invited');
    expect(res.body.data.link.inviteTokenHash).toBeUndefined();

    const stored = await CaregiverLink.findById(res.body.data.link.id).select('+inviteTokenHash');
    expect(stored.inviteTokenHash).toHaveLength(64);
    expect(stored.inviteTokenHash).not.toBe(res.body.data.inviteToken);
  });

  itIfDb('applies safe default permissions', async () => {
    const patient = await registerUser();
    const res = await request(app)
      .post('/api/caregivers')
      .set(authHeader(patient.accessToken))
      .send({ caregiverEmail: 'helper2@example.com' })
      .expect(201);

    const { permissions } = res.body.data.link;
    expect(permissions.viewMedicines).toBe(true);
    expect(permissions.viewSchedules).toBe(true);
    expect(permissions.viewAdherence).toBe(true);
    // Records and dose recording must be granted deliberately.
    expect(permissions.viewRecords).toBe(false);
    expect(permissions.canRecordIntake).toBe(false);
  });

  itIfDb('refuses a self-invitation and a duplicate pending invitation', async () => {
    const patient = await registerUser();

    await request(app)
      .post('/api/caregivers')
      .set(authHeader(patient.accessToken))
      .send({ caregiverEmail: patient.user.email })
      .expect(400);

    await request(app)
      .post('/api/caregivers')
      .set(authHeader(patient.accessToken))
      .send({ caregiverEmail: 'dupe@example.com' })
      .expect(201);
    await request(app)
      .post('/api/caregivers')
      .set(authHeader(patient.accessToken))
      .send({ caregiverEmail: 'dupe@example.com' })
      .expect(409);
  });

  itIfDb('only accepts the token from the invited email address', async () => {
    const patient = await registerUser();
    const intended = await registerUser();
    const impostor = await registerUser();

    const inviteRes = await request(app)
      .post('/api/caregivers')
      .set(authHeader(patient.accessToken))
      .send({ caregiverEmail: intended.user.email })
      .expect(201);

    const denied = await request(app)
      .post('/api/caregivers/respond')
      .set(authHeader(impostor.accessToken))
      .send({ token: inviteRes.body.data.inviteToken, accept: true })
      .expect(403);
    expect(denied.body.message).toMatch(/sign in with that address/i);

    await request(app)
      .post('/api/caregivers/respond')
      .set(authHeader(intended.accessToken))
      .send({ token: inviteRes.body.data.inviteToken, accept: true })
      .expect(200);
  });

  itIfDb('rejects an invalid or already-used token', async () => {
    const caregiver = await registerUser();
    await request(app)
      .post('/api/caregivers/respond')
      .set(authHeader(caregiver.accessToken))
      .send({ token: 'totally-made-up-token', accept: true })
      .expect(404);
  });

  itIfDb('records the invitation and acceptance in the audit trail', async () => {
    await linkedPair();
    expect(await AuditLog.countDocuments({ action: 'CAREGIVER_INVITED' })).toBe(1);
    expect(await AuditLog.countDocuments({ action: 'CAREGIVER_ACCEPTED' })).toBe(1);
  });

  itIfDb('lets the invitee decline', async () => {
    const patient = await registerUser();
    const caregiver = await registerUser();
    const inviteRes = await request(app)
      .post('/api/caregivers')
      .set(authHeader(patient.accessToken))
      .send({ caregiverEmail: caregiver.user.email })
      .expect(201);

    const res = await request(app)
      .post('/api/caregivers/respond')
      .set(authHeader(caregiver.accessToken))
      .send({ token: inviteRes.body.data.inviteToken, accept: false })
      .expect(200);
    expect(res.body.data.link.status).toBe('declined');
  });
});

describeIfDb('caregiver access enforcement', () => {
  itIfDb('lets a linked caregiver read the patient medicines', async () => {
    const { patient, caregiver } = await linkedPair();
    await addMedicine(patient);

    const res = await request(app)
      .get(`/api/medicines?patientId=${patient.user.id}`)
      .set(authHeader(caregiver.accessToken))
      .expect(200);
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.items[0].name).toBe('Metformin');
  });

  itIfDb('refuses a caregiver who has no link to that patient', async () => {
    const { caregiver } = await linkedPair();
    const stranger = await registerUser();
    await addMedicine(stranger);

    await request(app)
      .get(`/api/medicines?patientId=${stranger.user.id}`)
      .set(authHeader(caregiver.accessToken))
      .expect(403);
  });

  itIfDb('requires a caregiver to name the patient they are helping', async () => {
    const { caregiver } = await linkedPair();
    const res = await request(app)
      .get('/api/medicines')
      .set(authHeader(caregiver.accessToken))
      .expect(400);
    expect(res.body.message).toMatch(/patientId is required/i);
  });

  itIfDb('enforces the viewRecords permission', async () => {
    const { patient, caregiver } = await linkedPair({ viewRecords: false });

    await request(app)
      .post('/api/records')
      .set(authHeader(patient.accessToken))
      .field('title', 'Lab report')
      .field('category', 'lab_report')
      .field('shareableWithCaregivers', 'true')
      .expect(201);

    const denied = await request(app)
      .get(`/api/records?patientId=${patient.user.id}`)
      .set(authHeader(caregiver.accessToken))
      .expect(403);
    expect(denied.body.message).toMatch(/viewRecords/);
  });

  itIfDb('shows a caregiver only the records the patient shared', async () => {
    const { patient, caregiver } = await linkedPair({ viewRecords: true });

    await request(app)
      .post('/api/records')
      .set(authHeader(patient.accessToken))
      .field('title', 'Shared report')
      .field('category', 'lab_report')
      .field('shareableWithCaregivers', 'true')
      .expect(201);
    await request(app)
      .post('/api/records')
      .set(authHeader(patient.accessToken))
      .field('title', 'Private note')
      .field('category', 'other')
      .expect(201);
    await request(app)
      .post('/api/records')
      .set(authHeader(patient.accessToken))
      .field('title', 'Sensitive result')
      .field('category', 'lab_report')
      .field('shareableWithCaregivers', 'true')
      .field('isSensitive', 'true')
      .expect(201);

    const res = await request(app)
      .get(`/api/records?patientId=${patient.user.id}`)
      .set(authHeader(caregiver.accessToken))
      .expect(200);

    expect(res.body.data.total).toBe(1);
    expect(res.body.data.items[0].title).toBe('Shared report');
  });

  itIfDb('blocks a caregiver from editing or deleting a record', async () => {
    const { patient, caregiver } = await linkedPair({ viewRecords: true });
    const createRes = await request(app)
      .post('/api/records')
      .set(authHeader(patient.accessToken))
      .field('title', 'Shared report')
      .field('category', 'lab_report')
      .field('shareableWithCaregivers', 'true')
      .expect(201);

    await request(app)
      .patch(`/api/records/${createRes.body.data.record.id}?patientId=${patient.user.id}`)
      .set(authHeader(caregiver.accessToken))
      .send({ title: 'Tampered' })
      .expect(403);
  });

  itIfDb('enforces canRecordIntake before a caregiver can mark a dose', async () => {
    const { patient, caregiver } = await linkedPair({ canRecordIntake: false });
    const medicine = await addMedicine(patient);
    const schedRes = await request(app)
      .post('/api/schedules')
      .set(authHeader(patient.accessToken))
      .send({
        medicine: medicine.id,
        frequency: 'daily',
        times: [{ time: '08:00', doseQuantity: 1 }]
      })
      .expect(201);

    const denied = await request(app)
      .post('/api/intakes')
      .set(authHeader(caregiver.accessToken))
      .send({
        patientId: patient.user.id,
        schedule: schedRes.body.data.schedule.id,
        dateKey: todayKey(),
        scheduledTime: '08:00',
        status: 'taken'
      })
      .expect(403);
    expect(denied.body.message).toMatch(/read-only/i);
  });

  itIfDb('allows a dose to be recorded once canRecordIntake is granted', async () => {
    const { patient, caregiver } = await linkedPair({ canRecordIntake: true });
    const medicine = await addMedicine(patient);
    const schedRes = await request(app)
      .post('/api/schedules')
      .set(authHeader(patient.accessToken))
      .send({
        medicine: medicine.id,
        frequency: 'daily',
        times: [{ time: '08:00', doseQuantity: 1 }]
      })
      .expect(201);

    const res = await request(app)
      .post('/api/intakes')
      .set(authHeader(caregiver.accessToken))
      .send({
        patientId: patient.user.id,
        schedule: schedRes.body.data.schedule.id,
        dateKey: todayKey(),
        scheduledTime: '08:00',
        status: 'taken'
      })
      .expect(201);

    expect(res.body.data.intake.recordedBy).toBe(String(caregiver.user.id));
    expect(res.body.data.medicine.currentStock).toBe(29);
  });

  itIfDb('audit-logs every caregiver access to patient data', async () => {
    const { patient, caregiver } = await linkedPair();
    await addMedicine(patient);
    await request(app)
      .get(`/api/medicines?patientId=${patient.user.id}`)
      .set(authHeader(caregiver.accessToken))
      .expect(200);

    const entry = await AuditLog.findOne({ action: 'CAREGIVER_ACCESSED_PATIENT_DATA' });
    expect(entry).toBeTruthy();
    expect(String(entry.patient)).toBe(String(patient.user.id));
    expect(String(entry.user)).toBe(String(caregiver.user.id));
  });
});

describeIfDb('caregiver permission management', () => {
  itIfDb('requires PIN step-up to change permissions', async () => {
    const { patient, link } = await linkedPair();

    const denied = await request(app)
      .patch(`/api/caregivers/${link.id}/permissions`)
      .set(authHeader(patient.accessToken))
      .send({ permissions: { viewRecords: true } })
      .expect(401);
    expect(denied.body.code).toBe('STEP_UP_REQUIRED');

    const stepUpToken = await getStepUpToken(patient);
    const res = await request(app)
      .patch(`/api/caregivers/${link.id}/permissions`)
      .set(authHeader(patient.accessToken))
      .set('x-step-up-token', stepUpToken)
      .send({ permissions: { viewRecords: true } })
      .expect(200);

    expect(res.body.data.link.permissions.viewRecords).toBe(true);

    const audit = await AuditLog.findOne({ action: 'CAREGIVER_PERMISSIONS_CHANGED' });
    expect(audit.oldValue.viewRecords).toBe(false);
    expect(audit.newValue.viewRecords).toBe(true);
    expect(audit.authMethod).toBe('pin');
  });

  itIfDb('revokes access immediately', async () => {
    const { patient, caregiver, link } = await linkedPair();
    await addMedicine(patient);

    await request(app)
      .get(`/api/medicines?patientId=${patient.user.id}`)
      .set(authHeader(caregiver.accessToken))
      .expect(200);

    await request(app)
      .delete(`/api/caregivers/${link.id}`)
      .set(authHeader(patient.accessToken))
      .expect(200);

    await request(app)
      .get(`/api/medicines?patientId=${patient.user.id}`)
      .set(authHeader(caregiver.accessToken))
      .expect(403);
  });

  itIfDb('lets the caregiver end the relationship too', async () => {
    const { caregiver, link } = await linkedPair();
    const res = await request(app)
      .delete(`/api/caregivers/${link.id}`)
      .set(authHeader(caregiver.accessToken))
      .expect(200);
    expect(res.body.data.link.status).toBe('revoked');
  });
});

describeIfDb('caregiver patient summary', () => {
  itIfDb('returns only the sections the permissions allow', async () => {
    const { patient, caregiver } = await linkedPair({ viewAdherence: false });
    const medicine = await addMedicine(patient);
    await request(app)
      .post('/api/schedules')
      .set(authHeader(patient.accessToken))
      .send({
        medicine: medicine.id,
        frequency: 'daily',
        times: [{ time: '08:00', doseQuantity: 1 }]
      })
      .expect(201);

    const res = await request(app)
      .get(`/api/caregivers/patients/${patient.user.id}/summary`)
      .set(authHeader(caregiver.accessToken))
      .expect(200);

    expect(res.body.data.medicines).toHaveLength(1);
    expect(res.body.data.today).toHaveLength(1);
    expect(res.body.data.adherence).toBeUndefined();
  });

  itIfDb('includes adherence and missed-dose counts when permitted', async () => {
    const { patient, caregiver } = await linkedPair();
    const medicine = await addMedicine(patient);
    await request(app)
      .post('/api/schedules')
      .set(authHeader(patient.accessToken))
      .send({
        medicine: medicine.id,
        frequency: 'daily',
        times: [{ time: '00:01', doseQuantity: 1 }]
      })
      .expect(201);

    const res = await request(app)
      .get(`/api/caregivers/patients/${patient.user.id}/summary`)
      .set(authHeader(caregiver.accessToken))
      .expect(200);

    expect(res.body.data.adherence).toBeDefined();
    expect(res.body.data.adherence).toHaveProperty('adherenceScore');
    expect(res.body.data).toHaveProperty('missedToday');
  });

  itIfDb('refuses a summary for a patient the caregiver is not linked to', async () => {
    const { caregiver } = await linkedPair();
    const stranger = await registerUser();
    await request(app)
      .get(`/api/caregivers/patients/${stranger.user.id}/summary`)
      .set(authHeader(caregiver.accessToken))
      .expect(403);
  });
});
