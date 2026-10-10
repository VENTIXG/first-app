import { test } from 'node:test';
import assert from 'node:assert/strict';
import { macCamyFuchs, macCamyFuchsTotalForce } from '../../js/diffraction.js';
import { loadStandalonePhysics } from '../helpers/standalone.js';

const EULER_GAMMA = 0.5772156649015329;

test('small-ka limit: C_M -> 2, delta -> 0 (Morison with C_m = 2 recovered)', () => {
  const { CM, delta } = macCamyFuchs(1e-3);
  assert.ok(Math.abs(CM - 2) < 1e-4);
  assert.ok(Math.abs(delta) < 1e-5);
});

test('matches the small-argument asymptotic C_M = 2 / (1 + (x^2/2)(ln(x/2) + gamma + 1/2))', () => {
  for (const x of [0.01, 0.03, 0.06]) {
    const asym = 2 / (1 + (x * x / 2) * (Math.log(x / 2) + EULER_GAMMA + 0.5));
    assert.ok(Math.abs(macCamyFuchs(x).CM - asym) / asym < 2e-5, `x=${x}`);
  }
});

test('C_M rises slightly above 2 for small ka, then falls (not monotone)', () => {
  assert.ok(macCamyFuchs(0.3).CM > 2.05);
  assert.ok(macCamyFuchs(1.0).CM < 1.5);
  assert.ok(macCamyFuchs(3.0).CM < 0.35);
});

test('cross-implementation: agrees with standalone.html MacCamy–Fuchs (independent Bessel code) to 1e-6', () => {
  const S = loadStandalonePhysics();
  for (const ka of [0.1, 0.5, 1, 2, 3.5, 4.5, 6]) {
    const ours = macCamyFuchs(ka);
    const theirs = S.macCamyFuchs(ka);
    assert.ok(Math.abs(ours.CM - theirs.Cm) / ours.CM < 1e-6, `CM ka=${ka}`);
    // same angle modulo 2*pi (the two atan2 conventions differ by 2*pi where J1', Y1' < 0)
    const d = Math.atan2(Math.sin(ours.delta - theirs.delta), Math.cos(ours.delta - theirs.delta));
    assert.ok(Math.abs(d) < 1e-6, `delta ka=${ka}`);
  }
});

test('closed-form total force reduces to Morison (C_m = 2) for slender cylinders', () => {
  // F_Morison = rho * 2 * pi a^2 * (H/2) g k tanh(kh) / k  ... integrated: rho pi a^2 H g tanh(kh)
  const rho = 1025, g = 9.81, H = 2, h = 30, a = 0.05, k = 0.08;
  const mf = macCamyFuchsTotalForce({ rho, g, H, k, h, a });
  const morison = rho * Math.PI * a * a * H * g * Math.tanh(k * h);
  assert.ok(Math.abs(mf - morison) / morison < 1e-4);
});

test('rejects invalid ka', () => {
  for (const ka of [0, -1, NaN]) assert.throws(() => macCamyFuchs(ka), RangeError);
});
