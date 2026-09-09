import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const server = await createServer({ root: process.cwd(), server: { host: '127.0.0.1', port: 4186, strictPort: true } });
await server.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu'] });
const backend = process.argv[2] || 'webgpu';
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.routeWebSocket('**', socket => socket.close());
try {
  await page.goto(`http://127.0.0.1:4186/?backend=${backend}&test`);
  await page.locator('#welcome:not(.hidden)').waitFor({ timeout: 120000 });
  await page.locator('[data-action="play"]').click();
  await page.keyboard.press('m'); await page.locator('[data-action="teleport"][data-value="race"]').click();
  await page.waitForFunction(() => !window.__leonida.snapshot().streamingBusy);
  await page.keyboard.press('F2');
  await page.locator('[data-change="god"]').check(); await page.locator('[data-change="police"]').uncheck();
  await page.locator('#spawn-kind').selectOption('concept'); await page.locator('[data-action="spawn"]').click();
  await page.waitForFunction(() => window.__leonida.game.vehicles.list.some(v => v.kind === 'concept'));
  await page.locator('[data-action="close"]').click(); await page.waitForTimeout(1500);
  await page.keyboard.press('Escape');
  await page.screenshot({ path: `docs/evidence/lighting-${backend}-before.png` });
  const loaded = await page.evaluate(async () => (await import('/src/core/EnvironmentLighting.ts')).prepareEnvironmentLighting(window.__leonida.game.scene));
  assert.equal(loaded, true);
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `docs/evidence/lighting-${backend}-after.png` });
  await page.evaluate(() => { const config = window.__leonida.game.scene.imageProcessingConfiguration; config.toneMappingType = 1; config.exposure = 1; config.contrast = 1; });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `docs/evidence/lighting-${backend}-aces.png` });
  const report = await page.evaluate(() => { const g = window.__leonida.game, t = g.scene.environmentTexture; return { texture: t.name, ready: t.isReady(), size: t.getSize(), polynomial: !!t.sphericalPolynomial, backend: window.__leonida.snapshot().backend }; });
  assert.equal(report.ready, true); assert.equal(report.size.width, 256); assert.ok(report.polynomial); assert.equal(errors.length, 0);
  await writeFile(`docs/evidence/lighting-${backend}.json`, JSON.stringify({ errors, scope: 'Normal launch and car spawn; experimental environment replacement through a test-only module import. Static comparison, not a performance benchmark.', ...report }, null, 2));
  console.log(JSON.stringify(report));
} catch (error) { await page.screenshot({ path: `docs/evidence/lighting-${backend}-failure.png` }); throw error; }
finally { await browser.close(); await server.close(); }
