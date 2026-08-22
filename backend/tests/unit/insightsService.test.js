'use strict';

const { generateInsights } = require('../../src/services/insightsService');
const { addDays, toLocalDateKey } = require('../../src/utils/dateTime');

const TZ = 'Asia/Kolkata';
const NOW = new Date('2026-03-31T23:00:00+05:30');
const TODAY = toLocalDateKey(NOW, TZ);

const schedule = (overrides = {}) => ({
  _id: 's1',
  medicine: 'm1',
  frequency: 'daily',
  times: [{ time: '08:00', doseQuantity: 1 }],
  startDate: new Date('2026-01-01T00:00:00+05:30'),
  isActive: true,
  graceMinutes: 60,
  ...overrides
});

/** Intake records for the last `days` days, status decided per index. */
function history(days, statusFor, overrides = {}) {
  const records = [];
  for (let i = days; i >= 1; i -= 1) {
    const status = statusFor(days - i);
    if (!status) continue;
    records.push({
      _id: `i${i}`,
      schedule: 's1',
      medicine: 'm1',
      dateKey: addDays(TODAY, -i),
      scheduledTime: '08:00',
      status,
      doseQuantity: 1,
      ...overrides
    });
  }
  return records;
}

const run = (input) =>
  generateInsights({ now: NOW, timezone: TZ, windowDays: 30, ...input });

const idsOf = (result) => result.insights.map((i) => i.id);

describe('generateInsights — framing', () => {
  it('declares itself non-diagnostic, rule based and not model-generated', () => {
    const result = run({ schedules: [schedule()], intakes: history(30, () => 'taken') });
    expect(result.isDiagnostic).toBe(false);
    expect(result.method).toBe('rule-based-thresholds');
    expect(result.generatedByModel).toBe(false);
    expect(result.disclaimer).toMatch(/not a diagnosis and not medical advice/i);
    expect(result.disclaimer).toMatch(/describe your routine, not your health/i);
  });

  it('states the rule behind every insight', () => {
    const result = run({ schedules: [schedule()], intakes: history(30, () => 'taken') });
    for (const insight of result.insights) {
      expect(insight.rule).toBeTruthy();
      expect(['positive', 'neutral', 'attention']).toContain(insight.severity);
    }
  });

  it('never names a medical condition', () => {
    const result = run({
      schedules: [schedule()],
      intakes: history(60, (i) => (i % 3 === 0 ? 'skipped' : 'taken'))
    });
    const text = JSON.stringify(result.insights).toLowerCase();
    for (const word of ['diabetes', 'hypertension', 'cancer', 'infection', 'diagnos']) {
      expect(text).not.toContain(word);
    }
  });
});

describe('adherence insights', () => {
  it('reports no data when nothing has been expected', () => {
    const result = run({ schedules: [], intakes: [] });
    expect(idsOf(result)).toContain('ADHERENCE_NO_DATA');
  });

  it('praises excellent adherence', () => {
    const result = run({ schedules: [schedule()], intakes: history(60, () => 'taken') });
    expect(idsOf(result)).toContain('ADHERENCE_EXCELLENT');
    expect(result.insights.find((i) => i.id === 'ADHERENCE_EXCELLENT').severity).toBe('positive');
  });

  it('flags low adherence for attention without alarm', () => {
    const result = run({
      schedules: [schedule()],
      intakes: history(60, (i) => (i % 2 === 0 ? 'taken' : 'skipped'))
    });
    const low = result.insights.find((i) => i.id === 'ADHERENCE_LOW');
    expect(low).toBeTruthy();
    expect(low.severity).toBe('attention');
    expect(low.detail).toMatch(/worth mentioning at your next appointment/i);
  });

  it('detects an improving trend', () => {
    // Previous 30 days poor, current 30 days perfect.
    const intakes = history(60, (i) => (i < 30 ? 'skipped' : 'taken'));
    const result = run({ schedules: [schedule()], intakes });
    expect(idsOf(result)).toContain('TREND_IMPROVING');
  });

  it('detects a declining trend', () => {
    const intakes = history(60, (i) => (i < 30 ? 'taken' : 'skipped'));
    const result = run({ schedules: [schedule()], intakes });
    expect(idsOf(result)).toContain('TREND_DECLINING');
  });

  it('notes doses that were taken late', () => {
    const result = run({
      schedules: [schedule()],
      intakes: history(30, () => 'taken', { wasLate: true, minutesLate: 200 })
    });
    expect(idsOf(result)).toContain('LATE_DOSES');
  });

  it('reports a good adherence streak', () => {
    const result = run({ schedules: [schedule()], intakes: history(30, () => 'taken') });
    const streak = result.insights.find((i) => i.id === 'BEST_STREAK');
    expect(streak).toBeTruthy();
    expect(streak.title).toMatch(/days in a row/);
  });
});

