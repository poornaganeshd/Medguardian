# Testing

**26 suites · 409 tests · ~20 seconds**

```bash
cd backend
npm test
```

---

## 1. Three layers

The suite is split so that the parts worth testing most heavily are also the
parts that need the least infrastructure.

| Layer | Files | Needs MongoDB? | What it proves |
|-------|-------|----------------|----------------|
| **Unit** | 15 | No | The algorithms are correct |
| **Contract** | 1 | No | Routing, validation and auth middleware behave |
| **Integration** | 10 | Yes | The whole HTTP + database path works end to end |

### Why the split matters

The graded core of this project — the DRPA, the adherence score, the schedule
engine, the interaction lookup — is written as **pure functions**. They take
plain objects and return plain objects, so they can be tested directly with no
database, no fixtures, no mocking framework and no clock manipulation (`now` is
an argument).

That means the most important logic has the fastest, most thorough tests, and
those tests run identically on any machine.

---

## 2. Running it

```bash
npm test                    # everything
npm run test:watch          # re-run on change
npx jest tests/unit         # only the algorithms
npx jest tests/contract     # only routing/validation
npx jest tests/integration  # only database-backed flows

npx jest tests/unit/refillPredictionService   # just the DRPA
npx jest -t "skipped"                         # by test name
```

### Database-backed tests

`tests/setup.js` tries, in order:

1. `MONGO_TEST_URI` from the environment
2. `mongodb-memory-server` (downloads a `mongod` binary on first use)

If neither works it sets `global.__DB_AVAILABLE__ = false`, prints an
explanation, and suites wrapped in `describeIfDb` **skip rather than fail**.
The unit and contract layers still run, so the suite is green anywhere.

To be explicit about which database is used:

```bash
MONGO_TEST_URI=mongodb://127.0.0.1:27017/medguardian_test npm test
```

Collections are cleared between tests, so order never matters.

> **Note on this build environment.** The machine this project was built on had
> no MongoDB and its network policy blocked `fastdl.mongodb.org`, so
> `mongodb-memory-server` could not fetch a binary. The 10 integration suites
> were therefore written but **executed only in skip mode here**; the unit and
> contract layers were run in full on every phase. Run `npm test` with a local
> MongoDB to exercise them.

---

## 3. Unit tests — the algorithms

### `refillPredictionService.test.js` — DRPA (33 tests)

The most important suite in the project.

**The skipped-dose rule**
- Skipped doses are counted and reported but never deducted
- A patient who skips half their doses gets a **longer** supply estimate
- More skipping stretches supply further — the estimate tracks behaviour
- Missed (never recorded) doses also do not consume stock

**Rate selection**
- No history → the schedule alone (`basis: 'schedule_only'`)
- Short history → blended, confidence weight below 1
- 14+ observed days → observation dominates
- Twice-daily, alternate-day and weekday-only regimens each produce the right
  scheduled rate and days-of-supply

**Regression guards**
- Rejected with a stated reason when there are fewer than 7 observed days
- Rejected with a stated reason when r² < 0.30
- Features, coefficients, sample size and r² always reported
- A genuine rising trend is followed when the fit is strong

**Output**
- Run-out and threshold dates; suggested refill quantity for 30 days
- Urgency escalates correctly as supply shrinks
- No run-out date when nothing consumes the medicine; paused schedules ignored
- Horizon truncation flagged for a very large supply
- **Determinism** — identical inputs give byte-identical output
- The explanation mentions the skip rule and the effective rate

### `adherenceService.test.js` (26 tests)

- 100% when everything was taken; skipped doses count against the score
- Unrecorded past doses count as missed
- Taken / skipped / expected reported separately
- `null` (not 0, not 100) when nothing has been expected yet
- Doses later today excluded; still-actionable doses held out of the denominator
- As-needed medicines never contribute expected doses
- Per-medicine breakdown and chronological daily trend
- A dose taken after the grace window still counts as taken, but is flagged
- Label bands and window-over-window trend comparison

### `scheduleService.test.js` (24 tests)

- Each frequency type is due on the right days
- Start and end dates clip correctly
- One occurrence per time per due day, chronologically ordered
- Scheduled instants resolve in the **patient's** timezone (08:00 IST →
  02:30 UTC)
- Inactive schedules excluded unless explicitly requested
- `deriveStatus` transitions upcoming → due → late → missed as the clock moves
- A recorded intake always overrides the clock
- Intakes match occurrences only on the right `(schedule, date, time)`

### `intakeService.test.js` (20 tests)

The stock rules, exhaustively: taken deducts, skipped does not, taken→skipped
refunds, skipped→taken deducts, amended quantities apply only the difference,
deleting a taken record refunds, stock never goes negative and reports the
shortfall, lateness computed correctly including early doses.

### `drugInteractionService.test.js` (25 tests) + `drugNameNormalizer.test.js` (14)

Dataset integrity (demo flag, notice, unique ids, complete records, no
self-pairs); matching through brand names and combination products,
order-independent, severity-sorted; **no false positives** for unknown pairs;
determinism and verbatim fact copying; duplicate-therapy detection including
hidden paracetamol; normalisation of dosage strings, pack noise, brands and
combinations.

### `medicineInfoService.test.js` (31 tests)

- The knowledge base contains **no dose instructions anywhere** (asserted by
  regex across every entry)
- All ten refusal categories are refused with the right reason
- Refusal happens **before** retrieval, even for a medicine it knows
- Emergency questions flagged urgent; interaction questions redirected
- Answers copied verbatim from the corpus; unknown medicines return
  "not in the knowledge base" rather than a guess
