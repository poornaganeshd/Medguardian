# Security

How MedGuardian protects patient data, what it deliberately does not attempt,
and what to check before deploying it.

---

## 1. Threat model

MedGuardian stores medication schedules, adherence history and uploaded medical
documents. That is health data about an identifiable person, so the realistic
threats are:

| # | Threat | Primary control |
|---|--------|-----------------|
| T1 | Credential theft (guessing, reuse, brute force) | bcrypt hashing, generic failure messages, lockout, rate limiting |
| T2 | Session theft (stolen token, XSS) | Short-lived access tokens, hashed rotating refresh tokens with reuse detection |
| T3 | Another patient reading your data | Per-request ownership checks on every resource |
| T4 | A caregiver exceeding what was granted | Explicit per-permission gates, private-by-default records |
| T5 | Direct access to uploaded files | Files outside any static route, served only through an authenticated endpoint |
| T6 | Malicious upload (script, oversized, traversal) | MIME allow-list, size cap, random filenames, `attachment` + `nosniff`, traversal-proof paths |
| T7 | Someone using an unlocked device | PIN / biometric step-up on destructive and permission-changing actions |
| T8 | Injection (NoSQL, parameter pollution) | Zod validation, `express-mongo-sanitize`, `hpp`, Mongoose casting |
| T9 | Silent tampering | Append-only audit log with old/new values and auth method |
| T10 | Secrets leaking through source or config | Nothing hard-coded; production boot fails without real secrets |

---

## 2. Authentication

### Passwords

- **bcrypt**, 12 rounds (4 in tests for speed), hashed in a Mongoose
  `pre('save')` hook so no code path can persist a plaintext password.
- `select: false` — the field is never returned unless explicitly requested.
- Policy enforced by Zod and mirrored live in the registration UI: at least 8
  characters with upper case, lower case and a digit.
- Changing a password sets `passwordChangedAt` and **clears every refresh
  token**, so all other devices are signed out. Access tokens issued before the
  change are rejected by comparing `iat` against `passwordChangedAt`.

### Login hardening

- The same message — *"Invalid email or password"* — for a wrong password and
  an unknown email, so the endpoint cannot be used to enumerate accounts.
  A test asserts this.
- Failed attempts increment a counter; 8 failures lock the account for 15
  minutes. The lockout message reveals nothing about whether the account exists.
- `/api/auth/*` has a tighter rate limit than the rest of the API.
- Every attempt, successful or not, is audit-logged.

### Tokens

| Token | Lifetime | Signed with | Storage |
|-------|----------|-------------|---------|
| Access | 2 h | `JWT_SECRET` | Client memory + `localStorage` |
| Refresh | 7 d | `JWT_REFRESH_SECRET` (**different secret**) | Only the SHA-256 hash is stored server-side |
| Step-up | 10 min | `JWT_SECRET`, `type: 'stepup'` | `sessionStorage` — deliberately does not survive closing the browser |

**Refresh rotation with reuse detection.** Each refresh issues a new token and
removes the old hash. Presenting a token whose hash is no longer stored means
either it was already rotated (replay) or it was stolen — so **every session
for that account is revoked** and the event is audit-logged. Active sessions are
capped at 5 per account.

The three token types are not interchangeable: `protect` rejects anything whose
`type` is not `access`, and `requireStepUp` rejects anything whose `type` is not
`stepup` or whose `sub` is not the current user. A test confirms a step-up token
from a *different* user is refused.

### PIN re-authentication

A second factor for actions that destroy data or widen access.

- Stored as its **own bcrypt hash**, separate from the password, `select: false`.
- Setting or changing it requires the account password; changing it also
  requires the current PIN.
- Rejects trivial PINs (a single repeated digit); 4–8 digits.
- 5 wrong attempts locks PIN entry for 15 minutes, tracked separately from
  login lockout.
- A correct PIN issues a 10-minute step-up token, so a burst of related actions
  does not prompt repeatedly.

**Actions requiring step-up:**

| Action | Why |
|--------|-----|
| Delete a medicine | Destroys its schedules and entire dose history |
| Delete a medical record | Destroys the stored document |
| Change caregiver permissions | Widens who can see health data |

### WebAuthn / biometrics

Platform authenticators (fingerprint, face unlock) via
`@simplewebauthn/server`. Only the **public key**, credential id and signature
counter are stored — the biometric never leaves the device. A successful
assertion issues the same step-up token a PIN would, so the two are
interchangeable everywhere.

---

## 3. Authorization

Three layers, all of which must pass:

**1. Authentication** — `protect` verifies the token, loads the live user, and
rejects deactivated accounts and tokens predating a password change.

**2. Role** — `authorize('patient')` where a route is role-specific.

**3. Ownership** — `resolvePatientContext` decides *whose* data the request
touches:

