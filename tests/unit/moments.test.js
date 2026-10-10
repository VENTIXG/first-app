// Overturning moments (benchmark L: force/moment reference-point transformation).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePlatform, transferMoment, windLoad } from '../../js/morison.js';
import { DEFAULT_ENVIRONMENT } from '../../js/state.js';
import { prepareWave } from '../../js/waveTheory.js';

const env = (o = {}) => ({ ...DEFAULT_ENVIRONMENT, U_c: 0, V_wind: 0, useMacCamy: false, ...o });
const rel = (a, b) => Math.abs(a - b) / Math.abs(b);

test('inertia-only moment about the seabed of a bottom-mounted cylinder equals the closed form (1e-10)', () => {
  // M = rho Cm A a w^2 / sinh(kh) * ∫_0^h s cosh(ks) ds,  ∫ = h sinh(kh)/k - (cosh(kh) - 1)/k^2
  for (const [T, h] of [[9, 40], [6, 20], [14, 80]]) {
    const e = env({ Cd: 0, T, h, H: 2 });
    const D = 4;
    const r = computePlatform(e, [{ id: 1, type: 'cylinder', x: 0, y: 0, diameter: D, radius: 1, draft: h, freeboard: 5 }]);
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    const { k, omega } = prepareWave('airy', 2, T, h);
    const I = (h * Math.sinh(k * h)) / k - (Math.cosh(k * h) - 1) / (k * k);
    const ref = (e.rho * e.Cm * Math.PI * D * D / 4 * 1 * omega * omega / Math.sinh(k * h)) * I;
    assert.ok(rel(r.global.peakMoment, ref) < 1e-10, `T=${T}: ${r.global.peakMoment} vs ${ref}`);
  }
});

test('reference-point transfer: moment about SWL from the seabed moment equals the direct ∫ f z dz', () => {
  const T = 9, h = 40, D = 4;
  const e = env({ Cd: 0, T, h, H: 2 });
  const r = computePlatform(e, [{ id: 1, type: 'cylinder', x: 0, y: 0, diameter: D, radius: 1, draft: h, freeboard: 5 }]);
  const { k, omega } = prepareWave('airy', 2, T, h);
  // ∫_{-h}^0 cosh(k(z+h)) z dz = ∫_0^h cosh(ks)(s - h) ds = I1 - h sinh(kh)/k
  const I1 = (h * Math.sinh(k * h)) / k - (Math.cosh(k * h) - 1) / (k * k);
  const amp = e.rho * e.Cm * Math.PI * D * D / 4 * omega * omega / Math.sinh(k * h);
  for (const p of r.global.timeData) {
    const phase = Math.sin(-omega * p.t); // inertia ∝ sin(kx - wt) at x = 0
    const mSWL = amp * (I1 - (h * Math.sinh(k * h)) / k) * phase;
    const fromTransfer = transferMoment(p.moment, p.total, 0, h);
    assert.ok(Math.abs(fromTransfer - mSWL) <= 1e-9 * Math.abs(amp * I1), `t=${p.t}`);
  }
});

test('wind moment on a cylinder: exact power-law lever arm', () => {
  const e = { ...DEFAULT_ENVIRONMENT };
  const f = 15, D = 6, b = e.windBeta, p = 2 * b + 1;
  const { force, momentSWL } = windLoad({ type: 'cylinder', diameter: D, draft: 20, freeboard: f }, e);
  assert.ok(rel(momentSWL / force, (p / (p + 1)) * f) < 1e-14);
});

test('symmetric pair half a wavelength apart: forces and moments cancel', () => {
  const T = 9, h = 40;
  const e = env({ Cd: 0, T, h, H: 2 });
  const { wavelength } = prepareWave('airy', 2, T, h);
  const body = (id, x) => ({ id, type: 'cylinder', x, y: 0, diameter: 4, radius: 1, draft: 20, freeboard: 5 });
  const one = computePlatform(e, [body(1, 0)]);
  const pair = computePlatform(e, [body(1, 0), body(2, wavelength / 2)]);
  assert.ok(pair.global.peakMoment < 1e-6 * one.global.peakMoment);
  const same = computePlatform(e, [body(1, 0), body(2, 0)].map((b, i) => ({ ...b, y: i * 20 })));
  assert.ok(rel(same.global.peakMoment, 2 * one.global.peakMoment) < 1e-12);
});

test('moment is reported per body and globally, and is consistent with the force history', () => {
  const r = computePlatform({ ...DEFAULT_ENVIRONMENT }, [
    { id: 1, type: 'cylinder', x: 0, y: 0, diameter: 6, radius: 3, draft: 20, freeboard: 15 },
    { id: 2, type: 'cylinder', x: 60, y: 0, diameter: 6, radius: 3, draft: 20, freeboard: 15 },
  ]);
  for (let i = 0; i < r.global.timeData.length; i++) {
    const sum = r.bodies.reduce((a, b) => a + b.timeData[i].moment, 0);
    assert.ok(Math.abs(sum - r.global.timeData[i].moment) <= 1e-9 * Math.abs(r.global.peakMoment));
    // lever arm of the resultant lies inside the loaded height (seabed .. top)
    const p = r.global.timeData[i];
    if (Math.abs(p.total) > 1e3) {
      const arm = p.moment / p.total;
      assert.ok(arm > 0 && arm < 40 + 15, `arm ${arm}`);
    }
  }
});
