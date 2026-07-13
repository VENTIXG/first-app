// Scenario persistence: named snapshots of the input parameters in
// localStorage, so users can save and reload complete configurations.

const STORAGE_KEY = 'wfc-scenarios';

function readAll() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch {
    return {};
  }
}

function writeAll(map) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* storage unavailable (private mode, sandboxed frame) — scenarios just don't persist */
  }
}

/** Save (or overwrite) a named scenario. Returns the sorted name list. */
export function saveScenario(name, params) {
  const map = readAll();
  map[name] = { params, savedAt: new Date().toISOString() };
  writeAll(map);
  return listScenarios();
}

/** Sorted list of saved scenario names. */
export function listScenarios() {
  return Object.keys(readAll()).sort((a, b) => a.localeCompare(b));
}

/** Parameters of a saved scenario, or null. */
export function loadScenario(name) {
  return readAll()[name]?.params ?? null;
}

/** Delete a scenario. Returns the updated name list. */
export function deleteScenario(name) {
  const map = readAll();
  delete map[name];
  writeAll(map);
  return listScenarios();
}
