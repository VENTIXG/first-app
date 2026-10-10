// Heave natural-period SCREENING estimate.
//
// This is not a motion analysis. It reports the uncoupled heave natural period
//     T3 = 2 pi sqrt((M + A33) / C33),   C33 = rho g A_wp
// with each term reported separately, so that a potential resonance can be
// flagged for follow-up with a proper frequency-domain motion analysis (RAOs).
// Damping and wave excitation are NOT computed (reported as null).
//
// Assumptions (also returned with the result):
//  - mass from free-floating equilibrium M = rho * displaced volume (no mooring
//    or tendon vertical load, no user-specified mass);
//  - multi-body: bodies treated as one rigidly connected platform (heave only,
//    uncoupled from roll/pitch); hydrodynamic interaction between bodies neglected;
//  - added mass is a frequency-independent estimate:
//      cylinder: A33 ≈ (4/3) rho R^3 — one face of a circular disk
//                (disk in infinite fluid: (8/3) rho R^3; Newman 1977);
//      sphere:   A33 ≈ 0.5 rho V — exact for a floating hemisphere at infinite
//                frequency (Hulme 1982); larger (≈0.8) at low frequency.
//  - screening band: T within [0.9 T3(A33 = 0), 1.1 T3(estimate)].

import { g } from './waveTheory.js';
import { submergedVolume, waterplaneArea, bodyRadius } from './geometry.js';

export const HEAVE_ASSUMPTIONS = Object.freeze([
  'Free-floating equilibrium mass M = ρ∇ (no mooring/tendon vertical load).',
  'Bodies rigidly connected; heave uncoupled from roll and pitch.',
  'Frequency-independent added mass: cylinder (4/3)ρR³ (one-sided disk), sphere ½ρ∇.',
  'Hydrodynamic interaction between bodies neglected.',
  'No damping and no excitation model — this is not a response (RAO) calculation.',
]);

function addedMassEstimate(body, rho) {
  if (body.type === 'sphere') return 0.5 * rho * submergedVolume(body);
  return (4 / 3) * rho * bodyRadius(body) ** 3;
}

function period(mass, stiffness) {
  return stiffness > 0 ? 2 * Math.PI * Math.sqrt(mass / stiffness) : Infinity;
}

export function heaveScreening(bodies, env, waveT) {
  const rho = env.rho;
  const perBody = bodies.map((b) => {
    const volume = submergedVolume(b);
    const Awp = waterplaneArea(b);
    const mass = rho * volume;
    const addedMass = addedMassEstimate(b, rho);
    const restoringStiffness = rho * g * Awp;
    return {
      id: b.id, volume, waterplaneArea: Awp, mass, addedMass, restoringStiffness,
      Tn3: period(mass + addedMass, restoringStiffness),
      Tn3NoAddedMass: period(mass, restoringStiffness),
    };
  });
  const sum = (key) => perBody.reduce((s, p) => s + p[key], 0);
  const mass = sum('mass');
  const addedMass = sum('addedMass');
  const waterplane = sum('waterplaneArea');
  const restoringStiffness = rho * g * waterplane;
  const Tn3 = period(mass + addedMass, restoringStiffness);
  const Tn3NoAddedMass = period(mass, restoringStiffness);
  const applicable = restoringStiffness > 0;
  const bandLow = 0.9 * Tn3NoAddedMass;
  const bandHigh = 1.1 * Tn3;
  const potentialResonance = applicable && waveT >= bandLow && waveT <= bandHigh;
  return {
    status: 'screening estimate — not a motion analysis',
    applicable,
    mass, addedMass, restoringStiffness,
    waterplaneArea: waterplane,
    Tn3, Tn3NoAddedMass,
    damping: null,
    excitation: null,
    bandLow, bandHigh,
    potentialResonance,
    ratio: applicable ? Tn3 / waveT : 0,
    perBody,
    assumptions: HEAVE_ASSUMPTIONS,
  };
}
