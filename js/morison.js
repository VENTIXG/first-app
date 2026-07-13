// Multi-body Morison platform engine.
//
// For every body the local wave force is strip-integrated over its draft using
// kinematics evaluated at the body's own (x, z) — so each body sees the wave at
// its spatial phase (k*x_i - omega*t). The Global Total Base Shear is the strict
// sum of the per-body forces at each instant, which lets wave cancellation and
// amplification across the array emerge naturally from the superposition.
//
// Spheres are discretized into the documented 3-cylinder volumetric equivalent;
// current uses a 1/7-power (or logarithmic) subsurface profile; wind uses a
// power-law vertical profile integrated over the exposed height.

import {
  prepareWave, kinematics, breakingChecks, KIN_VISCOSITY, g,
} from './waveTheory.js';
import { bodyRadius } from './state.js';

const N_POINTS = 200; // samples per wave period for the time series
const N_STRIPS = 24;  // vertical strips over a cylinder draft
const N_WIND = 12;    // vertical strips over the exposed height for wind
const Z0 = 0.05;      // seabed roughness length for the log current profile [m]

// Heave added-mass coefficient A33 = Ca * rho * V_displaced (engineering estimate)
const CA_HEAVE = { cylinder: 1.0, sphere: 0.5 };

/**
 * Empirical MacCamy-Fuchs diffraction correction. Reduces effective force
 * coefficients as ka = k*R grows toward the diffraction regime.
 */
export function macCamyFuchsCorrection(ka) {
  const ka2 = ka * ka;
  let cmFactor;
  if (ka < 0.5) cmFactor = 1.0 - 0.35 * ka2;
  else if (ka < 3) cmFactor = 1.0 - 0.12 * ka - 0.18 * ka2;
  else cmFactor = 1.0 - 0.05 * ka;
  cmFactor = Math.max(0.7, Math.min(1.1, cmFactor));
  const cdFactor = 1.0 + 0.1 * Math.sin(ka / 2);
  return 0.7 * cmFactor + 0.3 * cdFactor;
}

/**
 * Subsurface current velocity at elevation z (z = 0 surface, z = -h bed).
 *  - 'uniform':  surface value everywhere
 *  - 'power17':  u_ss(z) = U_c * [(z+h)/h]^(1/7)     (zero at the bed)
 *  - 'log':      u_ss(z) = U_c * ln((z+h)/z0)/ln(h/z0)
 */
export function currentVelocity(z, env) {
  const heightAboveBed = Math.max(z + env.h, 0);
  if (env.currentProfile === 'power17') {
    return env.U_c * Math.pow(heightAboveBed / env.h, 1 / 7);
  }
  if (env.currentProfile === 'log') {
    return (env.U_c * Math.log(Math.max(heightAboveBed, Z0) / Z0)) / Math.log(env.h / Z0);
  }
  return env.U_c;
}

/**
 * Vertical strips over a body's draft. Each strip carries its elevation z,
 * the local radius R (constant for a cylinder; the 3-slice equivalent for a
 * sphere) and its thickness dz.
 *
 * Sphere 3-cylinder volumetric equivalent (per the engineering documentation):
 *   top slice    R1 = R
 *   middle slice R2 = sqrt(R^2 - (R/3)^2)
 *   bottom slice R3 = R/3
 * The slices reproduce the hemisphere displaced volume exactly when draft = R.
 */
export function bodyStrips(body) {
  const R = bodyRadius(body);
  const strips = [];

  if (body.type === 'sphere') {
    const sliceH = body.draft / 3;
    const radii = [R, Math.sqrt(Math.max(R * R - (R / 3) ** 2, 0)), R / 3];
    const nSub = 8; // sub-strips per slice for smooth integration
    for (let s = 0; s < 3; s++) {
      const zTop = -s * sliceH;
      const dz = sliceH / nSub;
      for (let j = 0; j < nSub; j++) {
        strips.push({ z: zTop - (j + 0.5) * dz, R: radii[s], dz });
      }
    }
    return strips;
  }

  // Cylinder: uniform radius
  const dz = body.draft / N_STRIPS;
  for (let j = 0; j < N_STRIPS; j++) {
    strips.push({ z: -body.draft + (j + 0.5) * dz, R, dz });
  }
  return strips;
}

