// End-to-end tests of the desktop app (Electron main process + pages).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect, _electron as electron } from '@playwright/test';
import { referenceModel } from '../helpers/rhinoFixtures.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');

async function launch() {
  const args = [];
  // Linux CI runners and containers cannot use Chromium's sandbox helper; the
  // shipped app keeps the sandbox (tests only).
  if (process.platform === 'linux') args.push('--no-sandbox');
  const options = process.env.APP_EXECUTABLE
    ? { executablePath: path.resolve(ROOT, process.env.APP_EXECUTABLE), args }
    : { args: [ROOT, ...args] };
  const app = await electron.launch({ ...options, env: { ...process.env, ELECTRON_ENABLE_LOGGING: '0' } });
  const page = await app.firstWindow();
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push(String(e)));
  // The app answers beforeunload with its own native prompt (will-prevent-unload);
  // a listener stops Playwright from trying to dismiss a page dialog that never shows.
  page.on('dialog', () => {});
  return { app, page, problems };
}

/** Close the app, answering "Leave" if a page with unsaved work asks. */
async function quit(app) {
  await app.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 0; });
  await app.close();
}

/** Save every download to `dir` without the native dialog. */
async function autoSaveDownloads(app, dir) {
  await app.evaluate(({ session }, target) => {
    session.defaultSession.on('will-download', (_e, item) => item.setSavePath(`${target}/${item.getFilename()}`));
  }, dir);
}

/** Replace the native confirmation dialog with a fixed answer (0 = Leave, 1 = Stay) and count calls. */
async function answerDialogs(app, choice) {
  await app.evaluate(({ dialog }, c) => {
    globalThis.__dialogCalls = 0;
    dialog.showMessageBoxSync = () => { globalThis.__dialogCalls += 1; return c; };
  }, choice);
}

test('opens on the home page, served from the private app:// origin', async () => {
  const { app, page, problems } = await launch();
  await expect(page.locator('h1')).toHaveText(/Offshore Studio/);
  expect(page.url()).toBe('app://local/home.html');
  expect(await page.title()).toBe('Offshore Studio');
  await expect(page.locator('.tool')).toHaveCount(3);
  expect(await app.evaluate(({ app: a }) => a.getName())).toBeTruthy();
  expect(problems).toEqual([]);
  await quit(app);
});

test('load calculator: worker computation, bundled Plotly and 3-D view, PDF saved to disk', async () => {
  const { app, page, problems } = await launch();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'osd-'));
  await autoSaveDownloads(app, dir);
  await page.click('#open-calculator');
  await expect(page.locator('#tile-peakTotal')).toHaveText('262.55 kN');
  await expect(page.locator('#chart .plotly')).toHaveCount(1);
  await expect(page.locator('#viz3d canvas')).toHaveCount(1);
  await page.click('#export-pdf');
  await expect.poll(() => fs.readdirSync(dir).filter((f) => f.endsWith('.pdf')).length).toBe(1);
  const pdf = fs.readFileSync(path.join(dir, fs.readdirSync(dir).find((f) => f.endsWith('.pdf'))));
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  await page.click('#export-csv');
  await expect.poll(() => fs.readdirSync(dir).filter((f) => f.endsWith('.csv')).length).toBe(1);
  expect(problems).toEqual([]);
  await quit(app);
});

test('3-D studio: Rhino import runs (WebAssembly under the CSP) and analysis matches', async () => {
  const { app, page, problems } = await launch();
  await page.click('#open-studio');
  await expect(page.locator('#res-peak')).toHaveText('262.55 kN');
  await expect(page.locator('.viewport-host canvas')).toHaveCount(1);
  await page.locator('#import-file').setInputFiles({
    name: 'reference.3dm', mimeType: 'application/octet-stream', buffer: Buffer.from(await referenceModel()),
  });
  await expect(page.locator('#import-report')).toContainText('7 imported, 2 skipped');
  expect(problems).toEqual([]);
  await quit(app);
});

test('array study runs its self-contained script', async () => {
  const { app, page, problems } = await launch();
  await page.click('#open-array');
  await expect(page.locator('h1')).toHaveText('Wave Force Laboratory');
  await expect(page.locator('#validityStrip')).toContainText('Morison');
  expect(problems).toEqual([]);
  await quit(app);
});

test('menu navigation; leaving unsaved studio work asks first', async () => {
  const { app, page } = await launch();
  const clickMenu = (top, item) => app.evaluate(({ Menu }, [t, i]) => {
    const menu = Menu.getApplicationMenu().items.find((m) => m.label === t);
    menu.submenu.items.find((m) => m.label === i).click();
  }, [top, item]);

  await clickMenu('Go', '3-D Studio');
  await expect(page.locator('#res-peak')).toHaveText('262.55 kN');
  await page.click('#add-cylinder'); // unsaved change

  await answerDialogs(app, 1); // Stay
  await clickMenu('File', 'Home');
  await expect.poll(() => app.evaluate(() => globalThis.__dialogCalls)).toBe(1);
  await page.waitForTimeout(300);
  expect(page.url()).toBe('app://local/studio/dist/index.html');
  await expect(page.locator('.outliner li')).toHaveCount(3);

  await answerDialogs(app, 0); // Leave
  await clickMenu('File', 'Home');
  await expect(page.locator('.tool')).toHaveCount(3);
  expect(page.url()).toBe('app://local/home.html');

  await clickMenu('Go', 'Load calculator');
  await expect(page.locator('#tile-peakTotal')).toHaveText(/kN$/);
  await quit(app);
});

test('external links open in the system browser; the app never navigates away or opens windows', async () => {
  const { app, page } = await launch();
  await app.evaluate(({ shell }) => {
    globalThis.__opened = [];
    shell.openExternal = async (url) => { globalThis.__opened.push(url); };
  });
  await page.click('footer a'); // Documentation (target=_blank)
  await expect.poll(() => app.evaluate(() => globalThis.__opened.length)).toBe(1);
  expect(await app.evaluate(() => globalThis.__opened[0])).toMatch(/^https:\/\/github\.com\//);
  expect(app.windows()).toHaveLength(1);

  await page.evaluate(() => { window.location.href = 'https://example.com/'; });
  await expect.poll(() => app.evaluate(() => globalThis.__opened.length)).toBe(2);
  expect(page.url()).toBe('app://local/home.html');

  // nothing outside the app folders is served
  const status = await page.evaluate(async () => (await fetch('/package.json')).status);
  expect(status).toBe(404);
  await quit(app);
});
