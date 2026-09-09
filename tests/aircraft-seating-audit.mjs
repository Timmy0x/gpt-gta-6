import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const origin = process.env.AUDIT_URL || 'http://127.0.0.1:4197', backend = process.env.AUDIT_BACKEND || 'webgpu';
const output = `docs/evidence/aircraft-seating-${backend}`;
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const checks = [], errors = [];
const index = await (await fetch(origin)).text(), entry = index.match(/<script[^>]*src="([^"]+)"/)[1];
const fingerprint = { entry, sha256: createHash('sha256').update(Buffer.from(await (await fetch(origin + entry)).arrayBuffer())).digest('hex'), worldBuild: (await (await fetch(origin + '/world/manifest.json')).json()).build, browser: browser.version() };

try {
  for (const kind of ['plane', 'helicopter']) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on('pageerror', error => errors.push(error.stack || error.message));
    const state = () => page.evaluate(() => {
      const g = window.__leonida.game, v = g.player.vehicle, c = g.player.model;
      return { backend: window.__leonida.snapshot().backend, character: g.player.character, characterName: c.root.name, visibleSkins: c.parts.filter(mesh => mesh.isVisible).map(mesh => ({ name: mesh.name, vertices: mesh.getTotalVertices(), bones: mesh.skeleton?.bones.length })), seated: c.root.parent === v?.root, transitioning: g.player.transitioning, seat: c.root.position.asArray(), intendedSeat: v?.model.seat?.asArray(), vehicle: v ? { kind: v.kind, health: v.health, speed: v.speed, position: v.root.position.asArray(), velocity: v.body.getLinearVelocity().asArray() } : null, prompt: document.querySelector('#prompt')?.textContent };
    });
    const capture = async label => {
      const current = await state(); checks.push({ kind, label, ...current });
      await page.screenshot({ path: `${output}/${kind}-${label}.png` });
      console.log(JSON.stringify({ kind, label, ...current })); return current;
    };
    const validate = (current, name) => {
      assert.equal(current.backend, backend === 'webgpu' ? 'WebGPU' : 'WebGL2');
      assert.ok(current.characterName.includes(name)); assert.equal(current.visibleSkins.length, 3);
      assert.ok(current.visibleSkins.every(mesh => mesh.bones === 80));
      assert.equal(current.vehicle.kind, kind); assert.equal(current.seated, true); assert.equal(current.transitioning, false);
      current.seat.forEach((coordinate, index) => assert.ok(Math.abs(coordinate - current.intendedSeat[index]) < 1e-5));
    };
    try {
      await page.goto(`${origin}/?backend=${backend}&test`, { waitUntil: 'domcontentloaded' });
      await page.locator('#welcome:not(.hidden)').waitFor({ timeout: 120000 });
      await page.locator('[data-action="play"]').click(); await page.waitForTimeout(1500);
      await page.keyboard.press('F2'); await page.locator('#spawn-kind').selectOption(kind); await page.locator('[data-action="spawn"]').click();
      await page.waitForFunction(() => !window.__leonida.snapshot().streamingBusy); await page.waitForTimeout(1600);
      await page.locator('[data-action="close"]').click(); await page.waitForTimeout(400);
      await page.keyboard.press('e'); await page.waitForTimeout(1100);
      validate(await capture('jason-ground-rear'), 'Jason');
      await page.mouse.move(720, 450); await page.locator('#game').click({ position: { x: 720, y: 450 }, delay: 30 });
      await page.mouse.down({ button: 'right' }); await page.mouse.move(1260, 510, { steps: 20 }); await page.mouse.up({ button: 'right' }); await page.waitForTimeout(500);
      validate(await capture('jason-ground-side'), 'Jason');
      await page.keyboard.press('Tab'); await page.waitForTimeout(700); validate(await capture('lucia-ground-side'), 'Lucia');
      if (kind === 'helicopter') {
        await page.mouse.down({ button: 'right' }); await page.mouse.move(1850, 510, { steps: 20 }); await page.mouse.up({ button: 'right' }); await page.waitForTimeout(500);
        validate(await capture('lucia-ground-front'), 'Lucia');
        await page.keyboard.press('Tab'); await page.waitForTimeout(700); validate(await capture('jason-ground-front'), 'Jason');
        await page.keyboard.press('Tab'); await page.waitForTimeout(700);
      }
      await page.mouse.down({ button: 'right' }); await page.mouse.move(720, 450, { steps: 20 }); await page.mouse.up({ button: 'right' }); await page.waitForTimeout(500);
      validate(await capture('lucia-ground-rear'), 'Lucia');
      const started = performance.now();
      if (kind === 'plane') {
        await page.keyboard.down('w');
        await page.waitForFunction(() => window.__leonida.game.player.vehicle.speed >= 25, null, { timeout: 16000 });
      }
      await page.keyboard.down('Space');
      await page.waitForFunction(() => window.__leonida.game.player.vehicle.root.position.y > 8, null, { timeout: 16000 });
      const luciaFlight = await capture('lucia-airborne'); validate(luciaFlight, 'Lucia');
      assert.ok(luciaFlight.vehicle.health > 95); checks.push({ kind, label: 'takeoff-time', seconds: (performance.now() - started) / 1000 });
      await page.keyboard.press('Tab'); await page.waitForTimeout(700);
      const jasonFlight = await capture('jason-airborne'); validate(jasonFlight, 'Jason'); assert.ok(jasonFlight.vehicle.position[1] > 8);
      await page.keyboard.up('Space'); await page.keyboard.up('w');
    } catch (error) {
      errors.push(`${kind}: ${error.stack || error}`); await page.screenshot({ path: `${output}/${kind}-failure.png` }).catch(() => {});
    } finally { await page.close(); }
  }
} finally {
  await writeFile(`${output}/result.json`, JSON.stringify({ origin, backend, fingerprint, scope: 'Normal Creative UI aircraft spawn, E entry, mouse camera orbit, Tab character switching and takeoff keys; diagnostics read seat/model state only. No game-state or camera-transform hooks.', checks, errors }, null, 2) + '\n');
  await browser.close(); console.log(JSON.stringify({ output, errors })); if (errors.length) process.exitCode = 1;
}
