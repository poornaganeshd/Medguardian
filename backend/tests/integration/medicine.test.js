'use strict';

const request = require('supertest');
const app = require('../../src/app');
const Medicine = require('../../src/models/Medicine');
const AuditLog = require('../../src/models/AuditLog');
const { describeIfDb, itIfDb } = require('../helpers/dbGuard');
const { registerUser, authHeader, getStepUpToken } = require('../helpers/factories');

const sample = {
  name: 'Metformin',
  genericName: 'Metformin Hydrochloride',
  strength: '500 mg',
  dosageForm: 'tablet',
  unit: 'tablet',
  instructions: 'Take one tablet after breakfast',
  prescriberNotes: 'Review HbA1c in 3 months',
  initialQuantity: 60,
  currentStock: 60,
  refillThreshold: 10
};

describeIfDb('medicine CRUD', () => {
  itIfDb('creates a medicine and stores the normalised name', async () => {
    const session = await registerUser();
    const res = await request(app)
      .post('/api/medicines')
      .set(authHeader(session.accessToken))
      .send(sample)
      .expect(201);

    expect(res.body.data.medicine.name).toBe('Metformin');
    expect(res.body.data.medicine.displayName).toBe('Metformin 500 mg');
    expect(res.body.data.medicine.needsRefill).toBe(false);

    const stored = await Medicine.findById(res.body.data.medicine.id);
    expect(stored.normalizedName).toBe('metformin');
    expect(String(stored.patient)).toBe(String(session.user.id));
  });

  itIfDb('defaults current stock to the initial quantity', async () => {
    const session = await registerUser();
    const res = await request(app)
      .post('/api/medicines')
      .set(authHeader(session.accessToken))
      .send({ name: 'Aspirin', initialQuantity: 30 })
      .expect(201);
    expect(res.body.data.medicine.currentStock).toBe(30);
  });

  itIfDb('lists only the signed-in patient own medicines', async () => {
    const a = await registerUser();
    const b = await registerUser();

    await request(app).post('/api/medicines').set(authHeader(a.accessToken)).send(sample);
    await request(app)
      .post('/api/medicines')
      .set(authHeader(b.accessToken))
      .send({ name: 'Amlodipine' });

    const res = await request(app)
      .get('/api/medicines')
      .set(authHeader(a.accessToken))
      .expect(200);

    expect(res.body.data.total).toBe(1);
    expect(res.body.data.items[0].name).toBe('Metformin');
  });

  itIfDb('refuses to read another patient medicine', async () => {
    const a = await registerUser();
    const b = await registerUser();
    const createRes = await request(app)
      .post('/api/medicines')
      .set(authHeader(a.accessToken))
      .send(sample);

    await request(app)
      .get(`/api/medicines/${createRes.body.data.medicine.id}`)
      .set(authHeader(b.accessToken))
      .expect(404);
  });

  itIfDb('searches by name and generic name', async () => {
    const session = await registerUser();
    await request(app).post('/api/medicines').set(authHeader(session.accessToken)).send(sample);
    await request(app)
      .post('/api/medicines')
      .set(authHeader(session.accessToken))
      .send({ name: 'Atorvastatin' });

    const res = await request(app)
      .get('/api/medicines?search=hydrochloride')
      .set(authHeader(session.accessToken))
      .expect(200);
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.items[0].name).toBe('Metformin');
  });

  itIfDb('filters medicines that need a refill', async () => {
    const session = await registerUser();
    await request(app)
      .post('/api/medicines')
      .set(authHeader(session.accessToken))
      .send({ name: 'Low stock', initialQuantity: 30, currentStock: 3, refillThreshold: 5 });
    await request(app).post('/api/medicines').set(authHeader(session.accessToken)).send(sample);

    const res = await request(app)
      .get('/api/medicines?needsRefill=true')
      .set(authHeader(session.accessToken))
      .expect(200);
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.items[0].name).toBe('Low stock');
  });

  itIfDb('updates a medicine and records the before/after values', async () => {
    const session = await registerUser();
    const createRes = await request(app)
      .post('/api/medicines')
      .set(authHeader(session.accessToken))
      .send(sample);
    const id = createRes.body.data.medicine.id;

    await request(app)
      .patch(`/api/medicines/${id}`)
      .set(authHeader(session.accessToken))
      .send({ refillThreshold: 15, instructions: 'Take with the evening meal' })
      .expect(200);

    const entry = await AuditLog.findOne({ action: 'MEDICINE_UPDATED' });
    expect(entry.oldValue.refillThreshold).toBe(10);
    expect(entry.newValue.refillThreshold).toBe(15);
  });

  itIfDb('re-normalises the name when the generic name changes', async () => {
    const session = await registerUser();
    const createRes = await request(app)
      .post('/api/medicines')
      .set(authHeader(session.accessToken))
      .send({ name: 'Ecosprin 75' });
    const id = createRes.body.data.medicine.id;
    expect((await Medicine.findById(id)).normalizedName).toBe('aspirin');

    await request(app)
      .patch(`/api/medicines/${id}`)
      .set(authHeader(session.accessToken))
      .send({ genericName: 'Clopidogrel' })
      .expect(200);

    expect((await Medicine.findById(id)).normalizedName).toBe('clopidogrel');
  });

  itIfDb('requires PIN step-up to delete a medicine', async () => {
    const session = await registerUser();
    const createRes = await request(app)
      .post('/api/medicines')
      .set(authHeader(session.accessToken))
      .send(sample);
    const id = createRes.body.data.medicine.id;

    const denied = await request(app)
      .delete(`/api/medicines/${id}`)
      .set(authHeader(session.accessToken))
      .expect(401);
    expect(denied.body.code).toBe('STEP_UP_REQUIRED');

    const stepUpToken = await getStepUpToken(session);
    await request(app)
      .delete(`/api/medicines/${id}`)
      .set(authHeader(session.accessToken))
      .set('x-step-up-token', stepUpToken)
      .expect(200);

    expect(await Medicine.findById(id)).toBeNull();
  });

  itIfDb('rejects a step-up token belonging to a different user', async () => {
    const a = await registerUser();
    const b = await registerUser();
    const createRes = await request(app)
      .post('/api/medicines')
      .set(authHeader(a.accessToken))
      .send(sample);

    const foreignToken = await getStepUpToken(b);
    await request(app)
      .delete(`/api/medicines/${createRes.body.data.medicine.id}`)
      .set(authHeader(a.accessToken))
      .set('x-step-up-token', foreignToken)
      .expect(401);
  });
});

