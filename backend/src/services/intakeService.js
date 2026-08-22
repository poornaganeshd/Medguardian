'use strict';

/**
 * Stock effect of recording or amending a dose.
 *
 * The single rule that the whole refill prediction rests on:
 *
 *   **Only a dose whose status is `taken` consumes stock.**
 *   A skipped dose leaves the medicine in the box, so it must never be
 *   deducted - and if a patient corrects a "taken" record to "skipped", the
 *   quantity has to be given back.
 *
 * Keeping this as a pure function means the rule is unit-testable and is
 * applied identically by every code path that touches stock.
 */

/** Quantity a record consumes: the dose if taken, otherwise zero. */
function consumptionOf(record) {
  if (!record) return 0;
  return record.status === 'taken' ? Number(record.doseQuantity) || 0 : 0;
}

/**
 * Stock delta to apply when moving from `previous` to `next`.
 * Negative = stock decreases.
 *
 * @param {?{status: string, doseQuantity: number}} previous existing record, if any
 * @param {?{status: string, doseQuantity: number}} next new state, or null when deleting
 * @returns {number}
 */
function stockDelta(previous, next) {
  return consumptionOf(previous) - consumptionOf(next);
}

/**
 * Applies a delta to the stock on hand without ever going negative.
 * Returns both the new value and whether the request had to be clamped, so the
 * caller can warn the patient that their recorded stock was already empty.
 */
function applyStockDelta(currentStock, delta) {
  const raw = (Number(currentStock) || 0) + delta;
  return { stock: Math.max(0, raw), clamped: raw < 0, shortfall: raw < 0 ? -raw : 0 };
}

/**
 * Lateness of a dose relative to its scheduled slot.
 *
 * @param {Date|string} scheduledAt
 * @param {Date|string} takenAt
 * @param {number} graceMinutes
 */
function computeLateness(scheduledAt, takenAt, graceMinutes = 60) {
  if (!scheduledAt || !takenAt) return { minutesLate: null, wasLate: false };
  const minutesLate = Math.round(
    (new Date(takenAt).getTime() - new Date(scheduledAt).getTime()) / 60000
  );
  return { minutesLate, wasLate: minutesLate > graceMinutes };
}

module.exports = { consumptionOf, stockDelta, applyStockDelta, computeLateness };
