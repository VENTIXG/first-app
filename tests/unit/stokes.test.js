import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  prepareWave, kinematics, surfaceElevation, stokesCoefficients, g,
} from '../../js/waveTheory.js';
import { computePlatform } from '../../js/morison.js';
import { DEFAULT_ENVIRONMENT, makeBody } from '../../js/state.js';
import { stokesResiduals } from '../helpers/stokesResidual.js';

// Period giving a prescribed linear kh in depth h.
function periodFor(kh, h) {
  const k = kh / h;
  return (2 * Math.PI) / Math.sqrt(g * k * Math.tanh(kh));
}

// Residuals for lambda ~ 0.04 / 0.02 / 0.01 at a target kh.
function residualLadder(kh) {
  const h = 50;
  const T = periodFor(kh, h);
  return [0.04, 0.02, 0.01].map((lam) => {
    const wp = prepareWave('stokes5', (2 * lam * h) / kh, T, h);
    assert.ok(wp.converged, `Stokes converged at kh=${kh}, lambda~${lam}`);
    return stokesResiduals(wp, g);
  });
}

test('small-amplitude limit: Stokes 5th velocity -> Airy (within 0.2% of amplitude)', () => {
  const a = prepareWave('airy', 0.1, 8, 20);
  const s = prepareWave('stokes5', 0.1, 8, 20);
  let worst = 0;
  for (const z of [-1, -5, -10, -18]) {
    const amp = Math.abs(kinematics(z, 0, a).u);
    for (const t of [0, 1, 2.7, 4.4, 6.1]) {
      worst = Math.max(worst, Math.abs(kinematics(z, t, s).u - kinematics(z, t, a).u) / amp);
    }
  }
  assert.ok(worst < 2e-3, `max diff ${(worst * 100).toFixed(3)}% of amplitude`);
});

test('crest-to-trough height reproduces the input H', () => {
  for (const [H, T, h] of [[6, 10, 15], [3, 8, 40], [10, 12, 200]]) {
    const wp = prepareWave('stokes5', H, T, h);
    assert.ok(wp.converged);
    const crest = surfaceElevation(0, wp, 0);
    const trough = surfaceElevation(0, wp, Math.PI / wp.k);
    assert.ok(Math.abs(crest - trough - H) / H < 1e-9, `H=${H}: ${crest - trough}`);
    assert.ok(crest > -trough, 'crest higher than trough is deep');
  }
});

test('deep-water limits of the S&H coefficients (B22, B33, B44, B55, C1, C2)', () => {
  const c = stokesCoefficients(20);
  const near = (v, ref, name) => assert.ok(Math.abs(v - ref) < 1e-6, `${name}: ${v} vs ${ref}`);
  near(c.B22, 1 / 2, 'B22');
  near(c.B33, 3 / 8, 'B33');
  near(c.B44, 1 / 3, 'B44');
  near(c.B55, 125 / 384, 'B55');
  near(c.C1, 1, 'C1');
  near(c.C2, 5 / 4, 'C2');
});

test('Fenton-derived lambda^2 dispersion term reproduces the S&H C1 identically (conversion check)', () => {
  for (const kh of [0.4, 0.8, 1.5, 3, 6]) {
    const S = 1 / Math.cosh(2 * kh);
    const twoQ = (2 + 7 * S * S) / (2 * (1 - S) ** 2);
    const C1 = stokesCoefficients(kh).C1;
    assert.ok(Math.abs(twoQ - C1) / C1 < 1e-12, `kh=${kh}: ${twoQ} vs ${C1}`);
  }
});

test('kinematic free-surface BC residual scales as lambda^6 at all depths', () => {
  for (const kh of [1, 2, 4]) {
    const [r1, r2, r3] = residualLadder(kh);
    for (const ratio of [r1.kinematic / r2.kinematic, r2.kinematic / r3.kinematic]) {
      assert.ok(ratio > 55, `kh=${kh}: KFSBC ratio ${ratio.toFixed(1)} (expect ~64)`);
    }
  }
});

test('dynamic (Bernoulli) free-surface BC residual scales as lambda^6 at all depths', () => {
  for (const kh of [0.6, 1, 2, 4]) {
    const [r1, r2, r3] = residualLadder(kh);
    for (const ratio of [r1.dynamic / r2.dynamic, r2.dynamic / r3.dynamic]) {
      assert.ok(ratio > 55, `kh=${kh}: DFSBC ratio ${ratio.toFixed(1)} (expect ~64; ~32 means an O(lambda^5) error)`);
    }
  }
});

test('Stokes non-convergence is reported as an error, never used as a result', () => {
  // Very steep wave in shallow water: outside the domain where S&H converges.
  const env = { ...DEFAULT_ENVIRONMENT, waveTheory: 'stokes5', H: 7.5, T: 14, h: 10 };
  const r = computePlatform(env, [makeBody({ diameter: 2, draft: 5 })]);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /converge|breaking|validity/i.test(e.message)));
});
