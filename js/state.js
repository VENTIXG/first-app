// Centralized application state with a minimal pub/sub observer pattern.
// All inputs live in `params`; derived data lives in `results`.
// UI modules subscribe to change events instead of polling the DOM.

export const DEFAULTS = Object.freeze({
  // Wave
  H: 2.0,          // wave height [m]
  T: 8.0,          // wave period [s]
  h: 20.0,         // water depth [m]
  U_c: 0.5,        // surface current velocity [m/s]
  waveTheory: 'airy',        // 'airy' | 'stokes5'
  currentProfile: 'uniform', // 'uniform' | 'log'
  // Cylinder
  D: 2.0,          // diameter [m]
  d: 3.0,          // draft (submerged length) [m]
  L: 10.0,         // total length [m]
  // Hydrodynamic coefficients
  Cd: 1.0,
  Cm: 2.0,
  useMacCamy: true,
  rho: 1025,       // seawater density [kg/m^3]
  // Air
  V_wind: 5.0,     // wind speed [m/s]
  Cd_air: 1.2,
  h_exp: 7.0,      // exposed height above waterline [m]
  rho_air: 1.225,
});

export class AppState {
  #params;
  #results = null;
  #listeners = new Map(); // event name -> Set<callback>

  constructor(initial = {}) {
    this.#params = { ...DEFAULTS, ...initial };
  }

  /** Immutable snapshot of all input parameters. */
  get params() {
    return { ...this.#params };
  }

  get results() {
    return this.#results;
  }

  get(key) {
    return this.#params[key];
  }

  set(key, value) {
    if (this.#params[key] === value) return;
    this.#params[key] = value;
    this.emit('params:changed', { keys: [key], params: this.params });
  }

  /** Batch update — emits a single change event. */
  setMany(patch) {
    const changed = Object.keys(patch).filter((k) => this.#params[k] !== patch[k]);
    if (changed.length === 0) return;
    Object.assign(this.#params, patch);
    this.emit('params:changed', { keys: changed, params: this.params });
  }

  /** Full replacement (scenario load). Unknown keys are ignored. */
  replace(params) {
    this.#params = { ...DEFAULTS };
    for (const k of Object.keys(params)) {
      if (k in DEFAULTS) this.#params[k] = params[k];
    }
    this.emit('params:changed', { keys: Object.keys(DEFAULTS), params: this.params });
  }

  setResults(results) {
    this.#results = results;
    this.emit('results:changed', results);
  }

  /** Subscribe to an event. Returns an unsubscribe function. */
  on(event, callback) {
    if (!this.#listeners.has(event)) this.#listeners.set(event, new Set());
    this.#listeners.get(event).add(callback);
    return () => this.#listeners.get(event)?.delete(callback);
  }

  emit(event, payload) {
    this.#listeners.get(event)?.forEach((cb) => cb(payload));
  }
}
