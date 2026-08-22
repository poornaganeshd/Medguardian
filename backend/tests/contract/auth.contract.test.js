'use strict';

/**
 * Contract tests exercise routing, validation and the auth middleware without
 * touching MongoDB, so they run in every environment.
 */
const request = require('supertest');
const app = require('../../src/app');

describe('auth route contract', () => {
  it('rejects registration with an invalid payload before reaching the database', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'A', email: 'not-an-email', password: 'weak' })
      .expect(422);

    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    const fields = res.body.details.map((d) => d.field);
    expect(fields).toEqual(expect.arrayContaining(['body.email', 'body.password']));
  });

  it('never echoes the submitted password back in an error', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'A', email: 'bad', password: 'SuperSecret1' });
    expect(JSON.stringify(res.body)).not.toContain('SuperSecret1');
  });

  it.each([
    ['GET', '/api/auth/me'],
    ['PATCH', '/api/auth/me'],
    ['POST', '/api/auth/logout'],
    ['POST', '/api/auth/pin'],
    ['POST', '/api/auth/pin/verify'],
    ['GET', '/api/audit']
  ])('requires authentication for %s %s', async (method, path) => {
    const res = await request(app)[method.toLowerCase()](path).send({});
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('rejects a malformed bearer token with 401 rather than 500', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer not.a.jwt')
      .expect(401);
    expect(res.body.code).toBe('INVALID_TOKEN');
  });

  it('refuses a refresh call with no token', async () => {
    const res = await request(app).post('/api/auth/refresh').send({}).expect(401);
    expect(res.body.message).toMatch(/Refresh token missing/i);
  });

  it('returns 400 for malformed JSON bodies', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email": "a@b.com",,}')
      .expect(400);
    expect(res.body.code).toBe('BAD_JSON');
  });
});

describe('medicine route contract', () => {
  const request2 = require('supertest');
  const application = require('../../src/app');

  it.each([
    ['GET', '/api/medicines'],
    ['POST', '/api/medicines'],
    ['GET', '/api/medicines/64b7f0c2f1a2b3c4d5e6f708'],
    ['PATCH', '/api/medicines/64b7f0c2f1a2b3c4d5e6f708'],
    ['DELETE', '/api/medicines/64b7f0c2f1a2b3c4d5e6f708']
  ])('requires authentication for %s %s', async (method, path) => {
    const res = await request2(application)[method.toLowerCase()](path).send({});
    expect(res.status).toBe(401);
  });
});
