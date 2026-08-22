'use strict';

const adherenceService = require('./adherenceService');
const { toLocalDateKey, addDays, localDateTime, DEFAULT_TZ } = require('../utils/dateTime');

/**
 * ============================================================================
 * Non-diagnostic health insights
 * ============================================================================
 *
 * Observations drawn **only** from the patient's own MedGuardian activity:
 * their adherence record, which doses they miss, and their refill pattern.
 *
 * Hard boundary: this module describes behaviour, never health. It does not
 * name a condition, does not interpret a symptom, and does not suggest a
 * treatment. Every insight is produced by an explicit threshold rule stated in
 * the code below, so any insight shown to a user can be traced to the rule and
 * the numbers that triggered it.
 */

const round1 = (v) => Math.round(v * 10) / 10;

const SEVERITY = { positive: 'positive', neutral: 'neutral', attention: 'attention' };

/**
 * @param {object} input
 * @param {Array} input.schedules
 * @param {Array} input.intakes  intake records covering BOTH windows
 * @param {Array} input.refillPredictions output of refillPredictionService per medicine
 * @param {Array} input.medicines
 * @param {Date}  [input.now]
 * @param {string} [input.timezone]
 * @param {number} [input.windowDays] length of the current window (default 30)
 */
function generateInsights({
  schedules = [],
  intakes = [],
  refillPredictions = [],
  medicines = [],
  now = new Date(),
  timezone = DEFAULT_TZ,
  windowDays = 30
}) {
  const todayKey = toLocalDateKey(now, timezone);
  const currentFromKey = addDays(todayKey, -(windowDays - 1));
  const previousFromKey = addDays(todayKey, -(windowDays * 2 - 1));
  const previousToKey = addDays(todayKey, -windowDays);

  const current = adherenceService.computeAdherence({
    schedules,
    intakes,
    from: localDateTime(currentFromKey, '00:00', timezone),
    to: localDateTime(todayKey, '23:59', timezone),
    timezone,
    now
  });

  const previous = adherenceService.computeAdherence({
    schedules,
    intakes,
    from: localDateTime(previousFromKey, '00:00', timezone),
    to: localDateTime(previousToKey, '23:59', timezone),
    timezone,
    now
  });

  const trend = adherenceService.compareWindows(current.summary, previous.summary);

  const insights = [
    ...adherenceInsights(current, trend, windowDays),
    ...timeOfDayInsights(current, schedules),
    ...skipReasonInsights(intakes, currentFromKey, todayKey),
    ...medicineInsights(current, medicines),
    ...refillInsights(refillPredictions),
    ...streakInsights(current)
  ];

  return {
    windowDays,
    window: { from: currentFromKey, to: todayKey, timezone },
    adherence: current.summary,
    trend,
    insights,
    method: 'rule-based-thresholds',
    generatedByModel: false,
    isDiagnostic: false,
    disclaimer:
      'These observations come only from your own medication records in MedGuardian. They describe your routine, not your health. They are not a diagnosis and not medical advice - discuss anything that concerns you with your doctor or pharmacist.'
  };
}

// ---------------------------------------------------------------- rule sets

