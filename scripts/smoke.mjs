// Browser-Smoke-Test im iPhone-Format (lokal, braucht Playwright + Chromium).
// Vorher `pnpm dev` starten. Aufruf: node scripts/smoke.mjs [url] [screenshot.png]
//  - Seite lädt ohne Konsolenfehler
//  - Server-Verbindung steht
//  - Wischen wird erkannt
//  - Querformat zeigt den Dreh-Hinweis
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');

const url = process.argv[2] ?? 'http://localhost:5173/';
const shot = process.argv[3] ?? 'smoke-iphone.png';

const browser = await chromium.launch();
const context = await browser.newContext({ ...devices['iPhone 12'], deviceScaleFactor: 2 });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

let failed = false;
const check = (ok, text) => {
  console.log(`${ok ? '✔' : '✖'} ${text}`);
  if (!ok) failed = true;
};

await page.goto(url);
await page.waitForSelector('.sheet');

// Anleitung „Zum Home-Bildschirm“ schließen, falls sie aufgeht
const guide = page.locator('.modal-backdrop .btn.primary');
if (await guide.isVisible().catch(() => false)) await guide.click();

const connected = await page
  .waitForFunction(() => document.querySelector('.server-status')?.textContent?.includes('Verbunden'), null, {
    timeout: 8000,
  })
  .then(() => true)
  .catch(() => false);
check(connected, 'Server verbunden: ' + ((await page.locator('.server-status').textContent()) ?? ''));

// Wischen nach links im Gesten-Feld
const pad = await page.locator('.gesture-pad').boundingBox();
if (pad) {
  const cx = pad.x + pad.width / 2;
  const cy = pad.y + pad.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx - 60, cy, { steps: 4 });
  await page.mouse.up();
}
const gestureText = (await page.locator('.gesture-pad').textContent()) ?? '';
check(gestureText.includes('links'), `Wisch erkannt: ${gestureText}`);

await page.waitForTimeout(1500);
const fps = (await page.locator('.stats').textContent()) ?? '';
check(/FPS \d+/.test(fps), `Statuszeile: ${fps}`);
await page.screenshot({ path: shot });
console.log(`📸 ${shot}`);

// Querformat
await page.setViewportSize({ width: 844, height: 390 });
await page.waitForTimeout(200);
check(await page.locator('.rotate-overlay').isVisible(), 'Querformat zeigt Dreh-Hinweis');

check(errors.length === 0, `Keine Konsolenfehler${errors.length ? ': ' + errors.join(' | ') : ''}`);
await browser.close();
process.exit(failed ? 1 : 0);
