'use strict';

const {
  predictRefill,
  urgencyOf
} = require('../../src/services/refillPredictionService');
const { addDays, toLocalDateKey } = require('../../src/utils/dateTime');

const TZ = 'Asia/Kolkata';
const NOW = new Date('2026-03-31T10:00:00+05:30');
const TODAY = toLocalDateKey(NOW, TZ); // 2026-03-31

const medicine = (overrides = {}) => ({
  _id: 'm1',
  name: 'Metformin',
  unit: 'tablet',
  currentStock: 30,
  refillThreshold: 5,
  initialQuantity: 60,
  ...overrides
});

const dailySchedule = (overrides = {}) => ({
  _id: 's1',
  medicine: 'm1',
  frequency: 'daily',
  times: [{ time: '08:00', doseQuantity: 1 }],
  startDate: new Date('2026-01-01T00:00:00+05:30'),
  isActive: true,
  graceMinutes: 60,
  ...overrides
});

/** Builds `count` intake records ending yesterday, alternating per pattern. */
function historyEndingYesterday(count, pattern) {
  const records = [];
  for (let i = count; i >= 1; i -= 1) {
    const dateKey = addDays(TODAY, -i);
    const status = pattern(count - i);
    records.push({
      _id: `i${i}`,
      schedule: 's1',
      medicine: 'm1',
      dateKey,
      scheduledTime: '08:00',
      status,
      doseQuantity: 1
    });
  }
  return records;
}

const run = (input) =>
  predictRefill({ now: NOW, timezone: TZ, ...input });

describe('DRPA — the skipped-dose rule', () => {
  it('does not deduct skipped doses from consumption', () => {
    const intakes = historyEndingYesterday(20, (i) => (i % 2 === 0 ? 'taken' : 'skipped'));
    const result = run({ medicine: medicine(), schedules: [dailySchedule()], intakes });

    expect(result.consumption.takenDoses).toBe(10);
    expect(result.consumption.skippedDoses).toBe(10);
    expect(result.consumption.skippedQuantityNotDeducted).toBe(10);
    // Half the prescribed doses are actually consumed.
    expect(result.consumption.adherenceRatio).toBeCloseTo(0.5, 1);
  });

  it('a patient who skips half their doses gets a longer supply estimate', () => {
    const perfect = run({
      medicine: medicine(),
      schedules: [dailySchedule()],
      intakes: historyEndingYesterday(20, () => 'taken')
    });
    const skipping = run({
      medicine: medicine(),
      schedules: [dailySchedule()],
      intakes: historyEndingYesterday(20, (i) => (i % 2 === 0 ? 'taken' : 'skipped'))
    });

    expect(perfect.rates.effectivePerDay).toBeCloseTo(1, 1);
    expect(skipping.rates.effectivePerDay).toBeLessThan(perfect.rates.effectivePerDay);
    expect(skipping.prediction.daysOfSupply).toBeGreaterThan(perfect.prediction.daysOfSupply);
  });

  it('the estimate moves as behaviour moves — more skipping stretches supply further', () => {
    const mostlyTaken = run({
      medicine: medicine(),
      schedules: [dailySchedule()],
      intakes: historyEndingYesterday(20, (i) => (i % 5 === 0 ? 'skipped' : 'taken'))
    });
    const mostlySkipped = run({
      medicine: medicine(),
      schedules: [dailySchedule()],
      intakes: historyEndingYesterday(20, (i) => (i % 5 === 0 ? 'taken' : 'skipped'))
    });

    expect(mostlySkipped.rates.effectivePerDay).toBeLessThan(mostlyTaken.rates.effectivePerDay);
    expect(mostlySkipped.prediction.daysOfSupply).toBeGreaterThan(
      mostlyTaken.prediction.daysOfSupply
    );
  });

  it('missed doses (never recorded) also do not consume stock', () => {
    const result = run({
      medicine: medicine(),
      schedules: [dailySchedule()],
      intakes: historyEndingYesterday(20, (i) => (i < 10 ? 'taken' : 'skipped')).slice(0, 10)
    });
    expect(result.consumption.missedDoses).toBeGreaterThan(0);
    expect(result.rates.observedPerDay).toBeLessThanOrEqual(1);
  });
});

