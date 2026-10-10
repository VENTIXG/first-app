// Geometric and physical input validation. The engine must refuse to produce
// numbers for impossible configurations rather than silently computing them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePlatform } from '../../js/morison.js';
import { DEFAULT_ENVIRONMENT, makeBody } from '../../js/state.js';

const ENV = { ...DEFAULT_ENVIRONMENT, waveTheory: 'airy', H: 3, T: 9, h: 40 };
const errorCodes = (r) => (r.errors || []).map((e) => e.code);
const warningCodes = (r) => (r.warnings || []).map((w) => w.code);

test('a valid configuration computes with ok = true and no errors', () => {
  const r = computePlatform(ENV, [makeBody({ diameter: 6, draft: 20 })]);
  assert.equal(r.ok, true);
  assert.deepEqual(errorCodes(r), []);
});

test('draft greater than water depth is rejected', () => {
  const r = computePlatform(ENV, [makeBody({ diameter: 6, draft: 45 })]);
  assert.equal(r.ok, false);
  assert.ok(errorCodes(r).includes('DRAFT_EXCEEDS_DEPTH'));
});

test('sphere with draft > 2R (deeper than the sphere itself) is rejected', () => {
  const r = computePlatform(ENV, [makeBody({ type: 'sphere', radius: 5, draft: 20 })]);
  assert.equal(r.ok, false);
  assert.ok(errorCodes(r).includes('SPHERE_DRAFT_EXCEEDS_DIAMETER'));
});

test('overlapping bodies are rejected', () => {
  const r = computePlatform(ENV, [
    makeBody({ x: 0, diameter: 6, draft: 20 }),
    makeBody({ x: 4, diameter: 6, draft: 20 }),
  ]);
  assert.equal(r.ok, false);
  assert.ok(errorCodes(r).includes('BODIES_OVERLAP'));
});

test('non-finite and negative inputs are rejected', () => {
  const cases = [
    [{ ...ENV, H: -1 }, [makeBody()]],
    [{ ...ENV, T: NaN }, [makeBody()]],
    [{ ...ENV, Cd: -0.5 }, [makeBody()]],
    [ENV, [makeBody({ diameter: 0 })]],
    [ENV, [makeBody({ draft: Infinity })]],
  ];
  for (const [env, bodies] of cases) {
    const r = computePlatform(env, bodies);
    assert.equal(r.ok, false, JSON.stringify({ env: { H: env.H, T: env.T, Cd: env.Cd }, b: bodies[0] }));
  }
});

test('physically impossible (breaking) waves block the result', () => {
  const r = computePlatform({ ...ENV, H: 8, h: 9 }, [makeBody({ diameter: 2, draft: 5 })]);
  assert.equal(r.ok, false);
  assert.ok(errorCodes(r).includes('WAVE_BREAKING_DEPTH'));
});

test('D/lambda > 0.2 raises a Morison-validity warning per body', () => {
  const r = computePlatform({ ...ENV, T: 5 }, [makeBody({ diameter: 12, draft: 20 })]);
  assert.ok(warningCodes(r).includes('MORISON_DIFFRACTION_REGIME'));
});