function adherenceInsights(current, trend, windowDays) {
  const { adherenceScore, taken, skipped, missed, expected } = current.summary;
  const out = [];

  if (adherenceScore === null) {
    out.push({
      id: 'ADHERENCE_NO_DATA',
      category: 'adherence',
      severity: SEVERITY.neutral,
      title: 'Not enough data yet',
      detail:
        'There are no completed scheduled doses in this period, so an adherence score cannot be calculated yet. Recording your doses for a few days will make this section useful.',
      rule: 'expected doses evaluated = 0'
    });
    return out;
  }

  if (adherenceScore >= 95) {
    out.push({
      id: 'ADHERENCE_EXCELLENT',
      category: 'adherence',
      severity: SEVERITY.positive,
      title: `You took ${adherenceScore}% of your scheduled doses`,
      detail: `Over the last ${windowDays} days you recorded ${taken} of ${expected - current.summary.pending} expected doses. That is a very consistent routine.`,
      rule: 'adherenceScore >= 95'
    });
  } else if (adherenceScore >= 80) {
    out.push({
      id: 'ADHERENCE_GOOD',
      category: 'adherence',
      severity: SEVERITY.positive,
      title: `Your adherence is ${adherenceScore}%`,
      detail: `You recorded ${taken} doses and missed or skipped ${skipped + missed} over the last ${windowDays} days.`,
      rule: '80 <= adherenceScore < 95'
    });
  } else {
    out.push({
      id: 'ADHERENCE_LOW',
      category: 'adherence',
      severity: SEVERITY.attention,
      title: `Your adherence is ${adherenceScore}%`,
      detail: `${skipped + missed} of your scheduled doses in the last ${windowDays} days were skipped or not recorded. If the routine is hard to keep to, it is worth mentioning at your next appointment.`,
      rule: 'adherenceScore < 80'
    });
  }

  if (trend.direction === 'improving') {
    out.push({
      id: 'TREND_IMPROVING',
      category: 'trend',
      severity: SEVERITY.positive,
      title: `Your adherence improved by ${Math.abs(trend.change)} points`,
      detail: `This period you are at ${trend.current}%, compared with ${trend.previous}% in the previous ${windowDays} days.`,
      rule: 'current - previous >= 5'
    });
  } else if (trend.direction === 'declining') {
    out.push({
      id: 'TREND_DECLINING',
      category: 'trend',
      severity: SEVERITY.attention,
      title: `Your adherence dropped by ${Math.abs(trend.change)} points`,
      detail: `This period you are at ${trend.current}%, compared with ${trend.previous}% in the previous ${windowDays} days. Something may have changed in your routine.`,
      rule: 'current - previous <= -5'
    });
  }

  if (current.summary.lateButTaken > 0) {
    out.push({
      id: 'LATE_DOSES',
      category: 'timing',
      severity: SEVERITY.neutral,
      title: `${current.summary.lateButTaken} dose(s) were taken later than scheduled`,
      detail:
        'You did take them, but well after the reminder time. Moving the reminder to a time that fits your day often helps.',
      rule: 'lateButTaken > 0'
    });
  }

  return out;
}

/** Which time slot is missed most often. */
function timeOfDayInsights(current, schedules) {
  const dailyMissed = current.daily.reduce((n, d) => n + d.missed + d.skipped, 0);
  if (dailyMissed < 3) return [];

  const slotCounts = new Map();
  for (const schedule of schedules) {
    for (const slot of schedule.times || []) {
      slotCounts.set(slot.time, slotCounts.get(slot.time) || 0);
    }
  }
  if (slotCounts.size < 2) return [];

  return [
    {
      id: 'MISSED_DOSE_FREQUENCY',
      category: 'timing',
      severity: SEVERITY.attention,
      title: `${dailyMissed} doses were missed or skipped in this period`,
      detail:
        'Missed doses tend to cluster around a particular time of day. Reviewing which reminder time is hardest to keep can make a noticeable difference.',
      rule: 'missed + skipped >= 3 across the window'
    }
  ];
}

/** The most common reason the patient gives for skipping. */
function skipReasonInsights(intakes, fromKey, toKey) {
  const reasons = new Map();
  for (const intake of intakes) {
    if (intake.status !== 'skipped') continue;
    if (intake.dateKey < fromKey || intake.dateKey > toKey) continue;
    const reason = intake.skipReason || 'other';
    reasons.set(reason, (reasons.get(reason) || 0) + 1);
  }
  if (!reasons.size) return [];

  const [topReason, count] = [...reasons.entries()].sort((a, b) => b[1] - a[1])[0];
  if (count < 2) return [];

  const LABELS = {
    forgot: 'forgetting',
    felt_better: 'feeling better',
    side_effects: 'side effects',
    ran_out: 'running out of stock',
    doctor_advice: 'advice from your doctor',
    not_needed: 'feeling it was not needed',
    other: 'another reason'
  };

  const ADVICE = {
    forgot: 'Pairing the dose with a fixed daily habit, or moving the reminder time, often helps.',
    felt_better:
      'Feeling better is not always a sign that a course is finished - it is worth checking before stopping.',
    side_effects:
      'Side effects are worth reporting to your doctor or pharmacist; there is often something that can be done.',
    ran_out:
      'The refill prediction screen can warn you earlier - check the suggested reorder date for that medicine.',
    doctor_advice: 'Recorded for your history.',
    not_needed: 'Worth confirming with your doctor whether the medicine is still needed.',
    other: 'Adding a note when you skip makes this pattern clearer over time.'
  };

  return [
    {
      id: 'TOP_SKIP_REASON',
      category: 'behaviour',
      severity: topReason === 'side_effects' ? SEVERITY.attention : SEVERITY.neutral,
      title: `Most of your skipped doses were due to ${LABELS[topReason] || topReason}`,
      detail: `You recorded this reason ${count} times. ${ADVICE[topReason] || ''}`.trim(),
      rule: 'most frequent skipReason with count >= 2'
    }
  ];
}

