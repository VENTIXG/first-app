// Mooring Studio workspace, on the production studio build.

import { test, expect } from './fixtures.js';

const STUDIO = '/studio/dist/index.html';
const project = (page) => page.evaluate(() => window.__studio.project());
const settled = (page) => expect(page.locator('.mooring-results')).toHaveAttribute('aria-busy', 'false');

async function openExample(page) {
  await page.goto(STUDIO);
  await expect(page.locator('#res-peak')).toHaveText(/kN$/, { timeout: 20_000 });
  await page.click('#open-example');
  await page.click('#ws-mooring');
  await expect(page.locator('#mooring-status')).toBeVisible({ timeout: 20_000 });
  await settled(page);
}

test.describe('mooring studio', () => {
  test('example project: equilibrium, line results, safety cases, chart and 3-D lines', async ({ page, issues }) => {
    await openExample(page);
    await expect(page.locator('#mooring-status')).toHaveText(/All safety cases meet the criteria/);
    await expect(page.locator('#mooring-offset')).toHaveText('0.00 m');
    await expect(page.locator('#mooring-lines tbody tr')).toHaveCount(3);
    // the example's line lengths give a 1200 kN fairlead pretension
    await expect(page.locator('#mooring-lines tbody tr').first().locator('td').nth(1)).toHaveText('1200 kN');
    await expect(page.locator('#mooring-cases tbody tr')).toHaveCount(4);
    await expect(page.locator('#mooring-chart polyline')).toHaveCount(3);
    for (const id of ['L1', 'L2', 'L3', 'A1', 'F1']) {
      expect(await page.evaluate((i) => window.__studio.mooringScreenPoint(i), id)).not.toBeNull();
    }
    expect(issues.page).toEqual([]);
    expect(issues.console).toEqual([]);
  });

  test('mean environmental load drives the study; losing the windward line is reported as a failure', async ({ page }) => {
    await openExample(page);
    await page.click('#mx-use-mean');
    await settled(page);
    const ext = (await project(page)).mooring.external;
    expect(ext[0]).toBeGreaterThan(1e5);
    await page.fill('#mx-fx', '400');
    await page.press('#mx-fx', 'Enter');
    await settled(page);
    await expect(page.locator('#mooring-status')).toHaveText(/do not meet the criteria: Line 1 failed/);
    const failedRow = page.locator('#mooring-cases tbody tr', { hasText: 'Line 1 failed' });
    await expect(failedRow.locator('td.fail')).toHaveText('fail');
    await expect(page.locator('.mooring-results .issues')).toContainText('Station keeping lost');
    expect(Number((await page.locator('#mooring-offset').textContent()).replace(' m', ''))).toBeGreaterThan(0.5);
  });

  test('selecting a line in the 3-D view opens it; edits are undoable; an impossible line is never reported as converged', async ({ page }) => {
    await openExample(page);
    const pt = await page.evaluate(() => window.__studio.mooringScreenPoint('L2'));
    await page.mouse.click(pt.x, pt.y);
    await expect(page.locator('.inspector[data-item="L2"]')).toBeVisible();
    const before = (await project(page)).mooring.system.lines[1].length;
    // shorter than the anchor-fairlead distance: no equilibrium exists without exceeding the breaking load
    await page.fill('#ml-length', '300');
    await page.press('#ml-length', 'Enter');
    await settled(page);
    await expect(page.locator('#mooring-status')).not.toHaveText(/All safety cases meet/);
    await expect(page.locator('#mooring-offset')).toHaveCount(0);
    await page.click('#undo');
    await settled(page);
    expect((await project(page)).mooring.system.lines[1].length).toBe(before);
    await expect(page.locator('#mooring-status')).toHaveText(/All safety cases meet the criteria/);
  });

  test('generate, extend and remove a spread on a new project', async ({ page }) => {
    await page.goto(STUDIO);
    await expect(page.locator('#res-peak')).toHaveText(/kN$/, { timeout: 20_000 });
    await page.click('#ws-mooring');
    await expect(page.locator('#mooring-none')).toBeVisible();
    await page.fill('#sp-count', '4');
    await page.press('#sp-count', 'Enter');
    await page.selectOption('#sp-material', 'polyester');
    await page.click('#mooring-generate');
    await expect(page.locator('#mooring-lines tbody tr')).toHaveCount(4, { timeout: 20_000 });
    const m = (await project(page)).mooring;
    expect(m.system.lineTypes[0].material).toBe('polyester');
    expect(m.system.anchors.every((a) => a.z === -m.system.depth)).toBe(true);
    await page.click('#mooring-add-line');
    await expect(page.locator('#mooring-lines tbody tr')).toHaveCount(5);
    await page.click('#mooring-remove');
    await expect(page.locator('#mooring-none')).toBeVisible();
    expect((await project(page)).mooring).toBeUndefined();
  });
});
