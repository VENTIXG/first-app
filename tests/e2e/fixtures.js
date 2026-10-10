// Shared E2E fixture: serves the CDN libraries from node_modules (pinned to the
// same versions the app requests) or blocks all external hosts ("offline").
// Collects console errors and uncaught page errors for assertions.

import { test as base, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const nm = (p) => fs.readFileSync(path.join(process.cwd(), 'node_modules', p));
const LIBS = [
  ['https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js', 'three/build/three.module.js'],
  ['https://cdn.jsdelivr.net/npm/jspdf@4.2.1/dist/jspdf.umd.min.js', 'jspdf/dist/jspdf.umd.min.js'],
  ['https://cdn.plot.ly/plotly-2.35.2.min.js', 'plotly.js-dist-min/plotly.min.js'],
];

/**
 * @param {import('@playwright/test').Page} page
 * @param {{ offline?: boolean, plotly?: boolean }} opts
 */
export async function routeLibraries(page, { offline = false, plotly = false } = {}) {
  await page.route(/^https?:\/\/(?!localhost)/, (route) => {
    if (offline) return route.abort();
    const url = route.request().url();
    const lib = LIBS.find(([u]) => url === u);
    if (!lib) return route.abort();
    if (!plotly && lib[1].startsWith('plotly')) return route.abort();
    return route.fulfill({ contentType: 'application/javascript', body: nm(lib[1]) });
  });
}

export const test = base.extend({
  issues: async ({ page }, use) => {
    const issues = { console: [], page: [] };
    page.on('console', (m) => {
      // Aborted optional CDN requests are expected in offline/no-Plotly mode.
      if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) issues.console.push(m.text());
    });
    page.on('pageerror', (e) => issues.page.push(String(e)));
    await use(issues);
  },
});

/** Open the app and wait until the first result is rendered. */
export async function openApp(page, opts) {
  await routeLibraries(page, opts);
  await page.goto('/index.html');
  await expect(page.locator('#tile-peakTotal')).not.toHaveText('–');
}

/** Set an environment field by its stable id (attribute selector: ids differ only by case, e.g. in-H vs in-h). */
export async function setEnv(page, key, value) {
  const input = page.locator(`[id="in-${key}"]`);
  await input.fill(String(value));
  await input.dispatchEvent('change');
}

/** Set a numeric field on the body card at 0-based index. */
export async function setBodyField(page, index, field, value) {
  const input = page.locator('#body-manager > div').nth(index).locator(`input[data-field="${field}"]`);
  await input.fill(String(value));
  await input.dispatchEvent('change');
}

export { expect };
