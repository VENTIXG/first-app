// Input, geometry and model-applicability validation.
//
// severity 'error'   : physically impossible or numerically unsound — the engine
//                      returns no results (ok = false).
// severity 'warning' : results are produced but accuracy/validity is degraded;
//                      shown beside the results and in exports.
// severity 'info'    : method notes (which approximation is in use).
//
// Thresholds that are engineering heuristics (not physical laws) say so in their
// message and in docs/ENGINEERING_AUDIT.md.

import { BODY_TYPES, bodyRadius, bodyTopZ, planRadius } from './geometry.js';
import { breakingChecks } from './waveTheory.js';

export const MAX_BODIES = 50;
export const ENUMS = Object.freeze({
  waveTheory: ['airy', 'stokes5'],
  currentProfile: ['uniform', 'power17', 'log'],
  integrateTo: ['swl', 'surface'],
  sphereModel: ['slices3', 'exact'],
});

const URSELL_AIRY_WARN = 26;   // heuristic
const URSELL_STOKES_MAX = 40;  // Hedges (1995)

export function issue(severity, code, message, extra = {}) {
  return { severity, code, message, ...extra };
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export function validateEnvironment(env) {
  const out = [];
  const need = (key, label, { min = 0, strict = true } = {}) => {
    const v = env[key];
    if (!isNum(v) || (strict ? !(v > min) : !(v >= min))) {
      out.push(issue('error', 'INVALID_INPUT',
        `${label} must be a finite number ${strict ? '>' : '≥'} ${min} (got ${v}).`, { field: key }));
      return false;
    }
    return true;
  };
  need('H', 'Wave height H');
  need('T', 'Wave period T');
  need('h', 'Water depth h');
  need('rho', 'Water density ρ');
  need('rho_air', 'Air density');
  need('nu', 'Kinematic viscosity ν');
  need('windRef', 'Wind reference height');
  need('U_c', 'Surface current', { strict: false });
  need('V_wind', 'Wind speed', { strict: false });
  need('Cd', 'Drag coefficient C_d', { strict: false });
  need('Cm', 'Inertia coefficient C_m', { strict: false });
  need('Cd_air', 'Wind shape coefficient', { strict: false });
  if (!isNum(env.windBeta) || env.windBeta <= 0 || env.windBeta >= 1) {
    out.push(issue('error', 'INVALID_INPUT', `Wind profile exponent β must be in (0, 1) (got ${env.windBeta}).`, { field: 'windBeta' }));
  }
  for (const [key, allowed] of Object.entries(ENUMS)) {
    if (!allowed.includes(env[key])) {
      out.push(issue('error', 'INVALID_INPUT', `Unknown ${key} "${env[key]}".`, { field: key }));
    }
  }
  if (typeof env.useMacCamy !== 'boolean') {
    out.push(issue('error', 'INVALID_INPUT', 'MacCamy–Fuchs switch must be true/false.', { field: 'useMacCamy' }));
  }
  if (isNum(env.Cm) && env.Cm < 1) {
    out.push(issue('warning', 'CM_BELOW_ONE',
      `C_m = ${env.Cm} < 1 implies negative added mass (C_m = 1 + C_a); check the coefficient.`, { field: 'Cm' }));
  }
  if (isNum(env.rho) && (env.rho < 990 || env.rho > 1050)) {
    out.push(issue('warning', 'DENSITY_RANGE', `Water density ${env.rho} kg/m³ is outside 990–1050.`, { field: 'rho' }));
  }
  return out;
}

export function validateBodies(bodies, env) {
  const out = [];
  if (!Array.isArray(bodies) || bodies.length === 0) {
    return [issue('error', 'NO_BODIES', 'The platform has no bodies.')];
  }
  if (bodies.length > MAX_BODIES) {
    out.push(issue('error', 'TOO_MANY_BODIES', `At most ${MAX_BODIES} bodies are supported (got ${bodies.length}).`));
  }
  const label = (i) => `Body ${i + 1}`;
  bodies.forEach((b, i) => {
    const bodyId = b.id;
    if (!BODY_TYPES.includes(b.type)) {
      out.push(issue('error', 'INVALID_INPUT', `${label(i)}: unknown type.`, { bodyId }));
      return;
    }
    const dims = b.type === 'sphere'
      ? [['radius', 'radius'], ['draft', 'draft']]
      : [['diameter', 'diameter'], ['draft', 'draft']];
    let dimsOk = true;
    for (const [key, name] of dims) {
      if (!isNum(b[key]) || b[key] <= 0) {
        out.push(issue('error', 'INVALID_INPUT', `${label(i)}: ${name} must be a finite number > 0 (got ${b[key]}).`, { bodyId, field: key }));
        dimsOk = false;
      }
    }
    for (const key of ['x', 'y']) {
      if (!isNum(b[key])) {
        out.push(issue('error', 'INVALID_INPUT', `${label(i)}: ${key} must be a finite number (got ${b[key]}).`, { bodyId, field: key }));
        dimsOk = false;
      }
    }
    if (b.type === 'cylinder' && (!isNum(b.freeboard) || b.freeboard < 0)) {
      out.push(issue('error', 'INVALID_INPUT', `${label(i)}: freeboard must be a finite number ≥ 0 (got ${b.freeboard}).`, { bodyId, field: 'freeboard' }));
      dimsOk = false;
    }
    if (!dimsOk) return;

    if (isNum(env.h) && b.draft > env.h * (1 + 1e-12)) {
      out.push(issue('error', 'DRAFT_EXCEEDS_DEPTH',
        `${label(i)}: draft ${b.draft} m exceeds the water depth ${env.h} m (the body would penetrate the seabed).`, { bodyId, field: 'draft' }));
    } else if (isNum(env.h) && Math.abs(b.draft - env.h) <= 1e-9 * env.h) {
      out.push(issue('info', 'BOTTOM_MOUNTED', `${label(i)}: draft equals depth — treated as bottom-mounted.`, { bodyId }));
    }
    if (b.type === 'sphere') {
      const R = b.radius;
      if (b.draft > 2 * R * (1 + 1e-12)) {
        out.push(issue('error', 'SPHERE_DRAFT_EXCEEDS_DIAMETER',
          `${label(i)}: sphere draft ${b.draft} m exceeds its diameter ${2 * R} m. Fully submerged spheres are not supported by this floating-body model.`, { bodyId, field: 'draft' }));
      } else if (Math.abs(b.draft - 2 * R) <= 1e-9 * R) {
        out.push(issue('warning', 'SPHERE_AWASH', `${label(i)}: sphere top is exactly at the still-water level (no waterplane area).`, { bodyId }));
      }
      if (env.sphereModel === 'slices3' && Math.abs(b.draft - R) > 1e-6 * R) {
        out.push(issue('warning', 'SPHERE_3SLICE_GEOMETRY',
          `${label(i)}: the thesis 3-slice equivalent is defined for draft = R (${R} m); at draft ${b.draft} m its slice radii no longer match the sphere. Use the exact-section sphere model.`, { bodyId }));
      }
    }
  });

  // pairwise plan-view overlap and close spacing
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i], c = bodies[j];
      if (![a.x, a.y, c.x, c.y].every(isNum) || !BODY_TYPES.includes(a.type) || !BODY_TYPES.includes(c.type)) continue;
      const s = Math.hypot(a.x - c.x, a.y - c.y);
      const ra = planRadius(a), rc = planRadius(c);
      if (!(isNum(ra) && isNum(rc))) continue;
      if (s < ra + rc) {
        out.push(issue('error', 'BODIES_OVERLAP',
          `Bodies ${i + 1} and ${j + 1} overlap in plan (centre distance ${s.toFixed(2)} m < ${(ra + rc).toFixed(2)} m).`, { bodyIds: [a.id, c.id] }));
      } else if (s < 3 * Math.max(2 * ra, 2 * rc)) {
        out.push(issue('warning', 'CLOSE_SPACING',
          `Bodies ${i + 1} and ${j + 1}: spacing ${s.toFixed(1)} m is under 3 diameters (heuristic); hydrodynamic interaction (blockage, shielding), which this method neglects, may be significant.`,
          { bodyIds: [a.id, c.id] }));
      }
    }
  }
  return out;
}

