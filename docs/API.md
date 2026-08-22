# API Reference

Base URL: `http://localhost:5000/api` (development)

---

## Conventions

**Success**

```json
{ "success": true, "message": "OK", "data": { } }
```

**Failure**

```json
{ "success": false, "message": "Human readable", "code": "OPTIONAL_CODE",
  "details": [ { "field": "body.email", "message": "…" } ] }
```

**Headers**

| Header | When |
|--------|------|
| `Authorization: Bearer <accessToken>` | Every authenticated route |
| `x-step-up-token: <stepUpToken>` | Sensitive routes (marked 🔐 below) |
| `Content-Type: multipart/form-data` | File uploads |

**Status codes**

| Code | Meaning |
|------|---------|
| 200 / 201 | Success |
| 400 | Bad request |
| 401 | Not authenticated, or `code: STEP_UP_REQUIRED` |
| 403 | Authenticated but not permitted |
| 404 | Not found, or not yours |
| 409 | Conflict (duplicate) |
| 422 | Validation failed — see `details` |
| 429 | Rate limited or account locked |

**Caregiver access.** Any patient-scoped route accepts `patientId` (query or
body). Patients may only pass their own id; caregivers must pass one and hold
an accepted link plus the relevant permission.

---

## Health

### `GET /health`

No authentication.

```json
{ "success": true, "data": {
  "service": "medguardian-api", "status": "up",
  "database": "connected", "uptimeSeconds": 142,
  "timestamp": "2026-03-31T10:00:00.000Z" } }
```

---

## Auth — `/api/auth`

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/register` | — | Create an account |
| POST | `/login` | — | Sign in |
| POST | `/refresh` | — | Rotate tokens |
| POST | `/logout` | ✅ | End this session (omit the token to end all) |
| GET | `/me` | ✅ | Current profile |
| PATCH | `/me` | ✅ | Update profile |
| POST | `/change-password` | ✅ | Change password (revokes all sessions) |
| POST | `/pin` | ✅ | Set or change the security PIN |
| POST | `/pin/verify` | ✅ | Verify PIN → step-up token |
| POST | `/webauthn/register/options` | ✅ | Begin biometric registration |
| POST | `/webauthn/register/verify` | ✅ | Complete biometric registration |
| POST | `/webauthn/authenticate/options` | ✅ | Begin biometric verification |
| POST | `/webauthn/authenticate/verify` | ✅ | Complete → step-up token |
| DELETE | `/webauthn/:credentialId` | ✅ | Remove a registered device |

### `POST /auth/register`

```json
{ "name": "Asha Menon", "email": "asha@example.com",
  "password": "Str0ngPass", "role": "patient",
  "phone": "+91 98765 43210", "timezone": "Asia/Kolkata" }
```

Password: ≥ 8 characters with upper case, lower case and a digit.
Role: `patient` (default) or `caregiver`.

**201** → `{ user, accessToken, refreshToken }`
**409** → email already registered

### `POST /auth/login`

```json
{ "email": "asha@example.com", "password": "Str0ngPass" }
```

**200** → `{ user, accessToken, refreshToken }`
**401** → `"Invalid email or password"` (identical for a wrong password and an
unknown email — no account enumeration)
**429** → locked after 8 failures for 15 minutes

### `POST /auth/refresh`

`{ "refreshToken": "…" }` — or the `refreshToken` cookie.

**200** → `{ accessToken, refreshToken }` (both rotated)
**401** → invalid, or **reuse detected** — every session for the account is
revoked

### `POST /auth/pin`

```json
{ "pin": "4821", "currentPin": "1234", "password": "Str0ngPass" }
```

`password` is always required. `currentPin` is required only when changing an
existing PIN. PIN: 4–8 digits, not all identical.

### `POST /auth/pin/verify`

`{ "pin": "4821" }` →
`{ "stepUpToken": "…", "expiresInMinutes": 10, "method": "pin" }`

**429** after 5 wrong attempts (15-minute lock).

---

## Medicines — `/api/medicines`

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/` | List with filters |
| POST | `/` | Create |
| GET | `/:id` | Read |
| PATCH | `/:id` | Update |
| DELETE | `/:id` 🔐 | Delete (cascades schedules + intakes) |
| POST | `/:id/stock` | Refill or correct stock |
| GET | `/:id/image` | Serve the photo |
| POST | `/:id/image` | Upload a photo |
| DELETE | `/:id/image` | Remove the photo |

