'use strict';

const {
  computeAdherence,
  labelFor,
  compareWindows
} = require('../../src/services/adherenceService');

const TZ = 'Asia/Kolkata';

const schedule = (overrides = {}) => ({
  _id: 's1',
  medicine: 'm1',
  frequency: 'daily',
  times: [{ time: '08:00', doseQuantity: 1 }],
  startDate: new Date('2026-03-01T00:00:00+05:30'),
  isActive: true,
  graceMinutes: 60,
  ...overrides
});

const intake = (dateKey, status, overrides = {}) => ({
  _id: `i-${dateKey}-${status}`,
  schedule: 's1',
  medicine: 'm1',
  dateKey,
  scheduledTime: '08:00',
  status,
  doseQuantity: 1,
  ...overrides
});

const run = (schedules, intakes, { from, to, now }) =>
  computeAdherence({ schedules, intakes, from, to, timezone: TZ, now: new Date(now) });

describe('computeAdherence — core scoring', () => {
  const window = {
    from: '2026-03-01T00:00:00+05:30',
    to: '2026-03-05T23:59:00+05:30',
    now: '2026-03-06T09:00:00+05:30'
  };

  it('scores 100% when every expected dose was taken', () => {
    const intakes = ['2026-03-01', '2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05'].map(
      (d) => intake(d, 'taken')
    );
    const { summary } = run([schedule()], intakes, window);

    expect(summary.expected).toBe(5);
    expect(summary.taken).toBe(5);
    expect(summary.adherenceScore).toBe(100);
    expect(summary.adherenceLabel).toBe('excellent');
  });

  it('counts skipped doses against the score', () => {
    const intakes = [
      intake('2026-03-01', 'taken'),
      intake('2026-03-02', 'taken'),
      intake('2026-03-03', 'skipped'),
      intake('2026-03-04', 'taken'),
      intake('2026-03-05', 'taken')
    ];
    const { summary } = run([schedule()], intakes, window);

    expect(summary.taken).toBe(4);
    expect(summary.skipped).toBe(1);
    expect(summary.missed).toBe(0);
    expect(summary.adherenceScore).toBe(80);
    expect(summary.adherenceLabel).toBe('good');
  });

  it('counts unrecorded past doses as missed', () => {
    const { summary } = run([schedule()], [intake('2026-03-01', 'taken')], window);

    expect(summary.expected).toBe(5);
    expect(summary.taken).toBe(1);
    expect(summary.missed).toBe(4);
    expect(summary.adherenceScore).toBe(20);
    expect(summary.adherenceLabel).toBe('needs_attention');
  });

  it('separates taken, skipped and expected doses explicitly', () => {
    const intakes = [
      intake('2026-03-01', 'taken'),
      intake('2026-03-02', 'skipped'),
      intake('2026-03-03', 'taken')
    ];
    const { summary } = run([schedule()], intakes, window);
    expect(summary).toMatchObject({ expected: 5, taken: 2, skipped: 1, missed: 2 });
  });

  it('reports null (not zero) when nothing has been expected yet', () => {
    const { summary } = run([schedule({ startDate: new Date('2026-04-01T00:00:00+05:30') })], [], {
      from: '2026-03-01T00:00:00+05:30',
      to: '2026-03-05T23:59:00+05:30',
      now: '2026-03-06T09:00:00+05:30'
    });
    expect(summary.expected).toBe(0);
    expect(summary.adherenceScore).toBeNull();
    expect(summary.adherenceLabel).toBe('no_data');
  });
});

describe('computeAdherence — doses that are not yet failures', () => {
  it('excludes doses later today from the score', () => {
    const s = schedule({
      times: [
        { time: '08:00', doseQuantity: 1 },
        { time: '20:00', doseQuantity: 1 }
      ]
    });
    const { summary } = run([s], [intake('2026-03-01', 'taken')], {
      from: '2026-03-01T00:00:00+05:30',
      to: '2026-03-01T23:59:00+05:30',
      now: '2026-03-01T12:00:00+05:30'
    });

    // The 20:00 dose has not arrived, so only the 08:00 dose is evaluated.
    expect(summary.expected).toBe(1);
    expect(summary.upcoming).toBe(1);
    expect(summary.adherenceScore).toBe(100);
  });

  it('holds a still-actionable dose out of the denominator', () => {
    const s = schedule({
      times: [
        { time: '08:00', doseQuantity: 1 },
        { time: '11:00', doseQuantity: 1 }
      ]
    });
    const { summary } = run([s], [intake('2026-03-01', 'taken')], {
      from: '2026-03-01T00:00:00+05:30',
      to: '2026-03-01T23:59:00+05:30',
      now: '2026-03-01T11:30:00+05:30'
    });

    expect(summary.expected).toBe(2);
    expect(summary.pending).toBe(1);
    expect(summary.evaluatedDoses).toBe(1);
    expect(summary.adherenceScore).toBe(100);
  });
});

