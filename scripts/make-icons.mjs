// Erzeugt die App-Icons (PNG) aus einem selbst gezeichneten SVG.
// Aufruf: pnpm icons   (braucht Playwright + Chromium – nur lokal, nicht in der CI)
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

// Playwright ist global installiert (nicht im Projekt) → per require laden.
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const OUT = new URL('../client/public/icons/', import.meta.url);
mkdirSync(OUT, { recursive: true });

/** @param {boolean} maskable – zusätzlicher Rand, damit Android/iOS es beschneiden darf */
function svg(maskable) {
  const s = maskable ? 0.78 : 0.92; // Motivgröße
  const t = (512 * (1 - s)) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <radialGradient id="bg" cx="50%" cy="40%" r="75%">
      <stop offset="0" stop-color="#4c5cff"/>
      <stop offset="1" stop-color="#1d2147"/>
    </radialGradient>
    <linearGradient id="track" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffb35c"/>
      <stop offset="1" stop-color="#f48a2a"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" fill="url(#bg)"/>
  <g transform="translate(${t} ${t}) scale(${s})">
    <!-- Strecke in die Tiefe -->
    <path d="M196 512 L236 300 L276 300 L316 512 Z" fill="url(#track)" opacity="0.9"/>
    <path d="M256 300 L256 512" stroke="#fff" stroke-width="6" stroke-dasharray="18 16" opacity="0.8"/>
    <!-- Läufer (leicht neben dem Fadenkreuz – er entkommt gerade) -->
    <g transform="translate(44 6)">
      <g fill="none" stroke="#14122b" stroke-width="34" stroke-linecap="round" stroke-linejoin="round">
        <path d="M232 250 L210 300 L178 318"/>
        <path d="M262 250 L296 286 L292 330"/>
        <path d="M244 172 L210 200 L188 186" stroke-width="28"/>
        <path d="M262 172 L298 182 L314 160" stroke-width="28"/>
      </g>
      <g fill="none" stroke="#ff7a1a" stroke-width="20" stroke-linecap="round" stroke-linejoin="round">
        <path d="M232 250 L210 300 L178 318"/>
        <path d="M262 250 L296 286 L292 330"/>
        <path d="M244 172 L210 200 L188 186" stroke-width="15"/>
        <path d="M262 172 L298 182 L314 160" stroke-width="15"/>
      </g>
      <rect x="226" y="158" width="52" height="100" rx="24" fill="#ff7a1a" stroke="#14122b" stroke-width="10"/>
      <circle cx="258" cy="126" r="30" fill="#ffc9a1" stroke="#14122b" stroke-width="10"/>
      <path d="M229 112 a29 27 0 0 1 58 0 Z" fill="#ffd23f" stroke="#14122b" stroke-width="8" stroke-linejoin="round"/>
      <path d="M284 110 h22" stroke="#14122b" stroke-width="14" stroke-linecap="round"/>
      <path d="M284 110 h20" stroke="#ffd23f" stroke-width="7" stroke-linecap="round"/>
      <circle cx="250" cy="128" r="7" fill="#fff"/><circle cx="268" cy="128" r="7" fill="#fff"/>
      <circle cx="252" cy="129" r="3.5" fill="#14122b"/><circle cx="270" cy="129" r="3.5" fill="#14122b"/>
      <path d="M252 143 q8 6 16 0" fill="none" stroke="#14122b" stroke-width="4" stroke-linecap="round"/>
    </g>
    <!-- Zielfernrohr-Ring mit Fadenkreuz -->
    <circle cx="256" cy="210" r="168" fill="none" stroke="#14122b" stroke-width="38"/>
    <circle cx="256" cy="210" r="168" fill="none" stroke="#ffd23f" stroke-width="24"/>
    <g stroke="#ffd23f" stroke-width="12" stroke-linecap="round">
      <line x1="256" y1="30" x2="256" y2="92"/>
      <line x1="256" y1="328" x2="256" y2="390"/>
      <line x1="76" y1="210" x2="138" y2="210"/>
      <line x1="374" y1="210" x2="436" y2="210"/>
    </g>
    <!-- Glitzern -->
    <path d="M404 64 l10 26 l26 10 l-26 10 l-10 26 l-10 -26 l-26 -10 l26 -10 Z" fill="#fff"/>
  </g>
</svg>`;
}

const targets = [
  { file: 'icon-192.png', size: 192, maskable: false },
  { file: 'icon-512.png', size: 512, maskable: false },
  { file: 'maskable-512.png', size: 512, maskable: true },
  { file: 'apple-touch-icon.png', size: 180, maskable: false },
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const { file, size, maskable } of targets) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<html><body style="margin:0;background:#1d2147">${svg(maskable).replace('width="512" height="512"', `width="${size}" height="${size}"`)}</body></html>`,
  );
  await page.screenshot({ path: new URL(file, OUT).pathname, clip: { x: 0, y: 0, width: size, height: size } });
  console.log('✔', file);
}
await browser.close();
