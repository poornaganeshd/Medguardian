'use strict';

const {
  toLocalDateKey,
  localDateTime,
  eachLocalDate,
  localDayOfWeek,
  daysBetween,
  DEFAULT_TZ
} = require('../utils/dateTime');

/**
 * Schedule expansion.
 *
 * `expandSchedule` turns a stored schedule into the concrete dose occurrences
 * that fall inside a date range. It is a **pure function** - no database, no
 * clock reads beyond the arguments it is given - so the reminder screen, the
 * adherence score and the DRPA refill prediction all derive their "expected
 * doses" from exactly the same logic, and it can be unit tested directly.
 */

/**
 * Decides whether a fixed schedule is due on a given local calendar date.
 *
 * @param {object} schedule
 * @param {string} dateKey "YYYY-MM-DD" in the patient's timezone
 * @param {string} tz IANA timezone
 * @returns {boolean}
 */
function isDueOnDate(schedule, dateKey, tz = DEFAULT_TZ) {
  if (schedule.frequency === 'as_needed') return false;

  const startKey = toLocalDateKey(schedule.startDate, tz);
  if (dateKey < startKey) return false;
  if (schedule.endDate && dateKey > toLocalDateKey(schedule.endDate, tz)) return false;

  switch (schedule.frequency) {
    case 'daily':
      return true;

    case 'specific_days':
      return (schedule.daysOfWeek || []).includes(localDayOfWeek(dateKey, tz));

    case 'interval': {
      const interval = schedule.intervalDays || 1;
      return daysBetween(startKey, dateKey) % interval === 0;
    }

    case 'cycle': {
      const on = schedule.cycleDaysOn || 1;
      const off = schedule.cycleDaysOff || 0;
      const position = daysBetween(startKey, dateKey) % (on + off);
      return position < on;
    }

    default:
      return false;
  }
}

/**
 * Expands a schedule into dose occurrences between two instants.
 *
 * Each occurrence is a plain object - it is NOT persisted. Intake records are
 * matched onto occurrences by `(scheduleId, dateKey, time)`, which keeps the
 * database small: only doses the patient actually acted on are stored.
 *
 * @param {object} schedule stored schedule (or plain object with the same shape)
 * @param {{from: Date|string, to: Date|string, timezone?: string, includeInactive?: boolean}} range
 * @returns {Array<{scheduleId: string, medicineId: string, dateKey: string, time: string,
 *   scheduledAt: Date, doseQuantity: number, label?: string, graceMinutes: number}>}
 */
function expandSchedule(schedule, range) {
  const tz = range.timezone || DEFAULT_TZ;
  const occurrences = [];

  if (!schedule) return occurrences;
  if (!range.includeInactive && schedule.isActive === false) return occurrences;
  if (schedule.frequency === 'as_needed') return occurrences;

  const scheduleId = String(schedule._id ?? schedule.id ?? '');
  const medicineId = String(schedule.medicine?._id ?? schedule.medicine ?? '');
  const graceMinutes = schedule.graceMinutes ?? 60;

  // Never expand before the schedule starts or after it ends.
  const startKey = toLocalDateKey(schedule.startDate, tz);
  const rangeStartKey = toLocalDateKey(range.from, tz);
  const rangeEndKey = toLocalDateKey(range.to, tz);

  const firstKey = rangeStartKey > startKey ? rangeStartKey : startKey;
  const scheduleEndKey = schedule.endDate ? toLocalDateKey(schedule.endDate, tz) : null;
  const lastKey =
    scheduleEndKey && scheduleEndKey < rangeEndKey ? scheduleEndKey : rangeEndKey;

  if (firstKey > lastKey) return occurrences;

  for (const dateKey of eachLocalDate(
    localDateTime(firstKey, '12:00', tz),
    localDateTime(lastKey, '12:00', tz),
    tz
  )) {
    if (!isDueOnDate(schedule, dateKey, tz)) continue;

    for (const entry of schedule.times || []) {
      occurrences.push({
        scheduleId,
        medicineId,
        dateKey,
        time: entry.time,
        scheduledAt: localDateTime(dateKey, entry.time, tz),
        doseQuantity: entry.doseQuantity ?? 1,
        label: entry.label || undefined,
        graceMinutes
      });
    }
  }

  return occurrences.sort((a, b) => a.scheduledAt - b.scheduledAt);
}

/** Expands many schedules at once, sorted chronologically. */
function expandSchedules(schedules, range) {
  return schedules
    .flatMap((schedule) => expandSchedule(schedule, range))
    .sort((a, b) => a.scheduledAt - b.scheduledAt);
}

/**
 * Derives the status of a single occurrence given the intake record (if any)
 * and the current time.
 *
 *  taken    - the patient recorded the dose
 *  skipped  - the patient explicitly skipped it
 *  upcoming - the scheduled time has not arrived yet
 *  due      - the time has arrived but the grace window has not expired
 *  late     - the grace window expired and no intake was recorded (still actionable)
 *  missed   - the calendar day has ended with no intake recorded
 *
 * `missed` is the terminal form of `late`; both count as "not taken" for
 * adherence. Only `taken` consumes stock (see DRPA).
 */
function deriveStatus(occurrence, intake, now = new Date()) {
  if (intake?.status === 'taken') return 'taken';
  if (intake?.status === 'skipped') return 'skipped';

  const scheduled = new Date(occurrence.scheduledAt).getTime();
  const nowMs = new Date(now).getTime();
  const graceEnd = scheduled + (occurrence.graceMinutes ?? 60) * 60000;

  if (nowMs < scheduled) return 'upcoming';
  if (nowMs <= graceEnd) return 'due';

  // Once the day is over the dose can no longer be acted on in good faith.
  const endOfDayMs = scheduled + 24 * 60 * 60000;
  return nowMs > endOfDayMs ? 'missed' : 'late';
}

/** Key used to match a stored intake back onto a generated occurrence. */
function occurrenceKey(scheduleId, dateKey, time) {
  return `${scheduleId}|${dateKey}|${time}`;
}

/**
 * Attaches intake records and a derived status to each occurrence.
 *
 * @param {Array} occurrences from expandSchedule(s)
 * @param {Array} intakes stored Intake documents / plain objects
 * @param {Date} [now]
 */
function attachIntakes(occurrences, intakes, now = new Date()) {
  const byKey = new Map();
  for (const intake of intakes || []) {
    byKey.set(
      occurrenceKey(
        String(intake.schedule?._id ?? intake.schedule ?? ''),
        intake.dateKey,
        intake.scheduledTime
      ),
      intake
    );
  }

  return occurrences.map((occurrence) => {
    const intake = byKey.get(
      occurrenceKey(occurrence.scheduleId, occurrence.dateKey, occurrence.time)
    );
    return {
      ...occurrence,
      status: deriveStatus(occurrence, intake, now),
      intakeId: intake ? String(intake._id ?? intake.id ?? '') : null,
      takenAt: intake?.takenAt ?? null,
      notes: intake?.notes ?? null
    };
  });
}

module.exports = {
  isDueOnDate,
  expandSchedule,
  expandSchedules,
  deriveStatus,
  attachIntakes,
  occurrenceKey
};
