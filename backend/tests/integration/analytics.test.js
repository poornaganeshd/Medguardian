'use strict';

const request = require('supertest');
const app = require('../../src/app');
const { describeIfDb, itIfDb } = require('../helpers/dbGuard');
const { registerUser, authHeader } = require('../helpers/factories');
const { toLocalDateKey, addDays } = require('../../src/utils/dateTime');

const TZ = 'Asia/Kolkata';
const todayKey = () => toLocalDateKey(new Date(), TZ);

async function patientWithSchedule(medicineOverrides = {}, times = [{ time: '00:01', doseQuantity: 1 }]) {
  const session = await registerUser();
  const medRes = await request(app)
    .post('/api/medicines')
    .set(authHeader(session.accessToken))
    .send({
      name: 'Metformin',
      unit: 'tablet',
      initialQuantity: 60,
      currentStock: 60,
      refillThreshold: 10,
      ...medicineOverrides
    })
    .expect(201);

  const schedRes = await request(app)
    .post('/api/schedules')
    .set(authHeader(session.accessToken))
    .send({
      medicine: medRes.body.data.medicine.id,
      frequency: 'daily',
      times,
      startDate: addDays(todayKey(), -10)
    })
    .expect(201);

  return { session, medicine: medRes.body.data.medicine, schedule: schedRes.body.data.schedule };
}

describeIfDb('GET /api/analytics/adherence', () => {
  itIfDb('reports expected, taken, skipped and missed doses', async () => {
    const { session, schedule } = await patientWithSchedule();

    await request(app)
      .post('/api/intakes')
      .set(authHeader(session.accessToken))
      .send({ schedule: schedule.id, dateKey: addDays(todayKey(), -1), scheduledTime: '00:01', status: 'taken' })
      .expect(201);
    await request(app)
      .post('/api/intakes')
      .set(authHeader(session.accessToken))
      .send({
        schedule: schedule.id,
        dateKey: addDays(todayKey(), -2),
        scheduledTime: '00:01',
        status: 'skipped',
        skipReason: 'forgot'
      })
      .expect(201);

    const res = await request(app)
      .get('/api/analytics/adherence?days=11')
      .set(authHeader(session.accessToken))
      .expect(200);

    const { summary } = res.body.data;
    expect(summary.expected).toBeGreaterThanOrEqual(10);
    expect(summary.taken).toBe(1);
    expect(summary.skipped).toBe(1);
    expect(summary.missed).toBeGreaterThan(0);
    expect(summary.adherenceScore).not.toBeNull();
    expect(summary.adherenceLabel).toBeTruthy();
  });

  itIfDb('includes a per-medicine breakdown with medicine details', async () => {
    const { session } = await patientWithSchedule();
    const res = await request(app)
      .get('/api/analytics/adherence?days=11')
      .set(authHeader(session.accessToken))
      .expect(200);

    expect(res.body.data.byMedicine).toHaveLength(1);
    expect(res.body.data.byMedicine[0].medicine.name).toBe('Metformin');
  });

  itIfDb('includes a chronological daily trend', async () => {
    const { session } = await patientWithSchedule();
    const res = await request(app)
      .get('/api/analytics/adherence?days=11')
      .set(authHeader(session.accessToken))
      .expect(200);

    const dates = res.body.data.daily.map((d) => d.date);
    expect(dates.length).toBeGreaterThan(0);
    expect([...dates].sort()).toEqual(dates);
  });

  itIfDb('reports no data for a patient with no schedules', async () => {
    const session = await registerUser();
    const res = await request(app)
      .get('/api/analytics/adherence')
      .set(authHeader(session.accessToken))
      .expect(200);

    expect(res.body.data.summary.expected).toBe(0);
    expect(res.body.data.summary.adherenceScore).toBeNull();
    expect(res.body.data.summary.adherenceLabel).toBe('no_data');
  });

  itIfDb('never mixes in another patient data', async () => {
    const { session } = await patientWithSchedule();
    const stranger = await registerUser();
    const res = await request(app)
      .get('/api/analytics/adherence')
      .set(authHeader(stranger.accessToken))
      .expect(200);
    expect(res.body.data.summary.expected).toBe(0);
    expect(session).toBeTruthy();
  });
});

