'use strict';

/**
 * Ordinary least-squares simple linear regression: y = intercept + slope * x.
 *
 * This is implemented from first principles (no ML library, no model weights
 * downloaded from anywhere) so every number in a prediction can be traced back
 * to the patient's own data during a project review.
 *
 * It is used by the DRPA for ONE narrow job: fitting the trend in a patient's
 * daily consumption so the forecast can follow a rising or falling pattern
 * instead of assuming a flat average. Where the fit is not trustworthy
 * (too few points, no variance, weak correlation) the DRPA falls back to the
 * plain average - see `refillPredictionService`.
 */

/**
 * @param {Array<{x: number, y: number}>} points
 * @returns {{slope: number, intercept: number, r2: number, n: number,
 *            meanX: number, meanY: number, predict: (x: number) => number} | null}
 */
function fitLinearRegression(points) {
  const data = (points || []).filter(
    (p) => Number.isFinite(p?.x) && Number.isFinite(p?.y)
  );
  const n = data.length;
  if (n < 2) return null;

  const meanX = data.reduce((s, p) => s + p.x, 0) / n;
  const meanY = data.reduce((s, p) => s + p.y, 0) / n;

  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (const p of data) {
    const dx = p.x - meanX;
    const dy = p.y - meanY;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }

  // Every x is identical: the slope is undefined, so there is no trend to fit.
  if (sxx === 0) return null;

  const slope = sxy / sxx;
  const intercept = meanY - slope * meanX;

  // Coefficient of determination. When y never varies (syy === 0) the fit is
  // exact by construction, so r2 = 1.
  const r2 = syy === 0 ? 1 : Math.max(0, Math.min(1, (sxy * sxy) / (sxx * syy)));

  return {
    slope,
    intercept,
    r2,
    n,
    meanX,
    meanY,
    predict: (x) => intercept + slope * x
  };
}

module.exports = { fitLinearRegression };
