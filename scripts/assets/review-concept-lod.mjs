import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
const provenance = JSON.parse(await readFile('public/vehicles/concept/lod-provenance.json'));
const batching = JSON.parse(await readFile('public/vehicles/concept/lod-batching.json'));
const output = 'docs/evidence/concept-lod'; await mkdir(output, { recursive: true });
const server = await createServer({ root: process.cwd(), server: { host: '127.0.0.1', port: 4192, strictPort: true } });
await server.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [], comparisons = [];
try {
  const page = await browser.newPage({ viewport: { width: 1520, height: 900 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.routeWebSocket('**', socket => socket.close());
  await page.goto('http://127.0.0.1:4192/scripts/world/export.html');
  const reports = await page.evaluate(async () => { window.lodReview = await (await import('/scripts/assets/review-concept-lod.ts')).createLODReview(); return window.lodReview.reports; });
  for (const report of reports) {
    assert.equal(report.wheels, 4); assert.equal(report.doors, 2); assert.equal(report.windows, 6); assert.equal(report.lamps, 4); assert.equal(report.covers, 2);
  }
  assert.equal(reports[0].triangles, provenance.source.triangles);
  assert.equal(reports[1].triangles, provenance.output.triangles);
  assert.equal(reports[2].triangles, provenance.output.triangles);
  const viewpoints = await page.evaluate(() => window.lodReview.viewpoints);
  for (const view of viewpoints) for (let index = 0; index < 3; index++) {
    const difference = await page.evaluate(async ({ index, view }) => window.lodReview.capture(index, view), { index, view });
    await page.screenshot({ path: `${output}/${view}-${['original', 'lod', 'batched'][index]}.png` });
    comparisons.push({ view, asset: reports[index].path, ...difference });
  }
  assert.equal(errors.length, 0);
  const result = { scope: 'Fixed-camera WebGL2 offline visual fixture using the current ConceptCar adapter. Pinned source/simplified/game asset descriptors use production integrity validation without a test-server transform. Actual movement, damage, save/load and performance require separate integration checks.', reports, comparisons, errors };
  await writeFile(`${output}/report.json`, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
} finally { await Promise.race([browser.close(), new Promise(resolve => setTimeout(resolve, 5000))]); await server.close(); }
