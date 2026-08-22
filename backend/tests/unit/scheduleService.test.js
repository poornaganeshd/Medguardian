'use strict';

const {
  isDueOnDate,
  expandSchedule,
  expandSchedules,
  deriveStatus,
  attachIntakes
} = require('../../src/services/scheduleService');

const TZ = 'Asia/Kolkata';

const baseSchedule = (overrides = {}) => ({
  _id: 'sched1',
  medicine: 'med1',
  frequency: 'daily',
  times: [{ time: '08:00', doseQuantity: 1 }],
  startDate: new Date('2026-03-01T00:00:00+05:30'),
  isActive: true,
  graceMinutes: 60,
  ...overrides
});

const range = (from, to) => ({ from, to, timezone: TZ });

describe('isDueOnDate', () => {
  it('is true every day for a daily schedule inside its window', () => {
    const s = baseSchedule();
    expect(isDueOnDate(s, '2026-03-01', TZ)).toBe(true);
    expect(isDueOnDate(s, '2026-03-17', TZ)).toBe(true);
  });

  it('is false before the start date and after the end date', () => {
    const s = baseSchedule({ endDate: new Date('2026-03-10T00:00:00+05:30') });
    expect(isDueOnDate(s, '2026-02-28', TZ)).toBe(false);
    expect(isDueOnDate(s, '2026-03-10', TZ)).toBe(true);
    expect(isDueOnDate(s, '2026-03-11', TZ)).toBe(false);
  });

  it('honours specific weekdays (0 = Sunday)', () => {
    const s = baseSchedule({ frequency: 'specific_days', daysOfWeek: [1, 3, 5] });
    expect(isDueOnDate(s, '2026-03-02', TZ)).toBe(true); // Monday
    expect(isDueOnDate(s, '2026-03-03', TZ)).toBe(false); // Tuesday
    expect(isDueOnDate(s, '2026-03-04', TZ)).toBe(true); // Wednesday
    expect(isDueOnDate(s, '2026-03-06', TZ)).toBe(true); // Friday
    expect(isDueOnDate(s, '2026-03-08', TZ)).toBe(false); // Sunday
  });

  it('counts an interval schedule from the start date', () => {
    const s = baseSchedule({ frequency: 'interval', intervalDays: 3 });
    expect(isDueOnDate(s, '2026-03-01', TZ)).toBe(true);
    expect(isDueOnDate(s, '2026-03-02', TZ)).toBe(false);
    expect(isDueOnDate(s, '2026-03-04', TZ)).toBe(true);
    expect(isDueOnDate(s, '2026-03-07', TZ)).toBe(true);
  });

  it('alternates on/off blocks for a cycle schedule', () => {
    const s = baseSchedule({ frequency: 'cycle', cycleDaysOn: 3, cycleDaysOff: 2 });
    ['2026-03-01', '2026-03-02', '2026-03-03'].forEach((d) =>
      expect(isDueOnDate(s, d, TZ)).toBe(true)
    );
    ['2026-03-04', '2026-03-05'].forEach((d) => expect(isDueOnDate(s, d, TZ)).toBe(false));
    expect(isDueOnDate(s, '2026-03-06', TZ)).toBe(true);
  });

  it('never reports an as-needed schedule as due', () => {
    const s = baseSchedule({ frequency: 'as_needed', times: [] });
    expect(isDueOnDate(s, '2026-03-05', TZ)).toBe(false);
  });
});

describe('expandSchedule', () => {
  it('creates one occurrence per time per due day', () => {
    const s = baseSchedule({
      times: [
        { time: '08:00', doseQuantity: 1 },
        { time: '20:00', doseQuantity: 2 }
      ]
    });
    const occ = expandSchedule(s, range('2026-03-01T00:00:00+05:30', '2026-03-03T23:59:00+05:30'));
    expect(occ).toHaveLength(6);
    expect(occ[0]).toMatchObject({ dateKey: '2026-03-01', time: '08:00', doseQuantity: 1 });
    expect(occ[1]).toMatchObject({ dateKey: '2026-03-01', time: '20:00', doseQuantity: 2 });
  });

  it('returns occurrences in chronological order', () => {
    const s = baseSchedule({
      times: [
        { time: '22:00', doseQuantity: 1 },
        { time: '06:00', doseQuantity: 1 }
      ]
    });
    const occ = expandSchedule(s, range('2026-03-01T00:00:00+05:30', '2026-03-02T23:59:00+05:30'));
    const stamps = occ.map((o) => o.scheduledAt.getTime());
    expect([...stamps].sort((a, b) => a - b)).toEqual(stamps);
  });

  it('resolves the scheduled instant in the patient timezone', () => {
    const s = baseSchedule();
    const [first] = expandSchedule(
      s,
      range('2026-03-01T00:00:00+05:30', '2026-03-01T23:59:00+05:30')
    );
    // 08:00 IST == 02:30 UTC
    expect(first.scheduledAt.toISOString()).toBe('2026-03-01T02:30:00.000Z');
  });

  it('clips the range to the schedule start and end dates', () => {
    const s = baseSchedule({
      startDate: new Date('2026-03-05T00:00:00+05:30'),
      endDate: new Date('2026-03-07T00:00:00+05:30')
    });
    const occ = expandSchedule(s, range('2026-03-01T00:00:00+05:30', '2026-03-31T23:59:00+05:30'));
    expect(occ.map((o) => o.dateKey)).toEqual(['2026-03-05', '2026-03-06', '2026-03-07']);
  });

  it('returns nothing for an inactive schedule unless explicitly requested', () => {
    const s = baseSchedule({ isActive: false });
    const r = range('2026-03-01T00:00:00+05:30', '2026-03-03T23:59:00+05:30');
    expect(expandSchedule(s, r)).toHaveLength(0);
    expect(expandSchedule(s, { ...r, includeInactive: true })).toHaveLength(3);
  });

  it('returns nothing for an as-needed schedule', () => {
    const s = baseSchedule({ frequency: 'as_needed', times: [] });
    expect(
      expandSchedule(s, range('2026-03-01T00:00:00+05:30', '2026-03-30T23:59:00+05:30'))
    ).toHaveLength(0);
  });

  it('returns nothing when the range ends before the schedule starts', () => {
    const s = baseSchedule({ startDate: new Date('2026-06-01T00:00:00+05:30') });
    expect(
      expandSchedule(s, range('2026-03-01T00:00:00+05:30', '2026-03-05T23:59:00+05:30'))
    ).toHaveLength(0);
  });

  it('handles a null schedule safely', () => {
    expect(expandSchedule(null, range('2026-03-01', '2026-03-02'))).toEqual([]);
  });

  it('merges several schedules chronologically', () => {
    const morning = baseSchedule({ _id: 'a', times: [{ time: '08:00', doseQuantity: 1 }] });
    const night = baseSchedule({ _id: 'b', times: [{ time: '21:00', doseQuantity: 1 }] });
    const occ = expandSchedules(
      [night, morning],
      range('2026-03-01T00:00:00+05:30', '2026-03-02T23:59:00+05:30')
    );
    expect(occ.map((o) => `${o.dateKey} ${o.time}`)).toEqual([
      '2026-03-01 08:00',
      '2026-03-01 21:00',
      '2026-03-02 08:00',
      '2026-03-02 21:00'
    ]);
  });
});

