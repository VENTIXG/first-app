// Numerical integration and maximisation utilities.

const cache = new Map();

/**
 * Gauss–Legendre nodes and weights on [-1, 1] for n points, computed by Newton
 * iteration on P_n (Golub–Welsch not needed at these orders). Exact for
 * polynomials of degree <= 2n - 1.
 */
export function gaussLegendre(n) {
  if (!(Number.isInteger(n) && n >= 1 && n <= 64)) throw new RangeError(`Gauss–Legendre order must be 1..64 (got ${n})`);
  if (cache.has(n)) return cache.get(n);
  const x = new Float64Array(n);
  const w = new Float64Array(n);
  for (let i = 0; i < Math.ceil(n / 2); i++) {
    let z = Math.cos((Math.PI * (i + 0.75)) / (n + 0.5));
    let dp = 0;
    for (let it = 0; it < 100; it++) {
      let p0 = 1, p1 = z;
      for (let k = 2; k <= n; k++) {
        const p2 = ((2 * k - 1) * z * p1 - (k - 1) * p0) / k;
        p0 = p1; p1 = p2;
      }
      if (n === 1) { p1 = z; p0 = 1; }
      dp = (n * (z * p1 - p0)) / (z * z - 1);
      const dz = p1 / dp;
      z -= dz;
      if (Math.abs(dz) < 1e-16) break;
    }
    x[i] = -z; x[n - 1 - i] = z;
    w[i] = w[n - 1 - i] = 2 / ((1 - z * z) * dp * dp);
  }
  if (n === 1) { x[0] = 0; w[0] = 2; }
  const rule = { x, w };
  cache.set(n, rule);
  return rule;
}

/**
 * Composite Gauss–Legendre nodes on [a, b]: `panels` equal sub-intervals of
 * `order` points each. Returns arrays of absolute positions and weights so the
 * caller can evaluate integrands with its own state (no closures in hot loops).
 */
export function compositeNodes(a, b, panels, order) {
  const { x, w } = gaussLegendre(order);
  const n = panels * order;
  const pos = new Float64Array(n);
  const wt = new Float64Array(n);
  const h = (b - a) / panels;
  for (let p = 0; p < panels; p++) {
    const mid = a + (p + 0.5) * h;
    for (let i = 0; i < order; i++) {
      pos[p * order + i] = mid + 0.5 * h * x[i];
      wt[p * order + i] = 0.5 * h * w[i];
    }
  }
  return { pos, wt };
}

/** ∫_a^b f by composite Gauss–Legendre. */
export function integrate(f, a, b, panels = 8, order = 8) {
  const { pos, wt } = compositeNodes(a, b, panels, order);
  let s = 0;
  for (let i = 0; i < pos.length; i++) s += wt[i] * f(pos[i]);
  return s;
}

/**
 * Refine a maximum of g on [lo, hi] by golden-section search (g unimodal on the
 * bracket). Used to recover the true peak of a sampled periodic force history.
 */
export function goldenMax(g, lo, hi, tol = 1e-10) {
  const phi = (Math.sqrt(5) - 1) / 2;
  let a = lo, b = hi;
  let c = b - phi * (b - a), d = a + phi * (b - a);
  let gc = g(c), gd = g(d);
  for (let it = 0; it < 200 && b - a > tol * Math.max(1, Math.abs(a) + Math.abs(b)); it++) {
    if (gc > gd) { b = d; d = c; gd = gc; c = b - phi * (b - a); gc = g(c); }
    else { a = c; c = d; gc = gd; d = a + phi * (b - a); gd = g(d); }
  }
  const t = (a + b) / 2;
  return { t, value: g(t) };
}
