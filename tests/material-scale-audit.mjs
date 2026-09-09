import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const origin = process.env.AUDIT_URL || 'http://127.0.0.1:4193', backend = process.env.AUDIT_BACKEND || 'webgpu';
const output = `docs/evidence/material-scale-${backend}-${process.env.AUDIT_VARIANT || 'after'}`;
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [], checks = [];
page.on('pageerror', e => errors.push(e.stack || e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
async function capture(label) {
  const s = await page.evaluate(() => {
    const g = window.__leonida.game, V = g.player.position.constructor;
    const surfaces = [], diagnostics = [];
    for (const mesh of g.scene.meshes) {
      if (!['world/asphalt', 'world/sand'].includes(mesh.material?.name) || !mesh.isEnabled()) continue;
      const p = mesh.getVerticesData('position'), n = mesh.getVerticesData('normal'), uv = mesh.getVerticesData('uv'), indices = mesh.getIndices(), world = mesh.computeWorldMatrix(true), scale = mesh.material.albedoTexture;
      diagnostics.push({ mesh: mesh.name, material: mesh.material.name, positions: p?.length, normals: n?.length, uvs: uv?.length, indices: indices?.length, sampleNormals: n?.slice(0,24), scaleU: scale?.uScale, scaleV: scale?.vScale });
      if (!p || !n || !uv || !indices) continue;
      let minimum = Infinity, maximum = 0, edges = 0;
      for (let k = 0; k < indices.length; k += 3) {
        const triangle = [indices[k], indices[k + 1], indices[k + 2]];
        if (!triangle.every(i => n[i * 3 + 1] > 0 && n[i * 3 + 1] > Math.abs(n[i * 3]) + Math.abs(n[i * 3 + 2]))) continue;
        for (let edge = 0; edge < 3; edge++) {
          const a = triangle[edge], b = triangle[(edge + 1) % 3];
          const distance = V.Distance(V.TransformCoordinates(V.FromArray(p, a * 3), world), V.TransformCoordinates(V.FromArray(p, b * 3), world));
          const texels = Math.hypot((uv[a * 2] - uv[b * 2]) * scale.uScale, (uv[a * 2 + 1] - uv[b * 2 + 1]) * scale.vScale);
          if (distance < .0001 || texels < .0001) continue;
          minimum = Math.min(minimum, distance / texels); maximum = Math.max(maximum, distance / texels); edges++;
        }
      }
      if (edges) surfaces.push({ mesh: mesh.name, material: mesh.material.name, minimumMetresPerTile: minimum, maximumMetresPerTile: maximum, edges });
    }
    const { frameTimes, ...snapshot } = window.__leonida.snapshot();
    return { ...snapshot, surfaces, diagnostics, available: g.scene.meshes.filter(m => /asphalt|sand/.test(m.material?.name ?? m.name)).map(m => ({name:m.name, material:m.material?.name, enabled:m.isEnabled(), vertices:m.getTotalVertices()})) };
  });
  checks.push({ label, ...s }); await page.screenshot({ path: `${output}/${label}.png` });
  if (process.env.AUDIT_VARIANT !== 'before') for (const surface of s.surfaces) {
    const expected = surface.material === 'world/asphalt' ? .75 : .5;
    assert.ok(Math.abs(surface.minimumMetresPerTile - expected) < .001 && Math.abs(surface.maximumMetresPerTile - expected) < .001, JSON.stringify(surface));
  }
  return s;
}
try {
  await page.goto(`${origin}/?backend=${backend}&test`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-action="play"]').waitFor({ state: 'visible', timeout: 120000 });
  const manifestBytes = Buffer.from(await (await fetch(`${origin}/world/manifest.json`)).arrayBuffer());
  checks.push({ label: 'build', module: await page.locator('script[type="module"]').getAttribute('src'), browser: browser.version(), worldManifest: { build: JSON.parse(manifestBytes).build, sha256: createHash('sha256').update(manifestBytes).digest('hex') } });
  await page.locator('[data-action="play"]').click(); await page.waitForTimeout(1600);
  const street = await capture('street'); assert.ok(street.surfaces.some(s => s.material === 'world/asphalt'));
  const destination = await page.evaluate(() => window.__leonida.game.world.locations.filter(l => /beach/i.test(l.name + l.type)).sort((a, b) => Math.abs(a.x - 180) - Math.abs(b.x - 180))[0]?.id);
  assert.ok(destination, 'normal beach destination exists');
  await page.keyboard.press('m'); await page.locator(`[data-action="teleport"][data-value="${destination}"]`).click();
  await page.waitForFunction(() => !window.__leonida.snapshot().streamingBusy); await page.waitForTimeout(1500);
  const beach = await capture('beach'); assert.ok(beach.surfaces.some(s => s.material === 'world/sand'));
  assert.equal(errors.length, 0);
} catch (e) { errors.push(e.stack || String(e)); }
finally { await writeFile(`${output}/result.json`, JSON.stringify({ origin, backend, method: 'Normal fresh launch and map fast travel; screenshots and read-only actual loaded GPU-mesh UV metrics.', checks, errors }, null, 2)); await browser.close(); console.log(JSON.stringify({ checks: checks.length, errors })); if (errors.length) process.exitCode = 1; }
