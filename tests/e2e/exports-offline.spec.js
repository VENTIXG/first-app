import fs from 'node:fs';
import { test, expect, openApp, externalRequests } from './fixtures.js';

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

test.describe('responsiveness', () => {
  test('a heavy platform is computed in a background worker; the page keeps animating', async ({ page }) => {
    const workers = [];
    page.on('worker', (w) => workers.push(w.url()));
    await openApp(page);
    await page.evaluate(() => {
      const bodies = Array.from({ length: 25 }, (_, i) => ({
        type: 'cylinder', x: (i % 5) * 40, y: Math.floor(i / 5) * 40, diameter: 4, radius: 2, draft: 15, freeboard: 10,
      }));
      localStorage.setItem('wfc-scenarios', JSON.stringify({
        heavy: { snapshot: { schemaVersion: 1, environment: { waveTheory: 'stokes5', integrateTo: 'surface' }, bodies } },
      }));
    });
    await page.reload();
    await page.locator('#scenario-list').selectOption('heavy');
    // longest gap between animation frames while the scenario loads and computes
    const maxGap = page.evaluate(() => new Promise((resolve) => {
      let last = performance.now(); let max = 0; const t0 = last;
      const tick = (t) => { max = Math.max(max, t - last); last = t; if (t - t0 < 1500) requestAnimationFrame(tick); else resolve(max); };
      requestAnimationFrame(tick);
    }));
    await page.click('#scenario-load');
    await expect(page.locator('#body-table tr')).toHaveCount(25);
    await expect(page.locator('#toast')).toContainText('Loaded scenario');
    expect(workers.some((u) => u.endsWith('/js/compute.worker.js'))).toBe(true);
    expect(await maxGap).toBeLessThan(400); // computing on the page thread took ~0.5 s per edit
  });
});

test.describe('offline / missing libraries', () => {
  test('everything works with no network: bundled 3-D view, Plotly chart and PDF; no external request', async ({ page, issues }) => {
    await openApp(page, { plotly: true });
    expect(await page.locator('header').evaluate((e) => getComputedStyle(e).position)).toBe('sticky');
    await expect(page.locator('#chart .plotly')).toHaveCount(1);
    await expect(page.locator('#viz3d canvas')).toHaveCount(1);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#export-pdf')]);
    expect(dl.suggestedFilename()).toMatch(/\.pdf$/);
    expect(externalRequests(page)).toEqual([]);
    expect(issues.page).toEqual([]);
  });

  test('if bundled libraries are missing, physics, tables and the SVG chart still work and the rest explains itself', async ({ page, issues }) => {
    await openApp(page, { missing: ['three', 'jspdf', 'plotly'] });
    await expect(page.locator('#chart svg path').first()).toBeVisible();
    await expect(page.locator('#viz3d')).toContainText('3-D view unavailable');
    await page.click('#export-pdf');
    await expect(page.locator('#toast')).toContainText('PDF export unavailable');
    expect(issues.page).toEqual([]);
  });
});
