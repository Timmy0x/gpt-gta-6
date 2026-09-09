import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const origin = process.env.AUDIT_URL || 'http://127.0.0.1:4201';
const backend = process.env.AUDIT_BACKEND || 'webgpu';
const output = `docs/evidence/weapon-facing-${backend}`;
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const checks = [], errors = [], warnings = [];
page.on('pageerror', e => errors.push(e.stack || e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); if (m.type() === 'warning') warnings.push(m.text()); });
async function capture(label) {
  const s = await page.evaluate(() => {
    const g = window.__leonida.game, p = g.player, V = p.position.constructor;
    const ray = p.camera.getForwardRay().direction, barrel = g.combat.held.root.getDirection(V.Forward()).normalize();
    return { backend: window.__leonida.snapshot().backend, character: p.name, heading: p.heading, aim: p.aim, raised: p.weaponRaised, ready: p.weaponFacingReady, shots: g.combat.shots, bodyError: Math.abs(Math.atan2(Math.sin(Math.atan2(ray.x, ray.z) - p.heading), Math.cos(Math.atan2(ray.x, ray.z) - p.heading))), barrelAngle: Math.acos(Math.max(-1, Math.min(1, V.Dot(ray, barrel)))) * 180 / Math.PI };
  });
  checks.push({ label, ...s }); await page.screenshot({ path: `${output}/${label}.png` }); return s;
}
try {
  await page.goto(`${origin}/?backend=${backend}&test`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-action="play"]').waitFor({ state: 'visible', timeout: 120000 });
  const module = await page.locator('script[type="module"]').getAttribute('src');
  checks.push({ label: 'build', module, sha256: createHash('sha256').update(Buffer.from(await (await fetch(new URL(module, origin))).arrayBuffer())).digest('hex'), browser: browser.version() });
  await page.locator('[data-action="play"]').click(); await page.waitForTimeout(1400);
  await page.keyboard.press('F2');
  await page.locator('[data-change="god"]').check(); await page.locator('[data-change="police"]').uncheck(); await page.locator('[data-change="ammo"]').check();
  await page.locator('[data-action="close"]').click(); await page.keyboard.press('2');
  await page.locator('#game').click({ position: { x: 800, y: 450 } }); await page.waitForTimeout(900);
  // Read-only per-physics-step diagnostics; controls below are ordinary keyboard/mouse.
  await page.evaluate(() => {
    const g = window.__leonida.game;
    window.weaponFacingSamples = [];
    g.scene.onAfterPhysicsObservable.add(() => {
      const p = g.player, ray = p.camera.getForwardRay().direction;
      window.weaponFacingSamples.push({ t: performance.now(), shots: g.combat.shots, raised: p.weaponRaised, ready: p.weaponFacingReady, aim: p.aim, bodyError: Math.abs(Math.atan2(Math.sin(Math.atan2(ray.x, ray.z) - p.heading), Math.cos(Math.atan2(ray.x, ray.z) - p.heading))) });
    });
  });
  const start = await capture('jason-idle'); assert.equal(start.backend, backend === 'webgpu' ? 'WebGPU' : 'WebGL2');
  await page.mouse.move(2056, 450); await page.waitForTimeout(100);
  const behind = await capture('camera-behind-body'); assert.ok(behind.bodyError > 2.5, 'normal mouse turns camera behind an idle body');
  await page.mouse.down(); await page.waitForTimeout(1000);
  const hip = await capture('jason-hipfire'); assert.equal(hip.aim, false); assert.equal(hip.ready, true); assert.ok(hip.shots > behind.shots); assert.ok(hip.barrelAngle < 6, 'active recoil remains within its authored 0.1-radian kick');
  await page.mouse.up(); await page.waitForTimeout(200); assert.ok((await capture('hipfire-recoil-settled')).barrelAngle < 1); await page.waitForTimeout(650); assert.equal((await capture('weapon-lowered')).raised, false);
  await page.keyboard.press('Tab'); await page.waitForTimeout(450);
  await page.mouse.move(3312, 450); await page.waitForTimeout(100);
  await page.mouse.down({ button: 'right' }); await page.mouse.down({ button: 'left' }); await page.waitForTimeout(1000);
  const aimed = await capture('lucia-aimed-fire'); assert.equal(aimed.character, 'Lucia'); assert.equal(aimed.aim, true); assert.equal(aimed.ready, true); assert.ok(aimed.barrelAngle < 6);
  await page.mouse.up({ button: 'left' }); await page.mouse.up({ button: 'right' });
  const samples = await page.evaluate(() => window.weaponFacingSamples);
  const fired = samples.filter((s, i) => i > 0 && s.shots > samples[i - 1].shots);
  const turning = samples.filter(s => s.raised && s.bodyError > Math.PI / 12 + .005);
  assert.ok(fired.length >= 4, 'actual shots recorded'); assert.ok(turning.length >= 4, 'bounded body-turn frames recorded');
  assert.ok(fired.every(s => s.ready && s.bodyError <= Math.PI / 12 + .005), 'every shot occurs only inside the forward body cone');
  checks.push({ label: 'per-step-facing-gate', fired: fired.length, turning: turning.length, samples });
} catch (e) { errors.push(e.stack || String(e)); await page.screenshot({ path: `${output}/failure.png` }).catch(() => {}); }
finally {
  await writeFile(`${output}/result.json`, JSON.stringify({ origin, backend, method: 'Normal mouse 180-degree turns, hip fire, aimed fire and character switching. Physics observer only reads shot/facing diagnostics.', checks, errors, warnings }, null, 2));
  await browser.close(); console.log(JSON.stringify({ checks: checks.length, errors, warnings })); if (errors.length) process.exitCode = 1;
}