/** Displaced volume and waterplane area of a body. */
function bodyGeometry(body) {
  const R = bodyRadius(body);
  if (body.type === 'sphere') {
    // 3-slice equivalent: V = pi*(draft/3)*(R1^2+R2^2+R3^2) = 2*pi*R^2*draft/3
    const volume = (2 * Math.PI * R * R * body.draft) / 3;
    return { volume, waterplaneArea: Math.PI * R * R, R };
  }
  return { volume: Math.PI * R * R * body.draft, waterplaneArea: Math.PI * R * R, R };
}

/**
 * Steady wind drag on a body's exposed height, using the power-law profile
 * V(z) = V_ref * (z/z_ref)^beta integrated over 0..h_exp. Projected width is
 * the body's waterline diameter. Acts along +x (mean base-shear offset).
 */
function windForce(body, env) {
  if (env.h_exp <= 0 || env.V_wind <= 0) return 0;
  const width = 2 * bodyRadius(body);
  const dz = env.h_exp / N_WIND;
  let F = 0;
  for (let j = 0; j < N_WIND; j++) {
    const z = (j + 0.5) * dz;
    const Vz = env.V_wind * Math.pow(z / env.windRef, env.windBeta);
    F += 0.5 * env.rho_air * env.Cd_air * width * Vz * Vz * dz;
  }
  return F;
}

/** Precompute everything that doesn't change over the time loop for one body. */
function prepareBody(body, wp, env) {
  const strips = bodyStrips(body).map((s) => ({ ...s, uc: currentVelocity(s.z, env) }));
  const R = bodyRadius(body);
  const ka = wp.k * R;
  const corr = env.useMacCamy && ka < 5 ? macCamyFuchsCorrection(ka) : 1.0;
  return {
    id: body.id, type: body.type, x: body.x, y: body.y, draft: body.draft, R,
    strips,
    Cd: env.Cd * corr,
    Cm: env.Cm * corr,
    ka,
    wind: windForce(body, env),
    geom: bodyGeometry(body),
  };
}

/** Instantaneous wave drag + inertia on a prepared body at time t. */
function bodyWaveForce(pb, t, wp, env) {
  let drag = 0;
  let inertia = 0;
  for (const s of pb.strips) {
    const { u, dudt } = kinematics(s.z, t, wp, pb.x);
    const V = u + s.uc;
    const D = 2 * s.R;
    const area = Math.PI * s.R * s.R;
    drag += 0.5 * env.rho * pb.Cd * D * Math.abs(V) * V * s.dz;
    inertia += env.rho * pb.Cm * area * dudt * s.dz;
  }
  return { drag, inertia };
}

/** Peak |u| and |dudt| at a body's mid-draft over one period (for KC/Re). */
function bodyKinematicPeaks(pb, wp, T) {
  const zRef = -pb.draft / 2;
  let uMax = 0;
  let aMax = 0;
  for (let i = 0; i < 60; i++) {
    const { u, dudt } = kinematics(zRef, (i / 60) * T, wp, pb.x);
    uMax = Math.max(uMax, Math.abs(u));
    aMax = Math.max(aMax, Math.abs(dudt));
  }
  return { uMax, aMax };
}

/** Uncoupled heave natural period of the platform (engineering estimate). */
function heaveNaturalPeriod(prepared, env, T) {
  let mass = 0;
  let added = 0;
  let awl = 0;
  for (const pb of prepared) {
    const { volume, waterplaneArea } = pb.geom;
    mass += env.rho * volume;                          // equilibrium flotation
    added += CA_HEAVE[pb.type] * env.rho * volume;     // A33 = Ca * rho * V
    awl += waterplaneArea;
  }
  const stiffness = env.rho * g * awl;                 // hydrostatic heave stiffness
  const Tn3 = stiffness > 0 ? 2 * Math.PI * Math.sqrt((mass + added) / stiffness) : 0;
  const ratio = T > 0 && Tn3 > 0 ? Tn3 / T : 0;
  return {
    Tn3, mass, addedMass: added, waterplaneArea: awl,
    ratio, resonance: Tn3 > 0 && Math.abs(Tn3 - T) / T < 0.1,
  };
}

