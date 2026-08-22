# DRPA — Dynamic Refill Prediction Algorithm

**Implementation:** [`backend/src/services/refillPredictionService.js`](../backend/src/services/refillPredictionService.js)
**Regression helper:** [`backend/src/services/linearRegression.js`](../backend/src/services/linearRegression.js)
**Tests:** [`backend/tests/unit/refillPredictionService.test.js`](../backend/tests/unit/refillPredictionService.test.js) (33 tests)

---

## 1. The problem

A patient has 30 tablets and a prescription for one a day. The naive answer is
"30 days". It is usually wrong, because prescriptions describe intent and
patients describe reality: doses get skipped, doubled, taken late, or not taken
at all.

If the app says "you will run out on the 30th" and the patient has been
skipping every other day, they are told to reorder two weeks too early. If it
says the same thing when they have been doubling up, they run out and miss
doses. Neither is acceptable in an application whose whole purpose is not
running out of medicine.

**DRPA predicts the run-out date from what the patient actually consumed, and
updates that prediction as their behaviour changes.**

---

## 2. The central rule

> **A skipped dose is not consumed.**

This one sentence is what makes the algorithm *dynamic*, and it drives two
separate consequences that are easy to conflate:

1. **Stock is not deducted.** The tablet is still in the box. Recording a skip
   must leave `currentStock` untouched, and correcting a "taken" record back to
   "skipped" must *return* the tablet.
2. **The consumption rate is not inflated.** A patient who takes 15 of 30
   prescribed doses is consuming at 0.5/day, not 1.0/day, and their supply
   genuinely lasts twice as long.

The stock half lives in
[`intakeService.js`](../backend/src/services/intakeService.js) as a pure
function:

```js
function consumptionOf(record) {
  if (!record) return 0;
  return record.status === 'taken' ? Number(record.doseQuantity) || 0 : 0;
}

function stockDelta(previous, next) {
  return consumptionOf(previous) - consumptionOf(next);
}
```

Every code path that touches stock — recording, amending, deleting — goes
through `stockDelta`, so the rule cannot be implemented inconsistently in one
place and not another. It is covered by 20 unit tests, including the
taken→skipped refund and the skipped→taken deduction.

---

## 3. Inputs

| Input | Source | Used for |
|-------|--------|----------|
| `currentStock` | Medicine record | Starting point of the projection |
| `refillThreshold` | Medicine record | When to warn |
| Scheduled doses | Schedule expansion over the horizon | The prescribed rate, and which future days consume |
| Taken doses | Intake records (`status: 'taken'`) | Observed consumption |
| Skipped doses | Intake records (`status: 'skipped'`) | Reported for transparency; **never deducted** |
| Missed doses | Expected minus recorded | Reported; excluded from the rate (see §5) |
| Historical daily consumption | Taken quantity grouped by day | The regression input |

---

## 4. The six steps

### Step 1 — EXPAND

Expand the medicine's schedules over the 30-day lookback window to obtain the
doses that *were* expected, and over the 180-day forecast horizon to obtain the
doses that *are* planned.

This uses the same `scheduleService.expandSchedule` that generates the reminder
screen, so "expected dose" means exactly one thing everywhere in the
application.

### Step 2 — OBSERVE

Sum the quantity **actually taken** per calendar day. Skipped doses contribute
zero.

```js
if (intake.status === 'taken') {
  takenQuantity += quantity;
  consumptionByDay.set(dateKey, (consumptionByDay.get(dateKey) || 0) + quantity);
} else if (intake.status === 'skipped') {
  skippedQuantity += quantity;   // recorded for transparency, NOT deducted
}
```

### Step 3 — RATE

Three candidate daily consumption rates are computed.

**(a) `scheduledRate`** — mean quantity per calendar day the schedule calls for
over the horizon. For a once-daily medicine this is 1.0; for alternate days,
0.5; for weekdays only, ~0.71.

**(b) `observedRate`** — mean quantity actually taken per *observed* day.

**(c) `trendRate`** — a least-squares fit of daily consumption against day
index, evaluated at today. This lets the forecast follow a rising or falling
pattern instead of assuming a flat average.

