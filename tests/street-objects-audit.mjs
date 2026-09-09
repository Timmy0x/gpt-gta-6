// Normal controls only. Game diagnostics are read without changing gameplay state.
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { MapViewport } from '../src/ui/MapViewport.ts';
const origin = process.env.AUDIT_URL || 'http://127.0.0.1:4207', backend = process.env.AUDIT_BACKEND || 'webgpu';
const output = process.env.AUDIT_OUTPUT || `docs/evidence/street-objects/normal-v16-${backend}`;
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
console.log(JSON.stringify({ browser: browser.version(), pid: process.pid, backend, origin }));
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const checks = [], errors = [], warnings = [], held = new Set(); let mx = 800, my = 450;
page.on('pageerror', error => errors.push(error.stack || error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); if (message.type() === 'warning') warnings.push(message.text()); });
const distance = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const angle = value => Math.atan2(Math.sin(value), Math.cos(value));
const state = () => page.evaluate(() => {
  const g = window.__leonida.game, p = g.player;
  return { backend: window.__leonida.snapshot().backend, player: p.position.asArray(), yaw: p.yaw, pitch: p.pitch, camera: p.camera.position.asArray(), forward: p.camera.getForwardRay().direction.asArray(), phase: p.vehiclePhase,
    vehicle: p.vehicle && { id: p.vehicle.id, position: p.vehicle.root.position.asArray(), heading: p.vehicle.heading, speed: p.vehicle.speed, health: p.vehicle.health },
    vehicles: g.vehicles.list.map(v => ({ id: v.id, position: v.root.position.asArray(), heading: v.heading, width: v.tuning.width })),
    shots: g.combat.shots, aim: p.aim, facingReady: p.weaponFacingReady, muzzle: g.combat.held.muzzle().asArray(), render: { drawCalls: window.streetDrawCalls, meshes: g.scene.meshes.length, activeMeshes: g.scene.getActiveMeshes().length, geometries: g.scene.geometries.length, bodies: g.scene.getPhysicsEngine().getBodies().length }, stats: g.world.getStreamingStats(), objects: [...g.world.streetObjects.objects.values()].map(o => {
      const trunk = o.definition.shapes[0].position, fraction = (1.5 - .16) / (trunk[1] - .16);
      const aimPoint = o.definition.kind === 'palm' ? [o.definition.position[0] + trunk[0] * fraction, 1.5, o.definition.position[2] + trunk[2] * fraction] : [o.definition.position[0], 1.5, o.definition.position[2]];
      return { id: o.definition.id, kind: o.definition.kind, original: o.definition.position, aimPoint, position: o.position.asArray(), rotation: o.rotation.asArray(), health: o.health, fallen: o.fallen, burning: o.burning, resident: !!o.body, parts: o.parts.size, velocity: o.velocity.asArray() };
    }) };
});
async function capture(label) { const s = await state(); checks.push({ label, ...s }); await page.screenshot({ path: `${output}/${label}.png` }); console.log(JSON.stringify({ label, player: s.player, vehicle: s.vehicle, fallen: s.objects.filter(o => o.fallen), stats: s.stats.streetObjects })); return s; }
async function keys(...next) { const wanted = new Set(next); for (const key of held) if (!wanted.has(key)) { await page.keyboard.up(key); held.delete(key); } for (const key of wanted) if (!held.has(key)) { await page.keyboard.down(key); held.add(key); } }
async function pin(point) {
  await keys(); await page.mouse.up({ button: 'right' }); await page.mouse.up({ button: 'left' });
  await page.keyboard.press('m'); await page.locator('[data-map-command="world"]').click();
  const view = new MapViewport(); view.fit(1000, 620, [], true); const [x, y] = view.screen(point, 1000, 620);
  const box = await page.locator('#bigmap').boundingBox();
  const mapX = box.x + x / 1000 * box.width, mapY = box.y + y / 620 * box.height;
  // The whole-map view intentionally prioritizes nearby place markers. Zoom at
  // the desired pin before selecting the precise sidewalk point.
  const anchorX = Math.round(mapX), anchorY = Math.round(mapY);
  await page.mouse.move(anchorX, anchorY); await page.mouse.wheel(0, -1000); await page.waitForTimeout(200);
  // Browser input coordinates round to CSS pixels. Reproject after zooming at
  // the exact integer anchor so that coarse whole-map rounding is not retained.
  view.zoomAt(Math.exp(1.5), (anchorX - box.x) / box.width * 1000, (anchorY - box.y) / box.height * 620, 1000, 620);
  const [zoomX, zoomY] = view.screen(point, 1000, 620);
  await page.mouse.click(box.x + zoomX / 1000 * box.width, box.y + zoomY / 620 * box.height); console.log(JSON.stringify({ pin: point, selected: await page.locator('#map-point').textContent() })); await page.locator('[data-map-command="travel"]').click();
  await page.locator('#panel').waitFor({ state: 'hidden', timeout: 45000 }); await page.waitForFunction(() => !window.__leonida.snapshot().streamingBusy); await page.waitForTimeout(800);
  assert.ok(distance((await state()).player, [point.x, 0, point.z]) < 12.1, 'zoomed map pin arrives within the supported clearance search radius');
}
async function lock() { await page.locator('#game').click({ position: { x: 800, y: 450 } }); mx = 800; my = 450; await page.waitForTimeout(350); }
async function aimAt(point) {
  for (let i = 0; i < 14; i++) {
    const s = await state(), d = point.map((n, j) => n - s.camera[j]), length = Math.hypot(...d);
    const yaw = angle(Math.atan2(d[0], d[2]) - Math.atan2(s.forward[0], s.forward[2]));
    const pitch = Math.asin(s.forward[1]) - Math.asin(d[1] / length);
    if (Math.abs(yaw) < .0015 && Math.abs(pitch) < .0015) return;
    mx += Math.max(-500, Math.min(500, yaw / .0025)); my += Math.max(-300, Math.min(300, pitch / .0017));
    await page.mouse.move(mx, my); await page.waitForTimeout(180);
  }
  throw new Error(`Normal mouse aim did not converge at ${point}`);
}
async function shootObject(id) {
  await page.keyboard.press('1'); await lock(); await page.mouse.down({ button: 'right' }); await page.waitForTimeout(600);
  const initial = (await state()).objects.find(o => o.id === id); assert.ok(initial?.resident && !initial.fallen);
  for (let shot = 0; shot < 28; shot++) {
    const o = (await state()).objects.find(o => o.id === id); if (o.fallen) break;
    await aimAt(o.aimPoint);
    const path = await page.evaluate(point => {
      const g = window.__leonida.game, V = g.player.position.constructor, physics = g.scene.getPhysicsEngine(), hits = [];
      physics.raycastToRef(g.combat.held.muzzle(), V.FromArray(point), hits);
      const describe = list => list.filter(h => h.hasHit).sort((a,b) => a.hitDistance - b.hitDistance).map(h => ({ name: h.body?.transformNode.name, object: h.body?.transformNode.metadata?.streetObject?.definition.id, distance: h.hitDistance, point: h.hitPointWorld.asArray() }));
      const ray = g.player.camera.getForwardRay(150), reticle = []; physics.raycastToRef(ray.origin, ray.origin.add(ray.direction.scale(150)), reticle);
      return { muzzle: describe(hits), reticle: describe(reticle), camera: g.player.camera.position.asArray(), origin: ray.origin.asArray(), forward: ray.direction.asArray(), target: point };
    }, o.aimPoint);
    const count = (await state()).shots;
    await page.mouse.down({ button: 'left' }); await page.waitForFunction(before => window.__leonida.game.combat.shots > before, count, { timeout: 1500 });
    const tracer = await page.evaluate(() => window.__leonida.game.combat.effects.filter(e => e.mesh.name === 'bullet-tracer').map(e => Array.from(e.mesh.getVerticesData('position') || [])));
    await page.mouse.up({ button: 'left' }); await page.waitForTimeout(320);
    const after = await state(), hit = after.objects.find(o => o.id === id);
    console.log(JSON.stringify({ target: id, shot, health: hit.health, shots: after.shots, aim: after.aim, ready: after.facingReady, path, tracer }));
    if (shot === 3) assert.ok(hit.health < initial.health, 'ordinary muzzle hits route into the authored object');
  }
  await page.mouse.up({ button: 'right' });
  assert.ok((await state()).objects.find(o => o.id === id).fallen, 'ordinary pistol fire breaks the object');
  await page.waitForTimeout(4500);
}
async function walkTo(target) {
  const deadline = performance.now() + 18000;
  while (performance.now() < deadline) {
    const s = await state(), dx = target[0] - s.player[0], dz = target[2] - s.player[2];
    if (Math.hypot(dx, dz) < .5) { await keys(); return; }
    const x = dx * Math.cos(s.yaw) - dz * Math.sin(s.yaw), z = dx * Math.sin(s.yaw) + dz * Math.cos(s.yaw), length = Math.hypot(x, z), next = [];
    if (Math.abs(x) / length > .35) next.push(x > 0 ? 'd' : 'a'); if (Math.abs(z) / length > .35) next.push(z > 0 ? 'w' : 's');
    await keys(...next); await page.waitForTimeout(90);
  }
  await keys(); throw new Error(`Normal walking could not reach ${target}`);
}
try {
  await page.goto(`${origin}/?backend=${backend}&test`, { waitUntil: 'domcontentloaded' }); await page.locator('[data-action="play"]').waitFor({ state: 'visible', timeout: 120000 });
  const module = await page.locator('script[type="module"]').getAttribute('src');
  checks.push({ label: 'build', module, sha256: createHash('sha256').update(Buffer.from(await (await fetch(new URL(module, origin))).arrayBuffer())).digest('hex'), world: (await (await fetch(`${origin}/world/manifest.json`)).json()).build, browser: browser.version() });
  await page.locator('[data-action="play"]').click(); await page.waitForTimeout(1100); assert.equal((await state()).backend, backend === 'webgpu' ? 'WebGPU' : 'WebGL2');
  await page.evaluate(() => {
    const scene = window.__leonida.game.scene, counter = scene.getEngine()._drawCalls; let previous = counter.current;
    scene.onAfterRenderObservable.add(() => { const current = counter.current; window.streetDrawCalls = current >= previous ? current - previous : current; previous = current; });
  });
  await page.keyboard.press('F2'); await page.locator('[data-change="police"]').uncheck(); await page.locator('[data-change="god"]').check(); await page.locator('[data-change="ammo"]').check();
  for (const name of ['traffic', 'peds']) { await page.locator(`[data-change="${name}"]`).focus(); await page.keyboard.press('Home'); }
  await page.locator('[data-action="close"]').click();
  const lampId = 'street-object/lamppost/-9.000/-18.000';
  await pin({ x: -4, z: -30 }); await capture('central-lamp-intact'); await shootObject(lampId); const shot = await capture('central-lamp-fallen');
  assert.ok(shot.objects.find(o => o.id === lampId).parts > 0);
  await page.keyboard.press('F2'); await page.locator('[data-action="save"]').click(); await page.locator('[data-action="close"]').click();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('leonida.sandbox.v1'))); assert.ok(saved.streetObjects.some(o => o.id === lampId && o.fallen));
  const crashId = 'street-object/lamppost/-1041.500/-76.000', crashPoint = [-1041.5, 0, -76];
  await pin({ x: crashPoint[0], z: crashPoint[2] - 26 }); const remote = await capture('western-lamp-intact'); assert.equal(remote.objects.find(o => o.id === lampId).resident, false);
  await lock(); const looking = await state(); mx += angle(-looking.yaw) / .0025; my -= looking.pitch / .002; await page.mouse.move(mx, my); await page.waitForTimeout(500);
  const before = (await state()).vehicles.map(v => v.id);
  await page.keyboard.press('F2'); await page.locator('#spawn-kind').selectOption('sedan'); await page.locator('[data-action="spawn"]').click(); await page.locator('[data-action="close"]').click(); await page.waitForTimeout(500);
  const car = (await state()).vehicles.find(v => !before.includes(v.id)); assert.ok(car, 'normal sandbox spawned a clear sedan');
  await walkTo([car.position[0] - car.width / 2 - 1.2, 0, car.position[2] - 3.2]); await walkTo([car.position[0] - car.width / 2 - 1.2, 0, car.position[2] - .6]);
  await page.keyboard.press('e'); await page.waitForFunction(() => window.__leonida.game.player.vehiclePhase === 'seated', null, { timeout: 6000 }); await capture('western-sedan-seated');
  const deadline = performance.now() + 10000, driven = [];
  while (performance.now() < deadline) {
    const s = await state(), target = s.objects.find(o => o.id === crashId); if (target.fallen) break;
    const v = s.vehicle, desired = Math.atan2(crashPoint[0] - v.position[0], crashPoint[2] - v.position[2]), error = angle(desired - v.heading);
    driven.push({ ...v, error, targetHealth: target.health, distance: distance(v.position, crashPoint) });
    await keys('w', ...(Math.abs(error) > .035 ? [error > 0 ? 'd' : 'a'] : [])); await page.waitForTimeout(90);
  }
  await keys('Space'); await page.waitForTimeout(1400); await keys(); checks.push({ label: 'normal-driving-samples', driven }); const crash = await capture('western-vehicle-impact'); assert.ok(crash.objects.find(o => o.id === crashId).fallen, 'a normal driven sedan breaks the physical pole');
  await page.keyboard.press('F2'); await page.locator('[data-action="load"]').click(); await page.waitForFunction(() => window.__leonida.game.player.position.x > -100, null, { timeout: 45000 });
  if (await page.locator('#panel').isVisible()) await page.locator('[data-action="close"]').click(); await page.waitForTimeout(1000);
  const loaded = await capture('saved-central-damage-restored'); assert.ok(loaded.objects.find(o => o.id === lampId).fallen); assert.equal(loaded.objects.find(o => o.id === crashId).fallen, false, 'loading the earlier save restores the later western damage');
  const restored = loaded.objects.find(o => o.id === lampId), savedLamp = saved.streetObjects.find(o => o.id === lampId); assert.ok(distance(restored.position, savedLamp.position) < .15);
  const palmId = 'street-object/palm/-10.400/-22.500'; await shootObject(palmId); const palm = await capture('central-palm-fallen'); assert.ok(palm.objects.find(o => o.id === palmId).parts >= 4);
  await page.keyboard.press('F2'); await page.locator('[data-action="reset"]').click(); await page.locator('[data-action="close"]').click(); const reset = await capture('encounter-reset-keeps-street-damage'); assert.ok(reset.objects.find(o => o.id === lampId).fallen && reset.objects.find(o => o.id === palmId).fallen);
} catch (error) { errors.push(error.stack || String(error)); await capture('failure').catch(() => {}); }
finally {
  await keys(); await page.mouse.up({ button: 'left' }); await page.mouse.up({ button: 'right' });
  await writeFile(`${output}/result.json`, JSON.stringify({ origin, backend, method: 'Normal map point travel, pistol aim/fire, sedan spawn/walking/entry/driving into a western lamp, sandbox save/load and encounter reset; read-only diagnostics.', checks, errors, warnings }, null, 2));
  await browser.close(); console.log(JSON.stringify({ checks: checks.length, errors, warnings })); if (errors.length) process.exitCode = 1;
}
