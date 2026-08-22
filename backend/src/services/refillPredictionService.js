'use strict';

const scheduleService = require('./scheduleService');
const { fitLinearRegression } = require('./linearRegression');
const {
  toLocalDateKey,
  addDays,
  daysBetween,
  localDateTime,
  DEFAULT_TZ
} = require('../utils/dateTime');

/**
 * ============================================================================
 * DRPA - Dynamic Refill Prediction Algorithm
 * ============================================================================
 *
 * Purpose
 * -------
 * Predict when a medicine will run out and when the patient should reorder,
 * using what the patient ACTUALLY consumed rather than what the prescription
 * nominally calls for.
 *
 * The central rule
 * ----------------
 *   A SKIPPED DOSE IS NOT CONSUMED.
 * A skipped tablet stays in the box, so it must never be deducted from stock
 * and must never inflate the consumption rate. This is what makes the
 * prediction *dynamic*: a patient who skips a third of their doses will be
 * told their supply lasts roughly 50% longer than the prescription implies,
 * and the estimate moves as their behaviour moves.
 *
 * Inputs
 * ------
 *   currentStock, refillThreshold      from the medicine record
 *   scheduled doses per day            from schedule expansion
 *   taken / skipped / missed doses     from the intake history
 *   historical daily consumption       taken doses per day over the lookback
 *
 * Steps
 * -----
 *  1. EXPAND    Expand the active schedules over the lookback window to get
 *               the doses that were expected, and over the forecast horizon to
 *               get the doses that are planned.
 *  2. OBSERVE   Sum the quantity actually taken per day. Skipped and missed
 *               doses contribute 0.
 *  3. RATE      Compute three candidate daily consumption rates:
 *                 a. scheduledRate  - doses/day the schedule calls for
 *                 b. observedRate   - mean quantity actually taken per day
 *                 c. trendRate      - linear-regression fit of daily
 *                                     consumption, projected to the next day,
 *                                     used ONLY when the fit is trustworthy
 *                                     (>= 7 days of data and r2 >= 0.30)
 *  4. BLEND     effectiveRate = w * observationBasedRate + (1 - w) * scheduledRate
 *               where w = min(1, observedDays / 14) is a confidence weight.
 *               With little history the schedule dominates; after two weeks of
 *               real data the patient's own behaviour dominates. This avoids a
 *               wild forecast on day one without ignoring genuine behaviour.
 *  5. PROJECT   Walk the forecast horizon day by day. On each day, consume
 *               min(scheduled quantity for that day, effectiveRate-adjusted
 *               amount) so that non-daily regimens (alternate days, weekdays
 *               only, cycles) are respected instead of being smoothed away.
 *  6. REPORT    Days of supply remaining, projected run-out date, the date
 *               stock falls to the refill threshold, urgency, and the full set
 *               of inputs so the number can be explained and audited.
 *
 * Everything is deterministic arithmetic over the patient's own records. The
 * only statistical component is the simple least-squares fit in step 3c, and
 * it is reported explicitly (features, coefficients, r2) rather than hidden.
 */

const LOOKBACK_DAYS = 30;
const HORIZON_DAYS = 180;
const CONFIDENCE_FULL_DAYS = 14;
const MIN_DAYS_FOR_TREND = 7;
const MIN_R2_FOR_TREND = 0.3;

const round2 = (v) => Math.round(v * 100) / 100;

/**
 * @param {object} input
 * @param {object} input.medicine     medicine document / plain object
 * @param {Array}  input.schedules    schedules for this medicine
 * @param {Array}  input.intakes      intake records for this medicine
 * @param {Date}   [input.now]
 * @param {string} [input.timezone]
 * @param {number} [input.lookbackDays]
 * @param {number} [input.horizonDays]
 */
