// Benchmark F: buoyancy of fully and partially submerged analytical shapes.
// Volumes from js/geometry.js are compared with (a) closed forms and (b) an
// independent Simpson integration of the horizontal section area A(z), so the
// test does not reuse the formula it checks.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { submergedVolume, waterplaneArea } from '../../js/geometry.js';
import { g } from '../../js/waveTheory.js';

const rho = 1025;
function simpson(f, a, b, n = 2000) {
  const h = (b - a) / n;
  let s = f(a) + f(b);
  for (let i = 1; i < n; i++) s += (i % 2 ? 4 : 2) * f(a + i * h);
  return (s * h) / 3;
}

test('vertical cylinder: V = pi R^2 T at several drafts; buoyancy = rho g V', () => {
  for (const [D, T] of [[8, 20], [6, 0.5], [12, 35]]) {
    const body = { type: 'cylinder', diameter: D, draft: T };
    const V = submergedVolume(body);
    assert.ok(Math.abs(V - (Math.PI * D * D * T) / 4) / V < 1e-14);
    assert.ok(Math.abs(simpson(() => (Math.PI * D * D) / 4, -T, 0) - V) / V < 1e-12);
    assert.ok(Math.abs(rho * g * V - rho * g * Math.PI * (D / 2) ** 2 * T) / (rho * g * V) < 1e-14);
    assert.ok(Math.abs(waterplaneArea(body) - (Math.PI * D * D) / 4) < 1e-12);
  }
});

test('sphere: partial drafts match the integrated section area; draft = 2R is the full sphere with no waterplane', () => {
  const R = 5;
  for (const frac of [0.1, 0.5, 1, 1.5, 1.9, 2]) {
    const d = frac * R;
    const body = { type: 'sphere', radius: R, draft: d };
    const zc = R - d; // centre elevation relative to SWL (z up)
    const area = (z) => Math.PI * Math.max(0, R * R - (z - zc) ** 2);
    const V = submergedVolume(body);
    const Vnum = simpson(area, zc - R, Math.min(0, zc + R), 4000);
    assert.ok(Math.abs(V - Vnum) / V < 1e-9, `draft ${d}: ${V} vs ${Vnum}`);
    const Awp = waterplaneArea(body);
    assert.ok(Math.abs(Awp - (d < 2 * R ? area(0) : 0)) < 1e-9, `waterplane at draft ${d}`);
  }
  assert.ok(Math.abs(submergedVolume({ type: 'sphere', radius: R, draft: 2 * R }) - (4 / 3) * Math.PI * R ** 3) < 1e-9);
  assert.ok(Math.abs(submergedVolume({ type: 'sphere', radius: R, draft: R }) - (2 / 3) * Math.PI * R ** 3) < 1e-9);
});
