// Morison force engine: drag + inertia on a surface-piercing cylinder,
// strip-integrated over the draft, with a depth-varying current profile,
// optional MacCamy-Fuchs diffraction correction, and wind drag.

import { prepareWave, kinematics, breakingChecks, KIN_VISCOSITY } from './waveTheory.js';

const N_POINTS = 200; // samples per wave period for the time series
const N_STRIPS = 24;  // vertical strips over the draft for force integration
const Z0 = 0.05;      // seabed roughness length for the log profile [m]

/**
 * Empirical MacCamy-Fuchs diffraction correction (legacy formulation).
 * Reduces effective force coefficients as ka = k*D/2 grows toward the
 * diffraction regime.
 */
export function macCamyFuchsCorrection(ka) {
  const ka2 = ka * ka;
  let cmFactor;
  if (ka < 0.5) {
    cmFactor = 1.0 - 0.35 * ka2;
  } else if (ka < 3) {
    cmFactor = 1.0 - 0.12 * ka - 0.18 * ka2;
  } else {
    cmFactor = 1.0 - 0.05 * ka;
  }
  cmFactor = Math.max(0.7, Math.min(1.1, cmFactor));
  const cdFactor = 1.0 + 0.1 * Math.sin(ka / 2);
  return 0.7 * cmFactor + 0.3 * cdFactor;
}

/**
 * Current velocity at elevation z (z = 0 surface, z = -h bed).
 *  - 'uniform': surface value everywhere
 *  - 'log':     u(z) = U_c * ln((z+h)/z0) / ln(h/z0), zero near the bed
 */
export function currentVelocity(z, params) {
  if (params.currentProfile === 'log') {
    const heightAboveBed = Math.max(z + params.h, Z0);
    return (params.U_c * Math.log(heightAboveBed / Z0)) / Math.log(params.h / Z0);
  }
  return params.U_c;
}

/**
 * Full force computation. Returns the time series over one wave period
 * plus peak/RMS statistics and dimensionless parameters.
 */
export function computeForces(params) {
  const wp = prepareWave(params.waveTheory, params.H, params.T, params.h);
  const { omega, k, wavelength } = wp;

  // Reference kinematics at mid-draft: max over one period (theory-agnostic)
  const zRef = -params.d / 2;
  let U_m = 0;
  let A_m = 0;
  for (let i = 0; i < 60; i++) {
    const { u, dudt } = kinematics(zRef, (i / 60) * params.T, wp);
    U_m = Math.max(U_m, Math.abs(u));
    A_m = Math.max(A_m, Math.abs(dudt));
  }

  // Dimensionless parameters
  const KC = (U_m * params.T) / params.D;
  const ka = (k * params.D) / 2;
  const Re = (U_m * params.D) / KIN_VISCOSITY;

  // MacCamy-Fuchs correction
  let correctionFactor = 1.0;
  if (params.useMacCamy && ka < 5) correctionFactor = macCamyFuchsCorrection(ka);
  const Cd = params.Cd * correctionFactor;
  const Cm = params.Cm * correctionFactor;

  const area = (Math.PI * params.D * params.D) / 4;

  // Wind drag on the exposed portion (steady over the wave period)
  const F_air =
    0.5 * params.rho_air * params.Cd_air * params.D * params.h_exp * params.V_wind ** 2;

  // Strip elevations (strip centers) and their current velocities
  const dz = params.d / N_STRIPS;
  const strips = [];
  for (let j = 0; j < N_STRIPS; j++) {
    const z = -params.d + (j + 0.5) * dz;
    strips.push({ z, uc: currentVelocity(z, params) });
  }

  const timeData = [];
  let peakWave = 0;
  let peakDrag = 0;
  let peakInertia = 0;
  let sumSq = 0;

  for (let i = 0; i < N_POINTS; i++) {
    const t = (i / (N_POINTS - 1)) * params.T;

    let drag = 0;
    let inertia = 0;
    for (const strip of strips) {
      const { u, dudt } = kinematics(strip.z, t, wp);
      const V = u + strip.uc;
      drag += 0.5 * params.rho * Cd * params.D * Math.abs(V) * V * dz;
      inertia += params.rho * Cm * area * dudt * dz;
    }

    const wave = drag + inertia;
    const total = wave + F_air;
    timeData.push({ t, drag, inertia, wave, air: F_air, total });

    peakWave = Math.max(peakWave, Math.abs(wave));
    peakDrag = Math.max(peakDrag, Math.abs(drag));
    peakInertia = Math.max(peakInertia, Math.abs(inertia));
    sumSq += total * total;
  }

  return {
    timeData,
    wave: wp,
    k,
    wavelength,
    KC,
    ka,
    Re,
    U_m,
    A_m,
    correctionFactor,
    peakWaveForce: peakWave,
    peakDragForce: peakDrag,
    peakInertiaForce: peakInertia,
    peakAirForce: F_air,
    totalPeakForce: peakWave + F_air,
    rmsForce: Math.sqrt(sumSq / N_POINTS),
    breaking: breakingChecks(wp),
    stokesConverged: wp.converged,
  };
}
