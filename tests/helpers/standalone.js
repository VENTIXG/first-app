// Loads the pure physics functions embedded in standalone.html into an isolated
// vm context, so the offline single-file app is tested directly rather than via
// a re-implementation. Only the chunks between known markers are evaluated; the
// DOM wiring at the bottom of the script is never executed.

import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const STANDALONE = path.join(here, '..', '..', 'standalone.html');

function between(text, start, end) {
  const i = text.indexOf(start);
  const j = text.indexOf(end, i);
  if (i === -1 || j === -1) {
    throw new Error(`standalone.html marker not found: "${start}" .. "${end}"`);
  }
  return text.slice(i, j);
}

export function loadStandalonePhysics() {
  const html = fs.readFileSync(STANDALONE, 'utf8');
  const script = between(html, "'use strict';", '</script>');
  const code = [
    between(script, 'const G = 9.81', 'const WIND_AB'),
    between(script, 'function sphereSlices', '/* wind on cylinders'),
    between(script, 'function arrayPoint', 'function readArrayParams'),
  ].join('\n');
  const ctx = vm.createContext({ Math });
  vm.runInContext(code, ctx, { filename: 'standalone.html (physics chunks)' });
  return ctx;
}

export function standaloneSource() {
  return fs.readFileSync(STANDALONE, 'utf8');
}
