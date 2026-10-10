import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareWave, solveDispersion, g } from '../../js/waveTheory.js';

test('group velocity: Cg/c -> 1/2 in deep water, -> 1 in shallow water, and equals dω/dk', () => {
  const deep = prepareWave('airy', 1, 6, 2000);
  assert.ok(Math.abs(deep.Cg / deep.c - 0.5) < 1e-12);
  const shallow = prepareWave('airy', 0.1, 60, 5);
  // Cg/c = 1 - (kh)^2/3 + O((kh)^4)
  assert.ok(Math.abs(shallow.Cg / shallow.c - (1 - shallow.kh ** 2 / 3)) < shallow.kh ** 4);
  // independent check: Cg = dω/dk by central differences of the dispersion relation
  for (const [T, h] of [[9, 40], [12, 30], [7, 15]]) {
    const w = (2 * Math.PI) / T, dw = 1e-6 * w;
    const dk = solveDispersion(w + dw, h) - solveDispersion(w - dw, h);
    const wp = prepareWave('airy', 1, T, h);
    assert.ok(Math.abs((2 * dw) / dk - wp.Cg) / wp.Cg < 1e-7, `T=${T} h=${h}`);
  }
  assert.ok(g > 9.8);
});
