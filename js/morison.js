// Morison force engine: drag + inertia on a surface-piercing cylinder,
// with optional MacCamy-Fuchs diffraction correction and wind drag.

import { waveParameters, kinematics, breakingChecks, KIN_VISCOSITY } from './waveTheory.js';

const N_POINTS = 200; // samples per wave period for the time series

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
 * Current velocity at elevation z (z=0 surface, z=-h bed).
 * 'uniform' returns the surface value everywhere; the logarithmic
 * profile arrives in Phase 2.
 */
export function currentVelocity(z, params) {
  return params.U_c; // TODO Phase 2: logarithmic profile
}

/**
 * Full force computation. Returns the time series over one wave period
 * plus peak/RMS statistics and dimensionless parameters.
 */
export function computeForces(params) {
  const wp = waveParameters(params.H, params.T, params.h);
  const { omega, k, wavelength } = wp;

  // Reference kinematics at the cylinder mid-draft
  const zRef = -params.d / 2;
  const decayRef = Math.cosh(k * (zRef + params.h)) / Math.sinh(k * params.h);
  const U_m = wp.a * omega * decayRef;         // max wave particle velocity
  const A_m = wp.a * omega * omega * decayRef; // max wave particle acceleration

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

  const timeData = [];
  let peakWave = 0;
  let peakDrag = 0;
  let peakInertia = 0;
  let sumSq = 0;

  for (let i = 0; i < N_POINTS; i++) {
    const t = (i / (N_POINTS - 1)) * params.T;
    const { u, dudt } = kinematics(params.waveTheory, zRef, t, wp);
    const V = u + currentVelocity(zRef, params);

    const drag = 0.5 * params.rho * Cd * params.D * Math.abs(V) * V * params.d;
    const inertia = params.rho * Cm * area * dudt * params.d;
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
  };
}
