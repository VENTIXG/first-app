import fs from 'node:fs';
import { test, expect, openApp } from './fixtures.js';

async function download(page, selector) {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30_000 }), page.click(selector)]);
  return { name: dl.suggestedFilename(), buf: fs.readFileSync(await dl.path()) };
}

/** Load a platform of n non-overlapping cylinders through the scenario mechanism. */
async function loadManyBodies(page, n) {
  await page.evaluate((count) => {
    const bodies = Array.from({ length: count }, (_, i) => ({
      type: 'cylinder', x: (i % 5) * 40, y: Math.floor(i / 5) * 40, diameter: 4, radius: 2, draft: 15, freeboard: 10,
    }));
    localStorage.setItem('wfc-scenarios', JSON.stringify({ many: { snapshot: { schemaVersion: 1, environment: {}, bodies } } }));
  }, n);
  await page.reload();
  await page.locator('#scenario-list').selectOption('many');
  await page.click('#scenario-load');
  await expect(page.locator('#body-manager > div')).toHaveCount(n);
}

test.describe('exports', () => {
  test('CSV: header and one row per time sample, consistent with the global series', async ({ page }) => {
    await openApp(page);
    const { name, buf } = await download(page, '#export-csv');
    expect(name).toBe('platform-forces.csv');
    const lines = buf.toString('utf8').trim().split('\n');
    expect(lines[0]).toBe('t_s,global_total_kN,global_drag_kN,global_inertia_kN,global_wind_kN,' +
      'body1_total_kN,body1_drag_kN,body1_inertia_kN,body2_total_kN,body2_drag_kN,body2_inertia_kN');
    expect(lines).toHaveLength(201);
    // global total = sum of body totals at every sample
    for (const line of lines.slice(1)) {
      const v = line.split(',').map(Number);
      expect(Math.abs(v[1] - (v[5] + v[8]))).toBeLessThan(2e-6);
    }
  });

  test('JSON: machine-readable record with inputs, results, warnings and engine version', async ({ page }) => {
    await openApp(page);
    const { buf } = await download(page, '#export-json');
    const rec = JSON.parse(buf.toString('utf8'));
    expect(rec.format).toBe('offshore-studio/results');
    expect(rec.ok).toBe(true);
    expect(rec.inputs.schemaVersion).toBe(1);
    expect(rec.engineVersion).toBeTruthy();
    expect(rec.heaveScreening.damping).toBeNull();
    expect(rec.warnings.some((w) => w.code === 'HEAVE_RESONANCE_SCREEN')).toBe(true);
    expect(rec.timeSeries.t).toHaveLength(200);
  });

  test('PDF: a 25-body platform produces a valid multi-page report', async ({ page }) => {
    await openApp(page);
    await loadManyBodies(page, 25);
    const { buf } = await download(page, '#export-pdf');
    const text = buf.toString('latin1');
    expect(text.startsWith('%PDF-')).toBe(true);
    const pages = (text.match(/\/Type \/Page\b/g) || []).length;
    expect(pages).toBeGreaterThanOrEqual(2);
    await expect(page.locator('#toast')).toContainText(`${pages} pages`);
  });
});

test.describe('offline / missing libraries', () => {
  test('physics, styling, SVG chart and tables work with every CDN blocked; optional features explain themselves', async ({ page, issues }) => {
    await openApp(page, { offline: true });
    // static CSS is local: the header must be styled (sticky) without any CDN
    expect(await page.locator('header').evaluate((e) => getComputedStyle(e).position)).toBe('sticky');
    await expect(page.locator('#chart svg path').first()).toBeVisible();
    await expect(page.locator('#viz3d')).toContainText('3-D view unavailable');
    await page.click('#export-pdf');
    await expect(page.locator('#toast')).toContainText('PDF export unavailable');
    expect(issues.page).toEqual([]);
  });
});