- A **patient** always operates on their own record. Passing someone else's
  `patientId` is refused **and audit-logged** as `ACCESS_DENIED`.
- A **caregiver** must supply `patientId`, hold an `accepted` link, and hold the
  specific permission the route names. Every such access writes a
  `CAREGIVER_ACCESSED_PATIENT_DATA` entry.

On top of that, every controller query is scoped by `patient: patientId`, so a
guessed object id returns 404 rather than another patient's data.

### Caregiver permissions

Seven independent flags. There is **no "full access" switch anywhere in the
system**.

| Permission | Default | Grants |
|------------|---------|--------|
| `viewMedicines` | ✅ on | The medicine list, stock levels, photos |
| `viewSchedules` | ✅ on | Schedules and today's dose statuses |
| `viewAdherence` | ✅ on | The adherence summary and trend |
| `viewRecords` | ❌ **off** | Records the patient marked shareable — never sensitive ones |
| `canRecordIntake` | ❌ **off** | Marking a dose taken or skipped (changes stock) |
| `receiveMissedDoseAlerts` | ✅ on | Missed-dose counts on their summary |
| `receiveRefillAlerts` | ✅ on | Refill warnings on their summary |

Medical records and dose recording are **off by default** and must be granted
deliberately. Caregivers can never edit or delete anything.

**Invitations** are bound to the email they were addressed to. The token is
stored only as a SHA-256 hash with a 14-day expiry, and presenting a valid token
from a different account is refused and audit-logged. Revocation by either party
takes effect on the very next request.

---

## 4. File security

Uploaded documents are the most sensitive artefacts in the system.

| Control | Implementation |
|---------|----------------|
| Storage location | `backend/uploads/`, **outside any `express.static` route** |
| Filenames | `Date.now()` + 12 random bytes + an extension derived from the *verified* MIME type — the user's filename never touches the filesystem |
| Type restriction | MIME allow-list: images only for medicine photos; images, PDF and plain text for records |
| Size | Capped by `MAX_UPLOAD_MB` (default 10 MB) at the Multer layer |
| Path traversal | `resolveStoredPath` enforces a strict `[A-Za-z0-9._-]+` filename allow-list, rejects `..`, and verifies the resolved path stays inside the base directory. Five traversal cases are unit-tested |
| Image processing | Sharp re-encodes every photo to WebP, which **strips EXIF** — including GPS coordinates that would otherwise reveal a patient's home address |
| Delivery | Authenticated endpoint only. Ownership (and caregiver sharing) is re-checked on **every** request |
| Response headers | `Content-Disposition: attachment` always — so an uploaded SVG or HTML file can never execute in the application's origin — plus `X-Content-Type-Options: nosniff` and `Cache-Control: private, no-store` |
| Integrity | SHA-256 checksum stored with every record file |
| Cleanup | Deleting a medicine or record removes its files; a failed upload is cleaned up rather than orphaned |

Records are **private by default** (`shareableWithCaregivers: false`), and a
record marked `isSensitive` is invisible to caregivers regardless of their
permissions.

---

## 5. Audit logging

An append-only record of everything that matters, covering exactly what the
specification asks for: **user, action, entity, old value, new value,
authentication method, timestamp.**

```js
{
  user, patient, actorEmail, actorRole,
  action,               // one of 40+ enumerated actions
  entityType, entityId,
  description,
  oldValue, newValue,   // redacted diffs
  authMethod,           // password | jwt | refresh_token | pin | webauthn | none
  status,               // success | failure
  ipAddress, userAgent,
  createdAt
}
```

**Immutability.** `findOneAndUpdate` and `updateOne` hooks throw. Entries are
written, never edited.

**Redaction.** `auditService` walks each value and replaces anything named
`password`, `pin`, `token`, `publicKey`, `refreshTokenHashes` and similar with
`[REDACTED]` before writing. A secret cannot leak into the audit trail by
someone passing a whole request body to it.

**Never breaks the request.** Audit writes are wrapped so a logging failure is
reported to the server log but never fails the user's operation.

Covered actions include authentication and security changes, medicine and
schedule changes, intake records, record views and file downloads, OCR runs and
confirmations, caregiver invitations, permission changes and every caregiver
data access, plus denied access attempts.

Patients read their own trail at `GET /api/audit`, rendered on **Profile →
Activity log**.

---

## 6. Input validation and injection

- **Zod schemas** on `body`, `query` and `params` for every non-trivial route.
  The parsed, stripped result **replaces** the raw input, so unexpected fields
  never reach a controller.
- **`express-mongo-sanitize`** removes `$`-prefixed keys, blocking NoSQL
  operator injection.
- **`hpp`** prevents parameter pollution.
- **Mongoose casting and enums** provide a second layer at the model.
- User-supplied strings used in regex searches are escaped before the `RegExp`
  is built.
