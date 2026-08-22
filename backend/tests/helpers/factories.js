'use strict';

const request = require('supertest');
const app = require('../../src/app');

let counter = 0;

/** Registers a user through the real API and returns tokens + user document. */
async function registerUser(overrides = {}) {
  counter += 1;
  const payload = {
    name: `Test User ${counter}`,
    email: `user${counter}.${Date.now()}@example.com`,
    password: 'Str0ngPass',
    role: 'patient',
    ...overrides
  };
  const res = await request(app).post('/api/auth/register').send(payload);
  if (res.status !== 201) {
    throw new Error(`registerUser failed (${res.status}): ${JSON.stringify(res.body)}`);
  }
  return { ...res.body.data, password: payload.password };
}

const authHeader = (accessToken) => ({ Authorization: `Bearer ${accessToken}` });

/** Sets a PIN then verifies it, returning a usable step-up token. */
async function getStepUpToken(session, pin = '4821') {
  await request(app)
    .post('/api/auth/pin')
    .set(authHeader(session.accessToken))
    .send({ pin, password: session.password })
    .expect(200);

  const res = await request(app)
    .post('/api/auth/pin/verify')
    .set(authHeader(session.accessToken))
    .send({ pin })
    .expect(200);

  return res.body.data.stepUpToken;
}

module.exports = { registerUser, authHeader, getStepUpToken };
