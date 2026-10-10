import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gaussLegendre, integrate, goldenMax } from '../../js/quadrature.js';

test('n-point Gauss–Legendre is exact for polynomials of degree 2n-1', () => {
  for (const n of [1, 2, 3, 5, 8, 16]) {
    const { x, w } = gaussLegendre(n);
    for (let p = 0; p <= 2 * n - 1; p++) {
      let s = 0;
      for (let i = 0; i < n; i++) s += w[i] * x[i] ** p;
      const exact = p % 2 ? 0 : 2 / (p + 1);
      assert.ok(Math.abs(s - exact) < 1e-13, `n=${n} p=${p}: ${s} vs ${exact}`);
    }
  }
});

test('weights are positive and sum to 2', () => {
  for (const n of [4, 8, 24]) {
    const { w } = gaussLegendre(n);
    assert.ok(Array.from(w).every((v) => v > 0));
    assert.ok(Math.abs(w.reduce((a, b) => a + b, 0) - 2) < 1e-14);
  }
});

test('composite rule integrates smooth transcendental functions (exp: 1e-12 absolute; cosh: 1e-9 relative)', () => {
  assert.ok(Math.abs(integrate(Math.exp, -2, 3) - (Math.exp(3) - Math.exp(-2))) < 1e-12);
  assert.ok(Math.abs(integrate((z) => Math.cosh(0.3 * (z + 40)), -25, 0) -
    (Math.sinh(0.3 * 40) - Math.sinh(0.3 * 15)) / 0.3) < 1e-9 * Math.sinh(12));
});

test('golden-section search recovers the maximum of a sampled sinusoid', () => {
  const f = (t) => Math.sin(1.3 * t + 0.4);
  const { t, value } = goldenMax(f, 0.5, 1.5);
  assert.ok(Math.abs(value - 1) < 1e-14);
  assert.ok(Math.abs(t - (Math.PI / 2 - 0.4) / 1.3) < 1e-7);
});
