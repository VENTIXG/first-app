import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePlatform } from '../../js/morison.js';
import { DEFAULT_ENVIRONMENT, makeBody } from '../../js/state.js';

// Steady drag on a vertical cylinder of width D over 0..he with the power-law
// profile V(z) = Vr (z/zr)^b has the exact integral
//   F = 0.5 rho_a C D Vr^2 he^(2b+1) / ((2b+1) zr^(2b))
function exactCylinderWind(env, D, he) {
  const b = env.windBeta;
  return 0.5 * env.rho_air * env.Cd_air * D * env.V_wind ** 2 *
    he ** (2 * b + 1) / ((2 * b + 1) * env.windRef ** (2 * b));
}

const ENV = { ...DEFAULT_ENVIRONMENT, waveTheory: 'airy', V_wind: 25 };

test('cylinder wind force agrees with the exact power-law integral to 1%', () => {
  const r = computePlatform(ENV, [makeBody({ diameter: 6, draft: 20 })]);
  const ref = exactCylinderWind(ENV, 6, 15);
  assert.ok(Math.abs(r.bodies[0].windForce - ref) / ref < 1e-2);
});

test('cylinder wind force is exact (closed-form integral, per-body freeboard)', () => {
  const body = makeBody({ diameter: 6, draft: 20, freeboard: 12 });
  const r = computePlatform(ENV, [body]);
  const ref = exactCylinderWind(ENV, 6, 12);
  assert.ok(Math.abs(r.bodies[0].windForce - ref) / ref < 1e-12);
});
