// Multi-body Morison platform engine (fixed, rigid bodies).
//
// For every body the wave force is integrated over its wetted length with the
// kinematics evaluated at the body's own x, so each body sees the wave at its
// spatial phase theta = k x - omega t. The global base shear is the sum of the
// per-body forces at each instant (superposition; no hydrodynamic interaction).
//
// Per unit length (fixed body):
//     dF = 1/2 rho C_d D(z) |u + U(z)| (u + U(z)) dz  +  rho C_m A(z) u' dz
// with u, u' from the selected wave theory and U(z) the current profile.
// For moving bodies the relative-velocity form is provided by morisonStripForce
// (not used by the UI: there is no motion solution in this tool).
//
// Numerics: composite Gauss–Legendre over the wetted length (configurable),
// 200 time samples per period for the histories, and golden-section refinement
// of every reported peak on the continuous force function.
//
// Inputs are validated (validation.js). If any error is found, the result has
// ok = false and contains no force numbers.

import {
  prepareWave, kinematics, accelerationFiltered, surfaceElevation, wheelerZ, g,
} from './waveTheory.js';
import { compositeNodes, goldenMax } from './quadrature.js';
import { macCamyFuchsFilter } from './diffraction.js';
import {
  bodyRadius, bodyTopZ, sphereCenterZ, sphereSlices3, submergedVolume,
} from './geometry.js';
import {
  validateEnvironment, validateBodies, validateWave, validateBodyHydrodynamics,
} from './validation.js';
import { heaveScreening } from './hydrostatics.js';

export const ENGINE_VERSION = '1.0.0';
export const DEFAULT_NUMERICS = Object.freeze({ timeSamples: 200, panels: 6, order: 8 });

const Z0 = 0.05; // seabed roughness length for the logarithmic profile [m]

export const ASSUMPTIONS = Object.freeze([
  'Rigid, fixed (non-moving) bodies; no motion response.',
  'Regular, long-crested waves travelling in +x (0° heading); T is the intrinsic period (no Doppler shift).',
  'Current and wind collinear with the waves; wind steady (no gusts).',
  'Morison loads superposed body by body: no hydrodynamic interaction (blockage, shielding, wave interaction).',
  'One drag coefficient and one inertia coefficient for all bodies (no KC/Re/roughness dependence).',
  'Viscous drag is never modified by the diffraction correction.',
]);

/** Subsurface current at elevation z; above SWL the surface value is used. */
export function currentVelocity(z, env) {
  const zz = Math.min(z, 0);
  const heightAboveBed = Math.max(zz + env.h, 0);
  if (env.currentProfile === 'power17') return env.U_c * Math.pow(heightAboveBed / env.h, 1 / 7);
  if (env.currentProfile === 'log') {
    return (env.U_c * Math.log(Math.max(heightAboveBed, Z0) / Z0)) / Math.log(env.h / Z0);
  }
  return env.U_c;
}

/**
 * Morison force per unit length on a (possibly moving) slender section,
 * relative-velocity form with C_m = 1 + C_a:
 *   f = rho C_m A u' - rho (C_m - 1) A xb'' + 1/2 rho C_d D |u - xb'| (u - xb')
 * For a fixed body (xb' = xb'' = 0) this is the standard Morison equation.
 */
export function morisonStripForce({ rho, Cd, Cm, D, A, u, dudt, ub = 0, dubdt = 0 }) {
  const rel = u - ub;
  return rho * Cm * A * dudt - rho * (Cm - 1) * A * dubdt + 0.5 * rho * Cd * D * Math.abs(rel) * rel;
}

// ---------------------------------------------------------------------------
// Integration nodes: each node carries z, a drag weight (∫ D dz share) and an
// inertia weight (∫ A dz share), so cylinders, the 3-slice sphere and the exact
// sphere all use one loop.
// ---------------------------------------------------------------------------

function cylinderNodes(R, zBot, zTop, numerics) {
  if (!(zTop > zBot)) return [];
  const { pos, wt } = compositeNodes(zBot, zTop, numerics.panels, numerics.order);
  const nodes = new Array(pos.length);
  for (let i = 0; i < pos.length; i++) {
    nodes[i] = { z: pos[i], wD: wt[i] * 2 * R, wA: wt[i] * Math.PI * R * R };
  }
  return nodes;
}

