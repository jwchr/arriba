#!/usr/bin/env node
// Usage: node scripts/build-icons.mjs
// Renders public/icon.svg to the PNG icons phones need: iPhone home screens ignore SVG (apple-touch-icon,
// 180 px, square: iOS rounds the corners), and Android's maskable icon must fill the square so the
// launcher can crop it to any shape. The arrow sits inside the maskable safe zone (80% circle).
// Uses the Playwright Chromium the tests already install; run it again after changing icon.svg.
import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const svg = readFileSync('public/icon.svg', 'utf8');
const square = svg.replace(/ rx="\d+"/, ''); // full-bleed background for maskable and iOS
const outputs = [
  { file: 'public/icon-192.png', size: 192, art: svg },
  { file: 'public/icon-512.png', size: 512, art: svg },
  { file: 'public/icon-maskable-512.png', size: 512, art: square },
  { file: 'public/apple-touch-icon.png', size: 180, art: square },
];

const browser = await chromium.launch();
for (const { file, size, art } of outputs) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${art}`);
  await page.screenshot({ path: file, omitBackground: true });
  await page.close();
  console.log(file);
}
await browser.close();