function predictRefill({
  medicine,
  schedules = [],
  intakes = [],
  now = new Date(),
  timezone = DEFAULT_TZ,
  lookbackDays = LOOKBACK_DAYS,
  horizonDays = HORIZON_DAYS
}) {
  const todayKey = toLocalDateKey(now, timezone);
  const currentStock = Number(medicine?.currentStock) || 0;
  const refillThreshold = Number(medicine?.refillThreshold) || 0;
  const unit = medicine?.unit || 'dose';

  // ---------------------------------------------------------------- step 1
  const historyStartKey = addDays(todayKey, -lookbackDays);
  const historyOccurrences = scheduleService.expandSchedules(schedules, {
    from: localDateTime(historyStartKey, '00:00', timezone),
    to: now,
    timezone,
    includeInactive: true
  });

  // ---------------------------------------------------------------- step 2
  // Only `taken` records consume stock; a skipped dose contributes zero.
  //
  // A day counts as *observed* only if the patient recorded something on it
  // (taken or skipped). Days with no record at all are genuinely unknown - the
  // patient may have taken the dose without logging it - so they are excluded
  // from the rate rather than counted as zero consumption. Counting them as
  // zero would tell a patient who never logs that their supply lasts forever,
  // which is exactly the wrong answer to give. They are still reported as
  // `missedDoses` for transparency.
  const consumptionByDay = new Map();
  const observedDayKeys = new Set();

  let takenDoses = 0;
  let takenQuantity = 0;
  let skippedDoses = 0;
  let skippedQuantity = 0;

  for (const intake of intakes) {
    if (intake.dateKey < historyStartKey || intake.dateKey > todayKey) continue;
    const quantity = Number(intake.doseQuantity) || 0;

    // Any recorded action makes the day observable; only `taken` adds quantity.
    if (intake.dateKey < todayKey) {
      observedDayKeys.add(intake.dateKey);
      if (!consumptionByDay.has(intake.dateKey)) consumptionByDay.set(intake.dateKey, 0);
    }

    if (intake.status === 'taken') {
      takenDoses += 1;
      takenQuantity += quantity;
      if (intake.dateKey < todayKey) {
        consumptionByDay.set(
          intake.dateKey,
          (consumptionByDay.get(intake.dateKey) || 0) + quantity
        );
      }
    } else if (intake.status === 'skipped') {
      skippedDoses += 1;
      skippedQuantity += quantity; // recorded for transparency, NOT deducted
    }
  }

  const expectedDoses = historyOccurrences.length;
  const missedDoses = Math.max(0, expectedDoses - takenDoses - skippedDoses);

  // ---------------------------------------------------------------- step 3
  const scheduledRate = averageScheduledPerDay(schedules, todayKey, timezone, horizonDays);

  const observedDays = [...observedDayKeys].sort();
  const observedTotal = observedDays.reduce(
    (sum, key) => sum + (consumptionByDay.get(key) || 0),
    0
  );
  const observedRate = observedDays.length > 0 ? observedTotal / observedDays.length : null;

  const regressionPoints = observedDays.map((key) => ({
    x: daysBetween(historyStartKey, key),
    y: consumptionByDay.get(key) || 0
  }));
  const fit = fitLinearRegression(regressionPoints);

  const trendUsable =
    fit !== null &&
    observedDays.length >= MIN_DAYS_FOR_TREND &&
    fit.r2 >= MIN_R2_FOR_TREND;

  const trendRate = trendUsable
    ? Math.max(0, fit.predict(daysBetween(historyStartKey, todayKey)))
    : null;

  // ---------------------------------------------------------------- step 4
  const observationBasedRate = trendUsable ? trendRate : observedRate;
  const confidenceWeight =
    observedDays.length === 0 ? 0 : Math.min(1, observedDays.length / CONFIDENCE_FULL_DAYS);

  let effectiveRate;
  if (observationBasedRate === null) {
    effectiveRate = scheduledRate;
  } else {
    effectiveRate =
      confidenceWeight * observationBasedRate + (1 - confidenceWeight) * scheduledRate;
  }

  // Adherence ratio expresses how much of the prescribed amount is really used.
  const adherenceRatio =
    scheduledRate > 0 && observedRate !== null ? observedRate / scheduledRate : null;

  // ---------------------------------------------------------------- step 5
  const projection = projectStock({
    schedules,
    startKey: addDays(todayKey, 1),
    days: horizonDays,
    timezone,
    startingStock: currentStock,
    effectiveRate,
    scheduledRate,
    refillThreshold
  });

  // ---------------------------------------------------------------- step 6
  const daysOfSupply = projection.runOutDayIndex;
  const urgency = urgencyOf(daysOfSupply, currentStock, refillThreshold);

  return {
    medicineId: String(medicine?._id ?? medicine?.id ?? ''),
    medicineName: medicine?.name,
    unit,

    stock: {
      currentStock,
      refillThreshold,
      belowThreshold: currentStock <= refillThreshold
    },

    consumption: {
      lookbackDays,
      observedDays: observedDays.length,
      expectedDoses,
      takenDoses,
      skippedDoses,
      missedDoses,
      takenQuantity: round2(takenQuantity),
      /** Recorded for transparency - deliberately NOT deducted from stock. */
      skippedQuantityNotDeducted: round2(skippedQuantity),
      adherenceRatio: adherenceRatio === null ? null : round2(adherenceRatio)
    },

    rates: {
      scheduledPerDay: round2(scheduledRate),
      observedPerDay: observedRate === null ? null : round2(observedRate),
      trendPerDay: trendRate === null ? null : round2(trendRate),
      effectivePerDay: round2(effectiveRate),
      confidenceWeight: round2(confidenceWeight),
      basis: describeBasis(observationBasedRate, trendUsable, confidenceWeight)
    },

    regression: fit
      ? {
          used: trendUsable,
          reasonIfUnused: trendUsable
            ? null
            : observedDays.length < MIN_DAYS_FOR_TREND
              ? `only ${observedDays.length} day(s) of consumption data (need ${MIN_DAYS_FOR_TREND})`
              : `fit quality too low (r2 ${round2(fit.r2)} < ${MIN_R2_FOR_TREND})`,
          features: ['dayIndexSinceLookbackStart'],
          target: 'quantityTakenPerDay',
          samples: fit.n,
          slopePerDay: round2(fit.slope),
          intercept: round2(fit.intercept),
          r2: round2(fit.r2),
          predictionForToday: trendRate === null ? null : round2(trendRate)
        }
      : {
          used: false,
          reasonIfUnused: 'not enough varied consumption data to fit a trend',
          features: ['dayIndexSinceLookbackStart'],
          target: 'quantityTakenPerDay',
          samples: regressionPoints.length,
          slopePerDay: null,
          intercept: null,
          r2: null,
          predictionForToday: null
        },

    prediction: {
      daysOfSupply,
      runOutDate: projection.runOutDateKey,
      thresholdDate: projection.thresholdDateKey,
      daysUntilThreshold: projection.thresholdDayIndex,
      /** Suggested reorder date: when stock reaches the threshold, or today. */
      suggestedRefillDate: projection.thresholdDateKey || todayKey,
      quantityToLastDays: 30,
      suggestedRefillQuantity: Math.ceil(effectiveRate * 30),
      urgency,
      horizonDays,
      truncatedHorizon: projection.truncated
    },

    explanation: buildExplanation({
      medicineName: medicine?.name,
      unit,
      currentStock,
      refillThreshold,
      scheduledRate,
      observedRate,
      trendRate,
      effectiveRate,
      confidenceWeight,
      skippedDoses,
      skippedQuantity,
      daysOfSupply,
      runOutDateKey: projection.runOutDateKey,
      thresholdDateKey: projection.thresholdDateKey,
      truncated: projection.truncated
    }),

    computedAt: new Date(now).toISOString(),
    timezone
  };
}

