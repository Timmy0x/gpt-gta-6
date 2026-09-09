import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { MapViewport } from '../src/ui/MapViewport.ts';
const origin = process.env.AUDIT_URL || 'http://127.0.0.1:4204', backend = process.env.AUDIT_BACKEND || 'webgpu';
const output = `docs/evidence/map-travel-${backend}${process.env.AUDIT_SUFFIX || '-v13'}`;
await mkdir(output, {recursive: true});
const browser = await chromium.launch({channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--disable-background-timer-throttling', '--disable-renderer-backgrounding']});
const page = await browser.newPage({viewport: {width: 1600, height: 900}}), checks = [], errors = [], warnings = [];
page.on('pageerror', error => errors.push(error.stack || error.message)); page.on('console', message => {if (message.type() === 'error') errors.push(message.text()); if (message.type() === 'warning') warnings.push(message.text());});
const state = () => page.evaluate(() => {
  const g = window.__leonida.game, p = g.player;
  return {backend: window.__leonida.snapshot().backend, position: p.position.asArray(), swimming: p.swimming, submerged: p.swim.submerged, clear: p.queries.clear(p.position), physics: p.controller.getVelocity().asArray(), oceanDepth: g.world.ocean.depthAt(p.position.x, p.position.z), streaming: g.world.getStreamingStats(), health: p.health};
});
async function capture(label) {const s = await state(); checks.push({label, ...s}); await page.screenshot({path: `${output}/${label}.png`}); console.log(label, JSON.stringify({position: s.position, clear: s.clear, swimming: s.swimming})); return s;}
async function arrived() {await page.locator('#panel').waitFor({state: 'hidden', timeout: 45000}); await page.waitForFunction(() => !window.__leonida.snapshot().streamingBusy); await page.waitForTimeout(550);}
async function pin(point) {
  await page.keyboard.press('m'); await page.locator('[data-map-command="world"]').click();
  const view = new MapViewport(); view.fit(1000, 620, [], true); const [x, y] = view.screen(point, 1000, 620);
  const box = await page.locator('#bigmap').boundingBox(); assert.ok(box);
  await page.mouse.click(box.x + x / 1000 * box.width, box.y + y / 620 * box.height);
  await page.locator('[data-map-command="travel"]').click(); await arrived();
}
try {
  await page.goto(`${origin}/?backend=${backend}&test`, {waitUntil: 'domcontentloaded'}); await page.locator('[data-action="play"]').waitFor({state: 'visible', timeout: 120000});
  const module = await page.locator('script[type="module"]').getAttribute('src'); checks.push({label: 'build', module, sha256: createHash('sha256').update(Buffer.from(await (await fetch(new URL(module, origin))).arrayBuffer())).digest('hex'), world: (await (await fetch(`${origin}/world/manifest.json`)).json()).build, browser: browser.version()});
  await page.locator('[data-action="play"]').click(); await page.waitForTimeout(900); assert.equal((await state()).backend, backend === 'webgpu' ? 'WebGPU' : 'WebGL2');
  await page.keyboard.press('F2'); await page.locator('[data-change="police"]').uncheck(); await page.locator('[data-action="close"]').click();
  const locations = await page.evaluate(() => window.__leonida.game.world.locations);
  await page.keyboard.press('m'); await capture('district-map');
  await page.locator('#location-search').fill('Mercado Luna'); assert.equal(await page.locator('#locations .location-row:visible').count(), 1); await capture('search-market'); await page.locator('#location-search').fill('');
  await page.locator('[data-map-location="inner-mercado-luna"]').click(); await capture('selected-market');
  await page.locator('[data-map-command="in"]').click(); await page.locator('[data-map-command="out"]').click();
  const canvas = await page.locator('#bigmap').boundingBox();
  await page.mouse.move(canvas.x + canvas.width * .6, canvas.y + canvas.height * .6); await page.mouse.down(); await page.mouse.move(canvas.x + canvas.width * .4, canvas.y + canvas.height * .5, {steps: 8}); await page.mouse.up(); await capture('panned-map');
  await page.locator('[data-map-command="fit"]').click(); await page.locator('[data-action="close"]').click();
  for (const location of locations) {
    await page.keyboard.press('m'); await page.locator(`[data-action="teleport"][data-value="${location.id}"]`).click(); await arrived();
    const s = await capture(`place-${location.id}`);
    assert.ok(Math.hypot(s.position[0] - location.x, s.position[2] - location.z) < 13, `${location.name}: arrives at selected place`);
    assert.ok(s.position.every(Number.isFinite) && s.clear, `${location.name}: standing capsule clears real geometry`);
  }
  for (const [name, point] of [['open-water', {x: 450, z: 120}], ['western-ground', {x: -1140, z: -420}], ['ocean-edge', {x: 2093, z: 0}]]) {
    await pin(point); const s = await capture(name);
    assert.ok(Math.hypot(s.position[0] - point.x, s.position[2] - point.z) < 13, 'map canvas projection selects actual world point');
    assert.equal(s.swimming, point.x > 210); assert.ok(s.clear);
  }
  await page.keyboard.down('d'); await page.waitForTimeout(10000); await page.keyboard.up('d'); let s = await capture('swam-against-world-edge'); assert.ok(s.position[0] <= 2099.67 && s.position[0] > 2093);
  await page.keyboard.down('a'); await page.waitForTimeout(3500); await page.keyboard.up('a'); const returned = await capture('swam-back-from-edge'); assert.ok(returned.position[0] < s.position[0] - 3, 'edge permits returning');
  await page.keyboard.press('m'); await page.locator('[data-map-command="player"]').click(); await page.locator('#bigmap').focus(); await page.keyboard.press('ArrowLeft'); await capture('keyboard-map-selection');
  await page.setViewportSize({width: 900, height: 700}); await capture('compact-map');
} catch (error) {errors.push(error.stack || String(error)); await page.screenshot({path: `${output}/failure.png`}).catch(() => {});}
finally {await page.keyboard.up('d'); await page.keyboard.up('a'); await writeFile(`${output}/result.json`, JSON.stringify({origin, backend, method: 'Normal UI map search, marker selection, zoom/pan, every listed destination, arbitrary canvas travel, keyboard edge swimming and responsive/keyboard map. Read-only diagnostics only.', checks, errors, warnings}, null, 2)); await browser.close(); console.log(JSON.stringify({checks: checks.length, errors, warnings})); if (errors.length) process.exitCode = 1;}
