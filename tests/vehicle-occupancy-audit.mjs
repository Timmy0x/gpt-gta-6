// Run with node --import tsx tests/vehicle-occupancy-audit.mjs.
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { vehicleFootRoute } from '../src/gameplay/police/vehicleFootRoute.ts';

const origin = process.env.AUDIT_URL || 'http://127.0.0.1:4201';
const backend = process.env.AUDIT_BACKEND || 'webgpu';
const auditExterior = process.env.AUDIT_EXTERIOR === '1';
const auditContact = process.env.AUDIT_CONTACT === '1';
const output = process.env.AUDIT_OUTPUT || `docs/evidence/vehicle-occupancy-v10-${backend}`;
await mkdir(output, { recursive: true });
const index = await (await fetch(origin)).text(), entry = index.match(/<script[^>]*src="([^"]+)"/)[1];
const fingerprint = { entry, sha256: createHash('sha256').update(Buffer.from(await (await fetch(origin + entry)).arrayBuffer())).digest('hex'), worldBuild: (await (await fetch(origin + '/world/manifest.json')).json()).build };
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const checks = [], errors = [], consoleMessages = [], held = new Set();
const started = performance.now();
page.on('pageerror', error => errors.push(error.stack || error.message));
page.on('console', message => { if (['warning', 'error'].includes(message.type())) consoleMessages.push({ type: message.type(), elapsedMs: performance.now() - started, text: message.text(), location: message.location() }); });
const state = () => page.evaluate(() => {
  const g = window.__leonida.game, p = g.player;
  const car = v => {
    const bounds = v.root.getHierarchyBoundingVectors(true, mesh => mesh.isEnabled());
    return { id: v.id, kind: v.kind, position: v.root.position.asArray(), health: v.health, speed: v.speed, heading: v.heading, right: v.root.right.asArray(), width: v.tuning.width, input: { ...v.input }, occupied: v.occupied, locked: !!v.controlLocked, doorAngles: v.model.doors.map(d => d.angle), bodyChildren: v.body.shape.getNumChildren(), mass: v.body.getMassProperties().mass,
      bounds: { min: bounds.min.asArray(), max: bounds.max.asArray() } };
  };
  return { backend: window.__leonida.snapshot().backend, player: p.position.asArray(), yaw: p.yaw, name: p.name, phase: p.vehiclePhase, transitioning: p.transitioning, message: p.interactionMessage, vehicle: p.vehicle ? car(p.vehicle) : null,
    traffic: g.population.drivers.filter(d => !d.police).map(d => ({ ...car(d.v), driver: g.population.pedestrians.find(ped => ped.vehicleId === d.v.id)?.id })),
    actors: g.population.pedestrians.filter(ped => ped.vehicleId || ped.formerDriver).map(ped => ({ id: ped.id, vehicleId: ped.vehicleId, formerDriver: !!ped.formerDriver, activity: ped.activity, health: ped.health, panic: ped.panic, position: ped.model.root.position.asArray(), visible: ped.model.root.isEnabled(), skins: ped.model.parts.filter(m => m.isVisible).map(m => ({ name: m.name, vertices: m.getTotalVertices() })) })),
    vehicles: g.vehicles.list.map(car), wanted: g.wanted.phase, simTime: window.__leonida.snapshot().simTime };
});
async function keys(...next) {
  const desired = new Set(next);
  for (const key of held) if (!desired.has(key)) { await page.keyboard.up(key); held.delete(key); }
  for (const key of desired) if (!held.has(key)) { await page.keyboard.down(key); held.add(key); }
}
async function capture(label) {
  const s = await state(); checks.push({ label, ...s }); await page.screenshot({ path: `${output}/${label}.png` });
  console.log(JSON.stringify({ label, player: s.player, phase: s.phase, vehicle: s.vehicle, actors: s.actors.filter(actor => actor.formerDriver) })); return s;
}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
function driverDoor(v) { return [v.position[0] - v.right[0] * (v.width / 2 + 1.3), .94, v.position[2] - v.right[2] * (v.width / 2 + 1.3)]; }
async function approachTraffic() {
  const map = await page.evaluate(() => ({ roads: window.__leonida.game.world.roads, obstacles: window.__leonida.game.world.obstacles.map(({ x, z, w, d, height }) => ({ x, z, w, d, height })) }));
  let selected, route = [], routeTime = 0, lastProgress = performance.now(), previousDistance = Infinity;
  let lastLog = 0;
  const deadline = performance.now() + 95000;
  while (performance.now() < deadline) {
    const s = await state();
    selected = s.traffic.find(v => v.id === selected?.id);
    if (!selected || Math.abs(selected.speed) > 5 || performance.now() - lastProgress > 25000) {
      selected = s.traffic.filter(v => v.driver && Math.abs(v.speed) < 3).sort((a, b) => dist(s.player, driverDoor(a)) - dist(s.player, driverDoor(b)))[0];
      route = []; routeTime = 0; previousDistance = Infinity; lastProgress = performance.now();
    }
    if (!selected) { await keys(); await page.waitForTimeout(250); continue; }
    const goal = driverDoor(selected), distance = dist(s.player, goal);
    if (performance.now() - lastLog > 8000) { console.log(JSON.stringify({ label: 'walking-progress', player: s.player, target: selected.id, targetPosition: goal, distance })); lastLog = performance.now(); }
    if (distance < .65 && Math.abs(selected.speed) < 5) { await keys(); return selected.id; }
    if (distance < previousDistance - .4) { previousDistance = distance; lastProgress = performance.now(); }
    if (performance.now() - routeTime > 1500 || !route.length) {
      const p = a => ({ x: a[0], y: a[1], z: a[2] });
      const observedVehicles = s.vehicles.map(v => ({ root: { position: p(v.position), isEnabled: () => true,
        getHierarchyBoundingVectors: () => ({ min: p(v.bounds.min), max: p(v.bounds.max) }) } }));
      route = vehicleFootRoute(p(s.player), p(goal), map.roads, map.obstacles, observedVehicles); routeTime = performance.now();
      if (distance < 12) console.log(JSON.stringify({ label: 'door-approach-route', player: s.player, goal, route }));
    }
    while (route.length > 1 && Math.hypot(route[0].x - s.player[0], route[0].z - s.player[2]) < .45) route.shift();
    const target = route[0] ?? { x: goal[0], z: goal[2] }, dx = target.x - s.player[0], dz = target.z - s.player[2];
    const localX = dx * Math.cos(s.yaw) - dz * Math.sin(s.yaw), localZ = dx * Math.sin(s.yaw) + dz * Math.cos(s.yaw);
    const threshold = Math.hypot(localX, localZ) * .25, next = [];
    if (Math.abs(localX) > threshold) next.push(localX > 0 ? 'd' : 'a');
    if (Math.abs(localZ) > threshold) next.push(localZ > 0 ? 'w' : 's');
    if (distance > 6) next.push('Shift');
    await keys(...next); await page.waitForTimeout(distance > 3 ? 180 : 90);
  }
  throw new Error('Could not approach a slow traffic driver using normal walking controls within 95 seconds');
}