describe('DRPA — consumption rates', () => {
  it('uses the schedule alone when there is no history', () => {
    const result = run({ medicine: medicine(), schedules: [dailySchedule()], intakes: [] });

    expect(result.rates.observedPerDay).toBeNull();
    expect(result.rates.basis).toBe('schedule_only');
    expect(result.rates.effectivePerDay).toBeCloseTo(1, 1);
    expect(result.rates.confidenceWeight).toBe(0);
    expect(result.prediction.daysOfSupply).toBe(30);
  });

  it('blends schedule and observation while history is short', () => {
    const result = run({
      medicine: medicine(),
      schedules: [dailySchedule()],
      intakes: historyEndingYesterday(4, () => 'skipped')
    });
    expect(result.rates.confidenceWeight).toBeLessThan(1);
    expect(result.rates.basis).toMatch(/^blend_/);
    // Skipping everything pulls the rate below the scheduled 1/day, but the
    // schedule still holds it above zero.
    expect(result.rates.effectivePerDay).toBeGreaterThan(0);
    expect(result.rates.effectivePerDay).toBeLessThan(1);
  });

  it('lets observation dominate once there are 14+ days of data', () => {
    const result = run({
      medicine: medicine(),
      schedules: [dailySchedule()],
      intakes: historyEndingYesterday(20, () => 'taken')
    });
    expect(result.rates.confidenceWeight).toBe(1);
    expect(result.rates.basis).toMatch(/^observed_/);
  });

  it('accounts for a twice-daily schedule', () => {
    const twiceDaily = dailySchedule({
      times: [
        { time: '08:00', doseQuantity: 1 },
        { time: '20:00', doseQuantity: 1 }
      ]
    });
    const result = run({ medicine: medicine(), schedules: [twiceDaily], intakes: [] });
    expect(result.rates.scheduledPerDay).toBeCloseTo(2, 1);
    expect(result.prediction.daysOfSupply).toBe(15);
  });

  it('respects an alternate-day regimen instead of smoothing it away', () => {
    const alternate = dailySchedule({ frequency: 'interval', intervalDays: 2 });
    const result = run({ medicine: medicine({ currentStock: 10 }), schedules: [alternate], intakes: [] });

    expect(result.rates.scheduledPerDay).toBeCloseTo(0.5, 1);
    // 10 tablets at one every other day lasts about 20 days.
    expect(result.prediction.daysOfSupply).toBeGreaterThanOrEqual(19);
    expect(result.prediction.daysOfSupply).toBeLessThanOrEqual(21);
  });

  it('handles a weekday-only regimen', () => {
    const weekdays = dailySchedule({ frequency: 'specific_days', daysOfWeek: [1, 2, 3, 4, 5] });
    const result = run({ medicine: medicine({ currentStock: 10 }), schedules: [weekdays], intakes: [] });
    expect(result.rates.scheduledPerDay).toBeGreaterThan(0.6);
    expect(result.rates.scheduledPerDay).toBeLessThan(0.8);
    expect(result.prediction.daysOfSupply).toBeGreaterThan(10);
  });
});

describe('DRPA — linear regression component', () => {
  it('is not used when there is too little data, and says why', () => {
    const result = run({
      medicine: medicine(),
      schedules: [dailySchedule()],
      intakes: historyEndingYesterday(4, () => 'taken')
    });
    expect(result.regression.used).toBe(false);
    expect(result.regression.reasonIfUnused).toMatch(/day\(s\) of consumption data/);
  });

  it('is not used when the fit does not explain the data, and says why', () => {
    // Alternating 1/0 consumption: no linear trend at all.
    const intakes = historyEndingYesterday(20, (i) => (i % 2 === 0 ? 'taken' : 'skipped'));
    const result = run({ medicine: medicine(), schedules: [dailySchedule()], intakes });
    expect(result.regression.used).toBe(false);
    expect(result.regression.reasonIfUnused).toMatch(/fit quality too low/);
    expect(result.rates.basis).toBe('observed_average');
  });

  it('stores the input features, coefficients and r2 whenever a fit exists', () => {
    const result = run({
      medicine: medicine(),
      schedules: [dailySchedule()],
      intakes: historyEndingYesterday(20, () => 'taken')
    });
    expect(result.regression.features).toEqual(['dayIndexSinceLookbackStart']);
    expect(result.regression.target).toBe('quantityTakenPerDay');
    expect(result.regression.samples).toBeGreaterThan(0);
    expect(result.regression.r2).not.toBeNull();
  });

  it('follows a rising consumption trend when the fit is strong', () => {
    // Dose quantity climbs steadily: 1,1,2,2,3,3,... over 14 days.
    const intakes = [];
    for (let i = 14; i >= 1; i -= 1) {
      intakes.push({
        _id: `r${i}`,
        schedule: 's1',
        medicine: 'm1',
        dateKey: addDays(TODAY, -i),
        scheduledTime: '08:00',
        status: 'taken',
        doseQuantity: Math.ceil((15 - i) / 3)
      });
    }
    const result = run({
      medicine: medicine({ currentStock: 60 }),
      schedules: [dailySchedule({ times: [{ time: '08:00', doseQuantity: 5 }] })],
      intakes
    });

    expect(result.regression.used).toBe(true);
    expect(result.regression.slopePerDay).toBeGreaterThan(0);
    expect(result.rates.trendPerDay).toBeGreaterThan(result.rates.observedPerDay);
  });
});

