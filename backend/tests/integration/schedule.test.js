'use strict';

const request = require('supertest');
const app = require('../../src/app');
const Intake = require('../../src/models/Intake');
const Medicine = require('../../src/models/Medicine');
const { describeIfDb, itIfDb } = require('../helpers/dbGuard');
const { registerUser, authHeader } = require('../helpers/factories');
const { toLocalDateKey } = require('../../src/utils/dateTime');

const TZ = 'Asia/Kolkata';
const todayKey = () => toLocalDateKey(new Date(), TZ);

async function setupPatientWithMedicine(overrides = {}) {
  const session = await registerUser();
  const medRes = await request(app)
    .post('/api/medicines')
    .set(authHeader(session.accessToken))
    .send({
      name: 'Metformin',
      strength: '500 mg',
      unit: 'tablet',
      initialQuantity: 60,
      currentStock: 60,
      refillThreshold: 10,
      ...overrides
    })
    .expect(201);
  return { session, medicine: medRes.body.data.medicine };
}

describeIfDb('schedule CRUD', () => {
  itIfDb('creates a daily schedule with two reminder times', async () => {
    const { session, medicine } = await setupPatientWithMedicine();
    const res = await request(app)
      .post('/api/schedules')
      .set(authHeader(session.accessToken))
      .send({
        medicine: medicine.id,
        frequency: 'daily',
        times: [
          { time: '08:00', doseQuantity: 1, label: 'Morning' },
          { time: '20:00', doseQuantity: 1, label: 'Night' }
        ]
      })
      .expect(201);

    expect(res.body.data.schedule.times).toHaveLength(2);
    expect(res.body.data.schedule.dosesPerDay).toBe(2);
    expect(res.body.data.schedule.isActive).toBe(true);
  });

  itIfDb('rejects a schedule for a medicine the patient does not own', async () => {
    const { medicine } = await setupPatientWithMedicine();
    const stranger = await registerUser();

    await request(app)
      .post('/api/schedules')
      .set(authHeader(stranger.accessToken))
      .send({
        medicine: medicine.id,
        frequency: 'daily',
        times: [{ time: '08:00', doseQuantity: 1 }]
      })
      .expect(404);
  });

  itIfDb('rejects a fixed schedule with no reminder times', async () => {
    const { session, medicine } = await setupPatientWithMedicine();
    const res = await request(app)
      .post('/api/schedules')
      .set(authHeader(session.accessToken))
      .send({ medicine: medicine.id, frequency: 'daily', times: [] })
      .expect(422);
    expect(res.body.details.map((d) => d.field)).toContain('body.times');
  });

  itIfDb('rejects specific_days without any weekday selected', async () => {
    const { session, medicine } = await setupPatientWithMedicine();
    await request(app)
      .post('/api/schedules')
      .set(authHeader(session.accessToken))
      .send({
        medicine: medicine.id,
        frequency: 'specific_days',
        times: [{ time: '08:00', doseQuantity: 1 }]
      })
      .expect(422);
  });

  itIfDb('accepts an as-needed schedule with no times', async () => {
    const { session, medicine } = await setupPatientWithMedicine();
    const res = await request(app)
      .post('/api/schedules')
      .set(authHeader(session.accessToken))
      .send({
        medicine: medicine.id,
        frequency: 'as_needed',
        asNeededDoseQuantity: 1,
        maxDosesPerDay: 4
      })
      .expect(201);
    expect(res.body.data.schedule.dosesPerDay).toBe(0);
  });

  itIfDb('pauses and resumes a schedule', async () => {
    const { session, medicine } = await setupPatientWithMedicine();
    const createRes = await request(app)
      .post('/api/schedules')
      .set(authHeader(session.accessToken))
      .send({
        medicine: medicine.id,
        frequency: 'daily',
        times: [{ time: '08:00', doseQuantity: 1 }]
      });
    const id = createRes.body.data.schedule.id;

    const paused = await request(app)
      .patch(`/api/schedules/${id}/status`)
      .set(authHeader(session.accessToken))
      .send({ isActive: false, pauseReason: 'Travelling' })
      .expect(200);
    expect(paused.body.data.schedule.isActive).toBe(false);
    expect(paused.body.data.schedule.pauseReason).toBe('Travelling');

    const resumed = await request(app)
      .patch(`/api/schedules/${id}/status`)
      .set(authHeader(session.accessToken))
      .send({ isActive: true })
      .expect(200);
    expect(resumed.body.data.schedule.isActive).toBe(true);
  });

  itIfDb('deletes a schedule and its intake history', async () => {
    const { session, medicine } = await setupPatientWithMedicine();
    const createRes = await request(app)
      .post('/api/schedules')
      .set(authHeader(session.accessToken))
      .send({
        medicine: medicine.id,
        frequency: 'daily',
        times: [{ time: '08:00', doseQuantity: 1 }]
      });
    const id = createRes.body.data.schedule.id;

    await request(app)
      .post('/api/intakes')
      .set(authHeader(session.accessToken))
      .send({ schedule: id, dateKey: todayKey(), scheduledTime: '08:00', status: 'taken' })
      .expect(201);

    const res = await request(app)
      .delete(`/api/schedules/${id}`)
      .set(authHeader(session.accessToken))
      .expect(200);

    expect(res.body.data.removedIntakes).toBe(1);
    expect(await Intake.countDocuments({ schedule: id })).toBe(0);
  });
});

