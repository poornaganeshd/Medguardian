'use strict';

const request = require('supertest');
const app = require('../../src/app');
const { describeIfDb, itIfDb } = require('../helpers/dbGuard');
const { registerUser, authHeader } = require('../helpers/factories');

describeIfDb('POST /api/assistant/medicine-info', () => {
  itIfDb('answers a general question from the curated knowledge base', async () => {
    const session = await registerUser();
    const res = await request(app)
      .post('/api/assistant/medicine-info')
      .set(authHeader(session.accessToken))
      .send({ question: 'How should I store metformin?' })
      .expect(200);

    expect(res.body.data.answered).toBe(true);
    expect(res.body.data.medicine.substance).toBe('metformin');
    expect(res.body.data.generatedByModel).toBe(false);
  });

  itIfDb('refuses a dosage-change question', async () => {
    const session = await registerUser();
    const res = await request(app)
      .post('/api/assistant/medicine-info')
      .set(authHeader(session.accessToken))
      .send({ question: 'Should I increase my dose of metformin?' })
      .expect(200);

    expect(res.body.data.answered).toBe(false);
    expect(res.body.data.reason).toBe('dosage_change');
  });

  itIfDb('answers about one of the patient own medicines by id', async () => {
    const session = await registerUser();
    const medRes = await request(app)
      .post('/api/medicines')
      .set(authHeader(session.accessToken))
      .send({ name: 'Glycomet 500', genericName: 'Metformin' })
      .expect(201);

    const res = await request(app)
      .post('/api/assistant/medicine-info')
      .set(authHeader(session.accessToken))
      .send({ medicineId: medRes.body.data.medicine.id, topic: 'storage' })
      .expect(200);

    expect(res.body.data.medicine.substance).toBe('metformin');
    expect(Object.keys(res.body.data.sections)).toEqual(['storage']);
  });

  itIfDb('refuses to look up another patient medicine', async () => {
    const owner = await registerUser();
    const medRes = await request(app)
      .post('/api/medicines')
      .set(authHeader(owner.accessToken))
      .send({ name: 'Metformin' })
      .expect(201);

    const stranger = await registerUser();
    await request(app)
      .post('/api/assistant/medicine-info')
      .set(authHeader(stranger.accessToken))
      .send({ medicineId: medRes.body.data.medicine.id })
      .expect(404);
  });

  itIfDb('requires a question or a medicine', async () => {
    const session = await registerUser();
    await request(app)
      .post('/api/assistant/medicine-info')
      .set(authHeader(session.accessToken))
      .send({})
      .expect(422);
  });

  itIfDb('publishes the knowledge base scope rules', async () => {
    const session = await registerUser();
    const res = await request(app)
      .get('/api/assistant/medicine-info/knowledge-base')
      .set(authHeader(session.accessToken))
      .expect(200);

    expect(res.body.data.knowledgeBase.isDemoData).toBe(true);
    expect(res.body.data.knowledgeBase.generatedByModel).toBe(false);
    expect(res.body.data.knowledgeBase.scopeRules.mustRefuse.length).toBeGreaterThan(0);
  });
});

describeIfDb('POST /api/assistant/visit-summary', () => {
  const NOTE = `Dr. A. Kumar
C/O headache since last week
BP 150/95
Advised: reduce salt
Rx
1. Tab Amlodipine 5mg 1-0-0
Follow up after 4 weeks`;

  itIfDb('summarises pasted text and reconciles it with the medicine list', async () => {
    const session = await registerUser();
    await request(app)
      .post('/api/medicines')
      .set(authHeader(session.accessToken))
      .send({ name: 'Metformin' })
      .expect(201);

    const res = await request(app)
      .post('/api/assistant/visit-summary')
      .set(authHeader(session.accessToken))
      .send({ text: NOTE, title: 'March visit' })
      .expect(200);

    expect(res.body.data.summarised).toBe(true);
    expect(res.body.data.isDiagnostic).toBe(false);
    expect(res.body.data.medicines.map((m) => m.normalizedName)).toContain('amlodipine');
    expect(res.body.data.reconciliation.onlyInDocument.map((r) => r.substance)).toContain(
      'amlodipine'
    );
    expect(res.body.data.reconciliation.onlyOnYourList.map((r) => r.substance)).toContain(
      'metformin'
    );
  });

  itIfDb('requires text or a record id', async () => {
    const session = await registerUser();
    await request(app)
      .post('/api/assistant/visit-summary')
      .set(authHeader(session.accessToken))
      .send({})
      .expect(422);
  });

  itIfDb('refuses to summarise a record with no extracted text', async () => {
    const session = await registerUser();
    const recRes = await request(app)
      .post('/api/records')
      .set(authHeader(session.accessToken))
      .field('title', 'Note')
      .field('category', 'other')
      .expect(201);

    const res = await request(app)
      .post('/api/assistant/visit-summary')
      .set(authHeader(session.accessToken))
      .send({ recordId: recRes.body.data.record.id })
      .expect(400);
    expect(res.body.message).toMatch(/no extracted text/i);
  });

  itIfDb('refuses another patient record', async () => {
    const owner = await registerUser();
    const recRes = await request(app)
      .post('/api/records')
      .set(authHeader(owner.accessToken))
      .field('title', 'Note')
      .field('category', 'other')
      .expect(201);

    const stranger = await registerUser();
    await request(app)
      .post('/api/assistant/visit-summary')
      .set(authHeader(stranger.accessToken))
      .send({ recordId: recRes.body.data.record.id })
      .expect(404);
  });
});

describeIfDb('GET /api/assistant/insights', () => {
  itIfDb('returns rule-based insights for the patient own data', async () => {
    const session = await registerUser();
    const medRes = await request(app)
      .post('/api/medicines')
      .set(authHeader(session.accessToken))
      .send({ name: 'Metformin', initialQuantity: 30, currentStock: 2, refillThreshold: 5 })
      .expect(201);
    await request(app)
      .post('/api/schedules')
      .set(authHeader(session.accessToken))
      .send({
        medicine: medRes.body.data.medicine.id,
        frequency: 'daily',
        times: [{ time: '08:00', doseQuantity: 1 }]
      })
      .expect(201);

    const res = await request(app)
      .get('/api/assistant/insights')
      .set(authHeader(session.accessToken))
      .expect(200);

    expect(res.body.data.isDiagnostic).toBe(false);
    expect(res.body.data.generatedByModel).toBe(false);
    expect(Array.isArray(res.body.data.insights)).toBe(true);
    expect(res.body.data.insights.map((i) => i.id)).toContain('REFILL_URGENT');
  });

  itIfDb('handles a brand-new patient with no data', async () => {
    const session = await registerUser();
    const res = await request(app)
      .get('/api/assistant/insights')
      .set(authHeader(session.accessToken))
      .expect(200);
    expect(res.body.data.insights.map((i) => i.id)).toContain('ADHERENCE_NO_DATA');
  });
});
