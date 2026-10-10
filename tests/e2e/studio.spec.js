// Studio (Phase 2–3 foundation), tested on the production build in
// studio/dist (`npm run build:studio`; `npm run test:e2e` builds first).

import fs from 'node:fs';
import { test, expect } from './fixtures.js';
import { referenceModel, singleColumn } from '../helpers/rhinoFixtures.mjs';

const STUDIO = '/studio/dist/index.html';

async function openStudio(page) {
  await page.goto(STUDIO);
  await expect(page.locator('#res-peak')).toHaveText(/kN$/, { timeout: 20_000 });
}
const project = (page) => page.evaluate(() => window.__studio.project());
const outlinerItems = (page) => page.locator('.outliner li');
/** Results are recomputed in a worker after every edit; wait until the panel is current. */
const settled = (page) => expect(page.locator('.results')).toHaveAttribute('aria-busy', 'false');
const selectInList = (page, name) => page.locator('.outliner-name', { hasText: name }).first().click();

async function clearScene(page) {
  for (const name of ['Column 1', 'Column 2']) {
    await selectInList(page, name);
    await page.click('.inspector button.danger');
  }
  await expect(outlinerItems(page)).toHaveCount(0);
}

async function importFile(page, name, bytes) {
  await page.locator('#import-file').setInputFiles({ name, mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) });
}