/** Exact sphere section on [zBot, zTop] via z = zc - R cos(phi): smooth integrands. */
function sphereExactNodes(body, zBot, zTop, numerics) {
  const R = body.radius;
  const zc = sphereCenterZ(body);
  const lo = Math.max(zBot, zc - R), hi = Math.min(zTop, zc + R);
  if (!(hi > lo)) return [];
  const phi = (z) => Math.acos(Math.max(-1, Math.min(1, (zc - z) / R)));
  const { pos, wt } = compositeNodes(phi(lo), phi(hi), numerics.panels, numerics.order);
  const nodes = new Array(pos.length);
  for (let i = 0; i < pos.length; i++) {
    const s = Math.sin(pos[i]);
    const r = R * s;
    const dzdphi = R * s;
    nodes[i] = { z: zc - R * Math.cos(pos[i]), wD: wt[i] * 2 * r * dzdphi, wA: wt[i] * Math.PI * r * r * dzdphi };
  }
  return nodes;
}

/** Nodes for one body over its wetted length up to `zTop` (SWL or instantaneous surface). */
function bodyNodes(body, env, zTop, numerics) {
  const zBot = -body.draft;
  const top = Math.min(zTop, bodyTopZ(body));
  if (!(top > zBot)) return [];
  if (body.type === 'cylinder') return cylinderNodes(body.diameter / 2, zBot, top, numerics);
  if (env.sphereModel === 'exact') return sphereExactNodes(body, zBot, top, numerics);
  // thesis 3-slice equivalent below SWL; any wetted part above SWL uses the exact section
  const nodes = [];
  for (const s of sphereSlices3(body)) {
    const hi = Math.min(s.zTop, top);
    if (hi > s.zBot) nodes.push(...cylinderNodes(s.r, s.zBot, hi, { panels: 1, order: numerics.order }));
  }
  if (top > 0) nodes.push(...sphereExactNodes(body, 0, top, numerics));
  return nodes;
}

// ---------------------------------------------------------------------------
// Wind: steady drag on the exposed part of each body, V(z) = Vr (z/zr)^beta.
// ---------------------------------------------------------------------------

export function windForce(body, env) {
  const top = bodyTopZ(body);
  if (!(top > 0) || env.V_wind <= 0) return 0;
  const b = env.windBeta;
  const p = 2 * b + 1;
  const k = 0.5 * env.rho_air * env.Cd_air * env.V_wind ** 2 / env.windRef ** (2 * b);
  if (body.type === 'cylinder') {
    // exact: ∫0^f D z^(2b) dz = D f^p / p
    return (k * body.diameter * top ** p) / p;
  }
  // sphere cap above SWL: ∫0^top w(z) z^(2b) dz with u = z^p (removes the z=0 singularity)
  const R = body.radius, zc = sphereCenterZ(body);
  const { pos, wt } = compositeNodes(0, top ** p, 32, 8);
  let s = 0;
  for (let i = 0; i < pos.length; i++) {
    const z = Math.pow(pos[i], 1 / p);
    const dz = z - zc;
    s += wt[i] * 2 * Math.sqrt(Math.max(R * R - dz * dz, 0));
  }
  return (k * s) / p;
}

// ---------------------------------------------------------------------------
// Platform computation
// ---------------------------------------------------------------------------

function failure(errors, warnings, infos, extra = {}) {
  return { ok: false, errors, warnings, infos, assumptions: ASSUMPTIONS, engineVersion: ENGINE_VERSION, ...extra };
}

/**
 * Compute the platform. Returns { ok, errors, warnings, infos, ... }.
 * When ok is false no force results are present.
 */
