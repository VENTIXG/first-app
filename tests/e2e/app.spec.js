import { test, expect, openApp, setEnv, setBodyField } from './fixtures.js';

test.describe('core workflow', () => {
  test('boots with libraries, computes, and renders every panel without errors', async ({ page, issues }) => {
    await openApp(page, { plotly: true });
    await expect(page.locator('#body-manager > div')).toHaveCount(2);
    await expect(page.locator('#tile-peakTotal')).toHaveText(/kN$/);
    await expect(page.locator('#body-table tr')).toHaveCount(2);
    await expect(page.locator('#chart .plotly')).toHaveCount(1);
    await expect(page.locator('#viz3d canvas')).toHaveCount(1);
    expect(await page.locator('#assumptions-list li').count()).toBeGreaterThan(5);
    expect(issues.page).toEqual([]);
    expect(issues.console).toEqual([]);
  });

  test('default platform shows the heave-resonance screening warning (T = 9 s)', async ({ page }) => {
    await openApp(page);
    await expect(page.locator('#warnings [data-code="HEAVE_RESONANCE_SCREEN"]')).toBeVisible();
    await expect(page.locator('#tile-heave')).toHaveText('9.25 s');
  });

  test('add body, switch to sphere, chart series selector follows the body list', async ({ page }) => {
    await openApp(page);
    await page.click('#add-body');
    await expect(page.locator('#body-manager > div')).toHaveCount(3);
    await expect(page.locator('#chart-series-select option')).toHaveCount(4);
    // new body copies the previous geometry and does not overlap it
    await expect(page.locator('#warnings [data-severity="error"]')).toHaveCount(0);

    await page.locator('#chart-series-select').selectOption({ index: 3 });
    await expect(page.locator('#chart-title')).toHaveText('Body 3 Force — one wave period');
    await page.locator('#body-manager > div').nth(2).locator('button').click();
    await expect(page.locator('#chart-title')).toHaveText('Global Platform Force — one wave period');
  });

  test('impossible geometry blocks results and is explained on the body card; fixing it recovers', async ({ page }) => {
    await openApp(page);
    await setBodyField(page, 0, 'draft', 45); // depth is 40 m
    await expect(page.locator('#warnings [data-code="DRAFT_EXCEEDS_DEPTH"]')).toBeVisible();
    await expect(page.locator('[data-issues-for] [data-code="DRAFT_EXCEEDS_DEPTH"]')).toBeVisible();
    await expect(page.locator('#tile-peakTotal')).toHaveText('—');
    await expect(page.locator('#export-csv')).toBeDisabled();
    await expect(page.locator('#export-pdf')).toBeDisabled();

    await setBodyField(page, 0, 'draft', 20);
    await expect(page.locator('#tile-peakTotal')).toHaveText(/kN$/);
    await expect(page.locator('#export-csv')).toBeEnabled();
  });

  test('switching a body to a sphere with draft > 2R is rejected with an explanation', async ({ page }) => {
    await openApp(page);
    await page.locator('#body-manager > div').nth(1).locator('select').selectOption('sphere');
    await expect(page.locator('[data-issues-for] [data-code="SPHERE_DRAFT_EXCEEDS_DIAMETER"]')).toBeVisible();
    await expect(page.locator('#tile-peakTotal')).toHaveText('—');
  });

  test('breaking wave is rejected (no numbers shown)', async ({ page }) => {
    await openApp(page);
    await setEnv(page, 'H', 9);
    await setEnv(page, 'h', 10);
    await setBodyField(page, 0, 'draft', 5);
    await setBodyField(page, 1, 'draft', 5);
    await expect(page.locator('#warnings [data-code="WAVE_BREAKING_DEPTH"]')).toBeVisible();
    await expect(page.locator('#tile-peakTotal')).toHaveText('—');
    await expect(page.locator('#chart')).toContainText('No results');
  });

  test('viscosity is shown in mm²/s but stored in SI (Re follows the change)', async ({ page }) => {
    await openApp(page);
    await expect(page.locator('[id="in-nu"]')).toHaveValue('1.19');
    const reCell = page.locator('#body-table tr').first().locator('td').nth(7);
    await expect(reCell).toHaveText('4.5e+6');
    await setEnv(page, 'nu', 1.785); // 1.5 × 1.19 → Re / 1.5
    await expect(reCell).toHaveText('3.0e+6');
    await page.fill('#scenario-name', 'visc');
    await page.click('#scenario-save');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('wfc-scenarios')).visc.snapshot);
    expect(saved.environment.nu).toBeCloseTo(1.785e-6, 15);
  });

  test('Stokes 5th at SWL is flagged; integrating to the surface clears the flag', async ({ page }) => {
    await openApp(page);
    await page.locator('[id="in-waveTheory"]').selectOption('stokes5');
    await expect(page.locator('#warnings [data-code="STOKES_TRUNCATED_AT_SWL"]')).toBeVisible();
    await page.locator('[id="in-integrateTo"]').selectOption('surface');
    await expect(page.locator('#warnings [data-code="STOKES_TRUNCATED_AT_SWL"]')).toHaveCount(0);
    await expect(page.locator('#tile-peakTotal')).toHaveText(/kN$/);
  });
});