try {
  await page.goto(`${origin}/?backend=${backend}&test`, { waitUntil: 'domcontentloaded' });
  await page.locator('#welcome:not(.hidden)').waitFor({ timeout: 120000 }); await page.locator('[data-action="play"]').click();
  await page.evaluate(() => {
    const g = window.__leonida.game;
    window.occupancySamples = [];
    g.scene.onAfterPhysicsObservable.add(() => {
      const p = g.player;
      if (p.transitioning && p.vehicle) window.occupancySamples.push({ phase: p.vehiclePhase, input: { ...p.vehicle.input }, locked: p.vehicle.controlLocked,
        doorAngles: p.vehicle.model.doors.map(d => d.angle), bodyChildren: p.vehicle.body.shape.getNumChildren(), mass: p.vehicle.body.getMassProperties().mass });
    });
  });
  await page.waitForTimeout(1800);
  const first = await capture('traffic-start'); assert.equal(first.backend, backend === 'webgpu' ? 'WebGPU' : 'WebGL2');
  assert.ok(first.actors.length >= 8); assert.ok(first.actors.every(actor => actor.visible && actor.skins.length >= 1));
  await page.waitForTimeout(6500); const moving = await capture('traffic-driving');
  const travel = moving.traffic.map(v => ({ id: v.id, distance: dist(v.position, first.traffic.find(old => old.id === v.id)?.position ?? v.position) }));
  checks.push({ label: 'traffic-distances', travel }); assert.ok(travel.some(v => v.distance > 6), 'visible traffic driver actually drives away');
  await page.keyboard.press('F2'); await page.locator('[data-change="traffic"]').press('Home'); await page.locator('[data-action="close"]').click(); await page.waitForTimeout(1600);
  checks.push({ label: 'normal-ui-traffic-paused-for-approach', ...(await state()) });
  const vehicleId = await approachTraffic();
  const before = await capture('driver-door'); const victimId = before.traffic.find(v => v.id === vehicleId).driver;
  if (auditExterior) assert.ok(before.traffic.find(v => v.id === vehicleId).bodyChildren > 15, 'the frozen runtime includes the actual exterior compound, beyond its old chassis/roof proxies');
  await page.keyboard.press('F2'); await page.locator('[data-change="traffic"]').press('End'); await page.locator('[data-action="close"]').click();
  checks.push({ label: 'normal-ui-full-traffic-restored', ...(await state()) });
  await page.keyboard.press('e'); await keys('w');
  await page.waitForFunction(() => window.__leonida.game.player.vehicle || window.__leonida.game.player.interactionMessage, null, { timeout: 1500 });
  const phases = new Set(); const end = performance.now() + 6000;
  while (performance.now() < end) {
    const s = await state();
    if (!s.vehicle) throw new Error(`Carjacking rejected: ${s.message}`);
    assert.equal(s.vehicle.id, vehicleId, 'normal E chooses the approached traffic vehicle');
    if (!phases.has(s.phase)) {
      phases.add(s.phase); await capture(s.phase);
      if (auditContact && s.phase === 'ejecting-driver') {
        await page.waitForTimeout(120);
        if ((await state()).phase === 'ejecting-driver') await capture('driver-contact');
      }
    }
    if (s.phase === 'seated') break;
    assert.equal(s.vehicle.input.throttle, 0); assert.equal(s.vehicle.locked, true); await page.waitForTimeout(90);
  }
  await keys(); assert.ok(phases.has('ejecting-driver')); assert.ok(phases.has('entering')); assert.ok(phases.has('seated'));
  const seated = await capture('victim-fleeing'), victim = seated.actors.find(actor => actor.id === victimId);
  assert.ok(victim?.formerDriver); assert.equal(victim.activity, 'fleeing'); assert.equal(victim.health, 100); assert.equal(victim.visible, true);
  assert.equal(seated.traffic.some(v => v.id === vehicleId), false);
  await page.keyboard.press('Tab'); await page.waitForTimeout(500); assert.equal((await capture('lucia-seated')).name, 'Lucia');
  const start = (await state()).vehicle.position;
  await keys('w'); await page.waitForTimeout(1900); await keys('Space'); await page.waitForTimeout(800); await keys();
  const driven = await capture('stolen-car-driven'); assert.ok(dist(driven.vehicle.position, start) > 1.2, 'new driver can move the stolen car');
  const stopDeadline = performance.now() + 5000;
  while (Math.abs((await state()).vehicle.speed) > 2 && performance.now() < stopDeadline) { await keys('Space'); await page.waitForTimeout(100); }
  await keys(); await page.keyboard.press('e'); await keys('w');
  await page.waitForFunction(() => window.__leonida.game.player.vehiclePhase === 'exiting' || window.__leonida.game.player.interactionMessage, null, { timeout: 1500 });
  const exiting = await capture('exiting'); assert.equal(exiting.phase, 'exiting');
  await page.waitForFunction(() => window.__leonida.game.player.vehicle === null, null, { timeout: 3000 }); await keys();
  const exited = await capture('on-foot'); assert.equal(exited.phase, 'on-foot');
  const parked = exited.vehicles.find(v => v.id === vehicleId);
  assert.equal(parked.input.throttle, 0); assert.equal(parked.input.steer, 0); assert.equal(parked.input.lift, 0); assert.equal(parked.input.brake, 1);
  const samples = await page.evaluate(() => window.occupancySamples);
  assert.ok(samples.some(s => s.phase === 'exiting'), 'physics samples cover held W during dismount');
  assert.ok(samples.some(s => s.phase === 'ejecting-driver'), 'physics samples cover driver removal');
  assert.ok(samples.every(s => s.locked && s.input.throttle === 0 && s.input.steer === 0 && s.input.lift === 0 && s.input.brake === 1), 'every transition physics step keeps powered inputs parked');
  checks.push({ label: 'transition-physics-inputs', samples });
  if (auditExterior) {
    assert.ok(samples.every(s => s.bodyChildren > 15), 'physical exterior remains attached during every transition sample');
    assert.ok(samples.some(s => s.phase === 'ejecting-driver' && Math.max(...s.doorAngles) > .7), 'physical door opens during visible driver extraction');
    assert.ok(samples.some(s => s.phase === 'exiting' && Math.max(...s.doorAngles) > .7), 'physical door opens during normal exit');
    assert.ok(samples.every(s => s.mass === samples[0].mass), 'animation and compound updates preserve vehicle mass');
  }
  const afterVictim = exited.actors.find(actor => actor.id === victimId);
  assert.ok(afterVictim && dist(afterVictim.position, victim.position) > 3, 'victim persists and flees under normal gameplay');
} catch (error) {
  errors.push(error.stack || String(error)); await capture('failure').catch(() => {});
} finally {
  await keys(); await page.close(); await browser.close();
  await writeFile(`${output}/result.json`, JSON.stringify({ origin, backend, fingerprint, method: 'Normal fresh play and moving traffic observation; Sandbox traffic-density slider stops cars for approach and returns to full density immediately before E theft; telemetry-guided keyboard walking along the authored accessible graph, E carjacking, held W during transition, Tab character switch, W driving, Space braking and E exit. Read-only state/actor telemetry; no transform, pose, spawn or gameplay hooks.', checks, consoleMessages, errors }, null, 2) + '\n');
  console.log(JSON.stringify({ output, errors })); if (errors.length) process.exitCode = 1;
}
