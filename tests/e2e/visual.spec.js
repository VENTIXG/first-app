// Visual regression for deterministic panels. Runs offline so the chart is the
// built-in SVG renderer (Plotly output varies with version). The WebGL 3-D view
// is excluded: its pixels depend on the GPU/driver. Baselines are
// platform-specific (Playwright suffixes them with the OS); regenerate with
// `npx playwright test tests/e2e/visual.spec.js --update-snapshots` after an
// intentional visual change.

import { test, expect, openApp } from './fixtures.js';

for (const theme of ['light', 'dark']) {
  test(`chart and result tiles — ${theme} theme`, async ({ page }) => {
    await page.addInitScript((t) => { try { localStorage.setItem('wfc-theme', t); } catch { /* ignore */ } }, theme);
    await openApp(page, { offline: true });
    await expect(page.locator('#chart svg')).toBeVisible();
    // the sticky header would overlap elements scrolled into view for capture
    await page.addStyleTag({ content: 'header { position: static !important; }' });
    const opts = { maxDiffPixelRatio: 0.01 };
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(page.locator('#tiles')).toHaveScreenshot(`tiles-${theme}.png`, opts);
    await expect(page.locator('#chart').locator('..')).toHaveScreenshot(`chart-${theme}.png`, opts);
  });
}
