// Engine-level verification: diffraction, integration limits, numerical
// convergence, sphere models, wind on spheres, relative-velocity Morison,
// heave screening consequences and robustness.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePlatform, morisonStripForce, windForce, currentVelocity } from '../../js/morison.js';
import { DEFAULT_ENVIRONMENT, makeBody } from '../../js/state.js';
import { macCamyFuchs, macCamyFuchsTotalForce } from '../../js/diffraction.js';
import { prepareWave, kinematics, g } from '../../js/waveTheory.js';
import { simpson } from '../helpers/references.js';

const RHO = 1025;
const BASE = {
  ...DEFAULT_ENVIRONMENT, waveTheory: 'airy', H: 2, T: 8, h: 30,
  U_c: 0, currentProfile: 'uniform', V_wind: 0, Cd: 1, Cm: 2, useMacCamy: false, rho: RHO,
};
const rel = (a, b) => Math.abs(a - b) / Math.abs(b);

// --- Diffraction -----------------------------------------------------------

test('MacCamy–Fuchs: bottom-mounted cylinder total force equals the exact closed form (1e-12)', () => {
  for (const [T, D] of [[8, 4], [6, 10], [5, 14]]) {
    const env = { ...BASE, T, Cd: 0, Cm: 2, useMacCamy: true };
    const r = computePlatform(env, [makeBody({ diameter: D, draft: 30, freeboard: 5 })]);
    assert.equal(r.ok, true);
    const ref = macCamyFuchsTotalForce({ rho: RHO, g, H: 2, k: r.k, h: 30, a: D / 2 });
    assert.ok(rel(r.global.peakTotal, ref) < 1e-12, `T=${T} D=${D}: ${rel(r.global.peakTotal, ref).toExponential(2)}`);
  }
});

test('MacCamy–Fuchs never modifies the drag term', () => {
  const env = { ...BASE, T: 6, Cm: 0, U_c: 0.6 };
  const body = [makeBody({ diameter: 10, draft: 20 })];
  const off = computePlatform({ ...env, useMacCamy: false }, body);
  const on = computePlatform({ ...env, useMacCamy: true }, body);
  assert.ok(rel(on.global.peakTotal, off.global.peakTotal) < 1e-14);
});

test('MacCamy–Fuchs inertia force leads the Morison inertia by delta(ka)', () => {
  const env = { ...BASE, T: 6, Cd: 0, useMacCamy: true };
  const D = 10;
  const r = computePlatform(env, [makeBody({ diameter: D, draft: 30, freeboard: 5 })]);
  const { delta } = macCamyFuchs((r.k * D) / 2);
  let ss = 0, cc = 0;
  for (const p of r.global.timeData.slice(0, -1)) {
    const th = -r.omega * p.t;
    ss += p.inertia * Math.sin(th);
    cc += p.inertia * Math.cos(th);
  }
  assert.ok(Math.abs(Math.atan2(cc, ss) - delta) < 1e-9, `phase ${Math.atan2(cc, ss)} vs ${delta}`);
});

// --- Numerical convergence -------------------------------------------------

test('quadrature convergence: 6x8 and 24x8 Gauss–Legendre agree (SWL, Airy, with current)', () => {
  const env = { ...BASE, U_c: 0.9, currentProfile: 'power17' };
  const bodies = [makeBody({ diameter: 5, draft: 22 })];
  const a = computePlatform(env, bodies, { panels: 6, order: 8 }).global.peakTotal;
  const b = computePlatform(env, bodies, { panels: 24, order: 8 }).global.peakTotal;
  assert.ok(rel(a, b) < 1e-6, `${rel(a, b).toExponential(2)}`);
});

test('quadrature convergence with the moving free-surface limit (Stokes 5th, to eta)', () => {
  const env = { ...BASE, waveTheory: 'stokes5', H: 5, T: 10, h: 40, integrateTo: 'surface' };
  const bodies = [makeBody({ diameter: 4, draft: 20, freeboard: 10 })];
  const a = computePlatform(env, bodies, { panels: 6, order: 8 }).global.peakTotal;
  const b = computePlatform(env, bodies, { panels: 24, order: 8 }).global.peakTotal;
  assert.ok(rel(a, b) < 1e-6, `${rel(a, b).toExponential(2)}`);
});

