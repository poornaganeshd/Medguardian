'use strict';

const express = require('express');
const mongoose = require('mongoose');
const { ok } = require('../utils/apiResponse');

const authRoutes = require('./authRoutes');
const auditRoutes = require('./auditRoutes');
const medicineRoutes = require('./medicineRoutes');
const scheduleRoutes = require('./scheduleRoutes');
const intakeRoutes = require('./intakeRoutes');
const analyticsRoutes = require('./analyticsRoutes');
const interactionRoutes = require('./interactionRoutes');

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

router.use('/auth', authRoutes);
router.use('/audit', auditRoutes);
router.use('/medicines', medicineRoutes);
router.use('/schedules', scheduleRoutes);
router.use('/intakes', intakeRoutes);
router.use('/analytics', analyticsRoutes);
router.use('/interactions', interactionRoutes);

module.exports = router;
