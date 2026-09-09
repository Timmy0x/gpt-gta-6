import { chromium } from '@playwright/test';
import { build, preview } from 'vite';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const directory = `docs/evidence/ocean-${process.env.AUDIT_VARIANT || 'candidate'}`; await mkdir(directory, { recursive: true });
const outDir = process.env.AUDIT_FROZEN_DIR || `.local-builds/ocean-preview-${process.env.AUDIT_VARIANT || 'candidate'}`;
if (!process.env.AUDIT_FROZEN_DIR) {
  await build({ configFile: false, publicDir: false, build: { outDir, emptyOutDir: true, rollupOptions: { input: 'scripts/ocean/preview.html' } } });
  await mkdir(`${outDir}/surfaces/dense_sand`, { recursive: true }); await copyFile('public/surfaces/dense_sand/color.jpg', `${outDir}/surfaces/dense_sand/color.jpg`);
}
if (process.env.AUDIT_BUILD_ONLY) { console.log('FROZEN', outDir); process.exit(0); }
const server = await preview({ configFile: false, build: { outDir }, preview: { host: '127.0.0.1', port: 0 } });
const origin = server.resolvedUrls.local[0]; const errors = [], checks = []; let browser;
try {
  for (const backend of (process.env.AUDIT_BACKEND ? [process.env.AUDIT_BACKEND] : ['webgpu', 'webgl'])) {
    browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu'] }); const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    page.on('pageerror', error => errors.push({ backend, message: error.stack || error.message })); page.on('console', message => { if (message.type() === 'error') errors.push({ backend, message: message.text() }); });
    await page.goto(`${origin}scripts/ocean/preview.html?backend=${backend}`, { waitUntil: 'networkidle' }); await page.waitForFunction(() => !!window.oceanStudy, {}, { timeout: 120000 });
    const stages = [['shore', 12, 'Clear', 'shore'], ['shallows', 12, 'Clear', 'shallows'], ['ripples', 12, 'Clear', 'surface'], ['reflection', 12, 'Clear', 'reflection'], ['sunset', 17.2, 'Clear', 'reflection'], ['rain', 14, 'Rain', 'shore'], ['night', 23, 'Clear', 'shore'], ['underwater', 12, 'Clear', 'underwater'], ['underwater-up', 12, 'Clear', 'underwater-up'], ['zenith', 12, 'Clear', 'zenith'], ['underwater-shore', 12, 'Clear', 'underwater-shore'], ['deep', 12, 'Clear', 'deep'], ['resurfaced', 12, 'Clear', 'reflection']];
    for (const [label, time, weather, view] of stages.filter(stage => !process.env.AUDIT_VIEWS || process.env.AUDIT_VIEWS.split(',').includes(stage[0]))) {
      await page.evaluate(({ time, weather, view }) => window.oceanStudy.show(time, weather, view), { time, weather, view }); await page.waitForTimeout(1400);
      const snapshot = await page.evaluate(() => window.oceanStudy.snapshot()); await page.screenshot({ path: `${directory}/${backend}-${label}.png` }); checks.push({ backend, label, time, weather, view, ...snapshot }); console.log(backend, label, JSON.stringify(snapshot));
      if (process.env.AUDIT_TARGETS && snapshot.stats.submergedView) {
        const targets = await page.evaluate(() => window.oceanStudy.targetImages());
        for (const [name, base64] of Object.entries(targets)) await writeFile(`${directory}/${backend}-${label}-${name}.png`, Buffer.from(base64, 'base64'));
      }
      assert.equal(snapshot.backend, backend === 'webgpu' ? 'WebGPU' : 'WebGL2'); assert.equal(snapshot.shaderLanguage, backend === 'webgpu' ? 1 : 0); assert.equal(snapshot.effectReady, true); assert.equal(snapshot.physicalWater, -.18); assert.ok(snapshot.stats.reflectionMeshes <= 32 && snapshot.stats.refractionMeshes <= 16);
      if (snapshot.stats.submergedView) { assert.ok(!snapshot.reflection.includes('sky/dome')); assert.ok(snapshot.refraction.includes('sky/dome')); assert.ok(snapshot.reflection.includes('study/continuous-sand-bank')); }
      else { assert.ok(snapshot.reflection.includes('sky/dome')); assert.ok(snapshot.refraction.includes('study/continuous-sand-bank')); }
    }
    await browser.close(); browser = undefined;
  }
} catch (error) { errors.push({ message: error.stack || String(error) }); }
finally { await browser?.close(); await new Promise(resolve => server.httpServer.close(resolve)); await writeFile(`${directory}/result.json`, JSON.stringify({ outDir, method: 'Frozen production build of isolated native Ocean+Sky material preview with scale geometry, sloping sand bank and bounded reflection/refraction lists. Not normal gameplay or integrated performance evidence.', checks, errors }, null, 2)); console.log('RESULT', JSON.stringify({ stages: checks.length, errors })); if (errors.length) process.exitCode = 1; }
