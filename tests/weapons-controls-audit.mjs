import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const origin = process.env.AUDIT_URL || 'http://127.0.0.1:4208', backend = process.env.AUDIT_BACKEND || 'webgpu';
const output = process.env.AUDIT_OUTPUT || `docs/evidence/weapons-${backend}-v17`;
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', ...(process.env.AUDIT_COLD_SHADER === '1' ? ['--disable-gpu-shader-disk-cache'] : [])] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } }), checks = [], errors = [], warnings = [];
if (process.env.AUDIT_GL_TRACE === '1') await page.addInitScript(() => {
  const records = [], programs = new WeakMap(); let nextId = 1;
  const phase = () => { const c = window.__leonida?.game?.combat; return c ? {weapon:c.weapon,target:c.handling.target,phase:c.handling.phase,character:window.__leonida.game.player.name} : null; };
  for (const name of ['WebGLRenderingContext','WebGL2RenderingContext']) {
    const proto=window[name]?.prototype;if(!proto)continue;
    for(const method of ['createProgram','deleteProgram','getProgramParameter']) {
      if(!Object.prototype.hasOwnProperty.call(proto,method))continue;
      const original=proto[method];proto[method]=function(...args){
        if(method==='createProgram'){const value=Reflect.apply(original,this,args);if(value)programs.set(value,{id:nextId++,created:performance.now(),phase:phase()});return value;}
        const program=args[0],record=program&&programs.get(program);
        if(method==='deleteProgram'&&record){record.deleted=performance.now();record.deletePhase=phase();record.deleteStack=new Error().stack;}
        const result=Reflect.apply(original,this,args);
        if(method==='getProgramParameter'&&(!program||record?.deleted||result===null)&&records.length<100){records.push({...record,queried:performance.now(),queryPhase:phase(),parameter:args[1],result,queryStack:new Error().stack});}
        return result;
      };
    }
  }
  Object.assign(window,{__weaponProgramAudit:records});
});
page.on('pageerror', e => errors.push(e.stack || e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); if (m.type() === 'warning') warnings.push(m.text()); });
const state = () => page.evaluate(() => {
  const g = window.__leonida.game, c = g.combat, p = g.player, V = p.position.constructor;
  const ray = p.camera.getForwardRay().direction;
  return { backend: window.__leonida.snapshot().backend, name: p.name, position: p.position.asArray(), yaw: p.yaw, pitch: p.pitch, heading: p.heading,
    weapon: c.weapon, target: c.handling.target, phase: c.handling.phase, progress: c.handling.progress, visible: c.held.root.isEnabled(),
    shots: c.shots, magazines: [...c.inventory.magazines], reserves: [...c.inventory.reserves], reload: c.reloadTime,
    raised: p.weaponRaised, ready: p.weaponFacingReady, aim: p.aim, scoped: c.scoped, magnification: c.magnification, fov: p.camera.fov,
    wheel: !document.querySelector('#weapon-wheel').classList.contains('hidden'), selected: document.querySelector('.weapon-slot.selected')?.getAttribute('data-weapon'),
    bodyError: Math.abs(Math.atan2(Math.sin(Math.atan2(ray.x, ray.z) - p.heading), Math.cos(Math.atan2(ray.x, ray.z) - p.heading))),
    barrelAngle: c.held.root.isEnabled() ? Math.acos(Math.max(-1, Math.min(1, V.Dot(ray, c.held.root.getDirection(V.Forward()).normalize())))) * 180 / Math.PI : null,
    muzzle: c.held.muzzle().asArray(), meshes: c.held.root.getChildMeshes().filter(m => m.isEnabled()).map(m => ({ name: m.name, vertices: m.getTotalVertices() })),
    vehicle: p.vehicle ? { kind: p.vehicle.kind, id: p.vehicle.id, position: p.vehicle.root.position.asArray(), speed: p.vehicle.speed, input: {...p.vehicle.input}, phase: p.vehiclePhase } : null,
    driveBy: { active: c.driveBy.active, ready: c.driveBy.ready },
  };
});
async function capture(label) { const s = await state(); checks.push({ label, ...s }); await page.screenshot({ path: `${output}/${label}.png` }); console.log(label, JSON.stringify(s)); return s; }
async function selected(index) { await page.keyboard.press(String(index + 1)); await page.waitForFunction(index => { const c = window.__leonida.game.combat; return c.weapon === index && (c.handling.ready || index === 7 && c.handling.phase === 'holstered'); }, index, { timeout: 6000 }); }
try {
  await page.goto(`${origin}/?backend=${backend}&test`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-action="play"]').waitFor({ state: 'visible', timeout: 120000 });
  const module = await page.locator('script[type="module"]').getAttribute('src');
  checks.push({ label: 'build', module, sha256: createHash('sha256').update(Buffer.from(await (await fetch(new URL(module, origin))).arrayBuffer())).digest('hex'), world: (await (await fetch(`${origin}/world/manifest.json`)).json()).build, browser: browser.version() });
  await page.locator('[data-action="play"]').click(); await page.waitForTimeout(1600);
  assert.equal((await state()).backend, backend === 'webgpu' ? 'WebGPU' : 'WebGL2');
  await page.keyboard.press('F2'); await page.locator('[data-change="police"]').uncheck(); await page.locator('[data-change="god"]').check(); await page.locator('[data-action="close"]').click();
  await page.locator('#game').click({ position: { x: 800, y: 450 } }); await page.waitForTimeout(1000);
  await selected(0);
  await capture('initial-pistol');
  await page.keyboard.press('Tab'); await page.waitForTimeout(700); let s = await capture('holstered'); assert.equal(s.phase, 'holstered'); assert.equal(s.visible, false);
  await page.keyboard.down('Tab'); await page.waitForTimeout(350); s = await capture('wheel-open'); assert.equal(s.wheel, true); assert.equal(await page.locator('.weapon-slot').count(), 8);
  await page.mouse.wheel(0, 100); await page.waitForTimeout(150); s = await capture('wheel-smg'); assert.equal(s.selected, '1');
  await page.keyboard.up('Tab'); await page.waitForTimeout(1200); s = await capture('wheel-release-smg'); assert.equal(s.weapon, 1); assert.equal(s.phase, 'ready');
  await page.mouse.down(); await page.waitForTimeout(1000); await page.mouse.up(); s = await capture('smg-automatic'); assert.ok(s.shots >= 5);
  await selected(0); await page.mouse.down(); const before = await state(); await page.waitForTimeout(900); s = await capture('pistol-held-trigger'); await page.mouse.up(); assert.ok(s.shots - before.shots <= 1, 'semi-automatic trigger does not repeat');
  await page.keyboard.press('r'); await page.waitForTimeout(350); s = await capture('pistol-reload'); assert.ok(s.reload > 0); await page.waitForTimeout(1700); assert.equal((await state()).magazines[0], 12);
  for (const index of [3, 4, 5, 6, 2, 7]) { await selected(index); await capture(`weapon-${index}`); }
  await selected(5); await page.mouse.down({button: 'right'}); await page.waitForTimeout(750); s = await capture('sniper-2x'); assert.equal(s.magnification, 2);
  await page.mouse.wheel(0, 100); await page.waitForTimeout(450); s = await capture('sniper-4x'); assert.equal(s.magnification, 4);
  await page.mouse.wheel(0, 100); await page.waitForTimeout(450); s = await capture('sniper-8x'); assert.equal(s.magnification, 8); assert.ok(s.fov < .13);
  await page.mouse.down(); await page.waitForTimeout(250); await page.mouse.up(); await page.mouse.up({button: 'right'}); await page.waitForTimeout(500); s = await capture('sniper-unscoped'); assert.equal(s.scoped, false); assert.ok(s.magazines[5] < 5);
  await page.keyboard.press('Alt'); await page.waitForTimeout(500); s = await capture('lucia-weapon'); assert.equal(s.name, 'Lucia');
  await page.keyboard.press('F2'); await page.locator('[data-action="save"]').click(); await page.locator('[data-action="close"]').click(); const saved = await state();
  await selected(0); await page.keyboard.press('F2'); await page.locator('[data-action="load"]').click(); await page.locator('[data-action="close"]').click(); await page.waitForTimeout(1800); s = await capture('inventory-restored'); assert.equal(s.weapon, saved.weapon); assert.deepEqual(s.magazines, saved.magazines); assert.deepEqual(s.reserves, saved.reserves);
  await page.keyboard.press('Escape'); assert.equal(await page.getByText('The world will be here when you get back.', {exact: true}).count(), 0); await capture('minimal-pause');
  if(process.env.AUDIT_SWITCH_STRESS==='1'){await page.keyboard.press('Escape');for(let cycle=0;cycle<4;cycle++){for(const index of [0,3,5,1,4,6,2,7]){await page.keyboard.press(String(index+1));await page.waitForTimeout(170);}await page.keyboard.press('Alt');await page.waitForTimeout(250);}await selected(0);await capture('switch-stress-finished');}
} catch (e) { errors.push(e.stack || String(e)); await capture('failure').catch(() => {}); }
finally { const programAudit = process.env.AUDIT_GL_TRACE === '1' ? await page.evaluate(() => window.__weaponProgramAudit || []).catch(() => []) : undefined; await writeFile(`${output}/result.json`, JSON.stringify({ origin, backend, method: 'Normal keyboard/mouse draw, holster, weapon wheel, weapon firing/reload/zoom, character switch and sandbox save/load. Game diagnostics are read only.', checks, errors, warnings, programAudit }, null, 2)); await browser.close(); console.log(JSON.stringify({ checks: checks.length, errors, warnings })); if (errors.length) process.exitCode = 1; }
