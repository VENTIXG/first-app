import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePlatform } from '../../js/morison.js';
import { DEFAULT_ENVIRONMENT, makeBody } from '../../js/state.js';
import { solveDispersion, g } from '../../js/waveTheory.js';
import { simpson } from '../helpers/references.js';

const RHO = 1025;
const BASE = {
  ...DEFAULT_ENVIRONMENT, waveTheory: 'airy', H: 2, T: 8, h: 30,
  U_c: 0, currentProfile: 'uniform', V_wind: 0, Cd: 1, Cm: 2, useMacCamy: false, rho: RHO,
};
const rel = (a, b) => Math.abs(a - b) / Math.abs(b);

// Closed-form depth integrals for a truncated cylinder, Airy waves, integrated to SWL.
//   I1 = ∫_{-d}^{0} cosh k(z+h) dz,  I2 = ∫_{-d}^{0} cosh^2 k(z+h) dz
function closedForm({ H, T, h, Cd, Cm }, D, d) {
  const w = (2 * Math.PI) / T;
  const k = solveDispersion(w, h);
  const I1 = (Math.sinh(k * h) - Math.sinh(k * (h - d))) / k;
  const I2 = d / 2 + (Math.sinh(2 * k * h) - Math.sinh(2 * k * (h - d))) / (4 * k);
  const FI = Cm * RHO * (Math.PI * D * D / 4) * (H / 2) * w * w * I1 / Math.sinh(k * h);
  const FD = 0.5 * Cd * RHO * D * (H / 2) ** 2 * w * w * I2 / Math.sinh(k * h) ** 2;
  return { FI, FD, k, w };
}

test('inertia-only peak matches the closed-form I1 integral (truncated cylinder, to SWL)', () => {
  const D = 4, d = 15;
  const { FI } = closedForm(BASE, D, d);
  const r = computePlatform({ ...BASE, Cd: 0 }, [makeBody({ diameter: D, draft: d })]);
  assert.ok(rel(r.global.peakTotal, FI) < 1e-3, `rel err ${rel(r.global.peakTotal, FI).toExponential(2)}`);
});

test('drag-only peak matches the closed-form I2 integral (no current)', () => {
  const D = 4, d = 15;
  const { FD } = closedForm(BASE, D, d);
  const r = computePlatform({ ...BASE, Cm: 0 }, [makeBody({ diameter: D, draft: d })]);
  assert.ok(rel(r.global.peakTotal, FD) < 1e-3, `rel err ${rel(r.global.peakTotal, FD).toExponential(2)}`);
});

test('inertia and drag closed forms reproduced to 1e-12 (Gauss–Legendre + peak refinement)', () => {
  const D = 4, d = 15;
  const { FI, FD } = closedForm(BASE, D, d);
  const rI = computePlatform({ ...BASE, Cd: 0 }, [makeBody({ diameter: D, draft: d })]);
  const rD = computePlatform({ ...BASE, Cm: 0 }, [makeBody({ diameter: D, draft: d })]);
  assert.ok(rel(rI.global.peakTotal, FI) < 1e-12, `inertia ${rel(rI.global.peakTotal, FI).toExponential(2)}`);
  assert.ok(rel(rD.global.peakTotal, FD) < 1e-12, `drag ${rel(rD.global.peakTotal, FD).toExponential(2)}`);
});

test('drag with uniform current matches an independent quadrature reference', () => {
  const env = { ...BASE, Cm: 0, U_c: 0.8 };
  const D = 3, d = 12;
  const w = (2 * Math.PI) / env.T;
  const k = solveDispersion(w, env.h);
  const a = env.H / 2;
  let peak = 0;
  for (let i = 0; i < 2000; i++) {
    const t = (i / 2000) * env.T;
    const F = 0.5 * RHO * env.Cd * D * simpson((z) => {
      const V = a * w * Math.cosh(k * (z + env.h)) / Math.sinh(k * env.h) * Math.cos(-w * t) + env.U_c;
      return Math.abs(V) * V;
    }, -d, 0, 2000);
    peak = Math.max(peak, Math.abs(F));
  }
  const r = computePlatform(env, [makeBody({ diameter: D, draft: d })]);
  assert.ok(rel(r.global.peakTotal, peak) < 2e-3, `rel err ${rel(r.global.peakTotal, peak).toExponential(2)}`);
});

// ---------------------------------------------------------------------------
// Thesis Part A benchmark (methodologia-morison.md, Table 6): 7 in-line
// cylinders D = 10 m, spacing 30 m, draft 26 m, depth 60 m, H = 2 m.
// ---------------------------------------------------------------------------

