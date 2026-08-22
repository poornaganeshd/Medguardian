'use strict';

const {
  registerSchema,
  loginSchema,
  setPinSchema,
  changePasswordSchema
} = require('../../src/validators/authValidators');

describe('auth validators', () => {
  it('accepts a well formed registration and normalises the email', () => {
    const result = registerSchema.safeParse({
      name: 'Asha Menon',
      email: '  Asha.Menon@Example.COM ',
      password: 'Str0ngPass'
    });
    expect(result.success).toBe(true);
    expect(result.data.email).toBe('asha.menon@example.com');
    expect(result.data.role).toBe('patient');
  });

  it.each([
    ['too short', 'Ab1'],
    ['no uppercase', 'weakpass1'],
    ['no lowercase', 'WEAKPASS1'],
    ['no digit', 'WeakPassword']
  ])('rejects a password that is %s', (_label, password) => {
    const result = registerSchema.safeParse({ name: 'Asha', email: 'a@b.com', password });
    expect(result.success).toBe(false);
  });

  it('rejects an unsupported role', () => {
    const result = registerSchema.safeParse({
      name: 'Doc',
      email: 'a@b.com',
      password: 'Str0ngPass',
      role: 'doctor'
    });
    expect(result.success).toBe(false);
  });

  it('requires a 4-8 digit PIN that is not a single repeated digit', () => {
    expect(setPinSchema.safeParse({ pin: '4821', password: 'x' }).success).toBe(true);
    expect(setPinSchema.safeParse({ pin: '1111', password: 'x' }).success).toBe(false);
    expect(setPinSchema.safeParse({ pin: '123', password: 'x' }).success).toBe(false);
    expect(setPinSchema.safeParse({ pin: '12a4', password: 'x' }).success).toBe(false);
    expect(setPinSchema.safeParse({ pin: '4821' }).success).toBe(false);
  });

  it('requires both passwords when changing a password', () => {
    expect(
      changePasswordSchema.safeParse({ currentPassword: 'old', newPassword: 'N3wPassword' }).success
    ).toBe(true);
    expect(changePasswordSchema.safeParse({ newPassword: 'N3wPassword' }).success).toBe(false);
  });

  it('requires a password on login', () => {
    expect(loginSchema.safeParse({ email: 'a@b.com', password: '' }).success).toBe(false);
  });
});