describe('deriveStatus', () => {
  const occurrence = {
    scheduledAt: new Date('2026-03-01T08:00:00+05:30'),
    graceMinutes: 60
  };

  it('reports a recorded intake', () => {
    expect(deriveStatus(occurrence, { status: 'taken' })).toBe('taken');
    expect(deriveStatus(occurrence, { status: 'skipped' })).toBe('skipped');
  });

  it('is upcoming before the scheduled time', () => {
    expect(deriveStatus(occurrence, null, new Date('2026-03-01T07:00:00+05:30'))).toBe('upcoming');
  });

  it('is due inside the grace window', () => {
    expect(deriveStatus(occurrence, null, new Date('2026-03-01T08:30:00+05:30'))).toBe('due');
    expect(deriveStatus(occurrence, null, new Date('2026-03-01T09:00:00+05:30'))).toBe('due');
  });

  it('is late after the grace window but still on the same day', () => {
    expect(deriveStatus(occurrence, null, new Date('2026-03-01T12:00:00+05:30'))).toBe('late');
  });

  it('is missed once a full day has passed', () => {
    expect(deriveStatus(occurrence, null, new Date('2026-03-02T09:00:00+05:30'))).toBe('missed');
  });

  it('a recorded intake always wins over the clock', () => {
    expect(deriveStatus(occurrence, { status: 'taken' }, new Date('2026-04-01T00:00:00Z'))).toBe(
      'taken'
    );
  });
});

describe('attachIntakes', () => {
  it('matches intakes to occurrences by schedule, date and time', () => {
    const s = baseSchedule({
      times: [
        { time: '08:00', doseQuantity: 1 },
        { time: '20:00', doseQuantity: 1 }
      ]
    });
    const occ = expandSchedule(s, range('2026-03-01T00:00:00+05:30', '2026-03-01T23:59:00+05:30'));

    const withStatus = attachIntakes(
      occ,
      [
        {
          _id: 'i1',
          schedule: 'sched1',
          dateKey: '2026-03-01',
          scheduledTime: '08:00',
          status: 'taken',
          takenAt: new Date('2026-03-01T08:05:00+05:30'),
          notes: 'after breakfast'
        }
      ],
      new Date('2026-03-01T21:30:00+05:30')
    );

    expect(withStatus[0].status).toBe('taken');
    expect(withStatus[0].intakeId).toBe('i1');
    expect(withStatus[0].notes).toBe('after breakfast');
    expect(withStatus[1].status).toBe('late');
    expect(withStatus[1].intakeId).toBeNull();
  });

  it('does not match an intake from a different schedule', () => {
    const s = baseSchedule();
    const occ = expandSchedule(s, range('2026-03-01T00:00:00+05:30', '2026-03-01T23:59:00+05:30'));
    const withStatus = attachIntakes(
      occ,
      [{ schedule: 'other', dateKey: '2026-03-01', scheduledTime: '08:00', status: 'taken' }],
      new Date('2026-03-01T08:10:00+05:30')
    );
    expect(withStatus[0].status).toBe('due');
  });

  it('handles an empty intake list', () => {
    const s = baseSchedule();
    const occ = expandSchedule(s, range('2026-03-01T00:00:00+05:30', '2026-03-01T23:59:00+05:30'));
    expect(attachIntakes(occ, [], new Date('2026-03-01T07:00:00+05:30'))[0].status).toBe('upcoming');
    expect(attachIntakes(occ, null, new Date('2026-03-01T07:00:00+05:30'))[0].status).toBe(
      'upcoming'
    );
  });
});
