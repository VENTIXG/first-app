// Independent reference implementations used ONLY by tests. They are written
// differently from the production code on purpose (series / quadrature instead
// of rational approximations), so agreement is meaningful evidence.

const EULER_GAMMA = 0.5772156649015329;

/** Ascending power series for J_n (n = 0, 1). Accurate to ~1e-13 for x <= 12. */
export function besselJSeries(n, x) {
  let term = Math.pow(x / 2, n);
  for (let k = 1; k <= n; k++) term /= k;
  let sum = 0;
  for (let k = 0; k < 300; k++) {
    sum += term;
    term *= -(x * x / 4) / ((k + 1) * (k + 1 + n));
    if (Math.abs(term) < 1e-18 * Math.abs(sum)) break;
  }
  return sum;
}

/** Y_0 by its ascending series with harmonic numbers. */
export function besselY0Series(x) {
  let s = 0, t = 1, H = 0;
  for (let k = 1; k < 300; k++) {
    t *= (x * x / 4) / (k * k);
    H += 1 / k;
    s += (k % 2 ? 1 : -1) * H * t;
    if (t * H < 1e-18) break;
  }
  return (2 / Math.PI) * ((Math.log(x / 2) + EULER_GAMMA) * besselJSeries(0, x) + s);
}

/** Composite Simpson rule. */
export function simpson(f, a, b, n = 4000) {
  const m = n % 2 ? n + 1 : n;
  const h = (b - a) / m;
  let s = f(a) + f(b);
  for (let i = 1; i < m; i++) s += f(a + i * h) * (i % 2 ? 4 : 2);
  return (s * h) / 3;
}

/** Bessel's integral representation of J_n (independent of the series). */
export function besselJIntegral(n, x) {
  return simpson((t) => Math.cos(n * t - x * Math.sin(t)), 0, Math.PI, 6000) / Math.PI;
}

/** Integral representation of Y_n (DLMF 10.9.7). */
export function besselYIntegral(n, x) {
  const a = simpson((t) => Math.sin(x * Math.sin(t) - n * t), 0, Math.PI, 6000) / Math.PI;
  const b = simpson(
    (t) => (Math.exp(n * t) + (n % 2 ? -1 : 1) * Math.exp(-n * t)) * Math.exp(-x * Math.sinh(t)),
    0, 14, 40000,
  ) / Math.PI;
  return a - b;
}

/**
 * Tabulated values, Abramowitz & Stegun (1964) Table 9.1 / DLMF, 10 significant digits.
 * Used as the external reference for the Bessel implementations.
 */
export const BESSEL_TABLE = [
  // x, J0, J1, Y0, Y1
  [1, 0.7651976866, 0.4400505857, 0.0882569642, -0.7812128213],
  [2, 0.2238907791, 0.5767248078, 0.5103756726, -0.1070324315],
  [3, -0.2600519549, 0.3390589585, 0.3768500100, 0.3246744248],
  [4, -0.3971498099, -0.0660433280, -0.0169407393, 0.3979257106],
  [5, -0.1775967713, -0.3275791376, -0.3085176252, 0.1478631434],
  [6, 0.1506452573, -0.2766838581, -0.2881946840, -0.1750103443],
  [7, 0.3000792705, -0.0046828235, -0.0259497440, -0.3026672370],
  [8, 0.1716508071, 0.2346363469, 0.2235214894, -0.1580604617],
  [10, -0.2459357645, 0.0434727462, 0.0556711673, 0.2490154242],
];