describeIfDb('GET /api/analytics/refill (DRPA)', () => {
  itIfDb('returns a prediction with rates, regression details and an explanation', async () => {
    const { session, medicine } = await patientWithSchedule();

    const res = await request(app)
      .get(`/api/analytics/refill/${medicine.id}`)
      .set(authHeader(session.accessToken))
      .expect(200);

    const p = res.body.data.prediction;
    expect(p.medicineName).toBe('Metformin');
    expect(p.stock.currentStock).toBe(60);
    expect(p.rates.scheduledPerDay).toBeCloseTo(1, 1);
    expect(p.prediction.daysOfSupply).toBeGreaterThan(0);
    expect(p.prediction.runOutDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Array.isArray(p.explanation)).toBe(true);
    expect(p.regression).toHaveProperty('features');
    expect(p.regression).toHaveProperty('r2');
  });

  itIfDb('reflects skipped doses in the prediction inputs', async () => {
    const { session, medicine, schedule } = await patientWithSchedule();

    for (let i = 1; i <= 6; i += 1) {
      await request(app)
        .post('/api/intakes')
        .set(authHeader(session.accessToken))
        .send({
          schedule: schedule.id,
          dateKey: addDays(todayKey(), -i),
          scheduledTime: '00:01',
          status: i % 2 === 0 ? 'taken' : 'skipped',
          skipReason: i % 2 === 0 ? undefined : 'forgot'
        })
        .expect(201);
    }

    const res = await request(app)
      .get(`/api/analytics/refill/${medicine.id}`)
      .set(authHeader(session.accessToken))
      .expect(200);

    const p = res.body.data.prediction;
    expect(p.consumption.takenDoses).toBe(3);
    expect(p.consumption.skippedDoses).toBe(3);
    expect(p.consumption.skippedQuantityNotDeducted).toBe(3);
    expect(p.explanation.join(' ')).toMatch(/NOT deducted from stock/);
  });

  itIfDb('lists every medicine most urgent first', async () => {
    const { session, medicine } = await patientWithSchedule();

    // A second medicine that is already out of stock.
    const second = await request(app)
      .post('/api/medicines')
      .set(authHeader(session.accessToken))
      .send({ name: 'Aspirin', initialQuantity: 30, currentStock: 0, refillThreshold: 5 })
      .expect(201);
    await request(app)
      .post('/api/schedules')
      .set(authHeader(session.accessToken))
      .send({
        medicine: second.body.data.medicine.id,
        frequency: 'daily',
        times: [{ time: '09:00', doseQuantity: 1 }]
      })
      .expect(201);

    const res = await request(app)
      .get('/api/analytics/refill')
      .set(authHeader(session.accessToken))
      .expect(200);

    expect(res.body.data.items).toHaveLength(2);
    expect(res.body.data.items[0].medicineName).toBe('Aspirin');
    expect(res.body.data.items[0].prediction.urgency).toBe('out_of_stock');
    expect(res.body.data.summary.needingRefill).toBeGreaterThanOrEqual(1);
    expect(medicine).toBeTruthy();
  });

  itIfDb('refuses a prediction for another patient medicine', async () => {
    const { medicine } = await patientWithSchedule();
    const stranger = await registerUser();
    await request(app)
      .get(`/api/analytics/refill/${medicine.id}`)
      .set(authHeader(stranger.accessToken))
      .expect(404);
  });

  itIfDb('returns an empty overview for a patient with no medicines', async () => {
    const session = await registerUser();
    const res = await request(app)
      .get('/api/analytics/refill')
      .set(authHeader(session.accessToken))
      .expect(200);
    expect(res.body.data.items).toEqual([]);
    expect(res.body.data.summary.total).toBe(0);
  });
});