### `GET /medicines`

| Query | Values | Default |
|-------|--------|---------|
| `page`, `limit` | 1+, 1–100 | 1, 20 |
| `search` | Name, generic name or purpose | — |
| `dosageForm` | tablet, capsule, syrup, … | — |
| `status` | `active` / `inactive` / `all` | `active` |
| `needsRefill` | `true` / `false` | — |
| `sort` | `name`, `-name`, `createdAt`, `-createdAt`, `currentStock`, `-currentStock` | `name` |

→ `{ items, total, page, limit, pages }`

### `POST /medicines`

```json
{ "name": "Metformin", "genericName": "Metformin Hydrochloride",
  "strength": "500 mg", "dosageForm": "tablet", "unit": "tablet",
  "instructions": "Take one tablet after breakfast",
  "prescriberNotes": "Review HbA1c in 3 months",
  "initialQuantity": 60, "currentStock": 60, "refillThreshold": 10,
  "expiryDate": "2027-06-30" }
```

Only `name` is required. `currentStock` defaults to `initialQuantity`, and may
not exceed it.

### `POST /medicines/:id/stock`

```json
{ "mode": "refill", "quantity": 30, "note": "Collected from pharmacy" }
```

`refill` **adds** to current stock and records the event; `correction` **sets**
the absolute value.

### `POST /medicines/:id/image`

`multipart/form-data`, field `image`. JPEG / PNG / WebP, ≤ 10 MB. Converted to
WebP with EXIF stripped, plus a 320 px square thumbnail.

### `GET /medicines/:id/image?variant=thumbnail`

Authenticated. Ownership is re-checked on every request. Returns the image
bytes.

---

## Schedules — `/api/schedules`

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/occurrences` | **The dose feed** |
| GET | `/` | List schedules |
| POST | `/` | Create |
| GET | `/:id` | Read |
| PATCH | `/:id` | Update |
| PATCH | `/:id/status` | Pause / resume |
| DELETE | `/:id` | Delete (removes its intakes) |

### `POST /schedules`

```json
{ "medicine": "<id>", "frequency": "daily",
  "times": [ { "time": "08:00", "doseQuantity": 1, "label": "Morning" },
             { "time": "20:00", "doseQuantity": 1, "label": "Night" } ],
  "startDate": "2026-03-01", "endDate": null,
  "mealRelation": "after_meal", "graceMinutes": 60 }
```

| Frequency | Extra fields |
|-----------|--------------|
| `daily` | — |
| `specific_days` | `daysOfWeek: [1,3,5]` (0 = Sunday) |
| `interval` | `intervalDays: 2` |
| `cycle` | `cycleDaysOn: 21`, `cycleDaysOff: 7` |
| `as_needed` | `asNeededDoseQuantity`, `maxDosesPerDay`; **no** `times` |

### `GET /schedules/occurrences`

The single most useful endpoint: expands schedules into concrete doses and
attaches whatever was recorded.

| Query | Purpose |
|-------|---------|
| `date` | One day, `YYYY-MM-DD` |
| `from`, `to` | A range (max 400 days) |
| `medicine` | Filter to one medicine |
| `status` | `all`, `taken`, `skipped`, `upcoming`, `due`, `late`, `missed`, `pending` |

```json
{ "items": [ {
    "scheduleId": "…", "medicineId": "…",
    "dateKey": "2026-03-31", "time": "08:00",
    "scheduledAt": "2026-03-31T02:30:00.000Z",
    "doseQuantity": 1, "graceMinutes": 60,
    "status": "taken", "intakeId": "…", "takenAt": "…", "notes": null,
    "medicine": { "id": "…", "name": "Metformin", "image": { } },
    "mealRelation": "after_meal" } ],
  "summary": { "total": 2, "taken": 1, "upcoming": 1 },
  "range": { "from": "…", "to": "…", "timezone": "Asia/Kolkata" } }
