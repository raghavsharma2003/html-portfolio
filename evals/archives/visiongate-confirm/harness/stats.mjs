// Two-proportion comparison, normal approximation — consistent with the
// method measurements.md cites ("two-proportion z") and this repo's own
// wilsonCI style (evals/dbattery/judge-backtest.mjs) for single-arm CIs.
function erf(x) {
  // Abramowitz-Stegun 7.1.26, |error| < 1.5e-7
  const s = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const a1 = 0.254829592,
    a2 = -0.284496736,
    a3 = 1.421413741,
    a4 = -1.453152027,
    a5 = 1.061405429,
    p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return s * y;
}
function normalCdf(z) {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

export function wilsonCI(successes, n, z = 1.96) {
  if (n === 0) return { point: NaN, lo: NaN, hi: NaN };
  const p = successes / n;
  const denom = 1 + (z * z) / n;
  const center = p + (z * z) / (2 * n);
  const halfwidth = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return { point: p, lo: (center - halfwidth) / denom, hi: (center + halfwidth) / denom };
}

// Two-proportion z-test on the DIFFERENCE (p2 - p1). CI uses the unpooled SE
// (standard for a CI on the difference); the p-value uses the pooled SE
// (standard for a test of p1 == p2 under H0).
export function twoPropZ(x1, n1, x2, n2, z = 1.96) {
  const p1 = x1 / n1,
    p2 = x2 / n2;
  const diff = p2 - p1;
  const seUnpooled = Math.sqrt((p1 * (1 - p1)) / n1 + (p2 * (1 - p2)) / n2);
  const pPool = (x1 + x2) / (n1 + n2);
  const sePooled = Math.sqrt(pPool * (1 - pPool) * (1 / n1 + 1 / n2));
  const zStat = sePooled > 0 ? diff / sePooled : NaN;
  const pTwoSided = Number.isFinite(zStat) ? 2 * (1 - normalCdf(Math.abs(zStat))) : NaN;
  return {
    p1,
    p2,
    diff,
    ci95: [diff - z * seUnpooled, diff + z * seUnpooled],
    zStat,
    pTwoSided,
  };
}