describe('computeAdherence — as-needed medicines', () => {
  it('never counts an as-needed medicine towards expected doses', () => {
    const prn = {
      _id: 's2',
      medicine: 'm2',
      frequency: 'as_needed',
      times: [],
      startDate: new Date('2026-03-01T00:00:00+05:30'),
      isActive: true
    };
    const { summary, byMedicine } = run([schedule(), prn], [intake('2026-03-01', 'taken')], {
      from: '2026-03-01T00:00:00+05:30',
      to: '2026-03-01T23:59:00+05:30',
      now: '2026-03-02T09:00:00+05:30'
    });

    expect(summary.expected).toBe(1);
    expect(byMedicine.map((m) => m.medicineId)).toEqual(['m1']);
  });
});

describe('computeAdherence — breakdowns', () => {
  const window = {
    from: '2026-03-01T00:00:00+05:30',
    to: '2026-03-03T23:59:00+05:30',
    now: '2026-03-04T09:00:00+05:30'
  };

  it('produces a per-medicine breakdown', () => {
    const other = schedule({ _id: 's2', medicine: 'm2' });
    const intakes = [
      intake('2026-03-01', 'taken'),
      intake('2026-03-02', 'taken'),
      intake('2026-03-03', 'taken'),
      { ...intake('2026-03-01', 'skipped'), _id: 'x1', schedule: 's2', medicine: 'm2' }
    ];
    const { byMedicine } = run([schedule(), other], intakes, window);

    const m1 = byMedicine.find((m) => m.medicineId === 'm1');
    const m2 = byMedicine.find((m) => m.medicineId === 'm2');
    expect(m1).toMatchObject({ expected: 3, taken: 3, adherenceScore: 100 });
    expect(m2).toMatchObject({ expected: 3, taken: 0, skipped: 1, missed: 2, adherenceScore: 0 });
  });

  it('produces a chronological daily trend', () => {
    const intakes = [intake('2026-03-01', 'taken'), intake('2026-03-03', 'skipped')];
    const { daily } = run([schedule()], intakes, window);

    expect(daily.map((d) => d.date)).toEqual(['2026-03-01', '2026-03-02', '2026-03-03']);
    expect(daily[0].adherenceScore).toBe(100);
    expect(daily[1].missed).toBe(1);
    expect(daily[2].skipped).toBe(1);
  });

  it('counts a dose taken after the grace window as taken but flags it', () => {
    const intakes = [intake('2026-03-01', 'taken', { wasLate: true, minutesLate: 180 })];
    const { summary } = run([schedule()], intakes, {
      from: '2026-03-01T00:00:00+05:30',
      to: '2026-03-01T23:59:00+05:30',
      now: '2026-03-02T09:00:00+05:30'
    });
    expect(summary.taken).toBe(1);
    expect(summary.lateButTaken).toBe(1);
    expect(summary.adherenceScore).toBe(100);
  });

  it('includes paused schedules for the days they were active', () => {
    const paused = schedule({ isActive: false });
    const { summary } = run([paused], [], {
      from: '2026-03-01T00:00:00+05:30',
      to: '2026-03-02T23:59:00+05:30',
      now: '2026-03-03T09:00:00+05:30'
    });
    expect(summary.expected).toBe(2);
  });

  it('handles an empty patient with no schedules at all', () => {
    const { summary, byMedicine, daily } = run([], [], {
      from: '2026-03-01T00:00:00+05:30',
      to: '2026-03-05T23:59:00+05:30',
      now: '2026-03-06T09:00:00+05:30'
    });
    expect(summary.expected).toBe(0);
    expect(summary.adherenceScore).toBeNull();
    expect(byMedicine).toEqual([]);
    expect(daily).toEqual([]);
  });
});

describe('labelFor', () => {
  it.each([
    [100, 'excellent'],
    [95, 'excellent'],
    [94.9, 'good'],
    [80, 'good'],
    [79.9, 'fair'],
    [60, 'fair'],
    [59.9, 'needs_attention'],
    [0, 'needs_attention'],
    [null, 'no_data']
  ])('maps %s to %s', (score, expected) => {
    expect(labelFor(score)).toBe(expected);
  });
});

describe('compareWindows', () => {
  it('reports improvement when the score rises by 5 points or more', () => {
    expect(compareWindows({ adherenceScore: 90 }, { adherenceScore: 80 })).toMatchObject({
      direction: 'improving',
      change: 10
    });
  });

  it('reports decline when the score drops by 5 points or more', () => {
    expect(compareWindows({ adherenceScore: 70 }, { adherenceScore: 85 })).toMatchObject({
      direction: 'declining',
      change: -15
    });
  });

  it('reports steady for small movements', () => {
    expect(compareWindows({ adherenceScore: 82 }, { adherenceScore: 80 }).direction).toBe('steady');
  });

  it('reports insufficient data when either period has no score', () => {
    expect(compareWindows({ adherenceScore: null }, { adherenceScore: 80 }).direction).toBe(
      'insufficient_data'
    );
  });
});
