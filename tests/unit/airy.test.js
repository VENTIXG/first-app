import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareWave, kinematics, surfaceElevation, g } from '../../js/waveTheory.js';

const close = (a, b, rel, msg) =>
  assert.ok(Math.abs(a - b) <= rel * Math.max(Math.abs(a), Math.abs(b), 1e-300), `${msg}: ${a} vs ${b}`);

test('Airy u, du/dt match the closed form a w cosh(k(z+h))/sinh(kh) at intermediate depth', () => {
  const wp = prepareWave('airy', 2, 9, 30);
  const { k, omega } = wp;
  for (const z of [-0.5, -5, -15, -29]) {
    for (const t of [0, 1.3, 4.1]) {
      const th = -omega * t;
      const decay = Math.cosh(k * (z + 30)) / Math.sinh(k * 30);
      const { u, dudt } = kinematics(z, t, wp, 0);
      close(u, 1 * omega * decay * Math.cos(th), 1e-12, `u z=${z} t=${t}`);
      close(dudt, 1 * omega * omega * decay * Math.sin(th), 1e-12, `dudt z=${z} t=${t}`);
    }
  }
});

test('du/dt is the true local time derivative of u (central difference)', () => {
  const wp = prepareWave('airy', 3, 10, 40);
  const dt = 1e-4;
  for (const t of [0.2, 2.7, 6.6]) {
    const fd = (kinematics(-8, t + dt, wp).u - kinematics(-8, t - dt, wp).u) / (2 * dt);
    close(kinematics(-8, t, wp).dudt, fd, 1e-6, `t=${t}`);
  }
});

test('spatial phase: u(x, t) = u(0, t - kx/w) for a wave travelling in +x', () => {
  const wp = prepareWave('airy', 2, 8, 25);
  const x = 37.5;
  for (const t of [0, 1, 3.3]) {
    close(kinematics(-4, t, wp, x).u, kinematics(-4, t - (wp.k * x) / wp.omega, wp, 0).u, 1e-12, `t=${t}`);
  }
});

test('surface elevation is a cos(kx - wt)', () => {
  const wp = prepareWave('airy', 2, 8, 25);
  for (const [x, t] of [[0, 0], [10, 2], [-30, 5.5]]) {
    close(surfaceElevation(t, wp, x), 1 * Math.cos(wp.k * x - wp.omega * t), 1e-12, `x=${x} t=${t}`);
  }
});

test('kinematics stay finite for extreme kh (h = 5000 m, T = 2 s, kh ~ 5000)', () => {
  const wp = prepareWave('airy', 1, 2, 5000);
  const { u, dudt } = kinematics(-3, 0.4, wp);
  assert.ok(Number.isFinite(u) && Number.isFinite(dudt));
});

test('deep water: velocity amplitude decays monotonically and equals a w e^{kz} at every depth', { todo: 'D-10' }, () => {
  // T = 4 s in 3000 m water: 25/k ~ 99 m, so the old effective-depth cap is exercised below that.
  const wp = prepareWave('airy', 2, 4, 3000);
  let prev = Infinity;
  for (let z = 0; z >= -250; z -= 5) {
    const amp = Math.hypot(kinematics(z, 0, wp).u, kinematics(z, wp.T / 4, wp).u);
    assert.ok(amp <= prev * (1 + 1e-12), `amplitude grows at z=${z}`);
    close(amp, 1 * wp.omega * Math.exp(wp.k * z), 1e-9, `z=${z}`);
    prev = amp;
  }
});
