# MedGuardian — Project Progress Tracker

> **How to use this file**
> This file is the single source of truth for build state. If a session ends,
> the next session must read this file, look at **NEXT TASK**, and continue
> from exactly that point. Update it after every phase.

- **Project:** MedGuardian – Intelligent Personal Medication and Medical Record Management Platform
- **Branch:** `claude/medguardian-build-5y6gi6`
- **Last updated:** Phase 21 complete — documentation done, packaging next

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
| 5 | Medication scheduling engine | `[x]` |
| 6 | Visual reminders (dose occurrence generation) | `[x]` |
| 7 | Intake tracking (TAKEN / SKIPPED / LATE / PENDING) | `[x]` |
| 8 | Adherence score service | `[x]` |
| 9 | DRPA – Dynamic Refill Prediction Algorithm | `[x]` |
| 10 | Drug interaction rule/dataset engine | `[x]` |
| 11 | Medical records + secure document storage | `[x]` |
| 12 | OCR (Tesseract) + user verification workflow | `[x]` |
| 13 | Caregiver module with granular permissions | `[x]` |
| 14 | Medicine information assistant (curated KB retrieval) | `[x]` |
| 15 | Visit / treatment summary | `[x]` |
| 16 | Non-diagnostic health insights | `[x]` |
| 17 | Audit logging & security hardening | `[x]` |
| 18 | Frontend scaffold + routing + auth context | `[x]` |
| 19 | Frontend feature pages (all screens) | `[x]` |
| 20 | Testing & bug fixing | `[x]` |
| 21 | Documentation (README, docs/) | `[x]` |
| 22 | Production build + `MedGuardian_Final.zip` | `[~]` |

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

### Phase 5-6 — Scheduling engine & dose occurrences `[x]`
- `models/Schedule.js` — five frequencies (`daily`, `specific_days`,
  `interval`, `cycle`, `as_needed`), multiple reminder times each with their
  own dose quantity, start/end date, meal relation, grace window, pause state.
- `utils/dateTime.js` — timezone-correct calendar helpers (dayjs + IANA zones).
- `services/scheduleService.js` — **pure functions**: `isDueOnDate`,
  `expandSchedule(s)`, `deriveStatus`, `attachIntakes`. Dose occurrences are
  *derived, never stored*, so the reminder feed, adherence score and DRPA all
  share one definition of "expected dose".
- `GET /api/schedules/occurrences` — the feed powering visual reminders and
  medication history, returning each dose with its medicine (image included)
  and derived status.

### Phase 7 — Intake tracking `[x]`
- `models/Intake.js` — stores only what the patient asserts (`taken` /
  `skipped`); `due` / `late` / `missed` are derived from the clock. Unique
  index per (schedule, date, time) with as-needed doses excluded.
- `services/intakeService.js` — **pure stock rules**: only a `taken` dose
  consumes stock; correcting taken→skipped refunds it; stock never goes
  negative and reports a shortfall instead.
- `controllers/intakeController.js` — record, amend, delete, as-needed dosing
  with a daily cap, and full medication history with filters.
- Server-side validation that the slot really exists in the schedule, so a
  client cannot invent doses to inflate its adherence score.

**Verified:** `npm test` → 165 passed (12 suites).

### Phase 8 — Adherence score `[x]`
- `services/adherenceService.js` — pure module. Explicit definitions:
  `expected`, `taken`, `skipped`, `missed`, `pending`, and
  **adherence % = taken / (expected − pending) × 100**. Doses still actionable
  today are held out of the denominator so the score does not dip and recover
  through the day; "no data" is reported as `null`, never as 0 or 100.
  As-needed medicines never contribute expected doses.
- Per-medicine breakdown, chronological daily trend, `labelFor` bands
  (excellent ≥95, good ≥80, fair ≥60, else needs_attention), `compareWindows`
  for trend direction.

### Phase 9 — DRPA `[x]`
- `services/linearRegression.js` — least-squares fit written from first
  principles (slope, intercept, r², n). No ML library, no external weights.
