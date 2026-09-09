import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const backend = process.argv[2] || 'webgpu';
const prefix = `docs/evidence/concept-${backend}${process.env.AUDIT_SUFFIX || ''}`;
const url = process.env.AUDIT_URL || 'http://127.0.0.1:4177';
const html = await (await fetch(url)).text();
const buildFingerprint = await Promise.all([...html.matchAll(/src="([^"]+\.js)"/g)].map(async match => { const bytes = Buffer.from(await (await fetch(new URL(match[1], url))).arrayBuffer()); return { url:match[1], sha256:createHash('sha256').update(bytes).digest('hex') }; }));
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu','--disable-background-timer-throttling','--disable-renderer-backgrounding'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.setDefaultTimeout(15000);
const errors = [], expectedErrors = [], checks = [], assetRequests = [];
let injecting = false;
page.on('pageerror', e => errors.push(e.stack || e.message));
page.on('console', m => { if (m.type() === 'error') (injecting && /503|Vehicle loading failed/.test(m.text()) ? expectedErrors : errors).push(m.text()); });
page.on('request', request => { if (request.url().includes('/vehicles/concept/')) assetRequests.push(request.url()); });
const state = () => page.evaluate(() => {
  const g = window.__leonida.game, { frameTimes, ...snapshot } = window.__leonida.snapshot();
  return { ...snapshot, beams: g.vehicles.equipment.beams.filter(b => b.isEnabled()).map(b => b.position.asArray()), cars: g.vehicles.list.filter(v => v.kind === 'concept').map(v => ({ saved: g.vehicles.serialize(v), headlights: v.model.lights.filter(m => m.name.startsWith('headlight-') && m.isEnabled()).map(m => m.getAbsolutePosition().asArray()), doors: v.model.doors.map(d => ({ angle: d.angle, enabled: d.mesh.isEnabled() })), meshes: v.root.getChildMeshes().length, paint: v.model.materials.filter(m => m.name.startsWith('paint-')).map(m => m.albedoColor.toHexString()), materials: v.model.materials.length })) };
});
async function capture(name) { const snapshot = await state(); checks.push({ name, ...snapshot }); await page.screenshot({ path: `${prefix}-${name}.png` }); console.log(name, JSON.stringify({ vehicle: snapshot.vehicle, cars: snapshot.cars.map(c => ({ id: c.saved.id, health: c.saved.health, meshes: c.meshes })), errors: errors.length })); return snapshot; }
async function panel(key = 'F2') { await page.keyboard.press(key); await page.locator('#panel:not(.hidden)').waitFor(); }
async function close() { await page.locator('[data-action="close"]').first().click(); }
async function ready() { await page.waitForFunction(() => !window.__leonida.snapshot().streamingBusy, {}, { timeout: 45000 }); }
async function travel(id) { await panel('m'); await page.locator(`[data-action="teleport"][data-value="${id}"]`).click(); await ready(); }
async function enter() { await page.keyboard.down('w'); await page.waitForTimeout(750); await page.keyboard.up('w'); await page.keyboard.press('e'); await page.waitForFunction(() => window.__leonida.snapshot().vehicle?.kind === 'concept'); }
try {
  injecting = true;
  await page.route('**/vehicles/concept/car-lod1-batched.glb', route => route.fulfill({ status: 503, body: 'Deliberate asset-load failure' }));
  await page.goto(`${url}/?backend=${backend}&test`, { waitUntil: 'networkidle' });
  await page.locator('#welcome:not(.hidden)').waitFor({ timeout: 120000 });
  assert.equal(assetRequests.length, 1, 'fresh startup attempts the shared detailed-car asset once');
  assert.equal((await state()).cars.length, 0, 'failed startup keeps playable procedural cars');
  await capture('startup-asset-fallback');
  await page.locator('[data-action="play"]').click();
  await panel();
  await page.locator('[data-change="god"]').check(); await page.locator('[data-change="police"]').uncheck();
  for (const name of ['peds','traffic']) { await page.locator(`[data-change="${name}"]`).fill('0'); await page.locator(`[data-change="${name}"]`).dispatchEvent('change'); }
  await page.locator('[data-change="time"]').fill('15'); await page.locator('[data-change="time"]').dispatchEvent('change');
  await close(); await travel('race'); await panel();
  await page.locator('#spawn-kind').selectOption('concept');
  injecting = true;
  await page.locator('[data-action="spawn"]').click();
  await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('could not load'));
  await ready(); assert.equal((await state()).cars.length, 0);
  await capture('failed-load-preserves-game');
  await page.unroute('**/vehicles/concept/car-lod1-batched.glb'); injecting = false;
  await page.locator('[data-action="spawn"]').click(); await ready();
  await page.waitForFunction(() => window.__leonida.game.vehicles.list.some(v => v.kind === 'concept'));
  await close(); await page.waitForTimeout(1800); await capture('spawned');
  await enter(); await page.waitForTimeout(200); await capture('entry-door');
  await page.waitForTimeout(1000); let s = await capture('seated-jason');
  assert.ok(s.cars[0].meshes > 87); // Includes the seated character's visible mesh.
  await page.keyboard.press('Tab'); await page.waitForTimeout(300); await capture('seated-lucia');
  await page.keyboard.down('w'); await page.waitForTimeout(3300); await page.keyboard.up('w');
  s = await capture('driving'); assert.ok(s.vehicle.speed > 10);
  await page.keyboard.down('Space'); await page.keyboard.down('s');
  await page.waitForFunction(() => Math.abs(window.__leonida.snapshot().vehicle.speed) < 1);
  await page.keyboard.up('s'); await page.keyboard.up('Space');
  await panel(); await page.locator('[data-change="time"]').fill('23'); await page.locator('[data-change="time"]').dispatchEvent('change'); await close();
  await page.waitForTimeout(1300); s = await capture('night-headlights');
  assert.equal(s.cars[0].headlights.filter(lamp => s.beams.some(beam => Math.hypot(...lamp.map((n,i) => n-beam[i])) < .1)).length, 2, 'both occupied-car headlamps receive beams');
  await page.keyboard.press('l'); await page.waitForFunction(() => window.__leonida.game.player.vehicle.headlights === false); await capture('night-lights-off');
  await page.keyboard.press('l'); await page.waitForFunction(() => window.__leonida.game.player.vehicle.headlights === true);
  await panel(); await page.locator('[data-change="time"]').fill('15'); await page.locator('[data-change="time"]').dispatchEvent('change'); await close();
  const target = await page.evaluate(() => {
    const g = window.__leonida.game, p = g.player.vehicle.root.position;
    const target = [...g.world.obstacles].filter(o => o.height > 4 && o.w > 10 && o.d > 10 && o.z > p.z + 12 && Math.abs(o.x - p.x) > 18).sort((a,b) => Math.hypot(a.x-p.x,a.z-p.z)-Math.hypot(b.x-p.x,b.z-p.z))[0];
    return target ? { x: target.x, z: target.z } : null;
  });
  assert.ok(target, 'a nearby solid building is available for a real driving impact');
  const end = Date.now() + 20000;
  while (Date.now() < end && (await state()).vehicle.health > 94) {
    const v = await page.evaluate(() => { const v = window.__leonida.game.player.vehicle; return { x:v.root.position.x,z:v.root.position.z,heading:v.heading }; });
    const error = Math.atan2(Math.sin(Math.atan2(target.x-v.x,target.z-v.z)-v.heading),Math.cos(Math.atan2(target.x-v.x,target.z-v.z)-v.heading));
    await page.keyboard.down('w');
    if (error > .07) { await page.keyboard.up('a'); await page.keyboard.down('d'); } else if (error < -.07) { await page.keyboard.up('d'); await page.keyboard.down('a'); } else { await page.keyboard.up('a'); await page.keyboard.up('d'); }
    await page.waitForTimeout(150);
  }
  for (const key of ['w','a','d']) await page.keyboard.up(key);
  s = await capture('physical-crash');
  assert.ok(s.vehicle.health < 95); assert.ok(s.cars[0].saved.damage.deformation.some(n => Math.abs(n) > .001));
  await panel(); await page.locator('[data-action="save"]').click();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('leonida.sandbox.v1')).vehicles.find(v => v.kind === 'concept'));
  await page.locator('[data-action="repair"]').click();
  assert.ok((await state()).cars[0].saved.damage.deformation.every(n => n === 0));
  await page.locator('[data-action="load"]').click(); await ready(); await close();
  s = await capture('damage-save-restored');
  assert.deepEqual(s.cars.find(c => c.saved.id === saved.id).saved.damage, saved.damage);
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('#welcome:not(.hidden)').waitFor({ timeout: 120000 });
  await page.locator('[data-action="continue"]').click(); await page.locator('#hud:not(.hidden)').waitFor({ state: 'attached', timeout: 60000 });
  await page.locator('#welcome').waitFor({ state: 'hidden' });
  await ready();
  s = await capture('fresh-continue'); assert.deepEqual(s.cars.find(c => c.saved.id === saved.id).saved.damage, saved.damage);
  await travel('garage'); await panel(); await page.locator('#spawn-kind').selectOption('concept'); await page.locator('[data-action="spawn"]').click(); await ready(); await close();
  await enter(); await page.waitForTimeout(1000); await page.keyboard.press('e');
  await page.locator('#paint-color').waitFor(); await page.locator('#paint-color').selectOption('#BA283B'); await page.locator('[data-action="garage-paint"]').click();
  s = await capture('garage-paint'); assert.ok(s.cars.some(c => c.saved.paint === '#BA283B')); assert.equal(s.cash, 12425);
  await page.locator('[data-action="garage-exit"]').click();
  await page.keyboard.press('Escape'); await page.locator('[data-action="credits"]').click();
  assert.match(await page.locator('#panel').textContent(), /Eric Chadwick/); await capture('credits');
  assert.equal(errors.length, 0);
} catch (error) { errors.push(error.stack || String(error)); console.error(error); await page.screenshot({ path:`${prefix}-failure.png` }).catch(()=>{}); }
await fs.writeFile(`${prefix}.json`, JSON.stringify({ backend, url, buildFingerprint, method:'Normal keyboard/mouse/UI mutations; read-only game diagnostics and building selection for closed-loop driving.',errors,expectedErrors,assetRequests,checks },null,2));
console.log('RESULT',JSON.stringify({backend,errors,checks:checks.length,assetRequests:assetRequests.length}));
await Promise.race([browser.close(),new Promise(resolve=>setTimeout(resolve,5000))]);
process.exit(errors.length ? 1 : 0);