- Body size capped at 2 MB.

---

## 7. Transport and headers

- **Helmet** for security headers, with CSP enabled in production.
- **CORS allow-list** from `CLIENT_ORIGIN` — a rejected origin gets an error,
  not a wildcard.
- **Rate limiting**: 300 requests / 15 min generally, 25 / 15 min on auth
  routes.
- Refresh cookies are `httpOnly`, `secure` in production, `sameSite: strict`,
  and scoped to `path=/api/auth`.
- `x-powered-by` disabled.

---

## 8. Secrets

Nothing sensitive is in source control. `.gitignore` excludes `.env`, `*.pem`,
`*.key` and the entire `uploads/` tree.

Development uses clearly-labelled fallback secrets so the project runs
immediately after cloning. **Production refuses to start** if `JWT_SECRET`,
`JWT_REFRESH_SECRET` or `MONGO_URI` is missing, or if the two JWT secrets are
identical:

```js
function assertProductionSecrets() {
  if (!isProd) return;
  const missing = [];
  if (!process.env.JWT_SECRET) missing.push('JWT_SECRET');
  if (!process.env.JWT_REFRESH_SECRET) missing.push('JWT_REFRESH_SECRET');
  if (!process.env.MONGO_URI) missing.push('MONGO_URI');
  if (missing.length) throw new Error(`Missing required production environment variables: ${missing.join(', ')}`);
  if (process.env.JWT_SECRET === process.env.JWT_REFRESH_SECRET) {
    throw new Error('JWT_SECRET and JWT_REFRESH_SECRET must be different values');
  }
}
```

---

## 9. Safety boundaries in the AI-adjacent features

Three features could plausibly produce unsafe medical content. Each is
constrained by construction rather than by prompt wording.

| Feature | Constraint |
|---------|-----------|
| **Drug interactions** | Pure dataset lookup. No model. Facts copied verbatim. Absent pairs return "not in this dataset" |
| **Medicine information** | Retrieval over a curated corpus. Seven refusal rule sets block diagnosis, prescribing, dose changes, stop/continue decisions, interaction questions, emergencies and personal-circumstance questions. A medicine absent from the corpus returns "not in the knowledge base" — never an invented answer |
| **Visit summary** | Extractive only. A test asserts every returned line exists verbatim in the input. Patient identifiers are stripped, not echoed |
| **Health insights** | Rule-based thresholds. Each insight returns the rule that produced it. A test asserts no medical condition is ever named |
| **OCR** | Never auto-creates a medicine. Suggestions sit in `awaiting_verification` until the patient reviews them; medicines are built from the *confirmation request*, so the user can correct anything OCR got wrong |

Every one of these returns `generatedByModel: false` / `isDiagnostic: false` in
its payload, and the UI displays it.

---

## 10. Production deployment checklist

- [ ] `NODE_ENV=production`
- [ ] `JWT_SECRET` and `JWT_REFRESH_SECRET` set to different 48-byte random
      values (`node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`)
- [ ] `MONGO_URI` points at a database with authentication enabled
- [ ] `CLIENT_ORIGIN` lists only the real frontend origin(s)
- [ ] `WEBAUTHN_RP_ID` and `WEBAUTHN_ORIGIN` match the deployed domain
- [ ] TLS terminated in front of the API (WebAuthn requires HTTPS, and so does
      any real handling of health data)
- [ ] `backend/uploads/` on persistent storage, backed up, not web-served
- [ ] MongoDB backups scheduled and restore-tested
- [ ] `BCRYPT_SALT_ROUNDS` at 12 or higher
- [ ] Rate limits reviewed for expected traffic
- [ ] `SEED_REFERENCE_DATA=false`, and the demo account removed
- [ ] Log aggregation configured; audit collection retention agreed
- [ ] The demo drug-interaction dataset and knowledge base **replaced with
      licensed clinical sources**, or the feature disabled

---

## 11. Deliberately out of scope

An academic project should be clear about its limits.

- **No end-to-end encryption.** Documents are encrypted in transit (TLS) and at
  rest only if the underlying storage provides it. Application-level encryption
  of uploads would be the next step.
- **No email or SMS.** Caregiver invitation codes are handed to the patient to
  pass on, and there is no password-reset-by-email flow. Adding one requires a
  mail provider and its own rate limiting and token expiry design.
- **No MFA on login itself.** The second factor guards sensitive *actions*, not
  the initial sign-in.
- **No key rotation tooling.** Rotating `JWT_SECRET` invalidates all sessions;
  there is no dual-key grace period.
- **No formal compliance work.** HIPAA, GDPR and equivalent regimes require
  organisational controls, DPAs, breach procedures and retention policies that
  are outside a software deliverable.
- **No penetration test.** The controls above are reasoned and unit-tested, not
  externally assessed.
