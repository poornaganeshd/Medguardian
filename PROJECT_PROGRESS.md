# MedGuardian — Project Progress Tracker

> **How to use this file**
> This file is the single source of truth for build state. If a session ends,
> the next session must read this file, look at **NEXT TASK**, and continue
> from exactly that point. Update it after every phase.

- **Project:** MedGuardian – Intelligent Personal Medication and Medical Record Management Platform
- **Branch:** `claude/medguardian-build-5y6gi6`
- **Last updated:** Phase 2 complete

---

## Status legend
`[ ]` not started `[~]` in progress `[x]` complete & verified

---

## Phase checklist

| # | Phase | Status |
|---|-------|--------|
| 0 | Repo skeleton, .gitignore, .env.example, progress tracker | `[x]` |
| 1 | Backend scaffold + dependencies + MongoDB connection + server bootstrap | `[x]` |
| 2 | Authentication & authorization (JWT, bcrypt, roles, PIN step-up, WebAuthn) | `[x]` |
| 3 | Medicine CRUD | `[~]` |
| 4 | Medicine image upload + secure file serving | `[ ]` |
| 5 | Medication scheduling engine | `[ ]` |
| 6 | Visual reminders (dose occurrence generation) | `[ ]` |
| 7 | Intake tracking (TAKEN / SKIPPED / LATE / PENDING) | `[ ]` |
| 8 | Adherence score service | `[ ]` |
| 9 | DRPA – Dynamic Refill Prediction Algorithm | `[ ]` |
| 10 | Drug interaction rule/dataset engine | `[ ]` |
| 11 | Medical records + secure document storage | `[ ]` |
| 12 | OCR (Tesseract) + user verification workflow | `[ ]` |
| 13 | Caregiver module with granular permissions | `[ ]` |
| 14 | Medicine information assistant (curated KB retrieval) | `[ ]` |
| 15 | Visit / treatment summary | `[ ]` |
| 16 | Non-diagnostic health insights | `[ ]` |
| 17 | Audit logging & security hardening | `[ ]` |
| 18 | Frontend scaffold + routing + auth context | `[ ]` |
| 19 | Frontend feature pages (all screens) | `[ ]` |
| 20 | Testing & bug fixing | `[ ]` |
| 21 | Documentation (README, docs/) | `[ ]` |
| 22 | Production build + `MedGuardian_Final.zip` | `[ ]` |

---

## Completed work

### Phase 0 — Repository skeleton `[x]`
- Created directory layout: `backend/`, `frontend/`, `docs/`.
- Backend module folders: `config`, `models`, `controllers`, `routes`,
  `middleware`, `services`, `utils`, `data`, `validators`, `tests`.
- Frontend module folders: `pages`, `components`, `services`, `context`,
  `utils`, `styles`, `hooks`.
- Root `.gitignore` excluding `node_modules`, `.env`, uploads, build caches.
- `.env.example` at root, `backend/.env.example`, `frontend/.env.example`.
- This progress tracker.

### Phase 1 — Backend scaffold `[x]`
- `backend/package.json` with all runtime + dev dependencies installed.
- `src/config/env.js` — typed env loader, dev fallbacks, production secret guard.
- `src/config/logger.js` — levelled logger.
- `src/config/database.js` — idempotent Mongoose connection + graceful disconnect.
- `src/utils/ApiError.js`, `asyncHandler.js`, `apiResponse.js`.
- `src/middleware/errorHandler.js` (normalises Mongoose/JWT/Multer errors),
  `validate.js` (zod), `rateLimiter.js`.
- `src/app.js` — helmet, CORS allow-list, compression, mongo-sanitize, hpp,
  morgan, `/api` router, SPA static serving in production.
- `src/server.js` — bootstrap, upload-dir creation, graceful shutdown.
- `GET /api/health` route + passing tests.
- Adaptive Jest harness (`tests/setup.js`): uses `MONGO_TEST_URI` if set, else
  `mongodb-memory-server`, else skips DB-backed suites (see Notes).

**Verified:** `npm test` → 3 passed.

### Phase 2 — Authentication & authorization `[x]`
- `models/User.js` — bcrypt password + PIN hashes (never selected by default),
  roles (`patient` / `caregiver`), profile & notification preferences, WebAuthn
  credential sub-documents, refresh-token hashes, login lockout, `passwordChangedAfter`.
- `models/AuditLog.js` — append-only, 40+ enumerated actions, old/new value,
  auth method, IP + user agent; immutable (update hooks blocked).
- `services/auditService.js` — redacts secrets before writing, never throws.
- `services/tokenService.js` — access / refresh (separate secrets) / step-up tokens,
  refresh tokens stored only as SHA-256 hashes.
- `middleware/auth.js` — `protect`, `authorize(...roles)`, `requireStepUp`, `optionalAuth`.
- `controllers/authController.js` — register, login (generic failure message, lockout),
  refresh **with rotation + reuse detection**, logout, profile read/update,
  change password (revokes all sessions), set PIN, verify PIN (issues step-up token).
- `controllers/webauthnController.js` — platform-authenticator registration and
  assertion, issuing a step-up token on success.
- `routes/authRoutes.js`, `routes/auditRoutes.js`.
- Tests: 15 unit + 11 contract + 17 DB-guarded integration.

**Verified:** `npm test` → 44 passed (5 suites).

---

## NEXT TASK

**Phase 3 — Medicine CRUD.** Create `models/Medicine.js` (name, generic
name, strength, dosage form, instructions, prescriber notes, initial quantity,
current stock, refill threshold, image), medicine validators, controller
(list/filter/create/read/update/delete + stock adjustment) and routes. Then
Phase 4 adds image upload with sharp + multer.

---

## Notes / decisions
- Frontend built with **Vite + React 18** (fast dev server, modern tooling).
- MongoDB is **not reachable from the build container**: the egress policy
  blocks `fastdl.mongodb.org`, so `mongodb-memory-server` cannot fetch a
  `mongod` binary and no MongoDB package is installable. The test suite is
  therefore split into three layers:
  - `tests/unit/` — pure algorithm/service tests, always run.
  - `tests/contract/` — routing, validation and auth middleware via supertest,
    no database needed, always run.
  - `tests/integration/` — full HTTP + database flows, wrapped in
    `describeIfDb`. They run automatically on any machine with MongoDB:
    `MONGO_TEST_URI=mongodb://127.0.0.1:27017/medguardian_test npm test`.
- No doctor portal, no pharmacy integration, no voice reminders — visual
  (browser) reminders only, per project scope.
