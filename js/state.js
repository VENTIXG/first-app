// Centralized application state for the multi-body platform solver.
//
// Shape:
//   { environment: { …wave/current/wind/coefficients… },
//     platform:    { bodies: [ { id, type, x, y, diameter|radius, draft } ] } }
//
// UI modules subscribe to events (env:changed / bodies:changed / results:changed)
// instead of polling the DOM. `bodies:changed` carries a `reason` so the UI can
// tell a structural change (add/remove/type) apart from an in-place value edit.

export const DEFAULT_ENVIRONMENT = Object.freeze({
  // Wave
  H: 4.0,                    // wave height [m]
  T: 9.0,                    // wave period [s]
  h: 40.0,                   // water depth [m]
  waveTheory: 'airy',        // 'airy' | 'stokes5'
  // Current
  U_c: 0.8,                  // surface current velocity [m/s]
  currentProfile: 'power17', // 'uniform' | 'power17' | 'log'
  // Wind (power-law profile)
  V_wind: 20.0,              // reference wind speed [m/s]
  windRef: 10.0,             // reference height for the wind profile [m]
  windBeta: 0.113,           // power-law exponent (1-min average)
  Cd_air: 1.0,               // aerodynamic shape/drag coefficient
  h_exp: 15.0,               // exposed height above still water [m]
  // Hydrodynamic coefficients (applied to every body)
  Cd: 1.0,
  Cm: 2.0,
  useMacCamy: true,
  // Fluids
  rho: 1025,                 // seawater density [kg/m^3]
  rho_air: 1.225,            // air density [kg/m^3]
});

const BODY_KEYS = ['type', 'x', 'y', 'diameter', 'radius', 'draft'];

let _nextId = 1;
export function nextBodyId() {
  return _nextId++;
}

/** Create a body with sensible defaults for its type. */
export function makeBody(overrides = {}) {
  const base = {
    id: nextBodyId(),
    type: 'cylinder', // 'cylinder' | 'sphere'
    x: 0,             // in-line position along wave propagation [m]
    y: 0,             // transverse position [m]
    diameter: 6,      // cylinder diameter [m]
    radius: 5,        // sphere radius [m]
    draft: 20,        // submerged depth [m]
  };
  return { ...base, ...overrides };
}

const DEFAULT_BODIES = () => [
  makeBody({ type: 'cylinder', x: 0, y: 0, diameter: 6, draft: 20 }),
  makeBody({ type: 'cylinder', x: 60, y: 0, diameter: 6, draft: 20 }),
];

/** Characteristic radius used by the physics engine. */
export function bodyRadius(body) {
  return body.type === 'sphere' ? body.radius : body.diameter / 2;
}

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
    if (this.#env[key] === value) return;
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

  /**
   * Update one field of a body. `structural` (type change) triggers a UI
   * rebuild; a plain value edit does not.
   */
  updateBody(id, key, value, structural = false) {
    const b = this.#bodies.find((x) => x.id === id);
    if (!b || !BODY_KEYS.includes(key) || b[key] === value) return;
    b[key] = value;
    this.emit('bodies:changed', {
      reason: structural ? 'type' : 'update', id, key, bodies: this.bodies,
    });
  }

  // --- Serialization (scenarios) ------------------------------------------

  serialize() {
    return { environment: this.environment, bodies: this.bodies };
  }

  replace(snapshot) {
    if (snapshot?.environment) {
      this.#env = { ...DEFAULT_ENVIRONMENT };
      for (const k of Object.keys(DEFAULT_ENVIRONMENT)) {
        if (k in snapshot.environment) this.#env[k] = snapshot.environment[k];
      }
    }
    if (Array.isArray(snapshot?.bodies) && snapshot.bodies.length) {
      this.#bodies = snapshot.bodies.map((b) => makeBody({ ...b, id: nextBodyId() }));
    }
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
