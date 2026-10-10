// Runs computePlatform off the main thread so the interface stays responsive
// for large platforms and instantaneous-surface integration. Requests carry an
// id; main.js applies only the reply to its latest request.

import { computePlatform } from './morison.js';

self.onmessage = (e) => {
  const { id, environment, bodies } = e.data;
  try {
    self.postMessage({ id, results: computePlatform(environment, bodies) });
  } catch (err) {
    self.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
