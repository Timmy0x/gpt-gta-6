import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const directory = 'docs/evidence/sky'; await mkdir(directory, { recursive: true });
const server = await createServer({ configFile: false, cacheDir: '.local-builds/sky-vite-cache', server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/.local-builds/**', '**/docs/evidence/**'] } }, optimizeDeps: { include: ['@babylonjs/core', '@babylonjs/materials/sky/skyMaterial.js'] } });
await server.listen();
const origin = server.resolvedUrls.local[0];
const errors = [], checks = [];
let browser;
try {
  for (const backend of ['webgpu', 'webgl']) {
    browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu'] });
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    page.on('pageerror', error => errors.push({ backend, message: error.stack || error.message }));
    page.on('console', message => { if (message.type() === 'error') errors.push({ backend, message: message.text() }); });
    await page.goto(`${origin}scripts/sky/preview.html?backend=${backend}`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => !!window.skyStudy, {}, { timeout: 120000 });
    for (const [label, time, weather, view] of [['day', 12, 'Clear', 'sunset'], ['sunset', 17.8, 'Clear', 'sunset'], ['twilight', 18.5, 'Clear', 'sunset'], ['night', 23, 'Clear', 'sunset'], ['haze', 15, 'Haze', 'sunset'], ['rain', 15, 'Rain', 'sunset'], ['solar-disk', 16, 'Clear', 'sun']]) {
      const state = await page.evaluate(({ time, weather, view }) => window.skyStudy.show(time, weather, view), { time, weather, view });
      await page.waitForTimeout(700); const snapshot = await page.evaluate(() => window.skyStudy.snapshot());
      await page.screenshot({ path: `${directory}/${backend}-${label}.png` });
      checks.push({ backend, label, ...state, ...snapshot }); console.log(backend, label, JSON.stringify(snapshot));
      assert.equal(snapshot.backend, backend === 'webgpu' ? 'WebGPU' : 'WebGL2');
    }
    await browser.close(); browser = undefined;
  }
} catch (error) { errors.push({ message: error.stack || String(error) }); }
finally {
  await browser?.close(); await server.close();
  await writeFile(`${directory}/result.json`, JSON.stringify({ method: 'Isolated procedural sky/scale-reference preview, using the production Sky module. Does not establish integrated game performance or geographic fidelity.', resolution: [1600, 900], checks, errors }, null, 2));
  console.log('RESULT', JSON.stringify({ stages: checks.length, errors })); if (errors.length) process.exitCode = 1;
}