/** Mean scheduled quantity per calendar day over the coming horizon. */
function averageScheduledPerDay(schedules, todayKey, timezone, horizonDays) {
  // Inclusive window of exactly `horizonDays` calendar days, starting tomorrow.
  const from = localDateTime(addDays(todayKey, 1), '00:00', timezone);
  const to = localDateTime(addDays(todayKey, horizonDays), '23:59', timezone);
  const occurrences = scheduleService.expandSchedules(schedules, {
    from,
    to,
    timezone,
    includeInactive: false
  });
  if (!occurrences.length) return 0;
  const total = occurrences.reduce((sum, o) => sum + (Number(o.doseQuantity) || 0), 0);
  return total / horizonDays;
}

/**
 * Day-by-day stock walk.
 *
 * Each future day consumes the quantity that day's schedule calls for, scaled
 * by how much of the prescribed amount the patient actually takes. Scaling
 * per day (rather than spreading a flat average) keeps alternate-day, weekday
 * and cycle regimens honest: an "every third day" medicine still only depletes
 * on the days it is due.
 */
function projectStock({
  schedules,
  startKey,
  days,
  timezone,
  startingStock,
  effectiveRate,
  scheduledRate,
  refillThreshold
}) {
  const adherenceScale = scheduledRate > 0 ? effectiveRate / scheduledRate : 1;
  const hasFixedSchedule = schedules.some(
    (s) => s.isActive !== false && s.frequency !== 'as_needed'
  );

  let stock = startingStock;
  let runOutDayIndex = null;
  let thresholdDayIndex = null;
  let runOutDateKey = null;
  let thresholdDateKey = null;

  // No active schedule and no consumption: supply is effectively unlimited.
  if (scheduledRate === 0 && effectiveRate === 0) {
    return {
      runOutDayIndex: null,
      thresholdDayIndex: null,
      runOutDateKey: null,
      thresholdDateKey: null,
      truncated: false
    };
  }

  for (let i = 0; i < days; i += 1) {
    const dateKey = addDays(startKey, i);

    let dayQuantity = 0;
    for (const schedule of schedules) {
      if (schedule.isActive === false) continue;
      if (schedule.frequency === 'as_needed') continue;
      if (!scheduleService.isDueOnDate(schedule, dateKey, timezone)) continue;
      for (const slot of schedule.times || []) {
        dayQuantity += Number(slot.doseQuantity) || 0;
      }
    }

    // On a day the regimen does not call for a dose, nothing is consumed - this
    // is what keeps alternate-day, weekday-only and cycle regimens honest.
    // The flat effective rate is used only when there is no fixed schedule at
    // all (an as-needed medicine the patient is demonstrably consuming).
    const consumed =
      dayQuantity > 0 ? dayQuantity * adherenceScale : hasFixedSchedule ? 0 : effectiveRate;
    if (consumed <= 0) continue;

    stock -= consumed;

    if (thresholdDayIndex === null && stock <= refillThreshold) {
      thresholdDayIndex = i + 1;
      thresholdDateKey = dateKey;
    }
    if (stock <= 0) {
      runOutDayIndex = i + 1;
      runOutDateKey = dateKey;
      break;
    }
  }

  return {
    runOutDayIndex,
    thresholdDayIndex,
    runOutDateKey,
    thresholdDateKey,
    truncated: runOutDayIndex === null
  };
}