describeIfDb('stock adjustment', () => {
  itIfDb('adds stock on a refill and records the event', async () => {
    const session = await registerUser();
    const createRes = await request(app)
      .post('/api/medicines')
      .set(authHeader(session.accessToken))
      .send({ name: 'Metformin', initialQuantity: 60, currentStock: 8, refillThreshold: 10 });
    const id = createRes.body.data.medicine.id;

    const res = await request(app)
      .post(`/api/medicines/${id}/stock`)
      .set(authHeader(session.accessToken))
      .send({ mode: 'refill', quantity: 60 })
      .expect(200);

    expect(res.body.data.previousStock).toBe(8);
    expect(res.body.data.medicine.currentStock).toBe(68);
    expect(res.body.data.medicine.lastRefillQuantity).toBe(60);
    expect(res.body.data.medicine.needsRefill).toBe(false);
  });

  itIfDb('sets an absolute value on a correction', async () => {
    const session = await registerUser();
    const createRes = await request(app)
      .post('/api/medicines')
      .set(authHeader(session.accessToken))
      .send(sample);

    const res = await request(app)
      .post(`/api/medicines/${createRes.body.data.medicine.id}/stock`)
      .set(authHeader(session.accessToken))
      .send({ mode: 'correction', quantity: 12, note: 'Counted the strip' })
      .expect(200);

    expect(res.body.data.medicine.currentStock).toBe(12);
  });

  itIfDb('flags a medicine as needing a refill when stock drops to the threshold', async () => {
    const session = await registerUser();
    const createRes = await request(app)
      .post('/api/medicines')
      .set(authHeader(session.accessToken))
      .send(sample);

    const res = await request(app)
      .post(`/api/medicines/${createRes.body.data.medicine.id}/stock`)
      .set(authHeader(session.accessToken))
      .send({ mode: 'correction', quantity: 10 })
      .expect(200);

    expect(res.body.data.medicine.needsRefill).toBe(true);
  });
});