export function computePlatform(environment, bodies, numericsIn = {}) {
  const env = environment;
  const numerics = { ...DEFAULT_NUMERICS, ...numericsIn };
  const split = (list) => ({
    errors: list.filter((i) => i.severity === 'error'),
    warnings: list.filter((i) => i.severity === 'warning'),
    infos: list.filter((i) => i.severity === 'info'),
  });

  // 1. inputs and geometry
  const inputIssues = [...validateEnvironment(env), ...validateBodies(bodies, env)];
  let s = split(inputIssues);
  if (s.errors.length) return failure(s.errors, s.warnings, s.infos);

  // 2. wave
  let wp;
  try {
    wp = prepareWave(env.waveTheory, env.H, env.T, env.h);
  } catch (err) {
    return failure([{ severity: 'error', code: 'WAVE_SOLVER', message: err.message }], s.warnings, s.infos);
  }
  const waveCheck = validateWave(wp, env);
  const crest = surfaceElevation(0, wp, 0);
  const trough = surfaceElevation(0, wp, Math.PI / wp.k);
  const all = [...inputIssues, ...waveCheck.issues, ...validateBodyHydrodynamics(bodies, wp, env, crest, trough)];
  s = split(all);
  const waveInfo = { wave: wp, k: wp.k, omega: wp.omega, wavelength: wp.wavelength, breaking: waveCheck.breaking };
  if (s.errors.length) return failure(s.errors, s.warnings, s.infos, waveInfo);

  // 3. per-body preparation
  const surfaceMode = env.integrateTo === 'surface';
  const harmonics = wp.theory === 'stokes5' ? 5 : 1;
  const prepared = bodies.map((b) => {
    const R = bodyRadius(b);
    const mf = env.useMacCamy && b.type === 'cylinder' ? macCamyFuchsFilter(wp.k, R, harmonics) : null;
    const staticNodes = surfaceMode ? null : bodyNodes(b, env, 0, numerics);
    return { body: b, R, mf, staticNodes, wind: windForce(b, env) };
  });

  const forceOnBody = (pb, t) => {
    const b = pb.body;
    let nodes = pb.staticNodes;
    let eta = 0;
    if (surfaceMode) {
      eta = surfaceElevation(t, wp, b.x);
      nodes = bodyNodes(b, env, eta, numerics);
    }
    let drag = 0, inertia = 0;
    for (let i = 0; i < nodes.length; i++) {
      const nd = nodes[i];
      const zk = surfaceMode && wp.theory === 'airy' ? wheelerZ(nd.z, eta, env.h) : nd.z;
      const kin = kinematics(zk, t, wp, b.x);
      const V = kin.u + currentVelocity(nd.z, env);
      const acc = pb.mf ? accelerationFiltered(zk, t, wp, b.x, pb.mf) : kin.dudt;
      drag += 0.5 * env.rho * env.Cd * nd.wD * Math.abs(V) * V;
      inertia += env.rho * env.Cm * nd.wA * acc;
    }
    return { drag, inertia };
  };

  const globalAt = (t) => {
    let drag = 0, inertia = 0, wind = 0;
    for (const pb of prepared) {
      const f = forceOnBody(pb, t);
      drag += f.drag; inertia += f.inertia; wind += pb.wind;
    }
    return { drag, inertia, wind, total: drag + inertia + wind };
  };

  // 4. sampled histories
  const N = numerics.timeSamples;
  const dt = env.T / (N - 1);
  const perBody = prepared.map(() => []);
  const global = [];
  for (let i = 0; i < N; i++) {
    const t = i * dt;
    let gd = 0, gi = 0, gw = 0;
    prepared.forEach((pb, j) => {
      const f = forceOnBody(pb, t);
      const wave = f.drag + f.inertia;
      perBody[j].push({ t, drag: f.drag, inertia: f.inertia, wave, wind: pb.wind, total: wave + pb.wind });
      gd += f.drag; gi += f.inertia; gw += pb.wind;
    });
    global.push({ t, drag: gd, inertia: gi, wave: gd + gi, wind: gw, total: gd + gi + gw });
  }

  // 5. peaks refined on the continuous function, RMS over one period
  const refinedPeak = (series, key, fn) => {
    const n = series.length;
    let iMax = 0;
    for (let i = 1; i < n; i++) if (Math.abs(series[i][key]) > Math.abs(series[iMax][key])) iMax = i;
    // periodic history: a maximum at either end may lie just inside the other end
    const brackets = iMax === 0 || iMax === n - 1
      ? [[series[0].t, series[1].t], [series[n - 2].t, series[n - 1].t]]
      : [[series[iMax - 1].t, series[iMax + 1].t]];
    let best = Math.abs(series[iMax][key]);
    for (const [lo, hi] of brackets) {
      best = Math.max(best, goldenMax((t) => Math.abs(fn(t)), lo, hi, 1e-12).value);
    }
    return best;
  };
  const rms = (series) => {
    let sq = 0;
    for (let i = 0; i < series.length - 1; i++) sq += series[i].total ** 2; // periodic: drop duplicate endpoint
    return Math.sqrt(sq / (series.length - 1));
  };

  const windTotal = prepared.reduce((a, pb) => a + pb.wind, 0);
  const globalResult = {
    timeData: global,
    peakTotal: refinedPeak(global, 'total', (t) => globalAt(t).total),
    peakWave: refinedPeak(global, 'wave', (t) => { const f = globalAt(t); return f.drag + f.inertia; }),
    peakDrag: refinedPeak(global, 'drag', (t) => globalAt(t).drag),
    peakInertia: refinedPeak(global, 'inertia', (t) => globalAt(t).inertia),
    peakWind: windTotal,
    rms: rms(global),
  };

  const bodyResults = prepared.map((pb, j) => {
    const b = pb.body;
    const series = perBody[j];
    const totalAt = (t) => { const f = forceOnBody(pb, t); return f.drag + f.inertia + pb.wind; };
    // wave-only orbital velocity amplitude at mid-draft (for KC, Re)
    const zMid = -b.draft / 2;
    let uMax = 0, aMax = 0;
    for (let i = 0; i < 120; i++) {
      const k = kinematics(zMid, (i / 120) * env.T, wp, b.x);
      uMax = Math.max(uMax, Math.abs(k.u)); aMax = Math.max(aMax, Math.abs(k.dudt));
    }
    const D = 2 * pb.R;
    return {
      id: b.id, type: b.type, x: b.x, y: b.y,
      timeData: series,
      peakTotal: refinedPeak(series, 'total', totalAt),
      peakDrag: Math.max(...series.map((p) => Math.abs(p.drag))),
      peakInertia: Math.max(...series.map((p) => Math.abs(p.inertia))),
      rms: rms(series),
      windForce: pb.wind,
      ka: wp.k * pb.R,
      Dlambda: D / wp.wavelength,
      mfApplied: Boolean(pb.mf),
      mfInertiaRatio: pb.mf ? pb.mf[0].gain : 1,
      KC: (uMax * env.T) / D,
      Re: (uMax * D) / env.nu,
      U_m: uMax,
      A_m: aMax,
      submergedVolume: submergedVolume(b),
    };
  });

  const sumOfPeaks = bodyResults.reduce((a, b) => a + b.peakTotal, 0);
  const heave = heaveScreening(bodies, env, env.T);
  if (heave.potentialResonance) {
    s.warnings.push({
      severity: 'warning', code: 'HEAVE_RESONANCE_SCREEN',
      message: `Potential heave resonance (screening): T = ${env.T.toFixed(2)} s lies within ` +
        `[${heave.bandLow.toFixed(2)}, ${heave.bandHigh.toFixed(2)}] s around the estimated heave period ` +
        `(T₃ ≈ ${heave.Tn3.toFixed(2)} s). This is not a motion analysis — a frequency-domain RAO study is required.`,
    });
  }

  return {
    ok: true,
    errors: [],
    warnings: s.warnings,
    infos: s.infos,
    ...waveInfo,
    stokesConverged: wp.converged,
    crest, trough,
    global: globalResult,
    bodies: bodyResults,
    arrayFactor: sumOfPeaks > 0 ? globalResult.peakTotal / sumOfPeaks : 1,
    heave,
    numerics,
    assumptions: ASSUMPTIONS,
    engineVersion: ENGINE_VERSION,
  };
}

export { g };
