import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solveDispersion, g } from '../../js/waveTheory.js';

const PERIODS = [1.5, 3, 6, 10, 20, 30];
const DEPTHS = [0.5, 2, 10, 50, 300, 5000];

test('dispersion residual |w^2 - g k tanh(kh)| / w^2 < 1e-12 over shallow..deep grid', () => {
  for (const T of PERIODS) {
    for (const h of DEPTHS) {
      const w = (2 * Math.PI) / T;
      const k = solveDispersion(w, h);
      assert.ok(Number.isFinite(k) && k > 0, `k finite/positive for T=${T}, h=${h}`);
      const res = Math.abs(w * w - g * k * Math.tanh(k * h)) / (w * w);
      assert.ok(res < 1e-12, `T=${T} h=${h}: residual ${res.toExponential(2)}`);
    }
  }
});

test('deep-water limit: k = w^2/g when kh >> 1', () => {
  const w = (2 * Math.PI) / 8;
  const k = solveDispersion(w, 5000);
  assert.ok(Math.abs(k - (w * w) / g) / k < 1e-12);
});

test('shallow-water limit: phase speed -> sqrt(g h) when kh << 1', () => {
  const h = 0.5;
  const w = (2 * Math.PI) / 30;
  const k = solveDispersion(w, h);
  assert.ok(k * h < 0.06, 'case is genuinely shallow');
  const c = w / k;
  assert.ok(Math.abs(c - Math.sqrt(g * h)) / Math.sqrt(g * h) < 1e-3);
});

test('reproduces thesis worked example (omega = 0.3 rad/s, d = 60 m -> kd = 0.81724)', () => {
  // methodologia-morison.md §3.1.2, convergence criterion 1e-4 on the residual.
  const k = solveDispersion(0.3, 60);
  assert.ok(Math.abs(k * 60 - 0.81724) < 2e-4, `kd = ${(k * 60).toFixed(5)}`);
});

test('rejects non-physical inputs instead of returning garbage', () => {
  for (const [w, h] of [[0, 10], [-1, 10], [1, 0], [1, -5], [NaN, 10], [1, Infinity]]) {
    assert.throws(() => solveDispersion(w, h), RangeError, `omega=${w}, h=${h}`);
  }
});