/**
 * Compute the whole platform. Returns the global (summed) time series plus
 * per-body series, dimensionless parameters, heave estimate and breaking state.
 */
export function computePlatform(environment, bodies) {
  const env = environment;
  const wp = prepareWave(env.waveTheory, env.H, env.T, env.h);
  const prepared = bodies.map((b) => prepareBody(b, wp, env));

  // Per-body accumulators
  const per = prepared.map((pb) => ({
    id: pb.id, type: pb.type, x: pb.x, ka: pb.ka, wind: pb.wind,
    geom: pb.geom, timeData: [],
    peakTotal: 0, peakDrag: 0, peakInertia: 0, sumSq: 0,
  }));

  // Global accumulators
  const global = { timeData: [], peakTotal: 0, peakDrag: 0, peakInertia: 0, peakWave: 0 };
  let globalSumSq = 0;
  const windTotal = prepared.reduce((a, pb) => a + pb.wind, 0);

  for (let i = 0; i < N_POINTS; i++) {
    const t = (i / (N_POINTS - 1)) * env.T;

    let gDrag = 0;
    let gInertia = 0;
    let gWind = 0;

    for (let bIdx = 0; bIdx < prepared.length; bIdx++) {
      const pb = prepared[bIdx];
      const { drag, inertia } = bodyWaveForce(pb, t, wp, env);
      const wave = drag + inertia;
      const total = wave + pb.wind;

      const rec = per[bIdx];
      rec.timeData.push({ t, drag, inertia, wave, wind: pb.wind, total });
      rec.peakTotal = Math.max(rec.peakTotal, Math.abs(total));
      rec.peakDrag = Math.max(rec.peakDrag, Math.abs(drag));
      rec.peakInertia = Math.max(rec.peakInertia, Math.abs(inertia));
      rec.sumSq += total * total;

      gDrag += drag;
      gInertia += inertia;
      gWind += pb.wind;
    }

    const gWave = gDrag + gInertia;
    const gTotal = gWave + gWind;
    global.timeData.push({ t, drag: gDrag, inertia: gInertia, wave: gWave, wind: gWind, total: gTotal });
    global.peakTotal = Math.max(global.peakTotal, Math.abs(gTotal));
    global.peakWave = Math.max(global.peakWave, Math.abs(gWave));
    global.peakDrag = Math.max(global.peakDrag, Math.abs(gDrag));
    global.peakInertia = Math.max(global.peakInertia, Math.abs(gInertia));
    globalSumSq += gTotal * gTotal;
  }

  global.rms = Math.sqrt(globalSumSq / N_POINTS);
  global.peakWind = windTotal;

  // Per-body dimensionless parameters + finalize RMS
  const bodyResults = per.map((rec, idx) => {
    const pb = prepared[idx];
    const { uMax, aMax } = bodyKinematicPeaks(pb, wp, env.T);
    const D = 2 * pb.R;
    return {
      id: rec.id, type: rec.type, x: rec.x,
      timeData: rec.timeData,
      peakTotal: rec.peakTotal,
      peakDrag: rec.peakDrag,
      peakInertia: rec.peakInertia,
      rms: Math.sqrt(rec.sumSq / N_POINTS),
      windForce: rec.wind,
      ka: rec.ka,
      KC: (uMax * env.T) / D,
      Re: (uMax * D) / KIN_VISCOSITY,
      U_m: uMax,
      A_m: aMax,
      submergedVolume: rec.geom.volume,
    };
  });

  // Superposition (array) factor: how the summed peak compares with the naive
  // in-phase sum of individual peaks. <1 => net cancellation, >1 impossible.
  const sumOfPeaks = bodyResults.reduce((a, b) => a + b.peakTotal, 0);
  const arrayFactor = sumOfPeaks > 0 ? global.peakTotal / sumOfPeaks : 1;

  return {
    wave: wp,
    k: wp.k,
    omega: wp.omega,
    wavelength: wp.wavelength,
    global,
    bodies: bodyResults,
    arrayFactor,
    heave: heaveNaturalPeriod(prepared, env, env.T),
    breaking: breakingChecks(wp),
    stokesConverged: wp.converged,
  };
}