test.describe('studio', () => {
  test('boots with the CSP, renders the scene and reproduces the classic default result', async ({ page, issues }) => {
    await openStudio(page);
    const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
    expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval'");
    await expect(page.locator('#res-peak')).toHaveText('262.55 kN');
    await expect(page.locator('.viewport-host canvas')).toHaveCount(1);
    expect(await page.evaluate(() => window.__studio.viewportAvailable())).toBe(true);
    await expect(outlinerItems(page)).toHaveCount(2);
    await expect(page.locator('[data-code="HEAVE_RESONANCE_SCREEN"]')).toBeVisible();
    expect(issues.page).toEqual([]);
    expect(issues.console).toEqual([]);
  });

  test('add, undo, redo', async ({ page }) => {
    await openStudio(page);
    await page.click('#add-cylinder');
    await expect(outlinerItems(page)).toHaveCount(3);
    await expect(page.locator('#res-peak')).not.toHaveText('262.55 kN');
    await expect(page.locator('#undo')).toHaveAttribute('title', /Undo Add Column 3/);
    await page.click('#undo');
    await expect(outlinerItems(page)).toHaveCount(2);
    await expect(page.locator('#res-peak')).toHaveText('262.55 kN');
    await page.keyboard.press('Control+Shift+Z');
    await expect(outlinerItems(page)).toHaveCount(3);
  });

  test('click-select in the 3-D view, impossible edit explained, undo recovers', async ({ page }) => {
    await openStudio(page);
    const pt = await page.evaluate(() => window.__studio.objectScreenPoint('obj-column-2'));
    expect(pt).not.toBeNull();
    await page.mouse.click(pt.x, pt.y);
    await expect(page.locator('.inspector')).toHaveAttribute('data-object-id', 'obj-column-2');

    await page.fill('#insp-zBottom', '-45'); // depth is 40 m
    await page.press('#insp-zBottom', 'Enter');
    await expect(page.locator('#res-none')).toBeVisible();
    await expect(page.locator('.inspector [data-code="DRAFT_EXCEEDS_DEPTH"]')).toBeVisible();
    await expect(page.locator('.outliner li[data-object-id="obj-column-2"] .badge-error')).toBeVisible();

    await page.fill('#insp-diameter', 'abc');
    await page.press('#insp-diameter', 'Enter');
    await expect(page.locator('#notice')).toHaveText(/is not a number/);
    await expect(page.locator('#insp-diameter')).toHaveValue('6');

    await page.click('#undo');
    await expect(page.locator('#res-peak')).toHaveText('262.55 kN');
  });

  test('gizmo drag moves the selected body in plan as one undoable step', async ({ page }) => {
    await openStudio(page);
    await selectInList(page, 'Column 1');
    const h = await page.evaluate(() => window.__studio.gizmoHandlePoint('XY'));
    expect(h).not.toBeNull();
    await page.mouse.move(h.x, h.y);
    await page.mouse.down();
    await page.mouse.move(h.x + 40, h.y + 10, { steps: 8 });
    await page.mouse.move(h.x + 80, h.y + 20, { steps: 8 });
    await page.mouse.up();
    await expect.poll(async () => (await project(page)).objects[0].shape.x).not.toBe(0);
    const moved = (await project(page)).objects[0].shape;
    expect(Number.isFinite(moved.x) && Number.isFinite(moved.y)).toBe(true);
    expect(moved.zBottom).toBe(-20); // plan move only
    await expect(page.locator('#undo')).toHaveAttribute('title', /Undo Move Column 1/);
    await page.click('#undo');
    expect((await project(page)).objects[0].shape.x).toBe(0);
  });

  test('Rhino import: report, layers, display-only meshes, and analysis of imported columns', async ({ page }) => {
    await openStudio(page);
    await clearScene(page);
    await importFile(page, 'reference.3dm', await referenceModel());
    await expect(page.locator('#import-report')).toContainText('7 imported, 2 skipped');
    await expect(page.locator('#import-report')).toContainText('units Millimeters');
    await expect(outlinerItems(page)).toHaveCount(7);
    await expect(page.locator('.outliner-name', { hasText: 'Column A' })).toContainText('Platform::Columns');
    await expect(page.locator('#res-none')).toBeVisible(); // nothing included yet

    await selectInList(page, 'Brace');
    await expect(page.locator('#insp-analysis')).toBeDisabled();
    await expect(page.locator('.inspector .source')).toContainText('inclined 30.00°');

    for (const name of ['Column A', 'Column B']) {
      await selectInList(page, name);
      await page.check('#insp-analysis');
    }
    await expect(page.locator('#res-peak')).toHaveText('262.55 kN'); // same geometry as the default platform

    await page.locator('.import details summary').click();
    await expect(page.locator('.skipped')).toContainText('Tube');
    await expect(page.locator('.skipped')).toContainText('curves have no volume');
  });

  test('a file without units asks for them before importing', async ({ page }) => {
    await openStudio(page);
    await importFile(page, 'nounits.3dm', await singleColumn({ units: 'None', x: 150 }));
    await expect(page.locator('.units-needed')).toContainText('does not state usable length units');
    await expect(outlinerItems(page)).toHaveCount(2);
    await page.locator('#import-units').selectOption('Meters');
    await page.click('.units-needed button');
    await expect(outlinerItems(page)).toHaveCount(3);
    await expect(page.locator('#import-report')).toContainText('Meters were assumed');
  });

  test('names from files are text, never markup', async ({ page }) => {
    await openStudio(page);
    const payload = '<img src=x onerror="window.__xss=1">';
    await importFile(page, 'evil.3dm', await singleColumn({ name: payload, x: 150 }));
    await expect(page.locator('.outliner-name', { hasText: payload })).toBeVisible();
    expect(await page.locator('img').count()).toBe(0);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  });

  test('save and reopen a project; a tampered project file is refused', async ({ page }, testInfo) => {
    await openStudio(page);
    await page.click('#add-sphere');
    await expect(outlinerItems(page)).toHaveCount(3);
    await expect(page.locator('#res-peak')).not.toHaveText('262.55 kN');
    await settled(page);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#save-project')]);
    const text = fs.readFileSync(await dl.path(), 'utf8');
    const saved = JSON.parse(text);
    expect(saved.format).toBe('offshore-studio/project');
    expect(saved.objects).toHaveLength(3);
    const peak = await page.locator('#res-peak').textContent();

    await page.click('#undo');
    await expect(outlinerItems(page)).toHaveCount(2);
    await page.locator('#project-file').setInputFiles({ name: 'p.osproj.json', mimeType: 'application/json', buffer: Buffer.from(text) });
    await expect(outlinerItems(page)).toHaveCount(3);
    await settled(page);
    await expect(page.locator('#res-peak')).toHaveText(peak);

    const tampered = { ...saved, objects: [{ ...saved.objects[0], id: '__proto__' }] };
    await page.locator('#project-file').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(tampered)) });
    await expect(page.locator('#notice')).toHaveText(/could not be opened/);
    await expect(outlinerItems(page)).toHaveCount(3);
    testInfo.annotations.push({ type: 'saved-bytes', description: String(text.length) });
  });
});