describeIfDb('occurrence feed', () => {
  itIfDb('returns today’s doses with derived statuses', async () => {
    const { session, medicine } = await setupPatientWithMedicine();
    await request(app)
      .post('/api/schedules')
      .set(authHeader(session.accessToken))
      .send({
        medicine: medicine.id,
        frequency: 'daily',
        times: [
          { time: '00:01', doseQuantity: 1 },
          { time: '23:59', doseQuantity: 1 }
        ]
      })
      .expect(201);

    const res = await request(app)
      .get(`/api/schedules/occurrences?date=${todayKey()}`)
      .set(authHeader(session.accessToken))
      .expect(200);

    expect(res.body.data.items).toHaveLength(2);
    expect(res.body.data.summary.total).toBe(2);
    const statuses = res.body.data.items.map((i) => i.status);
    expect(statuses).toContain('upcoming');
    expect(res.body.data.items[0].medicine.name).toBe('Metformin');
  });

  itIfDb('excludes paused schedules from the feed', async () => {
    const { session, medicine } = await setupPatientWithMedicine();
    const createRes = await request(app)
      .post('/api/schedules')
      .set(authHeader(session.accessToken))
      .send({
        medicine: medicine.id,
        frequency: 'daily',
        times: [{ time: '09:00', doseQuantity: 1 }]
      });

    await request(app)
      .patch(`/api/schedules/${createRes.body.data.schedule.id}/status`)
      .set(authHeader(session.accessToken))
      .send({ isActive: false })
      .expect(200);

    const res = await request(app)
      .get(`/api/schedules/occurrences?date=${todayKey()}`)
      .set(authHeader(session.accessToken))
      .expect(200);
    expect(res.body.data.items).toHaveLength(0);
  });

  itIfDb('never leaks another patient doses', async () => {
    const { session, medicine } = await setupPatientWithMedicine();
    await request(app)
      .post('/api/schedules')
      .set(authHeader(session.accessToken))
      .send({
        medicine: medicine.id,
        frequency: 'daily',
        times: [{ time: '09:00', doseQuantity: 1 }]
      });

    const stranger = await registerUser();
    const res = await request(app)
      .get(`/api/schedules/occurrences?date=${todayKey()}`)
      .set(authHeader(stranger.accessToken))
      .expect(200);
    expect(res.body.data.items).toHaveLength(0);
  });
});

