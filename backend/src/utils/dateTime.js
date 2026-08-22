'use strict';

const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const isSameOrBefore = require('dayjs/plugin/isSameOrBefore');
const isSameOrAfter = require('dayjs/plugin/isSameOrAfter');

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isSameOrBefore);
dayjs.extend(isSameOrAfter);

const DEFAULT_TZ = 'Asia/Kolkata';

/** True when `tz` is an IANA zone this runtime understands. */
function isValidTimezone(tz) {
  if (!tz || typeof tz !== 'string') return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const safeZone = (tz) => (isValidTimezone(tz) ? tz : DEFAULT_TZ);

/** "YYYY-MM-DD" for the given instant in the patient's timezone. */
function toLocalDateKey(instant, tz = DEFAULT_TZ) {
  return dayjs(instant).tz(safeZone(tz)).format('YYYY-MM-DD');
}

/** Start-of-day instant for a local calendar date. */
function startOfLocalDay(dateKey, tz = DEFAULT_TZ) {
  return dayjs.tz(`${dateKey} 00:00`, safeZone(tz)).toDate();
}

function endOfLocalDay(dateKey, tz = DEFAULT_TZ) {
  return dayjs.tz(`${dateKey} 23:59:59.999`, safeZone(tz)).toDate();
}

/** Combines a local calendar date and "HH:mm" into an absolute instant. */
function localDateTime(dateKey, time, tz = DEFAULT_TZ) {
  return dayjs.tz(`${dateKey} ${time}`, safeZone(tz)).toDate();
}

/** Inclusive list of "YYYY-MM-DD" keys between two instants, in `tz`. */
function eachLocalDate(from, to, tz = DEFAULT_TZ) {
  const zone = safeZone(tz);
  let cursor = dayjs(from).tz(zone).startOf('day');
  const last = dayjs(to).tz(zone).startOf('day');
  const keys = [];
  // Guard against a runaway range (10 years of days).
  let guard = 0;
  while (cursor.isSameOrBefore(last) && guard < 3700) {
    keys.push(cursor.format('YYYY-MM-DD'));
    cursor = cursor.add(1, 'day');
    guard += 1;
  }
  return keys;
}

/** 0 = Sunday .. 6 = Saturday, in the patient's timezone. */
function localDayOfWeek(dateKey, tz = DEFAULT_TZ) {
  return dayjs.tz(`${dateKey} 12:00`, safeZone(tz)).day();
}

/** Whole calendar days between two local dates (b - a). */
function daysBetween(aKey, bKey) {
  return dayjs(bKey, 'YYYY-MM-DD').diff(dayjs(aKey, 'YYYY-MM-DD'), 'day');
}

function addDays(dateKey, days) {
  return dayjs(`${dateKey}T00:00:00`).add(days, 'day').format('YYYY-MM-DD');
}

module.exports = {
  dayjs,
  DEFAULT_TZ,
  isValidTimezone,
  toLocalDateKey,
  startOfLocalDay,
  endOfLocalDay,
  localDateTime,
  eachLocalDate,
  localDayOfWeek,
  daysBetween,
  addDays
};
