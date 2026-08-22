'use strict';

const express = require('express');

const ctrl = require('../controllers/dashboardController');
const { protect } = require('../middleware/auth');
const { resolvePatientContext } = require('../middleware/patientContext');

const router = express.Router();

router.use(protect, resolvePatientContext({ permission: 'viewSchedules' }));

router.get('/', ctrl.getDashboard);

module.exports = router;