- Determinism; `generatedByModel: false`

### `visitSummaryService.test.js` (14 tests)

- Sections detected correctly; medicines extracted with strength and frequency
- **Every returned line exists verbatim in the input** (asserted against a set
  of the source lines)
- Patient identifiers are stripped, never echoed
- `isDiagnostic: false`, `generatedByModel: false`; deterministic

### `insightsService.test.js` (20 tests)

- Every insight carries the rule that produced it
- **No medical condition is ever named** (asserted against a word list)
- Adherence bands, improving/declining trends, streaks, top skip reason with a
  practical suggestion, weakest medicine, refill urgency, and how skipping
  stretches supply

### `ocrService.test.js` (12) · `linearRegression.test.js` (8) · `fileService.test.js` (15) · `tokenService.test.js` (6) · validators (2 files)

Prescription parsing with strength/form/frequency capture and header
rejection; least-squares recovery of an exact line, r² behaviour and null cases;
**path traversal rejection (8 cases)**, EXIF stripping, thumbnail dimensions,
size capping; token type separation, rotation ids, hashing and tamper
rejection; password and payload validation rules.

---

## 4. Contract tests

`tests/contract/auth.contract.test.js` runs Supertest against the real Express
app but exercises only paths that reject before touching the database:

- Invalid payloads return 422 with per-field details
- **A submitted password is never echoed back in an error**
- Every protected route returns 401 without a token
- A malformed bearer token returns 401, not 500
- Malformed JSON returns 400 with `code: BAD_JSON`

These catch wiring mistakes — a route mounted at the wrong path, a missing
`protect`, a validator not applied — without needing infrastructure.

---

## 5. Integration tests

Full HTTP + MongoDB flows through the real app.

| Suite | Covers |
|-------|--------|
| `auth` | Registration, bcrypt storage, duplicate email, login, **no account enumeration**, refresh rotation + reuse revocation, logout, password change invalidating old tokens, lockout after 8 failures, PIN set/verify/change |
| `medicine` | CRUD, ownership isolation, search and refill filters, audit old/new values, re-normalisation on rename, **step-up required to delete**, a foreign step-up token rejected, stock refill/correction, image upload → WebP + thumbnail, image never served to another patient, non-image rejected |
| `schedule` | All frequency types, validation, pause/resume, cascade delete, occurrence feed with derived statuses, paused schedules excluded, **no cross-patient leakage** |
| *(intakes, in `schedule`)* | Taken deducts stock, **skipped does not**, taken→skipped refunds, invented slots and dates refused, skip reason required, stock floor with warning, as-needed daily cap, history filters |
| `analytics` | Adherence counts and breakdowns, DRPA response shape, skipped doses reflected in the inputs, overview sorted by urgency, empty-patient cases |
| `interaction` | Interaction found between two of the patient's medicines, none for unrelated ones, archived medicines excluded, ad-hoc name checks, demo-data disclosure |
| `record` | Create with and without a file, unsupported type rejected, filters, ownership isolation, view and download audit entries, sharing change logged distinctly, **step-up to delete**, attachment headers, OCR unsupported for PDF, **OCR never auto-creates medicines**, confirmation creates only accepted rows, rejectAll discards |
| `caregiver` | Invitation with hashed token, safe default permissions, self-invite and duplicate refused, **token bound to the invited email**, access enforcement per permission, shared-vs-sensitive record visibility, caregivers cannot edit, `canRecordIntake` enforced then granted, every access audited, **step-up to change permissions**, immediate revocation, permission-gated summary |
| `dashboard` | Assembles doses, adherence, stock, records and caregivers; refill warnings ordered; interaction alerts surfaced; recorded dose reflected; empty and cross-patient cases |
| `assistant` | Knowledge-base answers and refusals over HTTP, another patient's medicine refused, visit summary with reconciliation, insights for a real patient |
| `health` | Service and database status, 404 shape |

---

## 6. Conventions

**Helpers.** `tests/helpers/factories.js` provides `registerUser()`,
`authHeader()` and `getStepUpToken()` — real API calls, not database inserts,
so the tests exercise the same paths a client would.

**Fixed time.** Time-sensitive unit tests pass an explicit `now`, so they never
depend on when they run. The DRPA suite is anchored to `2026-03-31`.

**Determinism.** Several suites assert that identical inputs produce
byte-identical output. For an algorithm a reviewer must be able to trust, this
is a first-class property.

**Behaviour, not implementation.** Tests exercise public behaviour through the
service or HTTP boundary. Refactoring internals does not break them.

---

## 7. Frontend

The frontend is verified by the production build:

```bash
cd frontend
npm run build     # 130 modules, ~408 kB JS (123 kB gzipped)
```

This catches import errors, syntax errors and unresolved modules across every
page. A component-level test suite (React Testing Library) is the natural next
addition; the backend was prioritised because that is where the algorithms and
the security controls live.

---

## 8. Adding a test

**An algorithm** → `tests/unit/`. Import the service, call it with plain
objects, assert on the result. Pass `now` explicitly if time matters.

**A route's validation or auth** → `tests/contract/`. Supertest against
`src/app`, asserting the rejection.

**A full flow** → `tests/integration/`. Wrap in `describeIfDb` / `itIfDb` so it
skips gracefully without a database:

```js
const { describeIfDb, itIfDb } = require('../helpers/dbGuard');
const { registerUser, authHeader } = require('../helpers/factories');

describeIfDb('my feature', () => {
  itIfDb('does the thing', async () => {
    const session = await registerUser();
    await request(app).get('/api/thing').set(authHeader(session.accessToken)).expect(200);
  });
});
```