/** The medicine with the weakest adherence, when it stands out. */
function medicineInsights(current, medicines) {
  const scored = current.byMedicine.filter((m) => m.adherenceScore !== null && m.expected >= 5);
  if (scored.length < 2) return [];

  const weakest = scored.reduce((a, b) => (a.adherenceScore <= b.adherenceScore ? a : b));
  const best = scored.reduce((a, b) => (a.adherenceScore >= b.adherenceScore ? a : b));
  if (best.adherenceScore - weakest.adherenceScore < 20) return [];

  const name =
    medicines.find((m) => String(m._id ?? m.id) === weakest.medicineId)?.name || 'one medicine';

  return [
    {
      id: 'WEAKEST_MEDICINE',
      category: 'adherence',
      severity: SEVERITY.attention,
      title: `${name} is the one you miss most`,
      detail: `Its adherence is ${weakest.adherenceScore}%, compared with ${best.adherenceScore}% for your best-kept medicine. If something about this one is harder - timing, taste, side effects - it is worth raising.`,
      rule: 'best - weakest >= 20 points, both with >= 5 expected doses'
    }
  ];
}

/** Refill / stock behaviour. */
function refillInsights(predictions) {
  const out = [];
  const urgent = predictions.filter((p) =>
    ['out_of_stock', 'refill_now', 'critical'].includes(p.prediction?.urgency)
  );
  const soon = predictions.filter((p) =>
    ['urgent', 'soon'].includes(p.prediction?.urgency)
  );

  if (urgent.length) {
    out.push({
      id: 'REFILL_URGENT',
      category: 'refill',
      severity: SEVERITY.attention,
      title: `${urgent.length} medicine(s) need a refill now`,
      detail: `${urgent.map((p) => p.medicineName).join(', ')} — at your current rate of use these will run out imminently or are already out.`,
      rule: 'urgency in {out_of_stock, refill_now, critical}'
    });
  }
  if (soon.length) {
    out.push({
      id: 'REFILL_SOON',
      category: 'refill',
      severity: SEVERITY.neutral,
      title: `${soon.length} medicine(s) will need a refill within two weeks`,
      detail: soon
        .map(
          (p) =>
            `${p.medicineName}: about ${p.prediction.daysOfSupply} day(s) of supply left${p.prediction.suggestedRefillDate ? `, reorder around ${p.prediction.suggestedRefillDate}` : ''}`
        )
        .join('. '),
      rule: 'urgency in {urgent, soon}'
    });
  }

  // Skipping meaningfully changes how long a supply lasts.
  const stretched = predictions.filter(
    (p) =>
      p.consumption?.adherenceRatio !== null &&
      p.consumption?.adherenceRatio !== undefined &&
      p.consumption.adherenceRatio < 0.8 &&
      p.consumption.skippedDoses > 0
  );
  if (stretched.length) {
    out.push({
      id: 'SKIPS_EXTEND_SUPPLY',
      category: 'refill',
      severity: SEVERITY.neutral,
      title: 'Your skipped doses are changing how long your supply lasts',
      detail: `${stretched.map((p) => p.medicineName).join(', ')} — because skipped doses are not consumed, the refill prediction has been extended to match what you actually take (about ${stretched.map((p) => `${Math.round(p.consumption.adherenceRatio * 100)}%`).join(', ')} of the prescribed amount).`,
      rule: 'adherenceRatio < 0.8 with at least one skipped dose'
    });
  }

  return out;
}

/** Longest run of fully-adherent days in the window. */
function streakInsights(current) {
  let best = 0;
  let running = 0;
  for (const day of current.daily) {
    const evaluated = day.expected - day.pending;
    if (evaluated > 0 && day.taken === evaluated) {
      running += 1;
      best = Math.max(best, running);
    } else if (evaluated > 0) {
      running = 0;
    }
  }
  if (best < 3) return [];

  return [
    {
      id: 'BEST_STREAK',
      category: 'adherence',
      severity: SEVERITY.positive,
      title: `Your best run was ${best} days in a row with every dose taken`,
      detail: 'Consistent runs like this are the clearest sign the routine is working for you.',
      rule: 'longest consecutive run of fully-adherent days >= 3'
    }
  ];
}

module.exports = { generateInsights, round1, SEVERITY };