/** Wave-theory applicability; wp from prepareWave. */
export function validateWave(wp, env) {
  const out = [];
  if (wp.theory === 'stokes5' && !wp.converged) {
    out.push(issue('error', 'STOKES_NOT_CONVERGED',
      `Stokes 5th-order solution did not converge (${wp.failure}). No results are shown; reduce H or use deeper water.`));
  }
  const b = breakingChecks(wp);
  if (b.depthLimited) {
    out.push(issue('error', 'WAVE_BREAKING_DEPTH',
      `Wave breaking limit exceeded: H/h = ${b.depthRatio.toFixed(3)} > 0.78 (depth-limited). Such a wave cannot exist at this depth.`));
  }
  if (b.steepLimited) {
    out.push(issue('error', 'WAVE_BREAKING_STEEPNESS',
      `Wave breaking limit exceeded: H/λ = ${b.steepness.toFixed(4)} > ${b.steepLimit.toFixed(4)} (steepness limit, min(0.14, Miche 0.142·tanh kh)).`));
  }
  if (wp.theory === 'stokes5' && wp.ursell > URSELL_STOKES_MAX) {
    out.push(issue('error', 'STOKES_URSELL_LIMIT',
      `Outside the validity range of Stokes theory: Ursell number U_R = Hλ²/h³ = ${wp.ursell.toFixed(1)} > ${URSELL_STOKES_MAX} (Hedges 1995). Use cnoidal or stream-function theory (not available here).`));
  }
  if (wp.theory === 'airy' && wp.ursell > URSELL_AIRY_WARN) {
    out.push(issue('warning', 'AIRY_URSELL',
      `Ursell number U_R = ${wp.ursell.toFixed(1)} > ${URSELL_AIRY_WARN} (heuristic): shallow-water nonlinearity is significant and linear theory is inaccurate.`));
  }
  if (wp.theory === 'stokes5' && env.integrateTo === 'swl') {
    out.push(issue('warning', 'STOKES_TRUNCATED_AT_SWL',
      'Stokes 5th kinematics are integrated only up to the still-water level, discarding the crest contribution. Select "instantaneous free surface" for consistent nonlinear loads.'));
  }
  return { issues: out, breaking: b };
}