function urgencyOf(daysOfSupply, currentStock, refillThreshold) {
  if (currentStock <= 0) return 'out_of_stock';
  if (currentStock <= refillThreshold) return 'refill_now';
  if (daysOfSupply === null) return 'ok';
  if (daysOfSupply <= 3) return 'critical';
  if (daysOfSupply <= 7) return 'urgent';
  if (daysOfSupply <= 14) return 'soon';
  return 'ok';
}

function describeBasis(observationBasedRate, trendUsable, confidenceWeight) {
  if (observationBasedRate === null) return 'schedule_only';
  if (confidenceWeight >= 1) return trendUsable ? 'observed_trend' : 'observed_average';
  return trendUsable ? 'blend_trend_and_schedule' : 'blend_average_and_schedule';
}

/** Human-readable justification shown in the UI and usable in a viva. */
function buildExplanation(ctx) {
  const lines = [];
  const name = ctx.medicineName || 'This medicine';

  lines.push(
    `${name}: ${round2(ctx.currentStock)} ${ctx.unit}(s) on hand, refill threshold ${ctx.refillThreshold}.`
  );
  lines.push(
    `The schedule calls for ${round2(ctx.scheduledRate)} ${ctx.unit}(s) per day on average.`
  );

  if (ctx.observedRate === null) {
    lines.push(
      'There is no recorded intake history yet, so the prediction uses the prescribed schedule alone.'
    );
  } else {
    lines.push(
      `Recorded intake shows ${round2(ctx.observedRate)} ${ctx.unit}(s) actually taken per day.`
    );
    if (ctx.skippedDoses > 0) {
      lines.push(
        `${ctx.skippedDoses} dose(s) (${round2(ctx.skippedQuantity)} ${ctx.unit}(s)) were skipped and were NOT deducted from stock, so the supply lasts longer than the prescription implies.`
      );
    }
    if (ctx.trendRate !== null) {
      lines.push(
        `A linear-regression fit over daily consumption projects ${round2(ctx.trendRate)} ${ctx.unit}(s) per day at the current trend.`
      );
    }
    lines.push(
      `With ${Math.round(ctx.confidenceWeight * 100)}% confidence in the observed history, the effective consumption rate used is ${round2(ctx.effectiveRate)} ${ctx.unit}(s) per day.`
    );
  }

  if (ctx.daysOfSupply === null) {
    lines.push(
      ctx.truncated
        ? 'At this rate the current stock lasts beyond the forecast horizon.'
        : 'No active schedule is consuming this medicine, so no run-out date can be projected.'
    );
  } else {
    lines.push(
      `Projecting the schedule forward day by day, stock runs out in about ${ctx.daysOfSupply} day(s), on ${ctx.runOutDateKey}.`
    );
  }
  if (ctx.thresholdDateKey) {
    lines.push(`Stock reaches the refill threshold on ${ctx.thresholdDateKey}.`);
  }

  return lines;
}

module.exports = {
  predictRefill,
  projectStock,
  averageScheduledPerDay,
  urgencyOf,
  LOOKBACK_DAYS,
  HORIZON_DAYS,
  CONFIDENCE_FULL_DAYS,
  MIN_DAYS_FOR_TREND,
  MIN_R2_FOR_TREND
};
