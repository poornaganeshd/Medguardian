'use strict';

const request = require('supertest');
const app = require('../../src/app');
const User = require('../../src/models/User');
const AuditLog = require('../../src/models/AuditLog');
const { describeIfDb, itIfDb } = require('../helpers/dbGuard');
const { registerUser, authHeader } = require('../helpers/factories');

describeIfDb('authentication flow', () => {
  itIfDb('registers a patient, hashes the password and returns tokens', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Asha Menon', email: 'asha@example.com', password: 'Str0ngPass' })
      .expect(201);

    expect(res.body.data.user.email).toBe('asha@example.com');
    expect(res.body.data.user.role).toBe('patient');
    expect(res.body.data.user.password).toBeUndefined();
    expect(res.body.data.accessToken).toBeTruthy();

    const stored = await User.findOne({ email: 'asha@example.com' }).select('+password');
    expect(stored.password).not.toBe('Str0ngPass');
    expect(stored.password.startsWith('$2')).toBe(true);
  });

  itIfDb('writes an audit entry on registration', async () => {
    await registerUser({ email: 'audit-reg@example.com' });
    const entry = await AuditLog.findOne({ action: 'AUTH_REGISTER' });
    expect(entry).toBeTruthy();
    expect(entry.actorEmail).toBe('audit-reg@example.com');
  });

  itIfDb('refuses a duplicate email', async () => {
    await registerUser({ email: 'dupe@example.com' });
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Other', email: 'dupe@example.com', password: 'Str0ngPass' })
      .expect(409);
    expect(res.body.message).toMatch(/already exists/i);
  });

  itIfDb('signs in with valid credentials and rejects a wrong password', async () => {
    const session = await registerUser({ email: 'login@example.com' });

    await request(app)
      .post('/api/auth/login')
      .send({ email: 'login@example.com', password: session.password })
      .expect(200);

    const bad = await request(app)
      .post('/api/auth/login')
      .send({ email: 'login@example.com', password: 'WrongPass1' })
      .expect(401);
    expect(bad.body.message).toBe('Invalid email or password');
  });

  itIfDb('returns the same generic message for an unknown email (no enumeration)', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: 'Whatever1' })
      .expect(401);
    expect(res.body.message).toBe('Invalid email or password');
  });

  itIfDb('returns the signed-in profile from /me', async () => {
    const session = await registerUser({ name: 'Profile Owner' });
    const res = await request(app)
      .get('/api/auth/me')
      .set(authHeader(session.accessToken))
      .expect(200);
    expect(res.body.data.user.name).toBe('Profile Owner');
    expect(res.body.data.user.hasPin).toBe(false);
  });

  itIfDb('updates the profile and records the old and new values', async () => {
    const session = await registerUser();
    await request(app)
      .patch('/api/auth/me')
      .set(authHeader(session.accessToken))
      .send({ name: 'Renamed Patient', bloodGroup: 'O+', allergies: ['penicillin'] })
      .expect(200);

    const entry = await AuditLog.findOne({ action: 'PROFILE_UPDATED' });
    expect(entry.newValue.name).toBe('Renamed Patient');
    expect(entry.oldValue.name).toBe(session.user.name);
  });

  itIfDb('rotates refresh tokens and revokes all sessions when one is reused', async () => {
    const session = await registerUser();

    const first = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: session.refreshToken })
      .expect(200);
    expect(first.body.data.refreshToken).not.toBe(session.refreshToken);

    // Replaying the original (now rotated) token must fail.
    await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: session.refreshToken })
      .expect(401);

    // ...and it invalidates the rotated one too.
    await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: first.body.data.refreshToken })
      .expect(401);
  });

  itIfDb('logs out and invalidates the refresh token', async () => {
    const session = await registerUser();
    await request(app)
      .post('/api/auth/logout')
      .set(authHeader(session.accessToken))
      .send({ refreshToken: session.refreshToken })
      .expect(200);

    await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: session.refreshToken })
      .expect(401);
  });

  itIfDb('changes the password and invalidates old access tokens', async () => {
    const session = await registerUser();
    await request(app)
      .post('/api/auth/change-password')
      .set(authHeader(session.accessToken))
      .send({ currentPassword: session.password, newPassword: 'Even5tronger' })
      .expect(200);

    // Tokens issued before the change are refused.
    await request(app).get('/api/auth/me').set(authHeader(session.accessToken)).expect(401);

    await request(app)
      .post('/api/auth/login')
      .send({ email: session.user.email, password: 'Even5tronger' })
      .expect(200);
  });

  itIfDb('locks the account after repeated failed logins', async () => {
    const session = await registerUser({ email: 'lockme@example.com' });
    for (let i = 0; i < 8; i += 1) {
      await request(app)
        .post('/api/auth/login')
        .send({ email: session.user.email, password: 'Wrong0ne' });
    }
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: session.user.email, password: session.password });
    expect(res.status).toBe(429);
    expect(res.body.message).toMatch(/Too many failed attempts/i);
  });
});

describeIfDb('PIN re-authentication', () => {
  itIfDb('sets a PIN only when the account password is supplied', async () => {
    const session = await registerUser();

    await request(app)
      .post('/api/auth/pin')
      .set(authHeader(session.accessToken))
      .send({ pin: '4821', password: 'WrongPass1' })
      .expect(401);

    await request(app)
      .post('/api/auth/pin')
      .set(authHeader(session.accessToken))
      .send({ pin: '4821', password: session.password })
      .expect(200);

    const stored = await User.findById(session.user.id).select('+pinHash');
    expect(stored.pinHash).toBeTruthy();
    expect(stored.pinHash).not.toContain('4821');
  });

  itIfDb('issues a step-up token for a correct PIN and refuses a wrong one', async () => {
    const session = await registerUser();
    await request(app)
      .post('/api/auth/pin')
      .set(authHeader(session.accessToken))
      .send({ pin: '4821', password: session.password })
      .expect(200);

    await request(app)
      .post('/api/auth/pin/verify')
      .set(authHeader(session.accessToken))
      .send({ pin: '0000' })
      .expect(401);

    const res = await request(app)
      .post('/api/auth/pin/verify')
      .set(authHeader(session.accessToken))
      .send({ pin: '4821' })
      .expect(200);

    expect(res.body.data.stepUpToken).toBeTruthy();
    expect(res.body.data.method).toBe('pin');
  });

  itIfDb('requires the current PIN before it can be changed', async () => {
    const session = await registerUser();
    await request(app)
      .post('/api/auth/pin')
      .set(authHeader(session.accessToken))
      .send({ pin: '4821', password: session.password })
      .expect(200);

    await request(app)
      .post('/api/auth/pin')
      .set(authHeader(session.accessToken))
      .send({ pin: '9137', password: session.password })
      .expect(400);

    await request(app)
      .post('/api/auth/pin')
      .set(authHeader(session.accessToken))
      .send({ pin: '9137', currentPin: '4821', password: session.password })
      .expect(200);
  });
});

describeIfDb('audit trail endpoint', () => {
  itIfDb('returns only the signed-in user own audit entries', async () => {
    const a = await registerUser();
    const b = await registerUser();

    await request(app).get('/api/auth/me').set(authHeader(b.accessToken)).expect(200);

    const res = await request(app)
      .get('/api/audit')
      .set(authHeader(a.accessToken))
      .expect(200);

    expect(res.body.data.items.length).toBeGreaterThan(0);
    for (const item of res.body.data.items) {
      expect(String(item.user)).toBe(String(a.user.id));
    }
  });
});
