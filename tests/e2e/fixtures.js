// Shared E2E fixture. The app bundles its libraries in vendor/ and must never
// contact another host: every request to a non-local host is aborted and
// recorded (issues.external). Options:
//   plotly   – serve vendor Plotly (default false: the built-in SVG chart is
//              used, which is faster and pixel-stable for visual tests)
//   missing  – vendor libraries to make unavailable ('three' | 'jspdf' | 'plotly'),
//              to test graceful degradation
// Also collects console errors and uncaught page errors.

import { test as base, expect } from '@playwright/test';

const VENDOR = {
  three: /\/vendor\/three-[\d.]+\.module\.js$/,
  jspdf: /\/vendor\/jspdf-[\d.]+\.umd\.min\.js$/,
  plotly: /\/vendor\/plotly-[\d.]+\.min\.js$/,
};

const externalByPage = new WeakMap();

/** URLs of requests to other hosts that the page attempted (all are blocked). */
export const externalRequests = (page) => externalByPage.get(page) ?? [];

/**
 * @param {import('@playwright/test').Page} page
 * @param {{ plotly?: boolean, missing?: Array<'three'|'jspdf'|'plotly'> }} opts
 */
export async function routeLibraries(page, { plotly = false, missing = [] } = {}) {
  const external = [];
  externalByPage.set(page, external);
  await page.route(/^https?:\/\/(?!localhost[:/])/, (route) => {
    external.push(route.request().url());
    return route.abort();
  });
  const blocked = new Set(missing);
  if (!plotly) blocked.add('plotly');
  for (const name of blocked) await page.route(VENDOR[name], (route) => route.abort());
}

export const test = base.extend({
  issues: async ({ page }, use) => {
    const issues = { console: [], page: [] };
    page.on('console', (m) => {
      // Deliberately blocked vendor files (e.g. Plotly by default) log a load error.
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