```

Defaults to today plus the next six days.

---

## Intakes — `/api/intakes`

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/` | Medication history |
| POST | `/` | Record a scheduled dose |
| POST | `/as-needed` | Record a PRN dose |
| PATCH | `/:id` | Amend a record |
| DELETE | `/:id` | Remove a record |

### `POST /intakes`

```json
{ "schedule": "<id>", "dateKey": "2026-03-31", "scheduledTime": "08:00",
  "status": "taken", "notes": "After breakfast" }
```

For `"status": "skipped"`, `skipReason` is **required** — one of `forgot`,
`felt_better`, `side_effects`, `ran_out`, `doctor_advice`, `not_needed`,
`other`.

The server verifies the slot genuinely exists in the schedule on that date, so
a client cannot invent doses to inflate its adherence score.

```json
{ "intake": { }, 
  "medicine": { "id": "…", "currentStock": 59, "needsRefill": false },
  "stockWarning": null }
```

**Stock:** `taken` deducts the dose; **`skipped` deducts nothing**. Re-recording
the same slot updates the record and applies only the difference. Stock never
goes below zero — instead `stockWarning` explains the shortfall.

### `POST /intakes/as-needed`

```json
{ "medicine": "<id>", "doseQuantity": 1, "notes": "Headache" }
```

Refused with 400 once `maxDosesPerDay` is reached.

### `GET /intakes`

Filters: `page`, `limit`, `medicine`, `status` (`taken`/`skipped`/`all`),
`from`, `to`.

---

## Analytics — `/api/analytics`

### `GET /analytics/adherence`

Query: `days` (1–365, default 30), or `from` / `to`; optional `medicine`.

```json
{ "summary": {
    "expected": 60, "taken": 54, "skipped": 3, "missed": 3,
    "pending": 1, "upcoming": 5, "lateButTaken": 2,
    "evaluatedDoses": 59, "adherenceScore": 91.5,
    "adherenceLabel": "good",
    "window": { "from": "2026-03-02", "to": "2026-03-31", "timezone": "Asia/Kolkata" } },
  "byMedicine": [ { "medicineId": "…", "expected": 60, "taken": 54,
                    "adherenceScore": 91.5, "medicine": { } } ],
  "daily": [ { "date": "2026-03-02", "expected": 2, "taken": 2,
               "adherenceScore": 100 } ] }
```

`adherenceScore = taken ÷ (expected − pending) × 100`, or `null` when nothing
has been evaluated yet. Labels: `excellent` ≥ 95, `good` ≥ 80, `fair` ≥ 60,
else `needs_attention`; `no_data` when null.

### `GET /analytics/refill` · `GET /analytics/refill/:medicineId`

The DRPA. Optional `lookbackDays` (7–180, default 30). The overview is sorted
most-urgent-first.

```json
{ "prediction": {
  "medicineId": "…", "medicineName": "Metformin", "unit": "tablet",
  "stock": { "currentStock": 30, "refillThreshold": 5, "belowThreshold": false },
  "consumption": { "lookbackDays": 30, "observedDays": 20,
    "expectedDoses": 20, "takenDoses": 10, "skippedDoses": 10, "missedDoses": 0,
    "takenQuantity": 10, "skippedQuantityNotDeducted": 10, "adherenceRatio": 0.5 },
  "rates": { "scheduledPerDay": 1, "observedPerDay": 0.5, "trendPerDay": null,
    "effectivePerDay": 0.5, "confidenceWeight": 1, "basis": "observed_average" },
  "regression": { "used": false,
    "reasonIfUnused": "fit quality too low (r2 0.02 < 0.3)",
    "features": ["dayIndexSinceLookbackStart"], "target": "quantityTakenPerDay",
    "samples": 20, "slopePerDay": 0, "intercept": 0.5, "r2": 0.02 },
  "prediction": { "daysOfSupply": 60, "runOutDate": "2026-05-30",
    "thresholdDate": "2026-05-20", "daysUntilThreshold": 50,
    "suggestedRefillDate": "2026-05-20", "suggestedRefillQuantity": 15,
    "urgency": "ok", "horizonDays": 180, "truncatedHorizon": false },
  "explanation": [ "…", "…" ] } }
```

