'use strict';

const { fitLinearRegression } = require('../../src/services/linearRegression');

describe('fitLinearRegression', () => {
  it('recovers an exact line', () => {
    const fit = fitLinearRegression([
      { x: 0, y: 1 },
      { x: 1, y: 3 },
      { x: 2, y: 5 },
      { x: 3, y: 7 }
    ]);
    expect(fit.slope).toBeCloseTo(2, 10);
    expect(fit.intercept).toBeCloseTo(1, 10);
    expect(fit.r2).toBeCloseTo(1, 10);
    expect(fit.predict(4)).toBeCloseTo(9, 10);
  });

  it('finds a downward trend', () => {
    const fit = fitLinearRegression([
      { x: 0, y: 10 },
      { x: 1, y: 8 },
      { x: 2, y: 6 }
    ]);
    expect(fit.slope).toBeCloseTo(-2, 10);
  });

  it('fits noisy data with a lower r2', () => {
    const fit = fitLinearRegression([
      { x: 0, y: 1 },
      { x: 1, y: 4 },
      { x: 2, y: 2 },
      { x: 3, y: 8 },
      { x: 4, y: 5 }
    ]);
    expect(fit.slope).toBeGreaterThan(0);
    expect(fit.r2).toBeLessThan(1);
    expect(fit.r2).toBeGreaterThanOrEqual(0);
  });

  it('reports r2 = 1 and slope 0 for a perfectly flat series', () => {
    const fit = fitLinearRegression([
      { x: 0, y: 5 },
      { x: 1, y: 5 },
      { x: 2, y: 5 }
    ]);
    expect(fit.slope).toBe(0);
    expect(fit.intercept).toBe(5);
    expect(fit.r2).toBe(1);
  });

  it('returns null when there is nothing to fit', () => {
    expect(fitLinearRegression([])).toBeNull();
    expect(fitLinearRegression([{ x: 1, y: 1 }])).toBeNull();
    expect(fitLinearRegression(null)).toBeNull();
  });

  it('returns null when every x is the same (no independent variation)', () => {
    expect(
      fitLinearRegression([
        { x: 2, y: 1 },
        { x: 2, y: 5 }
      ])
    ).toBeNull();
  });

  it('ignores non-finite points', () => {
    const fit = fitLinearRegression([
      { x: 0, y: 1 },
      { x: 1, y: 3 },
      { x: NaN, y: 4 },
      { x: 2, y: 5 },
      { x: 3, y: undefined }
    ]);
    expect(fit.n).toBe(3);
    expect(fit.slope).toBeCloseTo(2, 10);
  });

  it('reports the sample size and means it used', () => {
    const fit = fitLinearRegression([
      { x: 1, y: 2 },
      { x: 3, y: 6 }
    ]);
    expect(fit.n).toBe(2);
    expect(fit.meanX).toBe(2);
    expect(fit.meanY).toBe(4);
  });
});
