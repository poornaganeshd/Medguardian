'use strict';

const request = require('supertest');
const app = require('../../src/app');
const { describeIfDb, itIfDb } = require('../helpers/dbGuard');
const { registerUser, authHeader } = require('../helpers/factories');

async function addMedicine(session, name, extra = {}) {
  const res = await request(app)
    .post('/api/medicines')
    .set(authHeader(session.accessToken))
    .send({ name, initialQuantity: 30, currentStock: 30, ...extra })
    .expect(201);
  return res.body.data.medicine;
}

describeIfDb('GET /api/interactions/my-medicines', () => {
  itIfDb('detects an interaction between two of the patient medicines', async () => {
    const session = await registerUser();
    await addMedicine(session, 'Warfarin');
    await addMedicine(session, 'Ecosprin 75');

    const res = await request(app)
      .get('/api/interactions/my-medicines')
      .set(authHeader(session.accessToken))
      .expect(200);

    expect(res.body.data.summary.total).toBe(1);
    expect(res.body.data.findings[0].severity).toBe('major');
    expect(res.body.data.dataset.isDemoData).toBe(true);
    expect(res.body.data.disclaimer).toBeTruthy();
  });

  itIfDb('reports nothing for medicines with no documented interaction', async () => {
    const session = await registerUser();
    await addMedicine(session, 'Vitamin D3');
    await addMedicine(session, 'Zinc');

    const res = await request(app)
      .get('/api/interactions/my-medicines')
      .set(authHeader(session.accessToken))
      .expect(200);
    expect(res.body.data.summary.total).toBe(0);
    expect(res.body.data.findings).toEqual([]);
  });

  itIfDb('excludes archived medicines from the check', async () => {
    const session = await registerUser();
    await addMedicine(session, 'Warfarin');
    const aspirin = await addMedicine(session, 'Aspirin');

    await request(app)
      .patch(`/api/medicines/${aspirin.id}`)
      .set(authHeader(session.accessToken))
      .send({ isActive: false })
      .expect(200);

    const res = await request(app)
      .get('/api/interactions/my-medicines')
      .set(authHeader(session.accessToken))
      .expect(200);
    expect(res.body.data.summary.total).toBe(0);
  });

  itIfDb('never checks another patient medicines', async () => {
    const owner = await registerUser();
    await addMedicine(owner, 'Warfarin');
    await addMedicine(owner, 'Aspirin');

    const stranger = await registerUser();
    const res = await request(app)
      .get('/api/interactions/my-medicines')
      .set(authHeader(stranger.accessToken))
      .expect(200);
    expect(res.body.data.summary.medicinesChecked).toBe(0);
  });
});

describeIfDb('POST /api/interactions/check', () => {
  itIfDb('checks typed names against the patient existing medicines', async () => {
    const session = await registerUser();
    await addMedicine(session, 'Warfarin');

    const res = await request(app)
      .post('/api/interactions/check')
      .set(authHeader(session.accessToken))
      .send({ names: ['Ibuprofen 400mg'], includeMyMedicines: true })
      .expect(200);

    expect(res.body.data.summary.total).toBe(1);
    expect(res.body.data.findings[0].interactionId).toBe('DDI-002');
    expect(res.body.data.checkedNames).toEqual(['Ibuprofen 400mg']);
  });

  itIfDb('can check a list of names in isolation', async () => {
    const session = await registerUser();
    await addMedicine(session, 'Warfarin');

    const res = await request(app)
      .post('/api/interactions/check')
      .set(authHeader(session.accessToken))
      .send({ names: ['Ibuprofen', 'Naproxen'], includeMyMedicines: false })
      .expect(200);

    expect(res.body.data.summary.total).toBe(0);
    expect(res.body.data.duplicateTherapy).toHaveLength(1);
  });

  itIfDb('rejects an empty or oversized name list', async () => {
    const session = await registerUser();
    await request(app)
      .post('/api/interactions/check')
      .set(authHeader(session.accessToken))
      .send({ names: [] })
      .expect(422);

    await request(app)
      .post('/api/interactions/check')
      .set(authHeader(session.accessToken))
      .send({ names: Array.from({ length: 30 }, (_, i) => `Drug ${i}`) })
      .expect(422);
  });
});

describeIfDb('GET /api/interactions/dataset', () => {
  itIfDb('discloses that the dataset is demo data and no LLM is used', async () => {
    const session = await registerUser();
    const res = await request(app)
      .get('/api/interactions/dataset')
      .set(authHeader(session.accessToken))
      .expect(200);

    expect(res.body.data.dataset.isDemoData).toBe(true);
    expect(res.body.data.dataset.llmInvolved).toBe(false);
    expect(res.body.data.dataset.method).toBe('deterministic-dataset-lookup');
    expect(res.body.data.knownSubstances.length).toBeGreaterThan(30);
  });
});
