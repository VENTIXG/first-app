// Desktop-app tests (Playwright's Electron support). By default they launch
// the app from the repository (`electron .`, after `npm run build:studio`);
// set APP_EXECUTABLE to test a packaged build, e.g.
//   APP_EXECUTABLE=release/linux-unpacked/offshore-studio
// On Linux run under a display server: `xvfb-run -a npm run test:app`.

import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/electron',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
});