- `services/refillPredictionService.js` — the six-step DRPA:
  **1 Expand → 2 Observe → 3 Rate → 4 Blend → 5 Project → 6 Report.**
  - **Skipped doses are never deducted** and never inflate the consumption rate.
  - Days with no recorded action are treated as *unknown*, not as zero
    consumption (counting them as zero would tell a non-logging patient their
    supply lasts forever).
  - Three candidate rates: scheduled, observed average, regression trend.
    The trend is used only with ≥7 observed days **and** r² ≥ 0.30; otherwise
    the reason it was rejected is returned in the response.
  - Confidence blend `w = min(1, observedDays/14)` between observation and
    schedule, so day-one forecasts are not wild.
  - Day-by-day forward projection that respects alternate-day, weekday-only
    and cycle regimens instead of smoothing them into an average.
  - Output includes every input, both coefficients, r², urgency, run-out and
    threshold dates, a suggested refill quantity and a plain-language
    explanation array suitable for a project viva.
- `GET /api/analytics/adherence`, `GET /api/analytics/refill`,
  `GET /api/analytics/refill/:medicineId`.

**Verified:** `npm test` → 242 passed (16 suites), including 33 DRPA tests and
26 adherence tests.

### Phase 10 — Drug interaction engine `[x]`
- `data/drugInteractions.json` — 30 curated interaction records + 5 duplicate
  therapy groups. **Explicitly flagged `isDemoData: true`** with a prominent
  notice, source notes and a statement that no record was LLM-generated.
  Same record shape as a licensed dataset, so it can be swapped out.
- `services/drugInteractionService.js` — deterministic O(1) index lookup on
  normalised names, order-independent pair keys, combination-product
  decomposition, severity ranking, duplicate-therapy detection (including
  hidden paracetamol), verbatim fact copying, demo notice + disclaimer on
  every response, `method: 'deterministic-dataset-lookup'`,
  `llmInvolved: false`.
