'use strict';

const express = require('express');

const ctrl = require('../controllers/authController');
const webauthn = require('../controllers/webauthnController');
const validate = require('../middleware/validate');
const { protect } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimiter');
const schemas = require('../validators/authValidators');

const router = express.Router();

// ---------------------------------------------------------------- public
router.post('/register', authLimiter, validate({ body: schemas.registerSchema }), ctrl.register);
router.post('/login', authLimiter, validate({ body: schemas.loginSchema }), ctrl.login);
router.post('/refresh', authLimiter, validate({ body: schemas.refreshSchema }), ctrl.refresh);

// -------------------------------------------------------------- protected
router.use(protect);

router.post('/logout', ctrl.logout);
router.get('/me', ctrl.me);
router.patch('/me', validate({ body: schemas.updateProfileSchema }), ctrl.updateProfile);
router.post(
  '/change-password',
  authLimiter,
  validate({ body: schemas.changePasswordSchema }),
  ctrl.changePassword
);

// PIN re-authentication
router.post('/pin', authLimiter, validate({ body: schemas.setPinSchema }), ctrl.setPin);
router.post('/pin/verify', authLimiter, validate({ body: schemas.verifyPinSchema }), ctrl.verifyPin);

// WebAuthn / biometric
router.post('/webauthn/register/options', webauthn.registrationOptions);
router.post('/webauthn/register/verify', webauthn.verifyRegistration);
router.post('/webauthn/authenticate/options', webauthn.authenticationOptions);
router.post('/webauthn/authenticate/verify', authLimiter, webauthn.verifyAuthentication);
router.delete('/webauthn/:credentialId', webauthn.removeCredential);

module.exports = router;
