// Scenario persistence: named, versioned snapshots of the inputs in
// localStorage. Writes that fail (quota, private mode, sandboxed frames) throw,
// so the UI can tell the user the scenario was NOT saved.

const STORAGE_KEY = 'wfc-scenarios';
const MAX_NAME_LENGTH = 80;

export class StorageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'StorageError';
  }
}

function readAll() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(map) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch (err) {
    throw new StorageError(`Scenario could not be saved: browser storage is unavailable or full (${err.message}).`);
  }
}

/** Normalise a user-typed scenario name (trimmed, length-limited). */
export function normalizeName(name) {
  return String(name ?? '').trim().slice(0, MAX_NAME_LENGTH);
}

/** Save (or overwrite) a named scenario. Returns the sorted name list. Throws StorageError on failure. */
export function saveScenario(name, snapshot) {
  const key = normalizeName(name);
  if (!key) throw new StorageError('Scenario name is empty.');
  const map = readAll();
  map[key] = { snapshot, savedAt: new Date().toISOString() };
  writeAll(map);
  return listScenarios();
}

/** Sorted list of saved scenario names. */
export function listScenarios() {
  return Object.keys(readAll()).sort((a, b) => a.localeCompare(b));
}

/** Stored snapshot of a scenario (legacy entries stored it as `params`), or null. */
export function loadScenario(name) {
  const entry = readAll()[name];
  if (!entry || typeof entry !== 'object') return null;
  return entry.snapshot ?? entry.params ?? null;
}

/** Delete a scenario. Returns the updated name list. Throws StorageError on failure. */
export function deleteScenario(name) {
  const map = readAll();
  delete map[name];
  writeAll(map);
  return listScenarios();
}
