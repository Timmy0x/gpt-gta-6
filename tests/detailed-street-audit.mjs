import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const backend = process.env.AUDIT_BACKEND || 'webgpu', origin = process.env.AUDIT_URL || 'http://127.0.0.1:4189';
const output = `docs/evidence/detailed-street-${backend}${process.env.AUDIT_SUFFIX || ""}`;
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--disable-background-timer-throttling'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [], checks = [], requests = [];
page.on('pageerror', e => errors.push(e.stack || e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('request', r => { if (r.url().includes('/vehicles/concept/')) requests.push(r.url()); });
async function state() {
  return page.evaluate(() => {
    const g = window.__leonida.game, { frameTimes, ...snapshot } = window.__leonida.snapshot();
    return { ...snapshot, cars: g.vehicles.list.filter(v => v.kind === 'concept').map(v => ({ id: v.id, position: v.root.position.asArray(), health: v.health, speed: v.speed, ambient: g.population.drivers.some(d => d.v === v), owned: !g.population.drivers.some(d => d.v === v), meshes: v.root.getChildMeshes().filter(m => m.getTotalVertices() && !m.skeleton).length, triangles: v.root.getChildMeshes().filter(m => !m.skeleton).reduce((n, m) => n + m.getTotalIndices() / 3, 0), paint: g.vehicles.serialize(v).paint })), toast: document.querySelector('#toast').textContent };
  });
}
async function capture(label) { const s = await state(); checks.push({ label, ...s }); await page.screenshot({ path: `${output}/${label}.png` }); console.log(label, JSON.stringify({ cars: s.cars, vehicle: s.vehicle })); return s; }
try {
  await page.goto(`${origin}/?backend=${backend}&test`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-action="play"]').waitFor({ state: 'visible', timeout: 120000 });
  checks.push({ label: 'build', module: await page.locator('script[type="module"]').getAttribute('src'), browser: browser.version() });
  await page.locator('[data-action="play"]').click(); await page.waitForTimeout(1600);
  let s = await capture('normal-start');
  assert.equal(s.backend, backend === 'webgpu' ? 'WebGPU' : 'WebGL2');
  assert.equal(s.cars.length, 3); assert.equal(s.cars.filter(c => c.ambient).length, 2);
  assert.ok(s.cars.every(c => c.triangles === 61879 && c.meshes === 79));
  assert.equal(requests.length, 1, 'starter and traffic share one verified asset download');
  const starter = s.cars.find(c => c.owned), initialTraffic = s.cars.filter(c => c.ambient);
  await page.keyboard.down('w'); await page.waitForTimeout(600); await page.keyboard.up('w'); await page.keyboard.press('e');
  await page.waitForFunction(() => window.__leonida.snapshot().vehicle?.kind === 'concept');
  await page.waitForTimeout(1000); await capture('starter-seated');
  await page.keyboard.press('Tab'); await page.waitForTimeout(500); s = await capture('lucia-seated'); assert.equal(s.character, 'Lucia');
  await page.keyboard.down('w'); await page.waitForTimeout(3300); await page.keyboard.up('w'); s = await capture('starter-driving');
  assert.ok(s.vehicle.speed > 10); assert.ok(Math.hypot(...s.cars.find(c => c.id === starter.id).position.map((n, i) => n - starter.position[i])) > 15);
  assert.ok(initialTraffic.some(c => { const next = s.cars.find(v => v.id === c.id); return Math.hypot(...next.position.map((n, i) => n - c.position[i])) > 1; }), 'detailed traffic is physically moving on the road network');
  await page.keyboard.down('s'); await page.keyboard.down('Space'); await page.waitForFunction(() => Math.abs(window.__leonida.snapshot().vehicle.speed) < .7);
  await page.keyboard.up('s'); await page.keyboard.up('Space'); await page.keyboard.press('e'); await page.waitForTimeout(700); s = await capture('starter-exit'); assert.equal(s.vehicle, null);
  const parked = s.cars.find(c => c.id === starter.id).position;
  await page.waitForTimeout(2200); s = await capture('starter-parked');
  const stopped = s.cars.find(c => c.id === starter.id);
  assert.ok(stopped.speed < .1 && Math.hypot(...stopped.position.map((n, i) => n - parked[i])) < .25, 'exiting clears latent powered throttle and parks the car');
  await page.keyboard.press('F2'); await page.locator('#spawn-kind').selectOption('concept');
  for (let expected = 4; expected <= 6; expected++) {
    await page.locator('[data-action="spawn"]').click();
    await page.waitForFunction(n => window.__leonida.game.vehicles.list.filter(v => v.kind === 'concept').length === n, expected, { timeout: 15000 });
  }
  const before = (await state()).cars.map(c => c.id);
  await page.locator('[data-action="spawn"]').click(); s = await capture('six-car-budget'); assert.deepEqual(s.cars.map(c => c.id), before); assert.match(s.toast, /Six detailed cars/);
  await page.locator('[data-action="save"]').click();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('leonida.sandbox.v1')));
  assert.equal(saved.vehicles.filter(v => v.kind === 'concept').length, 4);
  await page.locator('[data-action="load"]').click(); await page.waitForFunction(() => !window.__leonida.snapshot().streamingBusy);
  s = await capture('saved-cars-restored'); assert.equal(s.cars.length, 6);
  assert.deepEqual(s.cars.filter(c => c.owned).map(c => c.id).sort(), saved.vehicles.filter(v => v.kind === 'concept').map(v => v.id).sort());
  // A separate valid-save fixture covers six owned cars displacing two ambient cars.
  // These are deliberate storage mutations; the earlier play/spawn/save stages use normal controls.
  await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('leonida.sandbox.v1'));
    const source = saved.vehicles.find(v => v.kind === 'concept');
    for (let i = 0; i < 2; i++) {
      const copy = structuredClone(source); copy.id = `vehicle-${900000 + i}`;
      copy.x += 14 + i * 5; copy.z += 20;
      saved.vehicles.push(copy);
    }
    localStorage.setItem('leonida.sandbox.v1', JSON.stringify(saved));
  });
  await page.locator('[data-action="load"]').click(); await page.waitForFunction(() => !window.__leonida.snapshot().streamingBusy);
  s = await capture('six-owned-save-fixture');
  assert.equal(s.cars.length, 6); assert.ok(s.cars.every(c => c.owned), 'owned save cars replace surplus detailed traffic');
  assert.equal(errors.length, 0);
} catch (e) { errors.push(e.stack || String(e)); await page.screenshot({ path: `${output}/failure.png` }).catch(() => {}); }
finally { await writeFile(`${output}/result.json`, JSON.stringify({ origin, backend, method: 'Normal fresh launch, keyboard entry/switch/driving/braking/exit, Sandbox spawn limit and save/load. Game hooks read diagnostics only. The final six-owned-save stage deliberately adds two valid vehicle records to browser storage, then uses the normal Load button to verify the shared budget.', requests, checks, errors }, null, 2)); await browser.close(); console.log('RESULT', JSON.stringify({ checks: checks.length, errors })); if (errors.length) process.exitCode = 1; }
