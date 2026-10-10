import { test, expect, openApp, setEnv, settled } from './fixtures.js';

const PAYLOAD = '<img src=x onerror="window.__xss=1">';

test.describe('security and scenario integrity', () => {
  test('scenario names are rendered as text, never as HTML', async ({ page }) => {
    await openApp(page);
    await page.fill('#scenario-name', PAYLOAD);
    await page.click('#scenario-save');
    await expect(page.locator('#scenario-list option')).toHaveText([PAYLOAD]);
    await expect(page.locator('#toast')).toContainText(PAYLOAD);
    expect(await page.locator('img').count()).toBe(0);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  });

  test('a stored scenario with an injected body type is rejected and leaves the state unchanged', async ({ page }) => {
    await openApp(page);
    const before = await page.locator('#tile-peakTotal').textContent();
    await page.evaluate((payload) => {
      localStorage.setItem('wfc-scenarios', JSON.stringify({
        evil: { snapshot: { schemaVersion: 1, environment: {}, bodies: [{ type: payload, x: 0, y: 0, diameter: 6, radius: 5, draft: 20, freeboard: 10 }] } },
      }));
    }, PAYLOAD);
    await page.reload();
    await expect(page.locator('#tile-peakTotal')).toHaveText(before);
    await page.locator('#scenario-list').selectOption('evil');
    await page.click('#scenario-load');
    await expect(page.locator('#toast')).toHaveAttribute('data-kind', 'error');
    await expect(page.locator('#toast')).toContainText('could not be loaded');
    await expect(page.locator('#body-manager > div')).toHaveCount(2);
    expect(await page.locator('img').count()).toBe(0);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  });

  test('save and load round-trip restores every input', async ({ page }) => {
    await openApp(page);
    await setEnv(page, 'H', 5.5);
    await page.locator('[id="in-waveTheory"]').selectOption('stokes5');
    await page.locator('[id="in-integrateTo"]').selectOption('surface');
    await page.fill('#scenario-name', 'storm');
    await page.click('#scenario-save');
    await settled(page);
    const saved = await page.locator('#tile-peakTotal').textContent();

    await setEnv(page, 'H', 1.5);
    await page.locator('[id="in-waveTheory"]').selectOption('airy');
    await expect(page.locator('#tile-peakTotal')).not.toHaveText(saved);
    await settled(page);

    await page.locator('#scenario-list').selectOption('storm');
    await page.click('#scenario-load');
    await expect(page.locator('[id="in-H"]')).toHaveValue('5.5');
    await expect(page.locator('[id="in-waveTheory"]')).toHaveValue('stokes5');
    await expect(page.locator('[id="in-integrateTo"]')).toHaveValue('surface');
    await expect(page.locator('#tile-peakTotal')).toHaveText(saved);
  });

  test('legacy (v0) scenarios migrate: global exposed height becomes body freeboard', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => {
      localStorage.setItem('wfc-scenarios', JSON.stringify({
        legacy: {
          params: {
            environment: { H: 3, T: 8, h: 40, h_exp: 12 },
            bodies: [{ id: 1, type: 'cylinder', x: 0, y: 0, diameter: 5, radius: 5, draft: 15 }],
          },
        },
      }));
    });
    await page.reload();
    await page.locator('#scenario-list').selectOption('legacy');
    await page.click('#scenario-load');
    await expect(page.locator('#toast')).toHaveAttribute('data-kind', 'info');
    await expect(page.locator('#body-manager > div')).toHaveCount(1);
    await expect(page.locator('#body-manager input[data-field="freeboard"]')).toHaveValue('12');
  });

  test('a failed storage write is reported, not silently ignored', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => {
      Storage.prototype.setItem = () => { throw new DOMException('quota', 'QuotaExceededError'); };
    });
    await page.fill('#scenario-name', 'x');
    await page.click('#scenario-save');
    await expect(page.locator('#toast')).toHaveAttribute('data-kind', 'error');
    await expect(page.locator('#toast')).toContainText('could not be saved');
  });
});