Urgency: `out_of_stock`, `refill_now`, `critical` (≤ 3 days), `urgent` (≤ 7),
`soon` (≤ 14), `ok`. Full method in [`DRPA.md`](DRPA.md).

---

## Interactions — `/api/interactions`

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/my-medicines` | Check every active medicine |
| POST | `/check` | Check typed names |
| GET | `/dataset` | Provenance |

### `POST /interactions/check`

```json
{ "names": ["Ibuprofen 400mg", "Crocin"], "includeMyMedicines": true }
```

1–25 names.

```json
{ "findings": [ {
    "interactionId": "DDI-001", "severity": "major",
    "medicineA": { "id": "…", "name": "Warfarin", "substance": "warfarin" },
    "medicineB": { "id": null, "name": "Ibuprofen 400mg", "substance": "ibuprofen" },
    "description": "…", "mechanism": "…", "precautions": ["…"],
    "source": "dataset" } ],
  "duplicateTherapy": [ ],
  "summary": { "medicinesChecked": 3, "checkedPairs": 3, "total": 1,
               "major": 1, "moderate": 0, "minor": 0, "highestSeverity": "major" },
  "dataset": { "isDemoData": true, "demoDataNotice": "…", "recordCount": 30 },
  "disclaimer": "…",
  "method": "deterministic-dataset-lookup" }
```

See [`DRUG_INTERACTIONS.md`](DRUG_INTERACTIONS.md).

---

## Records — `/api/records`

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/` | List with filters |
| POST | `/` | Create (multipart) |
| GET | `/:id` | Read (audit-logged) |
| PATCH | `/:id` | Update |
| DELETE | `/:id` 🔐 | Delete record + file |
| GET | `/:id/file` | Download (audit-logged) |
| POST | `/:id/ocr` | Run / re-run OCR |
| POST | `/:id/ocr/confirm` | **Verify OCR suggestions** |

### `POST /records`

`multipart/form-data`:

| Field | Notes |
|-------|-------|
| `title` | Required |
| `category` | Required — `prescription`, `pharmacy_bill`, `lab_report`, `discharge_summary`, `imaging`, `vaccination`, `insurance`, `referral`, `consultation_note`, `other` |
| `recordDate` | Defaults to today |
| `description`, `provider`, `doctorName` | Optional |
| `tags` | Comma-separated |
| `metadata` | JSON string |
| `shareableWithCaregivers` | Default `false` |
| `isSensitive` | Default `false` — never visible to caregivers |
| `runOcr` | Defaults to true for prescriptions, lab reports and discharge summaries |
| `file` | Image / PDF / text, ≤ 10 MB |

### `GET /records/:id/file`

Ownership (and caregiver sharing) re-checked; every download audit-logged.
Always `Content-Disposition: attachment` with `X-Content-Type-Options: nosniff`.

### `POST /records/:id/ocr/confirm`

**The verification step. Nothing OCR extracted becomes a medicine until this is
called.**

```json
{ "accepted": [ { "name": "Metformin", "genericName": "Metformin",
    "strength": "500 mg", "dosageForm": "tablet",
    "initialQuantity": 30, "currentStock": 30, "refillThreshold": 5,
    "instructions": "Take after food" } ] }
```

Medicines are built from **this request body**, not from the stored
suggestions, so the user can correct anything OCR got wrong. Send
`{ "rejectAll": true }` to discard everything.

**201** → `{ createdMedicines: [ … ], record }`

---

## Caregivers — `/api/caregivers`

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/` | Links in both directions |
| POST | `/` | Invite |
| POST | `/respond` | Accept or decline |
| PATCH | `/:id/permissions` 🔐 | Change permissions |
| DELETE | `/:id` | Revoke (either party) |
| GET | `/patients/:patientId/summary` | Caregiver's read-only view |

### `POST /caregivers`

```json
{ "caregiverEmail": "helper@example.com", "caregiverName": "Priya",
  "relationship": "Daughter",
  "permissions": { "viewMedicines": true, "viewSchedules": true,
    "viewAdherence": true, "viewRecords": false, "canRecordIntake": false,
    "receiveMissedDoseAlerts": true, "receiveRefillAlerts": true } }
