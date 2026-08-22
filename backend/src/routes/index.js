'use strict';

const express = require('express');
const mongoose = require('mongoose');
const { ok } = require('../utils/apiResponse');

const router = express.Router();

const STATES = ['disconnected', 'connected', 'connecting', 'disconnecting'];

router.get('/health', (req, res) =>
  ok(res, {
    service: 'medguardian-api',
    status: 'up',
    database: STATES[mongoose.connection.readyState] || 'unknown',
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString()
  })
);

module.exports = router;
