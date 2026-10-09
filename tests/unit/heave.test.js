// Heave screening estimate. This is NOT a motion analysis: there is no damping
// or excitation model, so the output may only be used to flag a potential
// resonance for follow-up analysis.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePlatform } from '../../js/morison.js';
import { DEFAULT_ENVIRONMENT, makeBody } from '../../js/state.js';
import { g } from '../../js/waveTheory.js';

const ENV = { ...DEFAULT_ENVIRONMENT, waveTheory: 'airy', H: 2, T: 9, h: 60, rho: 1025 };

test('waterplane area of a cylinder is pi R^2', () => {
  const r = computePlatform(ENV, [makeBody({ diameter: 6, draft: 20 })]);
  assert.ok(Math.abs(r.heave.waterplaneArea - Math.PI * 9) < 1e-9);
});

test('cylinder heave added mass uses a documented one-sided-disk estimate (4/3) rho R^3', { todo: 'D-06' }, () => {
  const R = 3, d = 20, rho = ENV.rho;
  const r = computePlatform(ENV, [makeBody({ diameter: 2 * R, draft: d })]);
  const M = rho * Math.PI * R * R * d;
  const A33 = (4 / 3) * rho * R ** 3;
  const C33 = rho * g * Math.PI * R * R;
  assert.ok(Math.abs(r.heave.addedMass - A33) / A33 < 1e-12);
  assert.ok(Math.abs(r.heave.Tn3 - 2 * Math.PI * Math.sqrt((M + A33) / C33)) < 1e-9);
});

test('heave components are reported separately and damping/excitation are explicitly absent', { todo: 'D-06' }, () => {
  const r = computePlatform(ENV, [makeBody({ diameter: 6, draft: 20 })]);
  const h = r.heave;
  for (const key of ['mass', 'addedMass', 'restoringStiffness', 'Tn3', 'Tn3NoAddedMass']) {
    assert.ok(Number.isFinite(h[key]), `${key} present`);
  }
  assert.equal(h.damping, null);
  assert.equal(h.excitation, null);
  assert.match(h.status, /screening/i);
});

test('sphere hydrostatics use exact spherical-cap geometry for any draft', { todo: 'D-07' }, () => {
  const R = 5, d = 3;
  const r = computePlatform(ENV, [makeBody({ type: 'sphere', radius: R, draft: d })]);
  assert.ok(Math.abs(r.bodies[0].submergedVolume - (Math.PI * d * d * (3 * R - d)) / 3) < 1e-9);
  assert.ok(Math.abs(r.heave.waterplaneArea - Math.PI * (2 * R * d - d * d)) < 1e-9);
});
