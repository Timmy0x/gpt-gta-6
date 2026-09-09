import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const origin = process.env.AUDIT_URL || 'http://127.0.0.1:4202', backend = process.env.AUDIT_BACKEND || 'webgpu';
const output = `docs/evidence/coast-gameplay-${backend}${process.env.AUDIT_SUFFIX || ''}`;
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } }), checks = [], errors = [], warnings = [];
page.on('pageerror', e => errors.push(e.stack || e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); if (m.type() === 'warning') warnings.push(m.text()); });
const state = () => page.evaluate(() => {
  const g = window.__leonida.game, { frameTimes, ...snapshot } = window.__leonida.snapshot(), p = g.player;
  return { ...snapshot, position: p.position.asArray(), camera: p.camera.position.asArray(), swimming: p.swimming, submerged: p.swim.submerged, breath: p.swim.breath, waterLevel: g.world.waterLevel, depth: g.world.ocean.depthAt(p.position.x, p.position.z), ocean: g.world.ocean.stats, fog: { density: g.scene.fogDensity, color: g.scene.fogColor.asArray() }, roadNodes: g.world.roads.length, newLocals: g.population.pedestrians.filter(ped => ped.id.startsWith('inner-')).map(ped => ({ id: ped.id, active: ped.model.root.isEnabled(), position: ped.model.root.position.asArray() })) };
});
async function capture(label) { const s = await state(); checks.push({ label, ...s }); await page.screenshot({ path: `${output}/${label}.png` }); console.log(label, JSON.stringify({ position: s.position, swimming: s.swimming, submerged: s.submerged, breath: s.breath, depth: s.depth, ocean: s.ocean })); return s; }
async function travel(id) { await page.keyboard.press('m'); await page.locator(`[data-action="teleport"][data-value="${id}"]`).click(); await page.waitForFunction(() => !window.__leonida.snapshot().streamingBusy); await page.waitForTimeout(1800); }
async function moveUntil(key, predicate, timeout = 60000) { await page.keyboard.down(key); try { await page.waitForFunction(predicate, null, { timeout }); } finally { await page.keyboard.up(key); } }
try {
  await page.goto(`${origin}/?backend=${backend}&test`, { waitUntil: 'domcontentloaded' }); await page.locator('[data-action="play"]').waitFor({ state: 'visible', timeout: 120000 });
  const module = await page.locator('script[type="module"]').getAttribute('src');
  checks.push({ label: 'build', module, sha256: createHash('sha256').update(Buffer.from(await (await fetch(new URL(module, origin))).arrayBuffer())).digest('hex'), world: (await (await fetch(`${origin}/world/manifest.json`)).json()).build, browser: browser.version() });
  await page.locator('[data-action="play"]').click(); await page.waitForTimeout(1600); assert.equal((await state()).backend, backend === 'webgpu' ? 'WebGPU' : 'WebGL2');
  await page.keyboard.press('F2'); await page.locator('[data-change="police"]').uncheck(); await page.locator('[data-action="close"]').click();
  await travel('ocean-beach'); let s = await capture('dry-beach'); assert.equal(s.swimming, false);
  await moveUntil('d', () => window.__leonida.game.player.swimming); s = await capture('shoreline-swim-entry'); assert.ok(s.depth > 1);
  await moveUntil('d', () => window.__leonida.game.player.position.x > 258); await page.waitForTimeout(1000); s = await capture('floating-offshore'); assert.ok(Math.abs(s.position[1] - (s.waterLevel - .45)) < .2);
  await page.keyboard.down('c'); await page.waitForTimeout(2500); await page.keyboard.up('c'); await page.waitForTimeout(800); s = await capture('underwater'); assert.equal(s.submerged, true); assert.ok(s.breath < 30); assert.ok(s.fog.density > .05, 'camera actually enters underwater atmosphere');
  await moveUntil('Space', () => !window.__leonida.game.player.swim.submerged, 10000); await page.waitForTimeout(1800); s = await capture('surfaced'); assert.equal(s.submerged, false);
  await moveUntil('a', () => window.__leonida.game.player.position.x < 208); await page.waitForTimeout(1000); s = await capture('walked-ashore'); assert.equal(s.swimming, false); assert.ok(s.position[1] > .7);
  await travel('inner-mercado-luna'); s = await capture('western-market'); assert.equal(s.roadNodes, 772); assert.ok(s.newLocals.some(p => p.active));
  await page.keyboard.down('w'); await page.waitForTimeout(2200); await page.keyboard.up('w'); await capture('market-walk');
  await travel('inner-cafe-lucero'); await capture('western-cafe'); await travel('inner-west-gardens'); await capture('western-gardens');
  await page.keyboard.press('F2'); await page.locator('[data-action="save"]').click(); await page.locator('[data-action="close"]').click(); await travel('ocean-beach'); await capture('return-coast');
  await page.keyboard.press('F2'); await page.locator('[data-action="load"]').click(); await page.locator('[data-action="close"]').click(); await page.waitForTimeout(2000); s = await capture('western-save-restored'); assert.ok(s.position[0] < -900);
} catch (e) { errors.push(e.stack || String(e)); await page.screenshot({ path: `${output}/failure.png` }).catch(() => {}); }
finally { await writeFile(`${output}/result.json`, JSON.stringify({ origin, backend, method: 'Normal map fast travel, keyboard beach traversal/swimming/diving/surfacing, western walking and normal save/load. Diagnostics read only; no game state hooks.', checks, errors, warnings }, null, 2)); await browser.close(); console.log(JSON.stringify({ checks: checks.length, errors, warnings })); if (errors.length) process.exitCode = 1; }
