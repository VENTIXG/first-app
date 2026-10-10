// Refresh vendor/ from node_modules (pinned versions in package.json).
// Usage: npm run vendor
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = (pkg) => JSON.parse(fs.readFileSync(path.join(root, 'node_modules', pkg, 'package.json'), 'utf8')).version;

const FILES = [
  ['plotly.js-dist-min', 'plotly.min.js', (v) => `plotly-${v}.min.js`],
  ['jspdf', 'dist/jspdf.umd.min.js', (v) => `jspdf-${v}.umd.min.js`],
  ['three', 'build/three.module.js', (v) => `three-${v}.module.js`],
];

fs.mkdirSync(path.join(root, 'vendor', 'licenses'), { recursive: true });
for (const [pkg, file, name] of FILES) {
  const v = version(pkg);
  const src = fs.readFileSync(path.join(root, 'node_modules', pkg, file), 'utf8');
  // drop the trailing source-map comment (maps are not shipped)
  const out = src.replace(/\n?\/\/# sourceMappingURL=\S+\s*$/, '\n');
  fs.writeFileSync(path.join(root, 'vendor', name(v)), out);
  fs.copyFileSync(path.join(root, 'node_modules', pkg, 'LICENSE'), path.join(root, 'vendor', 'licenses', `${pkg.replace('-dist-min', '')}-LICENSE.txt`));
  console.log(`vendor/${name(v)}`);
}