describe('DRPA — prediction output', () => {
  it('projects a run-out date and a threshold date', () => {
    const result = run({
      medicine: medicine({ currentStock: 10, refillThreshold: 3 }),
      schedules: [dailySchedule()],
      intakes: []
    });

    expect(result.prediction.daysOfSupply).toBe(10);
    expect(result.prediction.runOutDate).toBe(addDays(TODAY, 10));
    expect(result.prediction.thresholdDate).toBe(addDays(TODAY, 7));
    expect(result.prediction.daysUntilThreshold).toBe(7);
  });

  it('suggests a refill quantity covering 30 days at the effective rate', () => {
    const result = run({
      medicine: medicine(),
      schedules: [
        dailySchedule({
          times: [
            { time: '08:00', doseQuantity: 1 },
            { time: '20:00', doseQuantity: 1 }
          ]
        })
      ],
      intakes: []
    });
    expect(result.prediction.suggestedRefillQuantity).toBe(60);
  });

  it.each([
    [0, 5, 'out_of_stock'],
    [4, 5, 'refill_now'],
    [30, 5, null]
  ])('flags urgency for stock %s / threshold %s', (currentStock, refillThreshold, expected) => {
    const result = run({
      medicine: medicine({ currentStock, refillThreshold }),
      schedules: [dailySchedule()],
      intakes: []
    });
    if (expected) expect(result.prediction.urgency).toBe(expected);
    else expect(['ok', 'soon']).toContain(result.prediction.urgency);
  });

  it('escalates urgency as the days of supply shrink', () => {
    const supplyOf = (stock) =>
      run({
        medicine: medicine({ currentStock: stock, refillThreshold: 0 }),
        schedules: [dailySchedule()],
        intakes: []
      }).prediction.urgency;

    expect(supplyOf(2)).toBe('critical');
    expect(supplyOf(6)).toBe('urgent');
    expect(supplyOf(12)).toBe('soon');
    expect(supplyOf(60)).toBe('ok');
  });

  it('reports no run-out date when nothing consumes the medicine', () => {
    const result = run({ medicine: medicine(), schedules: [], intakes: [] });
    expect(result.prediction.daysOfSupply).toBeNull();
    expect(result.prediction.runOutDate).toBeNull();
    expect(result.prediction.urgency).toBe('ok');
  });

  it('ignores paused schedules when forecasting forward', () => {
    const result = run({
      medicine: medicine(),
      schedules: [dailySchedule({ isActive: false })],
      intakes: []
    });
    expect(result.rates.scheduledPerDay).toBe(0);
    expect(result.prediction.daysOfSupply).toBeNull();
  });

  it('stops the forecast at the horizon for a very large supply', () => {
    const result = run({
      medicine: medicine({ currentStock: 10000 }),
      schedules: [dailySchedule()],
      intakes: []
    });
    expect(result.prediction.daysOfSupply).toBeNull();
    expect(result.prediction.truncatedHorizon).toBe(true);
  });

  it('is deterministic — the same inputs always give the same answer', () => {
    const input = {
      medicine: medicine(),
      schedules: [dailySchedule()],
      intakes: historyEndingYesterday(20, (i) => (i % 3 === 0 ? 'skipped' : 'taken'))
    };
    expect(JSON.stringify(run(input))).toBe(JSON.stringify(run(input)));
  });
});

describe('DRPA — explanation', () => {
  it('explains the calculation in plain language, including the skip rule', () => {
    const result = run({
      medicine: medicine(),
      schedules: [dailySchedule()],
      intakes: historyEndingYesterday(20, (i) => (i % 2 === 0 ? 'taken' : 'skipped'))
    });

    const text = result.explanation.join(' ');
    expect(text).toContain('Metformin');
    expect(text).toMatch(/NOT deducted from stock/);
    expect(text).toMatch(/effective consumption rate/);
    expect(text).toMatch(/runs out in about/);
  });

  it('says when there is no history to work from', () => {
    const result = run({ medicine: medicine(), schedules: [dailySchedule()], intakes: [] });
    expect(result.explanation.join(' ')).toMatch(/no recorded intake history/i);
  });
});

describe('urgencyOf', () => {
  it.each([
    [null, 0, 5, 'out_of_stock'],
    [null, 3, 5, 'refill_now'],
    [2, 30, 5, 'critical'],
    [6, 30, 5, 'urgent'],
    [10, 30, 5, 'soon'],
    [40, 30, 5, 'ok'],
    [null, 30, 5, 'ok']
  ])('maps supply=%s stock=%s threshold=%s to %s', (supply, stock, threshold, expected) => {
    expect(urgencyOf(supply, stock, threshold)).toBe(expected);
  });
});
