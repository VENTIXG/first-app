// Engine timing benchmark: `npm run bench`.
// Reports the mean wall-clock time of computePlatform for representative
// cases. Timings depend on the machine; compare runs on the same host only.

import { performance } from 'node:perf_hooks';
import { computePlatform, ENGINE_VERSION } from '../js/morison.js';
import { DEFAULT_ENVIRONMENT } from '../js/state.js';

const env = (o = {}) => ({ ...DEFAULT_ENVIRONMENT, ...o });

/** n bodies on a 30 m grid (10 per row); every third body is a sphere (R 5 m, draft 5 m). */
const grid = (n) => Array.from({ length: n }, (_, i) => ({
  id: i + 1,
  type: i % 3 === 2 ? 'sphere' : 'cylinder',
  x: (i % 10) * 30,
  y: Math.floor(i / 10) * 30,
  diameter: 6,
  radius: 5,
  draft: i % 3 === 2 ? 5 : 20,
  freeboard: 15,
}));

const CASES = [
  ['2 bodies, Airy, SWL', env(), grid(2), 50],
  ['2 bodies, Stokes 5th, SWL', env({ waveTheory: 'stokes5' }), grid(2), 50],
  ['2 bodies, Stokes 5th, surface', env({ waveTheory: 'stokes5', integrateTo: 'surface' }), grid(2), 20],
  ['10 bodies, Airy, SWL', env(), grid(10), 20],
  ['50 bodies, Airy, SWL', env(), grid(50), 10],
  ['50 bodies, Airy, surface (Wheeler)', env({ integrateTo: 'surface' }), grid(50), 5],
  ['50 bodies, Stokes 5th, surface', env({ waveTheory: 'stokes5', integrateTo: 'surface' }), grid(50), 5],
];

console.log(`engine ${ENGINE_VERSION} · Node ${process.version} · ${process.platform}/${process.arch}`);
for (const [label, e, bodies, reps] of CASES) {
  const first = computePlatform(e, bodies);
  if (!first.ok) throw new Error(`${label}: ${first.errors.map((x) => x.code).join(', ')}`);
  const t0 = performance.now();
  for (let i = 0; i < reps; i++) computePlatform(e, bodies);
  const ms = (performance.now() - t0) / reps;
  console.log(`${label.padEnd(40)} ${ms.toFixed(1).padStart(8)} ms   peak ${(first.global.peakTotal / 1000).toFixed(2)} kN`);
}