describe('behaviour insights', () => {
  it('identifies the most common skip reason and offers a practical suggestion', () => {
    const intakes = history(30, (i) => (i % 2 === 0 ? 'skipped' : 'taken')).map((r) =>
      r.status === 'skipped' ? { ...r, skipReason: 'forgot' } : r
    );
    const result = run({ schedules: [schedule()], intakes });
    const insight = result.insights.find((i) => i.id === 'TOP_SKIP_REASON');
    expect(insight.title).toMatch(/forgetting/i);
    expect(insight.detail).toMatch(/fixed daily habit/i);
  });

  it('treats side effects as needing attention', () => {
    const intakes = history(30, (i) => (i % 2 === 0 ? 'skipped' : 'taken')).map((r) =>
      r.status === 'skipped' ? { ...r, skipReason: 'side_effects' } : r
    );
    const result = run({ schedules: [schedule()], intakes });
    const insight = result.insights.find((i) => i.id === 'TOP_SKIP_REASON');
    expect(insight.severity).toBe('attention');
    expect(insight.detail).toMatch(/worth reporting to your doctor/i);
  });

  it('does not report a skip reason seen only once', () => {
    const intakes = history(30, (i) => (i === 0 ? 'skipped' : 'taken')).map((r) =>
      r.status === 'skipped' ? { ...r, skipReason: 'forgot' } : r
    );
    const result = run({ schedules: [schedule()], intakes });
    expect(idsOf(result)).not.toContain('TOP_SKIP_REASON');
  });

  it('points out the medicine with the weakest adherence', () => {
    const second = schedule({ _id: 's2', medicine: 'm2' });
    const intakes = [
      ...history(30, () => 'taken'),
      ...history(30, (i) => (i % 4 === 0 ? 'taken' : 'skipped')).map((r) => ({
        ...r,
        _id: `x${r._id}`,
        schedule: 's2',
        medicine: 'm2',
        skipReason: 'forgot'
      }))
    ];
    const result = run({
      schedules: [schedule(), second],
      intakes,
      medicines: [
        { _id: 'm1', name: 'Metformin' },
        { _id: 'm2', name: 'Atorvastatin' }
      ]
    });
    const insight = result.insights.find((i) => i.id === 'WEAKEST_MEDICINE');
    expect(insight.title).toMatch(/Atorvastatin/);
  });
});

describe('refill insights', () => {
  const prediction = (name, urgency, extra = {}) => ({
    medicineName: name,
    prediction: { urgency, daysOfSupply: 5, suggestedRefillDate: '2026-04-02' },
    consumption: { adherenceRatio: 1, skippedDoses: 0 },
    ...extra
  });

  it('flags medicines needing an immediate refill', () => {
    const result = run({
      schedules: [schedule()],
      intakes: history(30, () => 'taken'),
      refillPredictions: [prediction('Metformin', 'out_of_stock')]
    });
    const insight = result.insights.find((i) => i.id === 'REFILL_URGENT');
    expect(insight.severity).toBe('attention');
    expect(insight.detail).toMatch(/Metformin/);
  });

  it('gives advance warning for medicines running low', () => {
    const result = run({
      schedules: [schedule()],
      intakes: history(30, () => 'taken'),
      refillPredictions: [prediction('Aspirin', 'soon')]
    });
    const insight = result.insights.find((i) => i.id === 'REFILL_SOON');
    expect(insight.detail).toMatch(/reorder around 2026-04-02/);
  });

  it('explains how skipped doses stretch the supply', () => {
    const result = run({
      schedules: [schedule()],
      intakes: history(30, (i) => (i % 2 === 0 ? 'taken' : 'skipped')),
      refillPredictions: [
        prediction('Metformin', 'ok', {
          consumption: { adherenceRatio: 0.5, skippedDoses: 15 }
        })
      ]
    });
    const insight = result.insights.find((i) => i.id === 'SKIPS_EXTEND_SUPPLY');
    expect(insight.detail).toMatch(/skipped doses are not consumed/i);
    expect(insight.detail).toMatch(/50%/);
  });

  it('says nothing about refills when everything is well stocked', () => {
    const result = run({
      schedules: [schedule()],
      intakes: history(30, () => 'taken'),
      refillPredictions: [prediction('Metformin', 'ok')]
    });
    const ids = idsOf(result);
    expect(ids).not.toContain('REFILL_URGENT');
    expect(ids).not.toContain('REFILL_SOON');
  });
});

describe('robustness', () => {
  it('handles a patient with no data at all', () => {
    const result = generateInsights({});
    expect(result.insights.length).toBeGreaterThan(0);
    expect(result.adherence.adherenceScore).toBeNull();
  });

  it('is deterministic', () => {
    const input = { schedules: [schedule()], intakes: history(40, (i) => (i % 3 ? 'taken' : 'skipped')) };
    expect(JSON.stringify(run(input))).toBe(JSON.stringify(run(input)));
  });
});
