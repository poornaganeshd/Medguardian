'use strict';

const request = require('supertest');
const app = require('../../src/app');
const { describeIfDb, itIfDb } = require('../helpers/dbGuard');
const { registerUser, authHeader } = require('../helpers/factories');
const { toLocalDateKey } = require('../../src/utils/dateTime');

const todayKey = () => toLocalDateKey(new Date(), 'Asia/Kolkata');

async function fullPatient() {
  const session = await registerUser();

  const warfarin = (
    await request(app)
      .post('/api/medicines')
      .set(authHeader(session.accessToken))
      .send({ name: 'Warfarin', initialQuantity: 30, currentStock: 3, refillThreshold: 5 })
      .expect(201)
  ).body.data.medicine;

  const aspirin = (
    await request(app)
      .post('/api/medicines')
      .set(authHeader(session.accessToken))
      .send({ name: 'Aspirin', initialQuantity: 60, currentStock: 60, refillThreshold: 10 })
      .expect(201)
  ).body.data.medicine;

  const schedule = (
    await request(app)
      .post('/api/schedules')
      .set(authHeader(session.accessToken))
      .send({
        medicine: warfarin.id,
        frequency: 'daily',
        times: [
          { time: '00:01', doseQuantity: 1 },
          { time: '23:59', doseQuantity: 1 }
        ]
      })
      .expect(201)
  ).body.data.schedule;

  await request(app)
    .post('/api/records')
    .set(authHeader(session.accessToken))
    .field('title', 'Recent blood test')
    .field('category', 'lab_report')
    .expect(201);

  await request(app)
    .post('/api/caregivers')
    .set(authHeader(session.accessToken))
    .send({ caregiverEmail: 'helper@example.com', relationship: 'Daughter' })
    .expect(201);

  return { session, warfarin, aspirin, schedule };
}

describeIfDb('GET /api/dashboard', () => {
  itIfDb('assembles today doses, adherence, stock, records and caregivers', async () => {
    const { session } = await fullPatient();

    const res = await request(app)
      .get('/api/dashboard')
      .set(authHeader(session.accessToken))
      .expect(200);

    const d = res.body.data;
    expect(d.date).toBe(todayKey());
    expect(d.today).toHaveLength(2);
    expect(d.todaySummary.total).toBe(2);
    expect(d.today[0].medicine.name).toBe('Warfarin');
    expect(d.adherence).toHaveProperty('adherenceScore');
    expect(d.stock.total).toBe(2);
    expect(d.stock.needingRefill).toBe(1);
    expect(d.recentRecords).toHaveLength(1);
    expect(d.caregivers.pendingInvites).toBe(1);
    expect(d.caregivers.activeCount).toBe(0);
  });

  itIfDb('surfaces refill warnings ordered by urgency', async () => {
    const { session } = await fullPatient();
    const res = await request(app)
      .get('/api/dashboard')
      .set(authHeader(session.accessToken))
      .expect(200);

    expect(res.body.data.refillWarnings.length).toBeGreaterThan(0);
    expect(res.body.data.refillWarnings[0].medicineName).toBe('Warfarin');
    expect(res.body.data.refillWarnings[0].urgency).toBe('refill_now');
  });

  itIfDb('surfaces interaction alerts from the demo dataset', async () => {
    const { session } = await fullPatient();
    const res = await request(app)
      .get('/api/dashboard')
      .set(authHeader(session.accessToken))
      .expect(200);

    expect(res.body.data.interactionAlerts.total).toBe(1);
    expect(res.body.data.interactionAlerts.major).toBe(1);
    expect(res.body.data.interactionAlerts.isDemoData).toBe(true);
  });

  itIfDb('reflects a recorded dose in today status', async () => {
    const { session, schedule } = await fullPatient();

    await request(app)
      .post('/api/intakes')
      .set(authHeader(session.accessToken))
      .send({ schedule: schedule.id, dateKey: todayKey(), scheduledTime: '00:01', status: 'taken' })
      .expect(201);

    const res = await request(app)
      .get('/api/dashboard')
      .set(authHeader(session.accessToken))
      .expect(200);

    expect(res.body.data.todaySummary.taken).toBe(1);
    expect(res.body.data.today.find((o) => o.time === '00:01').status).toBe('taken');
  });

  itIfDb('returns an empty but valid dashboard for a new patient', async () => {
    const session = await registerUser();
    const res = await request(app)
      .get('/api/dashboard')
      .set(authHeader(session.accessToken))
      .expect(200);

    const d = res.body.data;
    expect(d.today).toEqual([]);
    expect(d.stock.total).toBe(0);
    expect(d.adherence.adherenceScore).toBeNull();
    expect(d.interactionAlerts.total).toBe(0);
    expect(d.recentRecords).toEqual([]);
  });

  itIfDb('never mixes in another patient data', async () => {
    await fullPatient();
    const stranger = await registerUser();
    const res = await request(app)
      .get('/api/dashboard')
      .set(authHeader(stranger.accessToken))
      .expect(200);
    expect(res.body.data.stock.total).toBe(0);
    expect(res.body.data.today).toEqual([]);
  });

  itIfDb('requires authentication', async () => {
    await request(app).get('/api/dashboard').expect(401);
  });
});
