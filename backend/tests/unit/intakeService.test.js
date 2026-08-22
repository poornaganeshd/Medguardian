'use strict';

const {
  consumptionOf,
  stockDelta,
  applyStockDelta,
  computeLateness
} = require('../../src/services/intakeService');

const taken = (q = 1) => ({ status: 'taken', doseQuantity: q });
const skipped = (q = 1) => ({ status: 'skipped', doseQuantity: q });

describe('consumptionOf', () => {
  it('counts a taken dose', () => {
    expect(consumptionOf(taken(2))).toBe(2);
  });

  it('never counts a skipped dose - the tablet stays in the box', () => {
    expect(consumptionOf(skipped(2))).toBe(0);
  });

  it('treats a missing record as no consumption', () => {
    expect(consumptionOf(null)).toBe(0);
    expect(consumptionOf(undefined)).toBe(0);
  });

  it('handles a non-numeric dose safely', () => {
    expect(consumptionOf({ status: 'taken', doseQuantity: 'abc' })).toBe(0);
  });
});

describe('stockDelta', () => {
  it('deducts a newly taken dose', () => {
    expect(stockDelta(null, taken(1))).toBe(-1);
    expect(stockDelta(null, taken(2.5))).toBe(-2.5);
  });

  it('deducts nothing for a newly skipped dose', () => {
    expect(stockDelta(null, skipped(1))).toBe(0);
  });

  it('refunds stock when a taken dose is corrected to skipped', () => {
    expect(stockDelta(taken(2), skipped(2))).toBe(2);
  });

  it('deducts stock when a skipped dose is corrected to taken', () => {
    expect(stockDelta(skipped(2), taken(2))).toBe(-2);
  });

  it('applies only the difference when the dose quantity is amended', () => {
    expect(stockDelta(taken(1), taken(3))).toBe(-2);
    expect(stockDelta(taken(3), taken(1))).toBe(2);
  });

  it('is a no-op when nothing material changed', () => {
    expect(stockDelta(taken(1), taken(1))).toBe(0);
    expect(stockDelta(skipped(1), skipped(1))).toBe(0);
  });

  it('refunds the full dose when a taken record is deleted', () => {
    expect(stockDelta(taken(2), null)).toBe(2);
  });

  it('refunds nothing when a skipped record is deleted', () => {
    expect(stockDelta(skipped(2), null)).toBe(0);
  });
});

describe('applyStockDelta', () => {
  it('subtracts from the stock on hand', () => {
    expect(applyStockDelta(10, -1)).toEqual({ stock: 9, clamped: false, shortfall: 0 });
  });

  it('adds a refunded dose back', () => {
    expect(applyStockDelta(9, 1)).toEqual({ stock: 10, clamped: false, shortfall: 0 });
  });

  it('never lets stock go negative and reports the shortfall', () => {
    expect(applyStockDelta(0, -2)).toEqual({ stock: 0, clamped: true, shortfall: 2 });
    expect(applyStockDelta(1, -3)).toEqual({ stock: 0, clamped: true, shortfall: 2 });
  });

  it('treats a missing stock value as zero', () => {
    expect(applyStockDelta(undefined, -1).stock).toBe(0);
  });
});

describe('computeLateness', () => {
  const scheduled = '2026-03-01T08:00:00+05:30';

  it('reports a dose taken on time', () => {
    expect(computeLateness(scheduled, '2026-03-01T08:05:00+05:30', 60)).toEqual({
      minutesLate: 5,
      wasLate: false
    });
  });

  it('flags a dose taken after the grace window', () => {
    expect(computeLateness(scheduled, '2026-03-01T10:30:00+05:30', 60)).toEqual({
      minutesLate: 150,
      wasLate: true
    });
  });

  it('reports a negative value for an early dose', () => {
    expect(computeLateness(scheduled, '2026-03-01T07:30:00+05:30', 60).minutesLate).toBe(-30);
  });

  it('returns nulls when either instant is missing', () => {
    expect(computeLateness(null, scheduled)).toEqual({ minutesLate: null, wasLate: false });
    expect(computeLateness(scheduled, null)).toEqual({ minutesLate: null, wasLate: false });
  });
});
