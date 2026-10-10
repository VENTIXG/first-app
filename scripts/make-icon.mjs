// Render build/icon.svg to build/icon.png (1024×1024) with Playwright's Chromium.
// electron-builder derives the Windows .ico and macOS .icns from the PNG.
// Usage: node scripts/make-icon.mjs   (PW_CHROMIUM_PATH optional)
import fs from 'node:fs';
import { chromium } from '@playwright/test';

const svg = fs.readFileSync(new URL('../build/icon.svg', import.meta.url), 'utf8');
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });
await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
await page.locator('svg').screenshot({ path: new URL('../build/icon.png', import.meta.url).pathname, omitBackground: true });
await browser.close();
console.log('build/icon.png');