- `GET /api/interactions/my-medicines`, `POST /api/interactions/check`
  (ad-hoc names, optionally combined with the patient's list),
  `GET /api/interactions/dataset` (provenance).

**Verified:** `npm test` → 275 passed (18 suites).

### Phase 11 — Medical records `[x]`
- `models/MedicalRecord.js` — title, 10 categories (prescription, pharmacy
  bill, lab report, discharge summary, imaging, vaccination, insurance,
  referral, consultation note, other), record date, description, provider,
  doctor, free-form metadata map, tags, linked medicines, file sub-document
  (checksum + authenticated URL), OCR sub-document, `shareableWithCaregivers`
  (default **false**) and `isSensitive`.
- Controller: list with category/tag/date/search filters, create with upload,
  read (audit-logged view), update (sharing changes logged distinctly),
  delete (**PIN step-up required**), authenticated download.
- Download hardening: ownership re-checked per request, `Content-Disposition:
  attachment` always, `X-Content-Type-Options: nosniff`, `Cache-Control:
  no-store`, and every download written to the audit log.
- Caregivers see only records the patient marked shareable and never a record
  flagged sensitive; they cannot edit or delete.

### Phase 12 — OCR + verification `[x]`
- `services/ocrService.js` — Tesseract.js with a sharp pre-processing pass
  (greyscale, contrast normalise, upscale) and a **regex/dictionary parser**
  that extracts candidate medicines with strength, dosage form and frequency
  hints. Confidence is a transparent additive score, not a model output.
- **OCR output is never trusted.** Suggestions are stored as
  `awaiting_verification`; medicines are created only by
  `POST /api/records/:id/ocr/confirm`, from the entries in *that request*, so
  the user can correct anything OCR got wrong. `rejectAll` discards everything.
- `POST /api/records/:id/ocr` re-runs extraction on demand. PDFs are reported
  as `unsupported` with a helpful message rather than failing the upload.

**Verified:** `npm test` → 303 passed (20 suites).

### Phase 13 — Caregiver module `[x]`
- `models/CaregiverLink.js` — patient↔caregiver link with status
  (invited/accepted/declined/revoked), 7 granular permissions, relationship,
  and an invite token stored **only as a SHA-256 hash** with a 14-day expiry.
- Safe defaults: medicines / schedules / adherence visible; **`viewRecords`
  and `canRecordIntake` default to false** and must be granted deliberately.
  There is no "full access" switch anywhere in the system.
- Invitations are bound to the email they were addressed to — presenting a
  valid token from a different account is refused and audit-logged.
- Changing permissions requires **PIN / biometric step-up**; either side can
  revoke, and revocation takes effect on the next request.
- `GET /api/caregivers/patients/:id/summary` — read-only patient view where
  each section is gated on its own permission.
- Every caregiver read of patient data writes a
  `CAREGIVER_ACCESSED_PATIENT_DATA` audit entry.

**Verified:** `npm test` → 325 passed (21 suites).

### Phase 14 — Medicine information assistant `[x]`
- `data/medicineKnowledgeBase.json` — 16 curated, patient-facing entries
  (uses, how it works, general precautions, storage, common side effects,
  when to seek help). Marked demo data; **contains no doses anywhere** (a test
  enforces this).
- `services/medicineInfoService.js` — **retrieval, not generation**. Order of
  operations: refuse → retrieve → ground.
  - 7 refusal rule sets: diagnosis, prescribing, dosage change,
    stop/continue, interaction (redirects to the Phase 10 dataset engine),
    emergency (flagged urgent), personal circumstance.
  - Retrieval by exact substance, alias, then transparent keyword scoring.
  - A medicine absent from the corpus returns "not in the knowledge base" —
    never an invented answer. `generatedByModel: false` on every response.

### Phase 15 — Visit / treatment summary `[x]`
- `services/visitSummaryService.js` — **extractive** rule-based sectioning
  (medications, follow-up, investigations, advice, symptoms, observations,
  clinician notes). Every returned line is verbatim from the source; a test
  asserts no line exists that was not in the input. Patient identifiers are
  stripped, never echoed. `isDiagnostic: false`.
- Medicine reconciliation: compares the document's medicines against the
  patient's list (in both / document only / list only) as a **name comparison
  only**, with no clinical judgement.

### Phase 16 — Non-diagnostic health insights `[x]`
- `services/insightsService.js` — every insight comes from an explicit
  threshold rule which is returned alongside it (`rule` field). Covers
  adherence band, 30-vs-30-day trend, late doses, best streak, top skip reason
  with practical suggestion, weakest medicine, refill urgency, and how skipping
  stretches supply. A test asserts no medical condition is ever named.

### Phase 17 — Dashboard + audit/security `[x]`
- `GET /api/dashboard` — one call assembling today's doses, upcoming
  reminders, adherence, stock, refill warnings, interaction alerts, recent
  records and caregiver status.
- Audit logging is wired through every sensitive path (auth, medicines,
  schedules, intakes, records, file downloads, OCR, caregiver permissions).

**Verified:** `npm test` → 409 passed (26 suites). **Backend is complete.**

### Backend API surface
`/api/health`, `/api/auth/*`, `/api/audit`, `/api/medicines`,
`/api/schedules` (+`/occurrences`), `/api/intakes`, `/api/analytics`
(adherence + DRPA refill), `/api/interactions`, `/api/records`,
`/api/caregivers`, `/api/assistant` (medicine-info, visit-summary, insights),
`/api/dashboard`.

### Phase 18 — Frontend scaffold `[x]`
- Vite + React 18 + React Router 6, `vite.config.js` with an `/api` dev proxy.
- `styles/global.css` — a 630-line design system (tokens, layout, cards,
  forms, badges, alerts, tables, dose cards, charts, modals, toasts), fully
  responsive with print and reduced-motion support.
- `services/api.js` — axios client attaching the access token and any held
  step-up token, with **single-flight refresh + replay** on 401 and a
  normalised error shape. Refresh tokens in `localStorage`, step-up tokens in
  `sessionStorage` (short-lived by design).
- `services/endpoints.js` — every API route in one file.
- `context/AuthContext.jsx` (re-validates the stored session on load),
  `context/ToastContext.jsx`, `components/ErrorBoundary.jsx`,
  `components/ProtectedRoute.jsx`, `components/AppLayout.jsx` (sidebar +
  topbar + mobile drawer), `components/ui/index.jsx` (shared primitives).
- `hooks/useApi.js` (race-safe), `hooks/useDoseRecorder.js`,
  `hooks/useStepUp.js` (catches `STEP_UP_REQUIRED`, shows the PIN dialog,
  replays the action).
- `utils/format.js`, `utils/webauthn.js` (hand-written base64url helpers).

### Phase 19 — Frontend pages `[x]`
All 21 screens: Landing, Login, Register, Dashboard, Reminders, Medicines,
MedicineForm (add/edit), MedicineDetails, Schedules, History, Adherence
(+ DRPA explainer), Interactions, Records, RecordDetails, OcrVerification,
Caregivers, MedicineInfo, VisitSummary, Insights, Profile (4 tabs incl. the
audit log), NotFound — plus a global error boundary.

Notable UI decisions:
- **DoseCard** shows the patient's own photo of the medicine — this is the
  visual reminder that replaces voice alerts (explicit project scope).
- Browser notifications are requested on the Reminders screen and fired when a
  dose becomes due; no audio anywhere.
- The DRPA panel exposes every rate, the confidence weight, the regression
  coefficients (or the reason the fit was rejected) and the plain-language
  explanation — the algorithm is presentable in a viva straight from the UI.
- **OcrVerification** starts every suggestion *unchecked* and every field
  editable; only ticked rows are sent.
- Caregiver permission changes and destructive deletes route through
  `useStepUp` → `PinGate`.

**Verified:** `npm run build` → clean (130 modules, 408 kB JS / 123 kB gzip),
backend `npm test` → 409 passed.

### Phase 20 — Testing `[x]`
- 26 suites, **409 tests**, ~17 s. Three layers (unit / contract / integration).
- Bugs found and fixed by tests during the build:
  - DRPA treated unrecorded days as zero consumption → a non-logging patient
    was told their supply lasted forever. Now only days with a recorded action
    count as observed.
  - DRPA consumed stock on days an alternate-day regimen was not due →
    predicted 13 days instead of 20. The flat rate now applies only when there
    is no fixed schedule at all.
  - Timezone off-by-one in the forecast window inflated `scheduledPerDay` by
    ~0.5%. Range construction now goes through the patient-timezone helpers.
  - `fileService.resolveStoredPath` accepted a percent-encoded traversal string
    as a literal filename. Now a strict `[A-Za-z0-9._-]+` allow-list.
- `src/utils/seed.js` — deterministic demo patient with a month of history,
  arranged so every feature has something to show (see README).

### Phase 21 — Documentation `[x]`
~3,000 lines across:
- **README.md** — features, stack, structure, prerequisites, MongoDB setup for
  Windows/macOS/Linux/Atlas/Docker, env config, run commands, demo data,
  testing, production build, algorithm summaries, security summary, API map,
  troubleshooting.
- **docs/ARCHITECTURE.md** — layering rules, data model, why doses are derived
  rather than stored, request lifecycle, frontend structure, trade-offs.
- **docs/DRPA.md** — the six steps, the skipped-dose rule, the regression
  guards and why it is not called AI, two defended design decisions, a full
  worked example, urgency bands, constants, test properties.
- **docs/DRUG_INTERACTIONS.md** — dataset provenance and format, the
  normalisation pipeline, matching algorithm, endpoints, where the assistant
  defers, and an honest limitations section.
- **docs/SECURITY.md** — threat model, auth, tokens, PIN/WebAuthn step-up,
  authorization layers, file security, audit design, AI safety boundaries,
  production checklist, and what is deliberately out of scope.
- **docs/API.md** — every endpoint with parameters, payloads and error codes.
- **docs/TESTING.md** — strategy and what each suite proves.

---

## NEXT TASK

**Phase 22 — Package.** Produce `MedGuardian_Final.zip` containing the full
source and documentation, excluding `node_modules`, `.env`, `uploads/*`,
`dist/`, `coverage/` and OS/editor cruft. Verify the archive's contents and
size, then do a final full-suite + build run.

<details>
<summary>Original Phase 14 task text (completed)</summary>

**Phase 14 — Medicine information assistant.** Create
`data/medicineKnowledgeBase.json` (curated, clearly-sourced entries: general
description, common uses, general precautions, storage, common side effects,
"talk to your doctor if…"), and `services/medicineInfoService.js` implementing
**retrieval over that curated corpus only** — normalised-name exact match plus
a transparent keyword/TF-style scorer for free-text questions. It must refuse
diagnosis, prescribing and dosage-change questions via an explicit refusal
rule set, and must never answer an interaction question itself (it defers to
the Phase 10 dataset engine). Then routes + unit tests. Phases 15-16 follow:
visit summary (extractive, non-diagnostic) and health insights.

</details>

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
