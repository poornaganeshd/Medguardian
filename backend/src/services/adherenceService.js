'use strict';

const scheduleService = require('./scheduleService');
const { toLocalDateKey, DEFAULT_TZ } = require('../utils/dateTime');

/**
 * Medication adherence scoring.
 *
 * Definitions used throughout MedGuardian (stated explicitly because different
 * papers define adherence differently):
 *
 *   expected  - doses the active fixed schedules called for in the window,
 *               counted only up to `now` (a dose later today is not yet a
 *               failure). As-needed medicines produce no expected doses and
 *               therefore never influence the score.
 *   taken     - doses the patient recorded as taken.
 *   skipped   - doses the patient explicitly recorded as skipped.
 *   missed    - expected doses with no record at all once the day has passed.
 *   pending   - expected doses still actionable right now (due / late).
 *
 *   adherence % = taken / (expected - pending) x 100
 *
 * The denominator excludes still-actionable doses so the score does not dip
 * during the day and recover by evening. When nothing is expected yet, the
 * score is reported as `null` rather than 0 or 100 - "no data" is not the same
 * as "perfect" or "failed".
 *
 * Everything here is a pure function over data the caller supplies, so it can
 * be unit tested and explained line by line during a project review.
 */

const round1 = (value) => Math.round(value * 10) / 10;

/** Buckets a derived occurrence status into an adherence category. */
function categorise(status) {
  switch (status) {
    case 'taken':
      return 'taken';
    case 'skipped':
      return 'skipped';
    case 'missed':
      return 'missed';
    case 'due':
    case 'late':
      return 'pending';
    case 'upcoming':
      return 'upcoming';
    default:
      return 'upcoming';
  }
}

/**
 * Computes an adherence report.
 *
 * @param {object} input
 * @param {Array} input.schedules stored schedules (medicine may be populated)
 * @param {Array} input.intakes stored intake records covering the window
 * @param {Date|string} input.from window start
 * @param {Date|string} input.to window end
 * @param {string} [input.timezone]
 * @param {Date} [input.now]
 * @returns {{summary: object, byMedicine: Array, daily: Array}}
 */
function computeAdherence({ schedules = [], intakes = [], from, to, timezone = DEFAULT_TZ, now = new Date() }) {
  const evaluationEnd = new Date(to) < new Date(now) ? new Date(to) : new Date(now);

  const occurrences = scheduleService.expandSchedules(schedules, {
    from,
    to,
    timezone,
    includeInactive: true
  });

  const withStatus = scheduleService.attachIntakes(occurrences, intakes, now);

  const summary = {
    expected: 0,
    taken: 0,
    skipped: 0,
    missed: 0,
    pending: 0,
    upcoming: 0,
    lateButTaken: 0
  };
  const byMedicineMap = new Map();
  const dailyMap = new Map();

  const intakeByOccurrence = new Map();
  for (const intake of intakes) {
    intakeByOccurrence.set(
      scheduleService.occurrenceKey(
        String(intake.schedule?._id ?? intake.schedule ?? ''),
        intake.dateKey,
        intake.scheduledTime
      ),
      intake
    );
  }

  for (const occ of withStatus) {
    const bucket = categorise(occ.status);

    // Doses in the future are neither expected-yet nor a failure.
    if (bucket === 'upcoming') {
      summary.upcoming += 1;
      continue;
    }

    summary.expected += 1;
    summary[bucket] += 1;

    if (bucket === 'taken') {
      const intake = intakeByOccurrence.get(
        scheduleService.occurrenceKey(occ.scheduleId, occ.dateKey, occ.time)
      );
      if (intake?.wasLate) summary.lateButTaken += 1;
    }

    // ---- per medicine -------------------------------------------------
    const medId = occ.medicineId;
    if (!byMedicineMap.has(medId)) {
      byMedicineMap.set(medId, {
        medicineId: medId,
        expected: 0,
        taken: 0,
        skipped: 0,
        missed: 0,
        pending: 0
      });
    }
    const med = byMedicineMap.get(medId);
    med.expected += 1;
    med[bucket] += 1;

    // ---- per day ------------------------------------------------------
    if (!dailyMap.has(occ.dateKey)) {
      dailyMap.set(occ.dateKey, {
        date: occ.dateKey,
        expected: 0,
        taken: 0,
        skipped: 0,
        missed: 0,
        pending: 0
      });
    }
    const day = dailyMap.get(occ.dateKey);
    day.expected += 1;
    day[bucket] += 1;
  }

  const scoreOf = (entry) => {
    const denominator = entry.expected - entry.pending;
    if (denominator <= 0) return null;
    return round1((entry.taken / denominator) * 100);
  };

  const byMedicine = [...byMedicineMap.values()].map((entry) => ({
    ...entry,
    adherenceScore: scoreOf(entry)
  }));

  const daily = [...dailyMap.values()]
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((entry) => ({ ...entry, adherenceScore: scoreOf(entry) }));

  const adherenceScore = scoreOf(summary);

  return {
    summary: {
      ...summary,
      evaluatedDoses: summary.expected - summary.pending,
      adherenceScore,
      adherenceLabel: labelFor(adherenceScore),
      window: {
        from: toLocalDateKey(from, timezone),
        to: toLocalDateKey(to, timezone),
        evaluatedTo: toLocalDateKey(evaluationEnd, timezone),
        timezone
      }
    },
    byMedicine,
    daily
  };
}

/**
 * Plain-language band for the score. Thresholds follow the widely used
 * medication-possession convention where >= 80% is considered adherent.
 */
function labelFor(score) {
  if (score === null || score === undefined) return 'no_data';
  if (score >= 95) return 'excellent';
  if (score >= 80) return 'good';
  if (score >= 60) return 'fair';
  return 'needs_attention';
}

/**
 * Compares two equal-length periods and reports the direction of travel.
 * Used by the non-diagnostic insights module.
 */
function compareWindows(currentSummary, previousSummary) {
  const current = currentSummary?.adherenceScore ?? null;
  const previous = previousSummary?.adherenceScore ?? null;
  if (current === null || previous === null) {
    return { direction: 'insufficient_data', change: null, current, previous };
  }
  const change = round1(current - previous);
  let direction = 'steady';
  if (change >= 5) direction = 'improving';
  else if (change <= -5) direction = 'declining';
  return { direction, change, current, previous };
}

module.exports = { computeAdherence, labelFor, compareWindows, categorise };
