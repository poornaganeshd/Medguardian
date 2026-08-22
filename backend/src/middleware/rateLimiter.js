'use strict';

const rateLimit = require('express-rate-limit');
const { config } = require('../config/env');

const build = (max, message) =>
  rateLimit({
    windowMs: config.rateLimit.windowMs,
    max: config.isTest ? 100000 : max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message }
  });

// General API traffic
const apiLimiter = build(config.rateLimit.max, 'Too many requests, please slow down.');

// Login / register / PIN endpoints get a much tighter budget
const authLimiter = build(
  config.rateLimit.authMax,
  'Too many authentication attempts, please try again later.'
);

module.exports = { apiLimiter, authLimiter };
