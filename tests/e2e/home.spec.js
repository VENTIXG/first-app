// The home page and navigation between the three tools (studio needs
// `npm run build:studio`; `npm run test:e2e` builds it first).

import { test, expect, routeLibraries, externalRequests } from './fixtures.js';

test('home links to every tool, and every tool links back', async ({ page, issues }) => {
  await routeLibraries(page);
  await page.goto('/home.html');
  await expect(page.locator('h1')).toHaveText(/Offshore Studio/);
  await expect(page.locator('.tool')).toHaveCount(3);

  await page.click('#open-calculator');
  await expect(page.locator('#tile-peakTotal')).toHaveText('262.55 kN');
  await page.getByRole('link', { name: '3-D Studio' }).click();
  await expect(page.locator('#res-peak')).toHaveText('262.55 kN', { timeout: 20_000 });
  await page.getByRole('link', { name: 'Array study' }).click();
  await expect(page.locator('h1')).toHaveText('Wave Force Laboratory');
  await page.getByRole('link', { name: 'Home' }).click();
  await expect(page.locator('#open-studio')).toBeVisible();

  await page.click('#open-array');
  await page.getByRole('link', { name: 'Load calculator' }).click();
  await expect(page.locator('#tile-peakTotal')).toHaveText(/kN$/);
  await page.getByRole('link', { name: 'Home' }).click();
  await page.click('#open-studio');
  await page.getByRole('link', { name: 'Home' }).click();
  await expect(page.locator('.tool')).toHaveCount(3);

  expect(externalRequests(page)).toEqual([]);
  expect(issues.page).toEqual([]);
});
