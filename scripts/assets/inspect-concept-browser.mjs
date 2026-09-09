import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const server = await createServer({ root: process.cwd(), cacheDir: '/tmp/leonida-concept-vite-check', optimizeDeps: { force: true }, server: { host: '127.0.0.1', port: 4184, strictPort: true } });
await server.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-gpu'] });
const errors = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:4184/scripts/world/export.html');
  const report = await page.evaluate(async () => (await import('/scripts/assets/inspect-concept-browser.ts')).inspectConcept());
  await writeFile('docs/evidence/concept-materials-cpu.json', JSON.stringify({ errors, ...report }, null, 2));
  assert.equal(report.mutableMaterialsIndependent, true);
  assert.ok(report.materials.length > 15 && report.sharedTextureCount > 10);
  assert.equal(report.lights, 4);
  assert.equal(report.doors, 2);
  assert.deepEqual(report.repeatedCreateRemove.after, report.repeatedCreateRemove.before);
  assert.ok(report.materials.flatMap(m => m.textures).every(t => t.ready));
  assert.equal(errors.length, 0);
  await writeFile('docs/evidence/concept-materials-cpu.json', JSON.stringify({ errors, ...report }, null, 2));
  console.log(JSON.stringify({ errors, meshes: report.meshes, triangles: report.triangles, materials: report.materials.length, sharedTextureCount: report.sharedTextureCount }));
} finally {
  await Promise.race([browser.close(), new Promise(resolve => setTimeout(resolve, 5000))]);
  await server.close();
}
