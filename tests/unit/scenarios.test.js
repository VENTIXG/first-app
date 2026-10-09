import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { AppState, DEFAULT_ENVIRONMENT } from '../../js/state.js';

// Minimal in-memory localStorage for scenarios.js.
function installStorage({ failWrites = false } = {}) {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => {
      if (failWrites) throw new Error('QuotaExceededError');
      store.set(k, String(v));
    },
    removeItem: (k) => store.delete(k),
  };
  return store;
}

const scenarios = await import('../../js/scenarios.js');

beforeEach(() => installStorage());

test('serialize -> replace round-trip preserves environment and bodies', () => {
  const a = new AppState();
  a.setEnv('H', 5.5);
  a.addBody({ type: 'sphere', radius: 4, draft: 4, x: 90, y: 10 });
  const snap = JSON.parse(JSON.stringify(a.serialize()));
  const b = new AppState();
  b.replace(snap);
  assert.equal(b.getEnv('H'), 5.5);
  const strip = (bs) => bs.map(({ id, ...rest }) => rest);
  assert.deepEqual(strip(b.bodies), strip(a.bodies));
});

test('unknown environment keys in a snapshot are ignored', () => {
  const s = new AppState();
  s.replace({ environment: { ...DEFAULT_ENVIRONMENT, evil: '<script>' }, bodies: s.bodies });
  assert.equal(s.environment.evil, undefined);
});

test('save / list / load / delete round-trip through storage', () => {
  const st = new AppState();
  scenarios.saveScenario('case A', st.serialize());
  scenarios.saveScenario('case B', st.serialize());
  assert.deepEqual(scenarios.listScenarios(), ['case A', 'case B']);
  assert.deepEqual(scenarios.loadScenario('case A').environment, st.environment);
  scenarios.deleteScenario('case A');
  assert.deepEqual(scenarios.listScenarios(), ['case B']);
});

test('malicious or malformed body fields in a snapshot are rejected, state unchanged', { todo: 'A-02' }, () => {
  const s = new AppState();
  const before = JSON.stringify(s.serialize());
  for (const bad of [
    { type: '<img src=x onerror=alert(1)>', x: 0, y: 0, diameter: 6, radius: 5, draft: 20 },
    { type: 'cylinder', x: 'NaN', y: 0, diameter: 6, radius: 5, draft: 20 },
    { type: 'cylinder', x: 0, y: 0, diameter: -6, radius: 5, draft: 20 },
  ]) {
    assert.throws(() => s.replace({ environment: s.environment, bodies: [bad] }));
    assert.equal(JSON.stringify(s.serialize()), before);
  }
});

test('a failed storage write is reported to the caller, not swallowed', { todo: 'A-03' }, () => {
  installStorage({ failWrites: true });
  assert.throws(() => scenarios.saveScenario('x', new AppState().serialize()));
});
