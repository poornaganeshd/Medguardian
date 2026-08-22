'use strict';

const request = require('supertest');
const app = require('../../src/app');
const { describeIfDb, itIfDb } = require('../helpers/dbGuard');

describe('GET /api/health', () => {
  it('reports the service as up', async () => {
    const res = await request(app).get('/api/health').expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.service).toBe('medguardian-api');
  });

  it('returns 404 with a helpful message for unknown routes', async () => {
    const res = await request(app).get('/api/does-not-exist').expect(404);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/Route not found/);
  });
});

describeIfDb('GET /api/health (database connected)', () => {
  itIfDb('reports the database as connected', async () => {
    const res = await request(app).get('/api/health').expect(200);
    expect(res.body.data.database).toBe('connected');
  });
});
