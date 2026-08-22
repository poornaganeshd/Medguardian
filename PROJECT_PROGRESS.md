# MedGuardian — Project Progress Tracker

> **How to use this file**
> This file is the single source of truth for build state. If a session ends,
> the next session must read this file, look at **NEXT TASK**, and continue
> from exactly that point. Update it after every phase.

- **Project:** MedGuardian – Intelligent Personal Medication and Medical Record Management Platform
- **Branch:** `claude/medguardian-build-5y6gi6`
- **Last updated:** Phase 4 complete

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
| 3 | Medicine CRUD | `[x]` |
| 4 | Medicine image upload + secure file serving | `[x]` |
| 5 | Medication scheduling engine | `[~]` |
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

### Phase 3 — Medicine CRUD `[x]`
- `models/Medicine.js` — identity (name, generic name, normalised name,
  manufacturer), presentation (strength, dosage form, unit, colour, shape),
  guidance (instructions, prescriber notes, prescriber, purpose, storage),
  stock (initial quantity, current stock, refill threshold, last refill,
  expiry), image sub-document, `needsRefill` / `isExpired` / `displayName`
  virtuals, auto-synced `normalizedName`.
- `utils/drugNameNormalizer.js` — deterministic rule-based normalisation
  (dosage stripping, pack-noise removal, brand→generic map, order-independent
  combination keys). Shared by medicines and the interaction engine.
- `validators/medicineValidators.js`, `controllers/medicineController.js`
  (list with search/filter/sort/pagination, get, create, update, delete,
  stock adjust), `routes/medicineRoutes.js`.
- `middleware/patientContext.js` — resolves the target patient and enforces
  caregiver permissions (used by every patient-scoped module from here on).
- `services/medicineCleanupService.js` — cascades deletes to schedules/intakes.
- Deleting a medicine requires PIN/biometric **step-up**.

### Phase 4 — Medicine image upload `[x]`
- `middleware/upload.js` — multer disk storage with random filenames, MIME
  allow-list and size cap, outside any statically served directory.
- `services/fileService.js` — sharp pipeline producing a normalised 1024px
  webp + 320px square thumbnail with **EXIF stripped**; strict filename
  allow-list and traversal-proof path resolution; safe deletion.
- `POST/GET/DELETE /api/medicines/:id/image` — images are served only through
  an authenticated endpoint that re-checks ownership on every request.

**Verified:** `npm test` → 100 passed (9 suites).

---

## NEXT TASK

**Phase 5 — Medication scheduling engine.** Create `models/Schedule.js`
(frequency: daily / specific days / interval / as-needed, multiple reminder
times, dose quantity, start & end date, active flag) plus
`services/scheduleService.js` that expands a schedule into concrete dose
occurrences for a date range (pure function → unit-testable without a
database). Then validators, controller, routes and tests.

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