test('time-step convergence: refined peak independent of the sampling density', () => {
  const env = { ...BASE, U_c: 0.5 };
  const bodies = [makeBody({ diameter: 4, draft: 15 }), makeBody({ x: 37, diameter: 4, draft: 15 })];
  const coarse = computePlatform(env, bodies, { timeSamples: 60 }).global.peakTotal;
  const fine = computePlatform(env, bodies, { timeSamples: 2000 }).global.peakTotal;
  assert.ok(rel(coarse, fine) < 1e-9, `${rel(coarse, fine).toExponential(2)}`);
});

test('Wheeler-stretched surface integration -> SWL integration as H -> 0, at the expected order', () => {
  // Inertia peaks at the zero-crossing (eta = 0), so the extra wetted length only
  // enters at second order: difference O((kH)^2), ratio 4 per halving of H.
  // Drag peaks under the crest (eta = a): difference O(kH), ratio 2.
  const diff = (H, coeffs) => {
    const env = { ...BASE, H, ...coeffs };
    const b = [makeBody({ diameter: 3, draft: 12 })];
    const swl = computePlatform(env, b).global.peakTotal;
    const sur = computePlatform({ ...env, integrateTo: 'surface' }, b).global.peakTotal;
    return Math.abs(sur - swl) / swl;
  };
  for (const [coeffs, order] of [[{ Cd: 0 }, 4], [{ Cm: 0 }, 2]]) {
    const d1 = diff(0.4, coeffs), d2 = diff(0.2, coeffs), d3 = diff(0.1, coeffs);
    assert.ok(d3 < d2 && d2 < d1, `${JSON.stringify(coeffs)}: difference decreases with H`);
    for (const ratio of [d1 / d2, d2 / d3]) {
      assert.ok(Math.abs(ratio - order) < 0.25 * order, `${JSON.stringify(coeffs)}: ratio ${ratio} (expect ${order})`);
    }
  }
});

// --- Spheres -----------------------------------------------------------------

test('exact sphere section: inertia matches an independent Simpson reference', () => {
  for (const draft of [5, 7.5]) {
    const R = 5;
    const env = { ...BASE, Cd: 0, sphereModel: 'exact', T: 7 };
    const r = computePlatform(env, [makeBody({ type: 'sphere', radius: R, draft })]);
    const wp = prepareWave('airy', env.H, env.T, env.h);
    const zc = R - draft;
    let peak = 0;
    for (let i = 0; i < 720; i++) {
      const t = (i / 720) * env.T;
      const F = RHO * env.Cm * Math.PI * simpson((z) => (R * R - (z - zc) ** 2) * kinematics(z, t, wp).dudt, -draft, 0, 4000);
      peak = Math.max(peak, Math.abs(F));
    }
    assert.ok(rel(r.global.peakTotal, peak) < 2e-5, `draft ${draft}: ${rel(r.global.peakTotal, peak).toExponential(2)}`);
  }
});

test('thesis 3-slice sphere carries the hemisphere volume: equals exact model in long waves (draft = R)', () => {
  const env = { ...BASE, Cd: 0, T: 60, h: 400, H: 1 };
  const b = [makeBody({ type: 'sphere', radius: 4, draft: 4 })];
  const slices = computePlatform({ ...env, sphereModel: 'slices3' }, b).global.peakTotal;
  const exact = computePlatform({ ...env, sphereModel: 'exact' }, b).global.peakTotal;
  assert.ok(rel(slices, exact) < 1e-3, `${rel(slices, exact).toExponential(2)}`);
});

test('wind on a sphere cap matches an independent quadrature', () => {
  const env = { ...DEFAULT_ENVIRONMENT, V_wind: 30 };
  const body = makeBody({ type: 'sphere', radius: 6, draft: 4 });
  const zc = 6 - 4, top = 8;
  const ref = 0.5 * env.rho_air * env.Cd_air * env.V_wind ** 2 * simpson(
    (z) => 2 * Math.sqrt(Math.max(36 - (z - zc) ** 2, 0)) * Math.pow(Math.max(z, 0) / env.windRef, 2 * env.windBeta),
    0, top, 200000,
  );
  assert.ok(rel(windForce(body, env), ref) < 1e-4, `${rel(windForce(body, env), ref).toExponential(2)}`);
});

// --- Formulation details ------------------------------------------------------

test('relative-velocity Morison: co-moving body feels only the Froude–Krylov force', () => {
  const p = { rho: RHO, Cd: 1, Cm: 2, D: 2, A: Math.PI, u: 1.3, dudt: 0.7 };
  assert.ok(Math.abs(morisonStripForce({ ...p, ub: p.u, dubdt: p.dudt }) - RHO * p.A * p.dudt) < 1e-9);
  const fixed = RHO * 2 * Math.PI * 0.7 + 0.5 * RHO * 1 * 2 * 1.3 * 1.3;
  assert.ok(Math.abs(morisonStripForce(p) - fixed) < 1e-9);
});

