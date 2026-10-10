// Bessel functions of the first and second kind, orders 0 and 1, for real x > 0.
//
// x <= 12 : ascending power series (DLMF 10.2.2, 10.8.1). Largest term at x = 12
//           is ~4e3, so cancellation costs < 4 digits: ~1e-12 absolute.
// x  > 12 : Hankel asymptotic expansion (DLMF 10.17.3/4), summed until the terms
//           stop decreasing; truncation error ~ e^{-2x} < 1e-10 at x = 12.
//
// Verified in tests/unit/bessel.test.js against Abramowitz & Stegun Table 9.1
// and against independent integral representations.

const EULER_GAMMA = 0.5772156649015329;
const SERIES_LIMIT = 12;

function assertArg(x) {
  if (!(Number.isFinite(x) && x > 0)) throw new RangeError(`Bessel argument must be finite and > 0 (got ${x})`);
}

/** J_n(x), n = 0 or 1, by the ascending series. */
function jSeries(n, x) {
  const q = (x * x) / 4;
  let term = n === 0 ? 1 : x / 2;
  let sum = 0;
  for (let k = 0; k < 400; k++) {
    sum += term;
    term *= -q / ((k + 1) * (k + 1 + n));
    if (Math.abs(term) < 1e-17 * Math.abs(sum)) break;
  }
  return sum;
}

/** Y0(x) by its ascending series. */
function y0Series(x) {
  const q = (x * x) / 4;
  let t = 1, H = 0, s = 0;
  for (let k = 1; k < 400; k++) {
    t *= q / (k * k);
    H += 1 / k;
    const term = (k % 2 ? 1 : -1) * H * t;
    s += term;
    if (Math.abs(term) < 1e-17 * Math.max(1, Math.abs(s))) break;
  }
  return (2 / Math.PI) * ((Math.log(x / 2) + EULER_GAMMA) * jSeries(0, x) + s);
}

/** Y1(x) by its ascending series: psi(k+1) + psi(k+2) = -2 gamma + H_k + H_{k+1}. */
function y1Series(x) {
  const q = (x * x) / 4;
  let t = x / 2; // (x/2)^{2k+1} / (k!(k+1)!) at k = 0
  let Hk = 0;
  let s = 0;
  for (let k = 0; k < 400; k++) {
    const Hk1 = Hk + 1 / (k + 1);
    const term = (k % 2 ? -1 : 1) * (-2 * EULER_GAMMA + Hk + Hk1) * t;
    s += term;
    if (k > 2 && Math.abs(term) < 1e-17 * Math.max(1, Math.abs(s))) break;
    t *= q / ((k + 1) * (k + 2));
    Hk = Hk1;
  }
  return (2 / Math.PI) * Math.log(x / 2) * jSeries(1, x) - 2 / (Math.PI * x) - s / Math.PI;
}

/** Hankel asymptotic P, Q for order nu (DLMF 10.17.1-4). */
function hankelPQ(nu, x) {
  const mu = 4 * nu * nu;
  let P = 0, Q = 0;
  let a = 1; // a_k(nu) / x^k, built recursively
  let prev = Infinity;
  for (let k = 0; k < 60; k++) {
    const mag = Math.abs(a);
    if (mag > prev) break; // asymptotic series: stop at the smallest term
    const sign = Math.floor(k / 2) % 2 ? -1 : 1;
    if (k % 2 === 0) P += sign * a; else Q += sign * a;
    if (mag < 1e-18) break;
    prev = mag;
    a *= (mu - (2 * k + 1) ** 2) / ((k + 1) * 8 * x);
  }
  return { P, Q };
}

function asymptotic(nu, x) {
  const { P, Q } = hankelPQ(nu, x);
  const w = x - (nu * Math.PI) / 2 - Math.PI / 4;
  const f = Math.sqrt(2 / (Math.PI * x));
  return { J: f * (P * Math.cos(w) - Q * Math.sin(w)), Y: f * (P * Math.sin(w) + Q * Math.cos(w)) };
}

export function besselJ0(x) { assertArg(x); return x <= SERIES_LIMIT ? jSeries(0, x) : asymptotic(0, x).J; }
export function besselJ1(x) { assertArg(x); return x <= SERIES_LIMIT ? jSeries(1, x) : asymptotic(1, x).J; }
export function besselY0(x) { assertArg(x); return x <= SERIES_LIMIT ? y0Series(x) : asymptotic(0, x).Y; }
export function besselY1(x) { assertArg(x); return x <= SERIES_LIMIT ? y1Series(x) : asymptotic(1, x).Y; }

/** Derivatives of the order-1 functions: C1'(x) = C0(x) - C1(x)/x. */
export function besselJ1Prime(x) { return besselJ0(x) - besselJ1(x) / x; }
export function besselY1Prime(x) { return besselY0(x) - besselY1(x) / x; }