```

**201** → `{ link, inviteToken, inviteExpiresAt, recipientHasAccount }`

`inviteToken` is returned **once** — only its SHA-256 hash is stored. It expires
in 14 days and works only for the invited email address.

### `POST /caregivers/respond`

`{ "token": "…", "accept": true }` — must be called by an account whose email
matches the invitation, or it is refused with 403 and audit-logged.

### `GET /caregivers/patients/:patientId/summary`

Each section appears only if the corresponding permission is held:
`medicines` + `lowStock` (`viewMedicines`), `today` + `missedToday`
(`viewSchedules`), `adherence` + `adherenceDaily` (`viewAdherence`).

---

## Assistant — `/api/assistant`

### `POST /assistant/medicine-info`

```json
{ "question": "How should I store metformin?", "medicineName": "Metformin",
  "medicineId": "<id>", "topic": "storage" }
```

At least one of `question`, `medicineName`, `medicineId`.
`topic` ∈ `uses`, `howItWorks`, `precautions`, `storage`, `sideEffects`,
`whenToSeekHelp`.

**Answered:**

```json
{ "answered": true, "matchType": "exact_name",
  "medicine": { "substance": "metformin", "displayName": "Metformin",
                "drugClass": "Biguanide antidiabetic" },
  "sections": { "storage": { "title": "Storage", "text": "…" } },
  "disclaimer": "…", "safetyNote": "…",
  "source": "curated_knowledge_base", "generatedByModel": false }
```

**Refused:**

```json
{ "answered": false, "ruleId": "DOSAGE_CHANGE", "reason": "dosage_change",
  "message": "I cannot suggest or change a dose…",
  "urgent": false, "redirectTo": null, "source": "guardrail" }
```

Refusal reasons: `diagnosis`, `prescribing`, `dosage_change`,
`stop_or_continue`, `interaction` (redirects to the interaction checker),
`emergency` (`urgent: true`), `personal_circumstance`,
`not_in_knowledge_base`.

### `POST /assistant/visit-summary`

`{ "text": "…" }` or `{ "recordId": "<id>" }`.

Returns sectioned output where **every line is verbatim from the source**, the
medicines it mentions, a name-only reconciliation against the patient's list,
and `isDiagnostic: false`, `generatedByModel: false`.

### `GET /assistant/insights`

Query: `windowDays` (7–180, default 30).

```json
{ "windowDays": 30, "adherence": { }, "trend": { "direction": "improving", "change": 10 },
  "insights": [ { "id": "TOP_SKIP_REASON", "category": "behaviour",
    "severity": "neutral", "title": "…", "detail": "…",
    "rule": "most frequent skipReason with count >= 2" } ],
  "method": "rule-based-thresholds", "isDiagnostic": false,
  "generatedByModel": false, "disclaimer": "…" }
```

Every insight returns the threshold rule that produced it.

---

## Dashboard — `GET /api/dashboard`

One call for the whole dashboard: `today`, `todaySummary`, `upcoming`,
`adherence`, `adherenceDaily`, `stock`, `refillWarnings`, `interactionAlerts`,
`recentRecords`, `caregivers`.

---

## Audit — `/api/audit`

### `GET /audit`

Query: `page`, `limit` (≤ 100), `action`, `from`, `to`.

Returns the signed-in user's own trail — actions they performed, and actions
performed on their data.

```json
{ "items": [ { "action": "RECORD_FILE_DOWNLOADED", "entityType": "MedicalRecord",
    "description": "Downloaded \"bill.pdf\" from \"Pharmacy bill\"",
    "oldValue": null, "newValue": null, "authMethod": "jwt", "status": "success",
    "ipAddress": "…", "createdAt": "…" } ],
  "total": 128, "page": 1, "limit": 25, "pages": 6 }
```

### `GET /audit/actions`

The list of valid action values, for building a filter.
