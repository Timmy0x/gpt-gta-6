import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const origin = process.env.AUDIT_URL || 'http://127.0.0.1:4187';
const backend = process.env.AUDIT_BACKEND || 'webgpu';
const prefix = `docs/evidence/character-gameplay-${backend}${process.env.AUDIT_SUFFIX || ''}`;
await mkdir(prefix, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [], checks = [];
function checkAim(s) {
  assert.ok(s.gun.aiming, 'aim control is active');
  assert.ok(s.gun.handDistance < .1, 'weapon remains attached to the hand');
  assert.ok(s.gun.angleDegrees < 1, `barrel follows the current firing ray: ${s.gun.angleDegrees} degrees`);
}
page.on('pageerror', error => errors.push(error.stack || error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
async function capture(label) {
  const state = await page.evaluate(() => {
    const g = window.__leonida.game, c = g.player.model, weapon = g.combat.held.root;
    const V = g.player.position.constructor, hand = c.skeleton.bones.find(b => b.name.endsWith('/rightHand'));
    const barrel = weapon?.getDirection(V.Forward()).normalize(), aim = g.player.camera.getForwardRay().direction;
    const { frameTimes, ...snapshot } = window.__leonida.snapshot();
    return { ...snapshot, characterMeshes: c.parts.filter(m => m.isVisible).map(m => ({ name: m.name, vertices: m.getTotalVertices(), bones: m.skeleton?.bones.length })), gun: weapon ? { enabled: weapon.isEnabled(), barrel: barrel.asArray(), aim: aim.asArray(), angleDegrees: Math.acos(Math.min(1, Math.max(-1, V.Dot(barrel, aim)))) * 180 / Math.PI, position: weapon.getAbsolutePosition().asArray(), hand: hand.getAbsolutePosition(c.torso).asArray(), handDistance: V.Distance(weapon.getAbsolutePosition(), hand.getAbsolutePosition(c.torso)), pitch: g.player.pitch, aiming: g.player.aim, crouched: g.player.crouched } : null };
  });
  checks.push({ label, ...state });
  await page.screenshot({ path: `${prefix}/${label}.png` });
  await writeFile(`${prefix}/result.json`, JSON.stringify({ origin, backend, method: 'Ordinary play, keyboard movement/character switch, mouse aim and camera look. Test hooks read diagnostics only.', checks, errors }, null, 2));
  console.log(label, JSON.stringify({ character: state.character, gun: state.gun, meshes: state.characterMeshes }));
  return state;
}
try {
  await page.goto(`${origin}/?backend=${backend}&test`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-action="play"]').waitFor({ state: 'visible', timeout: 120000 });
  const module = await page.locator('script[type="module"]').getAttribute('src');
  const bytes = Buffer.from(await (await fetch(new URL(module, origin))).arrayBuffer());
  checks.push({ label: 'build', module, sha256: createHash('sha256').update(bytes).digest('hex'), browser: browser.version() });
  await page.locator('[data-action="play"]').click(); await page.waitForTimeout(1600);
  await page.keyboard.press('2');
  let s = await capture('jason-idle'); assert.equal(s.backend, backend === 'webgpu' ? 'WebGPU' : 'WebGL2'); assert.equal(s.characterMeshes.length, 3);
  await page.keyboard.down('a'); await page.waitForTimeout(700); await capture('jason-walk'); await page.keyboard.up('a');
  await page.locator('#game').click({ position: { x: 800, y: 450 }, delay: 30 });
  await page.mouse.down({ button: 'right' }); await page.waitForTimeout(1000);
  s = await capture('jason-aim'); checkAim(s);
  await page.mouse.move(800, 200, { steps: 12 }); await page.waitForTimeout(700); const up = await capture('jason-aim-up'); assert.ok(up.gun.pitch < s.gun.pitch - .2, 'ordinary mouse look pitched the camera upward'); checkAim(up);
  await page.mouse.move(800, 700, { steps: 24 }); await page.waitForTimeout(700); const down = await capture('jason-aim-down'); assert.ok(down.gun.pitch > up.gun.pitch + .4, 'ordinary mouse look pitched the camera downward'); checkAim(down);
  await page.mouse.up({ button: 'right' }); await page.keyboard.press('Tab'); await page.waitForTimeout(600); s = await capture('lucia-idle'); assert.equal(s.character, 'Lucia'); assert.equal(s.characterMeshes.length, 3);
  await page.keyboard.down('w'); await page.waitForTimeout(700); await capture('lucia-walk'); await page.keyboard.up('w');
  await page.mouse.down({ button: 'right' }); await page.waitForTimeout(1000); s = await capture('lucia-aim'); checkAim(s);
  await page.keyboard.down('c'); await page.waitForTimeout(800); s = await capture('lucia-aim-crouch'); checkAim(s); assert.equal(s.gun.crouched, true); await page.keyboard.up('c');
  await page.mouse.up({ button: 'right' });
} catch (error) { errors.push(error.stack || String(error)); await page.screenshot({ path: `${prefix}/failure.png` }).catch(() => {}); }
finally {
  await writeFile(`${prefix}/result.json`, JSON.stringify({ origin, backend, method: 'Ordinary play, keyboard movement/character switch, mouse aim and camera look. Test hooks read diagnostics only.', checks, errors }, null, 2));
  await browser.close(); console.log('RESULT', JSON.stringify({ checks: checks.length, errors }));
  if (errors.length) process.exitCode = 1;
}
