# Architecture

How MedGuardian is put together, and why.

---

## 1. Shape of the system

```
┌──────────────────────────────────────────────────────────────┐
│  Browser — React 18 SPA (Vite)                               │
│                                                              │
│  pages/          one file per screen                         │
│  components/     layout, dose card, PIN gate, UI primitives  │
│  context/        AuthContext, ToastContext                   │
│  hooks/          useApi, useDoseRecorder, useStepUp          │
│  services/       axios client + endpoint wrappers            │
└───────────────────────────┬──────────────────────────────────┘
                            │ HTTPS, JSON
                            │ Authorization: Bearer <access>
                            │ x-step-up-token: <stepup>   (sensitive only)
┌───────────────────────────▼──────────────────────────────────┐
│  Express API                                                 │
│                                                              │
│  routes/       →  middleware/  →  controllers/  →  services/ │
│                   protect          HTTP concerns    algorithms│
│                   patientContext                    (pure)   │
│                   validate (zod)                             │
│                   requireStepUp                              │
│                   upload (multer)                            │
│                            │                                 │
│                       models/ (Mongoose)                     │
└───────────────────────────┬──────────────────────────────────┘
                            │
              ┌─────────────┴──────────────┐
              │                            │
        ┌─────▼──────┐            ┌────────▼─────────┐
        │  MongoDB   │            │  uploads/        │
        │            │            │  (outside any    │
        │            │            │   static route)  │
        └────────────┘            └──────────────────┘
```

In production the Express app also serves `frontend/dist`, so the whole system
runs from one origin on one port.

---

## 2. The layering rule

Each backend layer has one job, and the boundary is enforced by what each layer
is allowed to import.

| Layer | Responsibility | May import | Must not |
|-------|---------------|------------|----------|
| `routes/` | URL → middleware chain → controller | middleware, controllers, validators | contain logic |
| `middleware/` | Cross-cutting concerns | models, services, utils | know about a feature |
| `controllers/` | HTTP: read the request, call services, shape the response, write the audit entry | models, services, utils | contain algorithms |
| `services/` | Business logic and algorithms | models (sparingly), utils | touch `req` or `res` |
| `models/` | Schema, indexes, hooks, instance methods | utils | reach into services |
| `validators/` | Zod schemas | models (for enums) | anything else |
| `utils/` | Pure helpers | nothing project-specific | — |

### Why the algorithms are pure functions

The four pieces of real logic — schedule expansion, adherence scoring, the
DRPA, and the interaction engine — take plain objects and return plain objects.
They never query the database and never read the clock except through an
injected `now`.

This buys three things:

1. **They are directly unit-testable.** 33 DRPA tests, 26 adherence tests and
   24 scheduling tests run in about a second with no database, no fixtures and
   no mocking framework.
2. **They are explainable.** During a project review the DRPA can be traced
   from its inputs to its output without a running server.
3. **They cannot drift.** The reminder screen, the adherence score and the
   refill forecast all call the same `expandSchedule`, so "expected dose" means
   exactly one thing across the entire application.

The controller's job is to load the data, hand it to the service, and translate
the result into HTTP.

---

## 3. Data model

```
User ─────┬──< Medicine ──< Schedule ──< Intake
          │         │                      │
          │         └──────────────────────┘
          ├──< MedicalRecord
          ├──< CaregiverLink >── User (caregiver)
          └──< AuditLog
```

| Collection | Purpose | Notable design |
|------------|---------|----------------|
| `users` | Accounts, profile, security material | Password, PIN, refresh hashes and WebAuthn credentials all `select: false` |
| `medicines` | What the patient takes | `normalizedName` auto-synced for interaction matching; `needsRefill` / `isExpired` as virtuals |
| `schedules` | When to take it | Five frequency types; per-time dose quantities; `pre('validate')` enforces the fields each frequency needs |
| `intakes` | What the patient did | Only `taken` / `skipped` — derived states are never stored |
| `medicalrecords` | Documents | File sub-document with checksum; OCR sub-document with suggestions and verification state; private by default |
| `caregiverlinks` | Optional delegated access | Seven independent permissions; invite token stored only as a hash |
| `auditlogs` | Append-only trail | Update hooks throw; 40+ enumerated actions |

### The decision that shapes everything: doses are derived, not stored

A twice-daily medicine over a year is 730 dose occurrences. Storing every one
would mean a row per patient per dose per day forever, plus a background job to
create tomorrow's rows, plus a reconciliation problem whenever a schedule
changes retrospectively.

Instead, **only actions are stored**. A dose occurrence is computed at read time
by expanding the schedule over the requested window:

```js
expandSchedule(schedule, { from, to, timezone })
  → [{ scheduleId, medicineId, dateKey, time, scheduledAt, doseQuantity, graceMinutes }, …]
```

Stored intakes are then matched onto occurrences by
`(scheduleId, dateKey, time)`.

Consequences:

- The `intakes` collection grows with real activity, not with elapsed time.
- Editing a schedule immediately corrects history and future alike — there is
  nothing stale to migrate.
- There is no cron job, no queue and no background worker anywhere in the
  system.
- A dose's status is always current: `due` becomes `late` becomes `missed` as
  the clock moves, with no write.

The cost is that any window query does work proportional to its length. That is
bounded by a 400-day cap on the occurrence endpoint and a 180-day DRPA horizon,
and the expansion is cheap arithmetic.

### Derived vs. asserted status

`Intake.status` is limited to what the patient **asserts**: `taken` or
`skipped`. Everything else is **derived** from the clock:

| Status | Meaning |
|--------|---------|
| `upcoming` | The scheduled time has not arrived |
| `due` | Arrived, still inside the grace window |
| `late` | Grace window passed, same day, still actionable |
| `missed` | The day has ended with no record |
| `taken` / `skipped` | The patient said so |

Storing `late` would mean writing a row the moment a window expired, and that
row would be wrong the instant a grace period was edited. Deriving it keeps the
database and the clock permanently consistent.

---

## 4. Request lifecycle

A representative sensitive request — deleting a medicine:

```
DELETE /api/medicines/:id
   Authorization: Bearer <access>
   x-step-up-token: <stepup>

 1  helmet, cors, json, cookieParser, compression,
    mongoSanitize, hpp, morgan            app.js
 2  apiLimiter                             rate limiting
 3  protect                                verify access token → req.user
 4  resolvePatientContext({ permission })  → req.patientId (+ caregiver checks)
 5  validate({ params })                   zod → req.params replaced
 6  requireStepUp                          verify PIN/biometric token → req.stepUp
 7  deleteMedicine                         controller
      ├── findOwnedMedicine(id, patientId) 404 if not this patient's
      ├── fileService.removeStoredFile()   delete the photo
      ├── purgeMedicineDependencies()      cascade schedules + intakes
      ├── medicine.deleteOne()
      └── auditService.record()            MEDICINE_DELETED + old value
 8  ok(res, …)                             uniform success envelope
 -- on throw --
    errorHandler                           normalise → { success:false, message, code }
```

Every layer can reject, and each rejection is specific: 401 for a missing
token, 401 with `code: STEP_UP_REQUIRED` for a missing PIN confirmation, 403
for a permission failure, 404 for another patient's resource, 422 for a
validation failure.

---

## 5. Frontend structure

### State

No Redux, no React Query. Server state is fetched per screen with a small
race-safe hook:

```js
const { data, loading, error, reload } = useApi(() => medicineApi.list(filters), [filters]);
```

`useApi` tracks a request id and discards results from superseded requests, so
rapid filter changes cannot render stale data. Only genuinely global concerns —
the signed-in user and toasts — live in context.

For an application of this size that is the right trade: less indirection, and
every fetch is visible where it is used.

### The API client

`services/api.js` is the only place that knows about tokens.

- Attaches the access token, and any held step-up token, to every request.
- On a 401 it refreshes **once**, replays the original request, and shares a
  single in-flight refresh promise so concurrent 401s do not trigger a stampede.
- Distinguishes `STEP_UP_REQUIRED` from a genuine session failure — the first
  is a normal outcome that opens the PIN dialog, the second signs the user out.
- Normalises every failure into `{ message, status, code, details }`.

### Step-up as a UI pattern

```js
const stepUp = useStepUp();
await stepUp.run(() => medicineApi.remove(id), 'delete this medicine');
{stepUp.gateProps && <PinGate {...stepUp.gateProps} />}
```

`run` attempts the action optimistically. If the server answers
`STEP_UP_REQUIRED`, the hook captures the action, renders the PIN dialog, and
**replays it** once the user confirms. Callers never branch on whether a token
is already held.

---

## 6. Cross-cutting decisions

**Timezones.** Every calendar decision goes through `utils/dateTime.js` (dayjs
+ IANA zones) using the *patient's* timezone, not the server's or the
caregiver's. `"2026-03-15" + "08:00" + "Asia/Kolkata"` resolves to a specific
instant; a dose "today" means today where the patient lives.

**Uniform envelopes.** Success is always
`{ success: true, message, data }` and failure always
`{ success: false, message, code?, details? }`, so the client has one shape to
handle.

**Audit as a first-class concern.** `auditService.record()` is called from the
controller, not buried in a model hook, because the controller is the only
layer that knows *who* acted, *how* they authenticated and *what changed*.

**Demo data is labelled in the payload, not just the docs.** The interaction
dataset and knowledge base carry `isDemoData: true` and their notice in every
response, and the UI renders it. A user can never see a result without seeing
its provenance.

---

## 7. Notable trade-offs

| Decision | Chosen | Alternative | Why |
|----------|--------|-------------|-----|
| Dose occurrences | Derived at read time | Materialised rows | No background jobs; retrospective schedule edits just work |
| State management | `useApi` + context | Redux / React Query | Proportionate to the app's size; every fetch visible at its use site |
| Styling | Hand-written CSS | Tailwind / MUI | The entire visual language is inspectable in one file, which matters for an academic deliverable |
| Interactions | Dataset lookup | LLM | Determinism is a hard requirement; a confident wrong answer is worse than none |
| Regression | Written from scratch | ML library | ~40 lines, no dependency, fully auditable arithmetic |
| Reminders | Visual + browser notifications | Voice | Explicitly out of project scope |
| Auth storage | `localStorage` + hashed rotating refresh | `httpOnly` cookies only | Cookies are also set; token storage keeps the API usable from non-browser clients, with rotation and reuse detection limiting the exposure |

---

## 8. Extending it

**A new tracked entity** — add `models/X.js`, `validators/xValidators.js`,
`controllers/xController.js`, `routes/xRoutes.js`, register in
`routes/index.js`. Use `resolvePatientContext` so caregiver rules apply for
free.

**A new algorithm** — write it as a pure function in `services/`, unit-test it
directly, then call it from a controller. Do not reach for `req` inside it.

**A real interaction dataset** — transform the licensed source into the shape in
`data/drugInteractions.json` and set `isDemoData: false`. No engine changes.

**A new sensitive action** — add `requireStepUp` to the route and an action to
the `AUDIT_ACTIONS` enum. The frontend needs only `useStepUp`.
