// Characterization and regression tests for the offline single-file app
// (standalone.html), run against its own embedded functions.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadStandalonePhysics, standaloneSource } from '../helpers/standalone.js';
import { BESSEL_TABLE } from '../helpers/references.js';

const S = loadStandalonePhysics();

test('array study reproduces thesis Table 6 |F| at all 15 frequencies', () => {
  const F = [1153.76, 2061.11, 2459.73, 2021.19, 536.01, 1344.57, 1437.97, 843.43,
    1010.83, 1407.21, 591.77, 556.50, 2035.45, 9243.25, 4643.50];
  const ap = { N: 7, L: 30, D: 10, T: 26, d: 60, H: 2, CM: 2, CD: 1, rho: 1025 };
  F.forEach((ref, i) => {
    const w = 0.1 * (i + 1);
    const p = S.arrayPoint(w, ap);
    assert.ok(Math.abs(p.F / 1000 - ref) < 0.006, `w=${w.toFixed(1)}: ${(p.F / 1000).toFixed(3)} vs ${ref}`);
  });
});

test('Bessel J0, J1, Y0 agree with A&S Table 9.1 to 1e-7', () => {
  for (const [x, j0, j1, y0] of BESSEL_TABLE) {
    assert.ok(Math.abs(S.besselJ0(x) - j0) < 1e-7, `J0(${x})`);
    assert.ok(Math.abs(S.besselJ1(x) - j1) < 1e-7, `J1(${x})`);
    assert.ok(Math.abs(S.bessY0(x) - y0) < 1e-7, `Y0(${x})`);
  }
});

test('Bessel Y1 agrees with A&S Table 9.1 to 1e-7', () => {
  for (const [x, , , , y1] of BESSEL_TABLE) {
    assert.ok(Math.abs(S.bessY1(x) - y1) < 1e-7, `Y1(${x}): err ${(S.bessY1(x) - y1).toExponential(2)}`);
  }
});

test('MacCamy-Fuchs inertia coefficient -> 2 as ka -> 0', () => {
  assert.ok(Math.abs(S.macCamyFuchs(0.01).Cm - 2) < 1e-3);
});

test('MacCamy-Fuchs inertia force is in phase with sin(theta + delta), not cos', () => {
  const h = 60, T = 4.5, omega = (2 * Math.PI) / T;
  const k = S.solveDispersion(omega, h);
  const lam = (2 * Math.PI) / k;
  const wv = { k, omega, kh: k * h, a: 1, lam, T };
  const b = { type: 'cyl', x: 0, D: 0.3 * lam, draft: 20, free: 1, CdAuto: false, Cd: 0, Cm: 2 };
  const p = { h, H: 2, rho: 1025, Uc: 0 };
  let ss = 0, cc = 0;
  for (let i = 0; i < 720; i++) {
    const t = (i / 720) * T;
    const th = -omega * t;
    const F = S.bodyForce(b, wv, p, t).Fi;
    ss += F * Math.sin(th);
    cc += F * Math.cos(th);
  }
  const { delta } = S.macCamyFuchs((k * b.D) / 2);
  const measured = Math.atan2(cc, ss); // F ∝ sin(th + phi) => atan2(cos-proj, sin-proj) = phi
  assert.ok(Math.abs(measured - delta) < 0.01, `phase ${measured.toFixed(3)} vs delta ${delta.toFixed(3)}`);
});

test('array study does not silently alter a draft >= depth', () => {
  assert.ok(!/if\(ap\.T>=ap\.d\)ap\.T=ap\.d-1;/.test(standaloneSource()),
    'runArray() silently replaces the user draft with depth - 1');
});
