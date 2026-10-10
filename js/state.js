// Centralized application state for the multi-body platform solver.
//
// Shape:
//   { environment: { …wave/current/wind/coefficients/model options… },
//     bodies: [ { id, type, x, y, diameter, radius, draft, freeboard } ] }
//
// Snapshots (scenarios) are versioned: serialize() emits SCHEMA_VERSION and
// parseSnapshot() validates types/enums/structural ranges and migrates older
// versions. Physical consistency (draft vs depth, overlap, …) is NOT enforced
// here — that is validation.js's job, so an inconsistent design can still be
// loaded and fixed. UI modules subscribe to env:changed / bodies:changed /
// results:changed.

import { BODY_TYPES, bodyRadius as geometryBodyRadius } from './geometry.js';
import { ENUMS, MAX_BODIES } from './validation.js';
import { KIN_VISCOSITY_SEAWATER } from './waveTheory.js';

export const SCHEMA_VERSION = 1;

export const DEFAULT_ENVIRONMENT = Object.freeze({
  // Wave
  H: 4.0,                    // wave height [m]
  T: 9.0,                    // intrinsic wave period [s]
  h: 40.0,                   // water depth [m]
  waveTheory: 'airy',        // 'airy' | 'stokes5'
  integrateTo: 'swl',        // 'swl' | 'surface' (instantaneous free surface)
  // Current (collinear with the waves)
  U_c: 0.8,                  // surface current velocity [m/s]
  currentProfile: 'power17', // 'uniform' | 'power17' | 'log'
  // Wind (power-law profile, collinear with the waves)
  V_wind: 20.0,              // wind speed at the reference height [m/s]
  windRef: 10.0,             // reference height [m]
  windBeta: 0.113,           // power-law exponent (1-min average, project documentation)
  Cd_air: 1.0,               // aerodynamic shape coefficient (applied to all bodies)
  // Hydrodynamic coefficients (applied to every body)
  Cd: 1.0,
  Cm: 2.0,
  useMacCamy: true,          // exact MacCamy–Fuchs inertia correction for cylinders
  sphereModel: 'slices3',    // 'slices3' (thesis 3-slice equivalent) | 'exact'
  // Fluids
  rho: 1025,                 // seawater density [kg/m^3]
  rho_air: 1.225,            // air density [kg/m^3]
  nu: KIN_VISCOSITY_SEAWATER, // kinematic viscosity [m^2/s]
});

const BODY_KEYS = Object.freeze(['type', 'x', 'y', 'diameter', 'radius', 'draft', 'freeboard']);
const BODY_DEFAULTS = Object.freeze({
  type: 'cylinder', x: 0, y: 0, diameter: 6, radius: 5, draft: 20, freeboard: 15,
});

let _nextId = 1;
export function nextBodyId() {
  return _nextId++;
}

/** Create a body with defaults; unknown keys are dropped. */
export function makeBody(overrides = {}) {
  const body = { id: nextBodyId() };
  for (const key of BODY_KEYS) body[key] = key in overrides ? overrides[key] : BODY_DEFAULTS[key];
  if (Number.isInteger(overrides.id)) body.id = overrides.id;
  return body;
}

/** Characteristic radius (re-exported from geometry for existing importers). */
export const bodyRadius = geometryBodyRadius;

export class ScenarioError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ScenarioError';
  }
}

const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Type-check a stored environment against DEFAULT_ENVIRONMENT. Missing keys take
 * the default, unknown keys are ignored, a wrongly typed value throws
 * ScenarioError. Physical ranges are checked later by validation.js.
 */
export function parseEnvironment(srcEnv) {
  const src = srcEnv && typeof srcEnv === 'object' ? srcEnv : {};
  const environment = { ...DEFAULT_ENVIRONMENT };
  for (const key of Object.keys(DEFAULT_ENVIRONMENT)) {
    if (!(key in src)) continue;
    const v = src[key];
    const def = DEFAULT_ENVIRONMENT[key];
    if (key in ENUMS) {
      if (!ENUMS[key].includes(v)) throw new ScenarioError(`Invalid value for ${key}.`);
    } else if (typeof def === 'boolean') {
      if (typeof v !== 'boolean') throw new ScenarioError(`${key} must be true/false.`);
    } else if (!isFiniteNumber(v)) {
      throw new ScenarioError(`${key} must be a finite number.`);
    }
    environment[key] = v;
  }
  return environment;
}

/**
 * Validate and migrate a snapshot. Returns { environment, bodies } or throws
 * ScenarioError. Version 0 (no schemaVersion): global `h_exp` becomes each
 * cylinder's freeboard.
 */
