'use strict';

const tokenService = require('../../src/services/tokenService');

const user = { _id: '64b7f0c2f1a2b3c4d5e6f708', role: 'patient' };

describe('tokenService', () => {
  it('issues a verifiable access token carrying the user id and role', () => {
    const token = tokenService.signAccessToken(user);
    const payload = tokenService.verifyAccessToken(token);
    expect(payload.sub).toBe(user._id);
    expect(payload.role).toBe('patient');
    expect(payload.type).toBe('access');
  });

  it('signs refresh tokens with a different secret than access tokens', () => {
    const { token } = tokenService.signRefreshToken(user);
    expect(() => tokenService.verifyAccessToken(token)).toThrow();
    expect(tokenService.verifyRefreshToken(token).type).toBe('refresh');
  });

  it('gives every refresh token a unique id so rotation can revoke one session', () => {
    const a = tokenService.verifyRefreshToken(tokenService.signRefreshToken(user).token);
    const b = tokenService.verifyRefreshToken(tokenService.signRefreshToken(user).token);
    expect(a.jti).not.toBe(b.jti);
  });

  it('stores only a hash of the refresh token', () => {
    const { token, hash } = tokenService.signRefreshToken(user);
    expect(hash).toHaveLength(64);
    expect(hash).not.toContain(token);
    expect(tokenService.hashToken(token)).toBe(hash);
  });

  it('marks step-up tokens with the method used to obtain them', () => {
    const payload = tokenService.verifyAccessToken(tokenService.signStepUpToken(user, 'pin'));
    expect(payload.type).toBe('stepup');
    expect(payload.method).toBe('pin');
  });

  it('rejects a tampered token', () => {
    const token = tokenService.signAccessToken(user);
    const tampered = `${token.slice(0, -3)}abc`;
    expect(() => tokenService.verifyAccessToken(tampered)).toThrow();
  });
});