```
y = intercept + slope × dayIndex
```

The fit is used **only when it is trustworthy**:

| Guard | Threshold | Why |
|-------|-----------|-----|
| Sample size | ≥ 7 observed days | A line through three points means nothing |
| Goodness of fit | r² ≥ 0.30 | Below this the line explains almost none of the variation |

When the fit is rejected, the API response says so explicitly:

```json
"regression": {
  "used": false,
  "reasonIfUnused": "fit quality too low (r2 0.02 < 0.3)",
  "features": ["dayIndexSinceLookbackStart"],
  "target": "quantityTakenPerDay",
  "samples": 20,
  "slopePerDay": 0,
  "intercept": 0.5,
  "r2": 0.02
}
```

> **On calling this "AI".** It is not. It is ordinary least-squares regression,
> implemented from first principles in ~40 lines with no library and no
> pre-trained weights. It is used for one narrow job — detecting a trend in a
> single time series — and it is rejected whenever it does not fit. The input
> features, both coefficients, the sample size and r² are all stored and
> returned, so a reviewer can check the arithmetic. Presenting a moving average
> as machine learning would be dishonest; presenting a small, well-guarded
> regression as what it is, is not.

### Step 4 — BLEND

With three days of history, the observed rate is noise. With thirty, it is
better evidence than the prescription. So the two are blended by a confidence
weight:

```
w              = min(1, observedDays / 14)
effectiveRate  = w × observationBasedRate + (1 − w) × scheduledRate
```

where `observationBasedRate` is the trend rate if the regression passed its
guards, otherwise the observed average.

| Observed days | w | Behaviour |
|---------------|---|-----------|
| 0 | 0.00 | Schedule only — a brand-new medicine forecasts from the prescription |
| 4 | 0.29 | Mostly schedule, slightly adjusted |
| 7 | 0.50 | Half and half |
| 14+ | 1.00 | The patient's own behaviour governs |

### Step 5 — PROJECT

A flat "stock ÷ rate" division would smooth a non-daily regimen into nonsense:
an alternate-day medicine would appear to deplete on the days it is not due.

Instead the algorithm walks the horizon **day by day**. For each future day it
asks the schedule what that day requires, scales it by how much of the
prescribed amount the patient actually takes, and subtracts:

```js
const adherenceScale = scheduledRate > 0 ? effectiveRate / scheduledRate : 1;

// On a day the regimen does not call for a dose, nothing is consumed.
const consumed = dayQuantity > 0
  ? dayQuantity * adherenceScale
  : hasFixedSchedule ? 0 : effectiveRate;
```

The first day stock crosses the refill threshold is recorded as
`thresholdDate`; the first day it reaches zero is `runOutDate`.

### Step 6 — REPORT

The response contains every input, every intermediate rate, the regression
details and a plain-language explanation array.

---

## 5. Two decisions worth defending

### Unrecorded days are *unknown*, not *zero*

An early version treated every past day with no intake record as zero
consumption. That is wrong, and dangerously so: a patient who never opens the
app would be told their supply lasts forever, because as far as the data was
concerned they had consumed nothing.

A day counts as **observed** only if the patient recorded *something* on it
(taken or skipped). Days with no record at all are excluded from the rate
calculation entirely — but they are still reported as `missedDoses` so the
patient sees the gap.

### Off-days consume nothing

A related bug: falling back to the flat `effectiveRate` on days the schedule
did not call for a dose. For an alternate-day medicine this burned stock every
single day and predicted a 10-tablet supply lasting 13 days instead of 20. The
flat rate is now used *only* when there is no fixed schedule at all — an
as-needed medicine the patient is demonstrably consuming.

Both were caught by unit tests before the feature shipped
(`respects an alternate-day regimen instead of smoothing it away`).

---

## 6. Worked example

**Setup.** Metformin, 30 tablets on hand, refill threshold 5, one tablet daily.
Over the last 20 days the patient took 10 doses and skipped 10.