export function parseSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') throw new ScenarioError('Scenario is not an object.');
  const version = snapshot.schemaVersion ?? 0;
  if (!Number.isInteger(version) || version < 0 || version > SCHEMA_VERSION) {
    throw new ScenarioError(`Unsupported scenario schema version ${version}.`);
  }
  const srcEnv = snapshot.environment && typeof snapshot.environment === 'object' ? snapshot.environment : {};
  const environment = parseEnvironment(srcEnv);

  const srcBodies = snapshot.bodies;
  if (!Array.isArray(srcBodies) || srcBodies.length === 0 || srcBodies.length > MAX_BODIES) {
    throw new ScenarioError(`Scenario must contain 1–${MAX_BODIES} bodies.`);
  }
  const legacyFreeboard = version === 0 && isFiniteNumber(srcEnv.h_exp) && srcEnv.h_exp >= 0 ? srcEnv.h_exp : null;
  const bodies = srcBodies.map((b, i) => {
    if (!b || typeof b !== 'object') throw new ScenarioError(`Body ${i + 1} is not an object.`);
    if (!BODY_TYPES.includes(b.type)) throw new ScenarioError(`Body ${i + 1}: unknown type.`);
    const out = {};
    for (const key of BODY_KEYS) {
      if (key === 'type') { out.type = b.type; continue; }
      let v = b[key];
      if (v === undefined) v = key === 'freeboard' && legacyFreeboard !== null ? legacyFreeboard : BODY_DEFAULTS[key];
      if (!isFiniteNumber(v)) throw new ScenarioError(`Body ${i + 1}: ${key} must be a finite number.`);
      if (['diameter', 'radius', 'draft'].includes(key) && !(v > 0)) {
        throw new ScenarioError(`Body ${i + 1}: ${key} must be > 0.`);
      }
      if (key === 'freeboard' && v < 0) throw new ScenarioError(`Body ${i + 1}: freeboard must be ≥ 0.`);
      out[key] = v;
    }
    return out;
  });
  return { environment, bodies };
}

const DEFAULT_BODIES = () => [
  makeBody({ type: 'cylinder', x: 0, y: 0, diameter: 6, draft: 20, freeboard: 15 }),
  makeBody({ type: 'cylinder', x: 60, y: 0, diameter: 6, draft: 20, freeboard: 15 }),
];

export class AppState {
  #env;
  #bodies;
  #results = null;
  #listeners = new Map();

  constructor() {
    this.#env = { ...DEFAULT_ENVIRONMENT };
    this.#bodies = DEFAULT_BODIES();
  }

  // --- Environment ---------------------------------------------------------

  get environment() {
    return { ...this.#env };
  }

  getEnv(key) {
    return this.#env[key];
  }

  setEnv(key, value) {
    if (!(key in DEFAULT_ENVIRONMENT) || this.#env[key] === value) return;
    this.#env[key] = value;
    this.emit('env:changed', { keys: [key], environment: this.environment });
  }

  // --- Bodies --------------------------------------------------------------

  get bodies() {
    return this.#bodies.map((b) => ({ ...b }));
  }

  getBody(id) {
    const b = this.#bodies.find((x) => x.id === id);
    return b ? { ...b } : null;
  }

  addBody(partial = {}) {
    const body = makeBody(partial);
    this.#bodies.push(body);
    this.emit('bodies:changed', { reason: 'add', id: body.id, bodies: this.bodies });
    return body.id;
  }

  removeBody(id) {
    const i = this.#bodies.findIndex((b) => b.id === id);
    if (i === -1) return;
    this.#bodies.splice(i, 1);
    this.emit('bodies:changed', { reason: 'remove', id, bodies: this.bodies });
  }

  /** Update one field of a body. `structural` (type change) triggers a UI rebuild. */
  updateBody(id, key, value, structural = false) {
    const b = this.#bodies.find((x) => x.id === id);
    if (!b || !BODY_KEYS.includes(key) || b[key] === value) return;
    if (key === 'type' && !BODY_TYPES.includes(value)) return;
    b[key] = value;
    this.emit('bodies:changed', {
      reason: structural ? 'type' : 'update', id, key, bodies: this.bodies,
    });
  }

  // --- Serialization (scenarios) ------------------------------------------

  serialize() {
    return {
      schemaVersion: SCHEMA_VERSION,
      environment: this.environment,
      bodies: this.bodies.map(({ id, ...rest }) => rest),
    };
  }

  /** Replace state from a snapshot. Throws ScenarioError and leaves state untouched if invalid. */
  replace(snapshot) {
    const { environment, bodies } = parseSnapshot(snapshot);
    this.#env = environment;
    this.#bodies = bodies.map((b) => makeBody(b));
    this.emit('env:changed', { keys: Object.keys(DEFAULT_ENVIRONMENT), environment: this.environment });
    this.emit('bodies:changed', { reason: 'replace', bodies: this.bodies });
  }

  // --- Results -------------------------------------------------------------

  get results() {
    return this.#results;
  }

  setResults(results) {
    this.#results = results;
    this.emit('results:changed', results);
  }

  // --- Pub/sub -------------------------------------------------------------

  on(event, callback) {
    if (!this.#listeners.has(event)) this.#listeners.set(event, new Set());
    this.#listeners.get(event).add(callback);
    return () => this.#listeners.get(event)?.delete(callback);
  }

  emit(event, payload) {
    this.#listeners.get(event)?.forEach((cb) => cb(payload));
  }
}