describeIfDb('medicine image upload', () => {
  const sharp = require('sharp');

  const pngBuffer = () =>
    sharp({ create: { width: 600, height: 400, channels: 3, background: '#3a7' } })
      .png()
      .toBuffer();

  itIfDb('accepts an image, stores it as webp and exposes authenticated urls', async () => {
    const session = await registerUser();
    const createRes = await request(app)
      .post('/api/medicines')
      .set(authHeader(session.accessToken))
      .send(sample);
    const id = createRes.body.data.medicine.id;

    const res = await request(app)
      .post(`/api/medicines/${id}/image`)
      .set(authHeader(session.accessToken))
      .attach('image', await pngBuffer(), 'metformin.png')
      .expect(200);

    const { image } = res.body.data.medicine;
    expect(image.mimeType).toBe('image/webp');
    expect(image.url).toBe(`/api/medicines/${id}/image`);
    expect(image.thumbnailUrl).toContain('variant=thumbnail');
    expect(image.originalName).toBe('metformin.png');
  });

  itIfDb('serves the stored image and its thumbnail to the owner', async () => {
    const session = await registerUser();
    const createRes = await request(app)
      .post('/api/medicines')
      .set(authHeader(session.accessToken))
      .send(sample);
    const id = createRes.body.data.medicine.id;

    await request(app)
      .post(`/api/medicines/${id}/image`)
      .set(authHeader(session.accessToken))
      .attach('image', await pngBuffer(), 'metformin.png')
      .expect(200);

    const full = await request(app)
      .get(`/api/medicines/${id}/image`)
      .set(authHeader(session.accessToken))
      .expect(200);
    expect(full.headers['content-type']).toMatch(/image\/webp/);
    expect(full.body.length).toBeGreaterThan(0);

    await request(app)
      .get(`/api/medicines/${id}/image?variant=thumbnail`)
      .set(authHeader(session.accessToken))
      .expect(200);
  });

  itIfDb('never serves an image to another patient or an anonymous caller', async () => {
    const owner = await registerUser();
    const stranger = await registerUser();
    const createRes = await request(app)
      .post('/api/medicines')
      .set(authHeader(owner.accessToken))
      .send(sample);
    const id = createRes.body.data.medicine.id;

    await request(app)
      .post(`/api/medicines/${id}/image`)
      .set(authHeader(owner.accessToken))
      .attach('image', await pngBuffer(), 'metformin.png')
      .expect(200);

    await request(app)
      .get(`/api/medicines/${id}/image`)
      .set(authHeader(stranger.accessToken))
      .expect(404);

    await request(app).get(`/api/medicines/${id}/image`).expect(401);
  });

  itIfDb('rejects a non-image upload', async () => {
    const session = await registerUser();
    const createRes = await request(app)
      .post('/api/medicines')
      .set(authHeader(session.accessToken))
      .send(sample);

    const res = await request(app)
      .post(`/api/medicines/${createRes.body.data.medicine.id}/image`)
      .set(authHeader(session.accessToken))
      .attach('image', Buffer.from('#!/bin/sh\nrm -rf /'), 'evil.sh')
      .expect(400);
    expect(res.body.message).toMatch(/Unsupported file type|No image file/i);
  });

  itIfDb('removes an image on request', async () => {
    const session = await registerUser();
    const createRes = await request(app)
      .post('/api/medicines')
      .set(authHeader(session.accessToken))
      .send(sample);
    const id = createRes.body.data.medicine.id;

    await request(app)
      .post(`/api/medicines/${id}/image`)
      .set(authHeader(session.accessToken))
      .attach('image', await pngBuffer(), 'metformin.png')
      .expect(200);

    const res = await request(app)
      .delete(`/api/medicines/${id}/image`)
      .set(authHeader(session.accessToken))
      .expect(200);
    expect(res.body.data.medicine.image).toBeUndefined();

    await request(app)
      .get(`/api/medicines/${id}/image`)
      .set(authHeader(session.accessToken))
      .expect(404);
  });
});
