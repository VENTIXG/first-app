// Playwright E2E configuration.
// CDN libraries are served from node_modules by the test fixture
// (tests/e2e/fixtures.js), so the suite runs without network access.
// Set PW_CHROMIUM_PATH to use a preinstalled Chromium instead of
// `npx playwright install chromium`.

import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1440, height: 1100 },
    acceptDownloads: true,
    launchOptions: {
      executablePath: process.env.PW_CHROMIUM_PATH || undefined,
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1100 } } }],
  webServer: {
    command: `node scripts/serve.mjs --port ${PORT}`,
    port: PORT,
    reuseExistingServer: true,
  },
});
