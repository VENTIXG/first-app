// Dead-route guard: without a studio build, links explain instead of 404.
import { test, expect, routeLibraries } from './fixtures.js';

test('studio links are disabled with an explanation when studio/dist is missing', async ({ page }) => {
  await routeLibraries(page);
  await page.route(/\/studio\/dist\/index\.html$/, (r) => r.fulfill({ status: 404, body: 'Not found' }));
  for (const url of ['/home.html', '/index.html', '/standalone.html']) {
    await page.goto(url);
    const link = page.locator('a[href$="studio/dist/index.html"]').first();
    await expect(link).toHaveAttribute('data-unavailable', 'true');
    await link.click({ force: true }); // aria-disabled: Playwright would otherwise refuse
    await expect(page.locator('#studio-unavailable')).toContainText('npm start');
    expect(page.url()).toContain(url);
  }
});

test('studio links stay active when the build exists', async ({ page }) => {
  await routeLibraries(page);
  await page.goto('/home.html');
  await page.waitForTimeout(300);
  await expect(page.locator('#open-studio')).not.toHaveAttribute('data-unavailable', 'true');
});