| Step | Result |
|------|--------|
| 1. Expand | 20 expected doses in the lookback; 180 planned over the horizon |
| 2. Observe | 10 taken (10 tablets), 10 skipped (10 tablets **not** deducted). 20 observed days |
| 3. Rate | `scheduledRate` = 1.0/day; `observedRate` = 0.5/day; regression rejected — alternating 1/0 has r² ≈ 0.02, below 0.30 |
| 4. Blend | `w` = min(1, 20/14) = 1.0 → `effectiveRate` = 0.5/day; basis `observed_average` |
| 5. Project | `adherenceScale` = 0.5. Each day consumes 1 × 0.5 = 0.5. Threshold (5) reached after 50 days; zero after 60 |
| 6. Report | 60 days of supply, urgency `ok`, reorder ~50 days out, suggested quantity 15 tablets for 30 days |

**Contrast.** A patient with identical stock and a perfect record gets
`effectiveRate` = 1.0/day and **30 days of supply** — half as long. The
difference comes entirely from the skipped-dose rule.

The explanation returned to the UI:

> Metformin: 30 tablet(s) on hand, refill threshold 5.
> The schedule calls for 1 tablet(s) per day on average.
> Recorded intake shows 0.5 tablet(s) actually taken per day.
> 10 dose(s) (10 tablet(s)) were skipped and were NOT deducted from stock, so
> the supply lasts longer than the prescription implies.
> With 100% confidence in the observed history, the effective consumption rate
> used is 0.5 tablet(s) per day.
> Projecting the schedule forward day by day, stock runs out in about 60
> day(s), on 2026-05-30.
> Stock reaches the refill threshold on 2026-05-20.

---

## 7. Urgency bands

| Condition | Urgency |
|-----------|---------|
| `currentStock` ≤ 0 | `out_of_stock` |
| `currentStock` ≤ `refillThreshold` | `refill_now` |
| ≤ 3 days of supply | `critical` |
| ≤ 7 days | `urgent` |
| ≤ 14 days | `soon` |
| otherwise | `ok` |

The dashboard and the refill overview sort by this order, so the most pressing
medicine is always first.

---

## 8. Constants

| Constant | Value | Rationale |
|----------|-------|-----------|
| `LOOKBACK_DAYS` | 30 | A month captures weekly rhythms without letting a long-abandoned pattern dominate |
| `HORIZON_DAYS` | 180 | Long enough for a large supply; a longer supply reports `truncatedHorizon: true` |
| `CONFIDENCE_FULL_DAYS` | 14 | Two weeks of recorded behaviour is enough to trust over the prescription |
| `MIN_DAYS_FOR_TREND` | 7 | Below this a regression line is meaningless |
| `MIN_R2_FOR_TREND` | 0.30 | Below this the fit explains almost none of the variation |

All five are exported, so they can be tuned and the effect re-tested.

---

## 9. Properties the tests enforce

The 33 unit tests are the specification. Notably:

- Skipped doses are counted and reported but never deducted.
- A patient who skips half their doses gets a **longer** supply estimate than
  one who takes everything.
- More skipping stretches supply further still — the estimate tracks behaviour.
- With no history, the forecast uses the schedule alone (`schedule_only`).
- With 14+ observed days, observation dominates (`observed_*`).
- Regression is rejected with a stated reason when data is thin or the fit is
  poor, and used when a genuine trend exists.
- Alternate-day, weekday-only and cycle regimens are respected, not smoothed.
- Paused schedules do not consume stock.
- The same inputs always produce byte-identical output (determinism).

```bash
cd backend
npx jest tests/unit/refillPredictionService
```

---

## 10. Endpoints

```
GET /api/analytics/refill                  # all medicines, most urgent first
GET /api/analytics/refill/:medicineId      # one medicine, full detail
```

Both accept an optional `lookbackDays` (7–180). The full response shape is in
[`API.md`](API.md#analytics).

The UI surfaces all of it on the **Adherence & refills** screen: every rate,
the confidence weight, the regression coefficients or the reason they were
rejected, and the plain-language explanation — so the algorithm can be
demonstrated live during a review without opening the source.