describeIfDb('intake tracking and stock', () => {
  async function scheduleFor(session, medicineId, times = [{ time: '08:00', doseQuantity: 1 }]) {
    const res = await request(app)
      .post('/api/schedules')
      .set(authHeader(session.accessToken))
      .send({ medicine: medicineId, frequency: 'daily', times })
      .expect(201);
    return res.body.data.schedule;
  }

  itIfDb('deducts stock when a dose is taken', async () => {
    const { session, medicine } = await setupPatientWithMedicine();
    const schedule = await scheduleFor(session, medicine.id);

    const res = await request(app)
      .post('/api/intakes')
      .set(authHeader(session.accessToken))
      .send({ schedule: schedule.id, dateKey: todayKey(), scheduledTime: '08:00', status: 'taken' })
      .expect(201);

    expect(res.body.data.intake.status).toBe('taken');
    expect(res.body.data.medicine.currentStock).toBe(59);
    expect((await Medicine.findById(medicine.id)).currentStock).toBe(59);
  });

  itIfDb('does NOT deduct stock when a dose is skipped', async () => {
    const { session, medicine } = await setupPatientWithMedicine();
    const schedule = await scheduleFor(session, medicine.id);

    const res = await request(app)
      .post('/api/intakes')
      .set(authHeader(session.accessToken))
      .send({
        schedule: schedule.id,
        dateKey: todayKey(),
        scheduledTime: '08:00',
        status: 'skipped',
        skipReason: 'felt_better'
      })
      .expect(201);

    expect(res.body.data.medicine.currentStock).toBe(60);
    expect((await Medicine.findById(medicine.id)).currentStock).toBe(60);
  });

  itIfDb('refunds stock when a taken dose is corrected to skipped', async () => {
    const { session, medicine } = await setupPatientWithMedicine();
    const schedule = await scheduleFor(session, medicine.id, [{ time: '08:00', doseQuantity: 2 }]);

    await request(app)
      .post('/api/intakes')
      .set(authHeader(session.accessToken))
      .send({ schedule: schedule.id, dateKey: todayKey(), scheduledTime: '08:00', status: 'taken' })
      .expect(201);
    expect((await Medicine.findById(medicine.id)).currentStock).toBe(58);

    const res = await request(app)
      .post('/api/intakes')
      .set(authHeader(session.accessToken))
      .send({
        schedule: schedule.id,
        dateKey: todayKey(),
        scheduledTime: '08:00',
        status: 'skipped',
        skipReason: 'side_effects'
      })
      .expect(200);

    expect(res.body.data.medicine.currentStock).toBe(60);
    expect(await Intake.countDocuments({ schedule: schedule.id })).toBe(1);
  });

  itIfDb('refuses a dose slot that is not in the schedule', async () => {
    const { session, medicine } = await setupPatientWithMedicine();
    const schedule = await scheduleFor(session, medicine.id);

    const res = await request(app)
      .post('/api/intakes')
      .set(authHeader(session.accessToken))
      .send({ schedule: schedule.id, dateKey: todayKey(), scheduledTime: '13:00', status: 'taken' })
      .expect(400);
    expect(res.body.message).toMatch(/no 13:00 dose/i);
  });

  itIfDb('refuses a date the medicine is not scheduled on', async () => {
    const { session, medicine } = await setupPatientWithMedicine();
    const res = await request(app)
      .post('/api/schedules')
      .set(authHeader(session.accessToken))
      .send({
        medicine: medicine.id,
        frequency: 'specific_days',
        daysOfWeek: [1],
        times: [{ time: '08:00', doseQuantity: 1 }],
        startDate: '2026-03-01T00:00:00+05:30'
      })
      .expect(201);

    const bad = await request(app)
      .post('/api/intakes')
      .set(authHeader(session.accessToken))
      .send({
        schedule: res.body.data.schedule.id,
        dateKey: '2026-03-03', // a Tuesday
        scheduledTime: '08:00',
        status: 'taken'
      })
      .expect(400);
    expect(bad.body.message).toMatch(/not scheduled/i);
  });

  itIfDb('requires a reason for a skipped dose', async () => {
    const { session, medicine } = await setupPatientWithMedicine();
    const schedule = await scheduleFor(session, medicine.id);

    const res = await request(app)
      .post('/api/intakes')
      .set(authHeader(session.accessToken))
      .send({ schedule: schedule.id, dateKey: todayKey(), scheduledTime: '08:00', status: 'skipped' })
      .expect(422);
    expect(res.body.details.map((d) => d.field)).toContain('body.skipReason');
  });

  itIfDb('never drives stock below zero and warns the patient', async () => {
    const { session, medicine } = await setupPatientWithMedicine({
      initialQuantity: 1,
      currentStock: 0
    });
    const schedule = await scheduleFor(session, medicine.id);

    const res = await request(app)
      .post('/api/intakes')
      .set(authHeader(session.accessToken))
      .send({ schedule: schedule.id, dateKey: todayKey(), scheduledTime: '08:00', status: 'taken' })
      .expect(201);

    expect(res.body.data.medicine.currentStock).toBe(0);
    expect(res.body.data.stockWarning).toMatch(/already empty/i);
  });

  itIfDb('records an as-needed dose and enforces the daily cap', async () => {
    const { session, medicine } = await setupPatientWithMedicine();
    await request(app)
      .post('/api/schedules')
      .set(authHeader(session.accessToken))
      .send({
        medicine: medicine.id,
        frequency: 'as_needed',
        asNeededDoseQuantity: 1,
        maxDosesPerDay: 2
      })
      .expect(201);

    await request(app)
      .post('/api/intakes/as-needed')
      .set(authHeader(session.accessToken))
      .send({ medicine: medicine.id })
      .expect(201);
    await request(app)
      .post('/api/intakes/as-needed')
      .set(authHeader(session.accessToken))
      .send({ medicine: medicine.id })
      .expect(201);

    const capped = await request(app)
      .post('/api/intakes/as-needed')
      .set(authHeader(session.accessToken))
      .send({ medicine: medicine.id })
      .expect(400);
    expect(capped.body.message).toMatch(/daily maximum/i);
    expect((await Medicine.findById(medicine.id)).currentStock).toBe(58);
  });

  itIfDb('returns stock when a dose record is deleted', async () => {
    const { session, medicine } = await setupPatientWithMedicine();
    const schedule = await scheduleFor(session, medicine.id);

    const created = await request(app)
      .post('/api/intakes')
      .set(authHeader(session.accessToken))
      .send({ schedule: schedule.id, dateKey: todayKey(), scheduledTime: '08:00', status: 'taken' })
      .expect(201);

    await request(app)
      .delete(`/api/intakes/${created.body.data.intake.id}`)
      .set(authHeader(session.accessToken))
      .expect(200);

    expect((await Medicine.findById(medicine.id)).currentStock).toBe(60);
  });

  itIfDb('lists medication history newest first', async () => {
    const { session, medicine } = await setupPatientWithMedicine();
    const schedule = await scheduleFor(session, medicine.id, [
      { time: '08:00', doseQuantity: 1 },
      { time: '20:00', doseQuantity: 1 }
    ]);

    await request(app)
      .post('/api/intakes')
      .set(authHeader(session.accessToken))
      .send({ schedule: schedule.id, dateKey: todayKey(), scheduledTime: '08:00', status: 'taken' });
    await request(app)
      .post('/api/intakes')
      .set(authHeader(session.accessToken))
      .send({
        schedule: schedule.id,
        dateKey: todayKey(),
        scheduledTime: '20:00',
        status: 'skipped',
        skipReason: 'forgot'
      });

    const res = await request(app)
      .get('/api/intakes')
      .set(authHeader(session.accessToken))
      .expect(200);

    expect(res.body.data.total).toBe(2);
    expect(res.body.data.items[0].scheduledTime).toBe('20:00');
    expect(res.body.data.items[0].medicine.name).toBe('Metformin');
  });

  itIfDb('filters history by status', async () => {
    const { session, medicine } = await setupPatientWithMedicine();
    const schedule = await scheduleFor(session, medicine.id, [
      { time: '08:00', doseQuantity: 1 },
      { time: '20:00', doseQuantity: 1 }
    ]);

    await request(app)
      .post('/api/intakes')
      .set(authHeader(session.accessToken))
      .send({ schedule: schedule.id, dateKey: todayKey(), scheduledTime: '08:00', status: 'taken' });
    await request(app)
      .post('/api/intakes')
      .set(authHeader(session.accessToken))
      .send({
        schedule: schedule.id,
        dateKey: todayKey(),
        scheduledTime: '20:00',
        status: 'skipped',
        skipReason: 'forgot'
      });

    const res = await request(app)
      .get('/api/intakes?status=skipped')
      .set(authHeader(session.accessToken))
      .expect(200);
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.items[0].skipReason).toBe('forgot');
  });
});