const TABLE6 = [
  // omega, C_FI kN, C_FD kN, Q, |F| kN
  [0.1, 169.08, 18.45, 6.7835, 1153.76], [0.2, 337.13, 18.35, 6.1046, 2061.11],
  [0.3, 503.70, 18.26, 4.8801, 2459.73], [0.4, 669.43, 18.29, 3.0181, 2021.19],
  [0.5, 835.80, 18.60, 0.6412, 536.01], [0.6, 1001.84, 19.25, -1.3419, 1344.57],
  [0.7, 1158.63, 20.04, -1.2409, 1437.97], [0.8, 1292.51, 20.68, 0.6525, 843.43],
  [0.9, 1395.46, 21.06, 0.7243, 1010.83], [1.0, 1468.02, 21.23, -0.9585, 1407.21],
  [1.1, 1515.55, 21.30, 0.3904, 591.77],
];

function thesisPoint(w) {
  const d = 60, T = 26, D = 10, H = 2;
  const k = solveDispersion(w, d);
  const I1 = (Math.sinh(k * d) - Math.sinh(k * (d - T))) / k;
  const I2 = T / 2 + (Math.sinh(2 * k * d) - Math.sinh(2 * k * (d - T))) / (4 * k);
  const CFI = 2 * RHO * Math.PI * D * D * H * w * w * I1 / (8 * Math.sinh(k * d));
  const CFD = 1 * RHO * D * H * H * w * w * I2 / (3 * Math.PI * Math.sinh(k * d) ** 2);
  let Q = 1;
  for (let m = 1; m <= 3; m++) Q += 2 * Math.cos(m * 30 * k);
  return { CFI, CFD, Q, F: Math.abs(Q) * Math.hypot(CFI, CFD) };
}

test('closed-form 7-step method reproduces thesis Table 6 (to table rounding)', () => {
  for (const [w, cfi, cfd, Q, F] of TABLE6) {
    const p = thesisPoint(w);
    assert.ok(Math.abs(p.CFI / 1e3 - cfi) < 0.006, `w=${w} C_FI ${(p.CFI / 1e3).toFixed(3)}`);
    assert.ok(Math.abs(p.CFD / 1e3 - cfd) < 0.006, `w=${w} C_FD ${(p.CFD / 1e3).toFixed(3)}`);
    assert.ok(Math.abs(p.Q - Q) < 6e-5, `w=${w} Q ${p.Q.toFixed(5)}`);
    assert.ok(Math.abs(p.F / 1e3 - F) < 0.006, `w=${w} |F| ${(p.F / 1e3).toFixed(3)}`);
  }
});

function thesisArray(w, Cd) {
  const env = { ...BASE, H: 2, T: (2 * Math.PI) / w, h: 60, Cd, Cm: 2 };
  const bodies = [-90, -60, -30, 0, 30, 60, 90].map((x) => makeBody({ x, diameter: 10, draft: 26 }));
  return computePlatform(env, bodies);
}

test('time-domain array engine (Cd = 0) equals |Q|·C_FI from the thesis closed form', () => {
  for (const [w] of TABLE6) {
    const ref = Math.abs(thesisPoint(w).Q) * thesisPoint(w).CFI;
    const r = thesisArray(w, 0);
    assert.ok(rel(r.global.peakTotal, ref) < 1e-12, `w=${w}: ${rel(r.global.peakTotal, ref).toExponential(2)}`);
  }
});

test('with quadratic drag, time-domain peaks stay within 2% of the linearised thesis |F|', () => {
  // Not an error bound: the thesis linearises |u|u (Fourier 8/3pi), the engine does not.
  for (const [w] of TABLE6) {
    const ref = thesisPoint(w).F;
    const r = thesisArray(w, 1);
    assert.ok(rel(r.global.peakTotal, ref) < 0.02, `w=${w}: ${rel(r.global.peakTotal, ref).toExponential(2)}`);
  }
});

test('spatial superposition: bodies at equal x add in phase; lambda/2 apart cancel', () => {
  const env = { ...BASE, H: 3, T: 9, h: 40 };
  const one = computePlatform(env, [makeBody({ x: 0, y: 0, diameter: 4, draft: 15 })]);
  const twoInPhase = computePlatform(env, [
    makeBody({ x: 0, y: -20, diameter: 4, draft: 15 }),
    makeBody({ x: 0, y: 20, diameter: 4, draft: 15 }),
  ]);
  assert.ok(rel(twoInPhase.global.peakTotal, 2 * one.global.peakTotal) < 1e-9);
  const L = one.wavelength;
  const anti = computePlatform(env, [
    makeBody({ x: 0, diameter: 4, draft: 15 }),
    makeBody({ x: L / 2, diameter: 4, draft: 15 }),
  ]);
  assert.ok(anti.global.peakTotal < 1e-6 * one.global.peakTotal, `residual ${anti.global.peakTotal}`);
});
