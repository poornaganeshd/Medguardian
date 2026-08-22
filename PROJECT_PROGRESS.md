# MedGuardian — Project Progress Tracker

> **How to use this file**
> This file is the single source of truth for build state. If a session ends,
> the next session must read this file, look at **NEXT TASK**, and continue
> from exactly that point. Update it after every phase.

- **Project:** MedGuardian – Intelligent Personal Medication and Medical Record Management Platform
- **Branch:** `claude/medguardian-build-5y6gi6`
- **Last updated:** Phase 1 complete

---

## Status legend
`[ ]` not started `[~]` in progress `[x]` complete & verified

---

## Phase checklist

| # | Phase | Status |
|---|-------|--------|
| 0 | Repo skeleton, .gitignore, .env.example, progress tracker | `[x]` |
| 1 | Backend scaffold + dependencies + MongoDB connection + server bootstrap | `[x]` |
| 2 | Authentication & authorization (JWT, bcrypt, roles, PIN step-up, WebAuthn) | `[~]` |
| 3 | Medicine CRUD | `[ ]` |
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

---

## NEXT TASK

**Phase 2 — Authentication & authorization.** Build `User` model (bcrypt
password + PIN hash, roles, lockout), `AuditLog` model, token service, auth
controller/routes (register, login, refresh, logout, profile, change password,
set/verify PIN), `protect` / `authorize` / `requireStepUp` middleware, and
WebAuthn credential registration + assertion. Then add auth tests.

---

## Notes / decisions
- Frontend built with **Vite + React 18** (fast dev server, modern tooling).
- MongoDB is **not installed in the build container**; automated tests use
  `mongodb-memory-server` so the suite runs without an external database.
- No doctor portal, no pharmacy integration, no voice reminders — visual
  (browser) reminders only, per project scope.