/** Per-body applicability given the solved wave. */
export function validateBodyHydrodynamics(bodies, wp, env, crest, trough) {
  const out = [];
  bodies.forEach((b, i) => {
    const D = 2 * bodyRadius(b);
    const ratio = D / wp.wavelength;
    const bodyId = b.id;
    if (ratio > 0.2) {
      let detail;
      if (b.type === 'sphere') {
        detail = 'no diffraction correction exists for spheres in this tool — a 3-D radiation/diffraction (BEM) analysis is required';
      } else if (env.useMacCamy) {
        detail = Math.abs(b.draft - env.h) <= 1e-9 * env.h
          ? 'inertia corrected with MacCamy–Fuchs (exact linear theory for this bottom-mounted cylinder); drag still from Morison'
          : 'inertia corrected with MacCamy–Fuchs applied strip-wise — an approximation for a truncated cylinder (end effects neglected)';
      } else {
        detail = 'enable the MacCamy–Fuchs correction or use a BEM analysis';
      }
      out.push(issue('warning', 'MORISON_DIFFRACTION_REGIME',
        `Body ${i + 1}: D/λ = ${ratio.toFixed(3)} > 0.2 (diffraction regime) — ${detail}.`, { bodyId }));
    }
    if (env.integrateTo === 'surface') {
      const top = bodyTopZ(b);
      if (crest > top) {
        out.push(issue('warning', 'GREEN_WATER',
          `Body ${i + 1}: wave crest (${crest.toFixed(2)} m) exceeds the body top (${top.toFixed(2)} m); load above the top and slamming are not modelled.`, { bodyId }));
      }
      if (trough < -b.draft) {
        out.push(issue('warning', 'BOTTOM_EMERGENCE',
          `Body ${i + 1}: wave trough (${trough.toFixed(2)} m) falls below the body bottom; the body is momentarily out of the water.`, { bodyId }));
      }
    }
  });
  if (env.useMacCamy && wp.theory === 'stokes5' && bodies.some((b) => b.type === 'cylinder')) {
    out.push(issue('info', 'MF_PER_HARMONIC',
      'MacCamy–Fuchs is applied per Stokes harmonic (ka → n·ka) — an approximation: second-order diffraction effects are neglected.'));
  }
  return out;
}