test('current profiles: surface value at z = 0, zero at the bed, constant above SWL', () => {
  const env = { ...BASE, U_c: 1.2, h: 40 };
  for (const currentProfile of ['power17', 'log']) {
    const e = { ...env, currentProfile };
    assert.ok(Math.abs(currentVelocity(0, e) - 1.2) < 1e-12, currentProfile);
    assert.ok(Math.abs(currentVelocity(3, e) - 1.2) < 1e-12, `${currentProfile} above SWL`);
  }
  assert.equal(currentVelocity(-40, { ...env, currentProfile: 'power17' }), 0);
});

test('Stokes 5th truncated at SWL is flagged; integrating to eta clears the flag', () => {
  const env = { ...BASE, waveTheory: 'stokes5', H: 4, T: 9, h: 40 };
  const b = [makeBody({ diameter: 4, draft: 15, freeboard: 10 })];
  const codes = (r) => r.warnings.map((w) => w.code);
  assert.ok(codes(computePlatform(env, b)).includes('STOKES_TRUNCATED_AT_SWL'));
  assert.ok(!codes(computePlatform({ ...env, integrateTo: 'surface' }, b)).includes('STOKES_TRUNCATED_AT_SWL'));
});

test('Reynolds number uses the configured kinematic viscosity', () => {
  const r = computePlatform({ ...BASE, nu: 1.19e-6 }, [makeBody({ diameter: 4, draft: 15 })]);
  const b = r.bodies[0];
  assert.ok(rel(b.Re, (b.U_m * 4) / 1.19e-6) < 1e-12);
});

// --- Consequences and robustness -----------------------------------------------

test('default platform: corrected heave estimate flags potential resonance at T = 9 s (missed before D-06)', () => {
  const r = computePlatform({ ...DEFAULT_ENVIRONMENT }, [
    makeBody({ x: 0, diameter: 6, draft: 20 }), makeBody({ x: 60, diameter: 6, draft: 20 }),
  ]);
  assert.equal(r.ok, true);
  assert.ok(Math.abs(r.heave.Tn3 - 9.2526) < 1e-3, `T3 = ${r.heave.Tn3}`);
  assert.ok(r.warnings.some((w) => w.code === 'HEAVE_RESONANCE_SCREEN'));
});

test('array factor never exceeds 1 (peak of the sum <= sum of the peaks)', () => {
  for (const dx of [0, 13, 31, 47, 60, 95]) {
    const r = computePlatform({ ...BASE, U_c: 0.7 }, [
      makeBody({ x: 0, y: -15, diameter: 4, draft: 15 }), makeBody({ x: dx, y: 15, diameter: 4, draft: 15 }),
    ]);
    assert.ok(r.arrayFactor <= 1 + 1e-12, `dx=${dx}: ${r.arrayFactor}`);
  }
});

test('robustness sweep: 300 seeded random configurations never throw and never return NaN', () => {
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  let okCount = 0;
  for (let i = 0; i < 300; i++) {
    const h = 5 + rnd() * 300;
    const env = {
      ...DEFAULT_ENVIRONMENT,
      waveTheory: pick(['airy', 'stokes5']), integrateTo: pick(['swl', 'surface']),
      sphereModel: pick(['slices3', 'exact']), currentProfile: pick(['uniform', 'power17', 'log']),
      useMacCamy: rnd() < 0.5, H: 0.2 + rnd() * 12, T: 3 + rnd() * 18, h, U_c: rnd() * 2,
    };
    const type = pick(['cylinder', 'sphere']);
    const R = 0.5 + rnd() * 8;
    const body = makeBody({ type, diameter: 2 * R, radius: R, draft: Math.min(h, 0.3 + rnd() * 2 * R * 1.2), freeboard: rnd() * 20 });
    const r = computePlatform(env, [body, makeBody({ ...body, x: 40 + rnd() * 80 })]);
    if (r.ok) {
      okCount++;
      for (const v of [r.global.peakTotal, r.global.rms, r.heave.Tn3, r.bodies[0].KC, r.arrayFactor]) {
        assert.ok(Number.isFinite(v) || v === Infinity, `case ${i}: ${v}`);
      }
    } else {
      assert.ok(r.errors.length > 0, `case ${i}: ok=false without errors`);
    }
  }
  assert.ok(okCount > 50, `only ${okCount} valid cases — sweep not exercising the solver`);
});
