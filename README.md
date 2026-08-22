# MedGuardian

**Intelligent Personal Medication and Medical Record Management Platform**

MedGuardian is a patient-centred web application for managing medicines, doses,
refills and medical documents. It gives a patient visual (never spoken)
reminders showing a photograph of the actual medicine, an honest adherence
score, a refill forecast built from what they really take, deterministic drug
interaction checking, secure document storage with OCR, and optional
finely-scoped caregiver access.

> **Scope.** MedGuardian is patient-centric by design. There is **no doctor
> portal**, **no pharmacy integration**, **no hospital-management dependency**
> and **no voice reminders**. It is a final-year academic project — not a
> medical device, and not a substitute for advice from a doctor or pharmacist.

---

## Table of contents

1. [Feature overview](#feature-overview)
2. [Tech stack](#tech-stack)
3. [Project structure](#project-structure)
4. [Prerequisites](#prerequisites)
5. [MongoDB setup](#mongodb-setup)
6. [Environment configuration](#environment-configuration)
7. [Running the application](#running-the-application)
8. [Demo data](#demo-data)
9. [Testing](#testing)
10. [Production build](#production-build)
11. [Algorithms](#algorithms)
12. [Security](#security)
13. [API reference](#api-reference)
14. [Documentation index](#documentation-index)
15. [Troubleshooting](#troubleshooting)

---

## Feature overview

| # | Feature | What it does |
|---|---------|--------------|
| 1 | **Authentication** | Registration, login, logout, JWT access + rotating refresh tokens, bcrypt hashing, protected routes, patient/caregiver roles, profile management, **PIN re-authentication** and **WebAuthn** biometric confirmation for sensitive actions |
| 2 | **Medicine management** | Full CRUD with name, generic name, strength, dosage form, instructions, prescriber notes, initial quantity, current stock, refill threshold and a **photograph** |
| 3 | **Scheduling** | Daily, specific weekdays, every N days, on/off cycles and as-needed; multiple reminder times each with its own dose; start/end dates; pause & resume |
| 4 | **Visual reminders** | Dose cards showing the patient's own photo of the medicine, plus optional browser notifications. **No audio or voice reminders anywhere** |
| 5 | **Intake tracking** | TAKEN / SKIPPED recorded by the patient; DUE / LATE / MISSED derived from the clock; timestamps, lateness, notes and full history |
| 6 | **Adherence score** | `taken ÷ (expected − pending) × 100`, with taken, skipped, missed and expected reported separately |
| 7 | **DRPA** | Dynamic Refill Prediction Algorithm — see [`docs/DRPA.md`](docs/DRPA.md) |
| 8 | **Drug interactions** | Deterministic lookup against a curated dataset — see [`docs/DRUG_INTERACTIONS.md`](docs/DRUG_INTERACTIONS.md) |
| 9 | **Medical records** | Prescriptions, pharmacy bills, lab reports, discharge summaries and more, with title, category, date, description, file, checksum and metadata |
| 10 | **OCR** | Tesseract text extraction with a rule-based medicine parser and a **mandatory user verification step** before anything is saved |
| 11 | **Caregiver module** | Optional, invitation-based, with seven individually-granted permissions and immediate revocation |
| 12 | **Medicine information** | Retrieval over a curated knowledge base with explicit refusal rules |
| 13 | **Visit summary** | Extractive, non-diagnostic reorganisation of a document the patient supplies |
| 14 | **Health insights** | Rule-based observations about medication *behaviour*, never health |
| 15 | **Audit & security** | Append-only log of every sensitive action with user, entity, old/new value, auth method and timestamp |
| 16 | **Dashboard** | Today's medicines, upcoming reminders, adherence, stock, refill warnings, interaction alerts, recent records and caregiver status |

---

## Tech stack

**Frontend** — React 18, React Router 6, Vite 5, Axios, Day.js, hand-written
CSS design system (no UI framework, so every style is inspectable).

**Backend** — Node.js 18+, Express 4, MongoDB with Mongoose 8, JSON Web
Tokens, bcryptjs, Multer, Sharp, Tesseract.js, Zod, Helmet,
express-rate-limit, express-mongo-sanitize, hpp, `@simplewebauthn/server`.

**Testing** — Jest + Supertest, with `mongodb-memory-server` for integration
runs.

---

## Project structure

```
MedGuardian/
├── backend/
│   ├── src/
│   │   ├── config/       env loader, logger, database connection
│   │   ├── models/       User, Medicine, Schedule, Intake,
│   │   │                 MedicalRecord, CaregiverLink, AuditLog
│   │   ├── controllers/  request handling per feature
│   │   ├── routes/       Express routers
│   │   ├── middleware/   auth, patient context, validation,
│   │   │                 uploads, rate limiting, error handling
│   │   ├── services/     the algorithms and business logic
│   │   ├── utils/        helpers, seeder
│   │   ├── validators/   Zod schemas
│   │   ├── data/         drug interaction dataset, medicine knowledge base
│   │   ├── app.js        Express application
│   │   └── server.js     bootstrap
│   ├── tests/
│   │   ├── unit/         pure algorithm tests (always run)
│   │   ├── contract/     routing/validation tests (no database needed)
│   │   ├── integration/  full HTTP + database tests
│   │   └── helpers/
│   └── uploads/          user files (git-ignored)
├── frontend/
│   ├── src/
│   │   ├── pages/        one file per screen
│   │   ├── components/   layout, dose card, PIN gate, UI primitives
│   │   ├── services/     API client and endpoint wrappers
│   │   ├── context/      auth and toast providers
│   │   ├── hooks/        useApi, useDoseRecorder, useStepUp
│   │   ├── utils/        formatting, WebAuthn helpers
│   │   └── styles/       the design system
│   └── index.html
├── docs/                 architecture, algorithms, security, API, testing
├── README.md
├── PROJECT_PROGRESS.md
└── .env.example
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for how the layers fit
together and why the algorithms are kept as pure functions.

---

## Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| Node.js | 18 or later | 20 LTS recommended |
| npm | 9 or later | ships with Node |
| MongoDB | 6.0 or later | local install or a free Atlas cluster |

Check what you have:

```bash
node --version
npm --version
mongod --version    # only if you installed MongoDB locally
```

---

## MongoDB setup

You need **one** of the following.

### Option A — local MongoDB (recommended for development)

**Windows**

1. Download the MongoDB Community Server MSI from
   <https://www.mongodb.com/try/download/community>.
2. Run the installer, choosing *Complete*, and tick **Install MongoDB as a
   Service**.
3. The service starts automatically. Verify:
   ```powershell
   mongosh
   ```

**macOS (Homebrew)**

```bash
brew tap mongodb/brew
brew install mongodb-community@7.0
brew services start mongodb-community@7.0
mongosh
```

**Ubuntu / Debian**

```bash
sudo apt-get install -y gnupg curl
curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc | \
  sudo gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg --dearmor
echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse" | \
  sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list
sudo apt-get update && sudo apt-get install -y mongodb-org
sudo systemctl start mongod && sudo systemctl enable mongod
mongosh
```

Your connection string is then:

```
MONGO_URI=mongodb://127.0.0.1:27017/medguardian
```

MedGuardian creates the `medguardian` database and all its collections and
indexes automatically on first run — there is no migration step.

### Option B — MongoDB Atlas (free tier, no local install)

1. Create a free account at <https://www.mongodb.com/cloud/atlas>.
2. Create an **M0** (free) cluster.
3. **Database Access** → add a user with a password.
4. **Network Access** → add your IP address (or `0.0.0.0/0` for a demo).
5. **Connect** → *Connect your application* → copy the connection string.

```
MONGO_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/medguardian?retryWrites=true&w=majority
```

### Option C — Docker

```bash
docker run -d --name medguardian-mongo -p 27017:27017 -v medguardian-data:/data/db mongo:7
```

---

## Environment configuration

The backend reads `backend/.env`. Copy the template and fill it in:

```bash
cp .env.example backend/.env
```

Generate two **different** strong secrets:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Minimum working configuration:

```env
NODE_ENV=development
PORT=5000
CLIENT_ORIGIN=http://localhost:5173
MONGO_URI=mongodb://127.0.0.1:27017/medguardian
JWT_SECRET=<first generated secret>
JWT_REFRESH_SECRET=<second generated secret>
```

Every available variable is documented in [`.env.example`](.env.example).

The frontend needs nothing in development (Vite proxies `/api` to port 5000).
For a separate deployment, copy `frontend/.env.example` to `frontend/.env` and
set `VITE_API_URL`.

> **Never commit a real `.env` file.** The repository's `.gitignore` already
> excludes it. In production the server **refuses to start** if `JWT_SECRET`,
> `JWT_REFRESH_SECRET` or `MONGO_URI` is missing, or if the two secrets are
> identical.

---

## Running the application

Open two terminals.

**Terminal 1 — backend**

```bash
cd backend
npm install
npm run dev          # nodemon, restarts on change
# or: npm start      # plain node
```

The API starts on <http://localhost:5000>. Check it:

```bash
curl http://localhost:5000/api/health
```

**Terminal 2 — frontend**

```bash
cd frontend
npm install
npm run dev
```

Open <http://localhost:5173>.

### All commands

| Where | Command | What it does |
|-------|---------|--------------|
| backend | `npm start` | Start the API |
| backend | `npm run dev` | Start with auto-restart |
| backend | `npm test` | Run the whole test suite |
| backend | `npm run test:watch` | Re-run tests on change |
| backend | `npm run seed` | Create the demo patient |
| backend | `npm run seed -- --reset` | Rebuild the demo patient |
| frontend | `npm run dev` | Vite dev server |
| frontend | `npm run build` | Production build into `dist/` |
| frontend | `npm run preview` | Serve the built app locally |

---

## Demo data

```bash
cd backend
npm run seed
```

This creates a patient with a month of realistic history:

- **Email:** `demo.patient@medguardian.local`
- **Password:** `Demo1234`

It is arranged so every feature has something to show:

- **Metformin** (twice daily, ~90% adherence) — a healthy baseline.
- **Ecosprin / aspirin** — deliberately low on stock, so the DRPA raises a
  refill warning.
- **Warfarin + Ecosprin together** — triggers a **major** interaction alert.
- **Atorvastatin** at ~60% adherence — the insights engine flags it as the
  medicine most often missed.
- **Paracetamol** as an as-needed medicine, with PRN doses recorded.
- Four medical records, one of them marked sensitive.

The seeder refuses to run if the database already contains other users, unless
you pass `--force`.

---

## Testing

```bash
cd backend
npm test
```

The suite has three layers:

| Layer | Location | Needs a database? |
|-------|----------|-------------------|
| **Unit** | `tests/unit/` | No — pure functions: DRPA, adherence, schedule expansion, interaction engine, OCR parsing, name normalisation, insights, visit summary, regression, token service |
| **Contract** | `tests/contract/` | No — routing, validation and auth middleware through Supertest |
| **Integration** | `tests/integration/` | Yes — full HTTP + MongoDB flows |

Integration suites are wrapped in `describeIfDb`, so they **run automatically
when a database is reachable** and are skipped (rather than failing) when one
is not. To be explicit about which database is used:

```bash
MONGO_TEST_URI=mongodb://127.0.0.1:27017/medguardian_test npm test
```

Run one area:

```bash
npx jest tests/unit/refillPredictionService   # the DRPA
npx jest tests/unit/drugInteractionService    # the interaction engine
npx jest tests/integration                    # everything database-backed
```

Full details, including what each suite proves, are in
[`docs/TESTING.md`](docs/TESTING.md).

---

## Production build

```bash
# 1. Build the frontend
cd frontend
npm run build          # emits frontend/dist/

# 2. Run the API in production mode
cd ../backend
NODE_ENV=production npm start
```

In production the backend also serves `frontend/dist`, so the whole
application runs from one origin on one port — no CORS configuration and no
second web server required. Any non-`/api` path falls through to the SPA's
`index.html` so client-side routing works on a hard refresh.

A production deployment checklist is in
[`docs/SECURITY.md`](docs/SECURITY.md#production-deployment-checklist).

---

## Algorithms

Two pieces of real algorithmic work sit at the centre of this project. Both are
implemented as **pure functions**, so they are unit-tested directly and can be
explained line by line.

### DRPA — Dynamic Refill Prediction Algorithm

Predicts when each medicine will run out, from what the patient **actually
takes** rather than what the prescription nominally calls for.

The rule the whole thing rests on:

> **A skipped dose is not consumed.** The tablet stays in the box, so it is
> never deducted from stock and never inflates the consumption rate.

Six steps: **expand → observe → rate → blend → project → report**. It computes
three candidate consumption rates (scheduled, observed average, and a
least-squares regression trend), blends observation with schedule according to
how much history exists, then walks the forecast forward day by day so that
alternate-day, weekday-only and cycle regimens stay honest. Linear regression
is applied **only** where it is genuinely useful — with at least 7 days of data
and r² ≥ 0.30 — and when it is rejected the response says exactly why.

Full walkthrough with worked examples: [`docs/DRPA.md`](docs/DRPA.md).

### Drug interaction engine

A **deterministic dataset lookup**. Medicine names are normalised to canonical
substances (dosage strings stripped, pack noise removed, brand names mapped,
combination products decomposed), then every pair is looked up in an indexed
dataset. Severity, description, mechanism and precautions are returned
**verbatim** from the dataset file.

No language model is involved at any point, and a pair that is absent returns
"no known interaction *in this dataset*" — never a guess.

Full explanation: [`docs/DRUG_INTERACTIONS.md`](docs/DRUG_INTERACTIONS.md).

### Adherence score

```
adherence % = taken ÷ (expected − pending) × 100
```

Doses still actionable right now are held out of the denominator, so the score
does not dip through the day and recover by evening. As-needed medicines
produce no expected doses. When nothing has been expected yet the score is
`null` — "no data" is not the same as "perfect" or "failed".

---

## Security

| Area | Implementation |
|------|----------------|
| Passwords | bcrypt, 12 rounds, never selected by default |
| PIN | Separate bcrypt hash, own attempt counter and lockout |
| Sessions | Short-lived JWT access tokens; refresh tokens stored only as SHA-256 hashes, **rotated on use with reuse detection** that revokes every session |
| Sensitive actions | PIN or WebAuthn **step-up** required to delete a medicine or record, or change caregiver permissions |
| Biometrics | WebAuthn platform authenticators; only public keys are stored |
| Access control | Role gates plus per-request ownership checks; caregivers need an accepted link **and** the specific permission |
| Files | Random filenames outside any static route, MIME allow-list, size cap, EXIF stripped from images, traversal-proof path resolution, always served as `attachment` with `nosniff` |
| Audit | Append-only log with user, action, entity, old/new value, auth method, IP and timestamp; secrets redacted before writing |
| Transport & headers | Helmet, CORS allow-list, rate limiting, `express-mongo-sanitize`, `hpp` |
| Secrets | Never in source; production boot fails if any are missing or duplicated |

Full detail, including the threat model and what is deliberately out of scope:
[`docs/SECURITY.md`](docs/SECURITY.md).

---

## API reference

All routes are under `/api`. Authenticated routes take
`Authorization: Bearer <accessToken>`; sensitive ones additionally take
`x-step-up-token`.

| Group | Base path | Purpose |
|-------|-----------|---------|
| Health | `/api/health` | Service and database status |
| Auth | `/api/auth` | Register, login, refresh, logout, profile, password, PIN, WebAuthn |
| Medicines | `/api/medicines` | CRUD, stock adjustment, image upload/serve/delete |
| Schedules | `/api/schedules` | CRUD, pause/resume, `/occurrences` dose feed |
| Intakes | `/api/intakes` | Record, amend, delete, as-needed dosing, history |
| Analytics | `/api/analytics` | Adherence report, DRPA refill prediction |
| Interactions | `/api/interactions` | Check own medicines, ad-hoc names, dataset provenance |
| Records | `/api/records` | CRUD, secure download, OCR, OCR confirmation |
| Caregivers | `/api/caregivers` | Invite, respond, permissions, revoke, patient summary |
| Assistant | `/api/assistant` | Medicine information, visit summary, insights |
| Dashboard | `/api/dashboard` | Everything the dashboard needs, in one call |
| Audit | `/api/audit` | The signed-in user's own activity log |

Every endpoint with its parameters, responses and error codes:
[`docs/API.md`](docs/API.md).

---

## Documentation index

| Document | Contents |
|----------|----------|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Layering, data model, request lifecycle, design decisions |
| [`docs/DRPA.md`](docs/DRPA.md) | The refill algorithm, step by step, with worked examples |
| [`docs/DRUG_INTERACTIONS.md`](docs/DRUG_INTERACTIONS.md) | Dataset format, normalisation, matching, provenance |
| [`docs/SECURITY.md`](docs/SECURITY.md) | Threat model, controls, audit design, deployment checklist |
| [`docs/API.md`](docs/API.md) | Complete endpoint reference |
| [`docs/TESTING.md`](docs/TESTING.md) | Test strategy and what each suite proves |
| [`PROJECT_PROGRESS.md`](PROJECT_PROGRESS.md) | Build log — every phase and what it delivered |

---

## Troubleshooting

**`MongooseServerSelectionError` on startup**
MongoDB is not running or `MONGO_URI` is wrong. Start the service
(`sudo systemctl start mongod`, `brew services start mongodb-community`, or the
Windows service) and confirm with `mongosh`. On Atlas, check your IP is on the
Network Access allow-list.

**`Missing required production environment variables`**
You set `NODE_ENV=production` without `JWT_SECRET`, `JWT_REFRESH_SECRET` and
`MONGO_URI`. This guard is deliberate — set them rather than removing it.

**CORS errors in the browser**
Add your frontend origin to `CLIENT_ORIGIN` in `backend/.env` (comma-separated
for several) and restart the API.

**Database-backed tests are skipped**
No MongoDB was reachable. Start one and re-run with
`MONGO_TEST_URI=mongodb://127.0.0.1:27017/medguardian_test npm test`. The unit
and contract layers run regardless.

**OCR is slow on the first run**
Tesseract.js downloads its language data the first time it runs, then caches
it. Subsequent runs are much faster. Set `OCR_ENABLED=false` to disable it.

**`sharp` fails to install**
Install with `npm install --include=optional sharp`, or on Linux install the
build tools (`sudo apt-get install -y build-essential libvips-dev`).

**Uploaded images do not appear**
Images are served through an authenticated endpoint, not a static path. Make
sure the request carries the access token — the frontend's API client does this
automatically.

---

## Licence and disclaimer

Built as a final-year academic project.

The bundled drug interaction dataset and medicine knowledge base are **clearly
marked demonstration content**, compiled for teaching purposes. They are not
complete or clinically validated and must not be used to make treatment
decisions. Replace them with a licensed source before any real-world use.

MedGuardian does not diagnose, prescribe, or replace professional medical
advice. Always consult a qualified doctor or pharmacist.
