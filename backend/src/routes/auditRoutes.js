'use strict';

const express = require('express');
const { z } = require('zod');

const asyncHandler = require('../utils/asyncHandler');
const validate = require('../middleware/validate');
const { protect } = require('../middleware/auth');
const { ok } = require('../utils/apiResponse');
const auditService = require('../services/auditService');
const { AUDIT_ACTIONS } = require('../models/AuditLog');

const router = express.Router();

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  action: z.enum(AUDIT_ACTIONS).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional()
});

router.use(protect);

/** The signed-in user can always read their own audit trail. */
router.get(
  '/',
  validate({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const result = await auditService.listForUser(req.user._id, req.query);
    return ok(res, result);
  })
);

router.get(
  '/actions',
  asyncHandler(async (req, res) => ok(res, { actions: AUDIT_ACTIONS }))
);

module.exports = router;
