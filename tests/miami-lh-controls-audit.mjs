import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const origin = process.env.AUDIT_URL || 'http://127.0.0.1:4494';
const output = process.env.AUDIT_OUTPUT || 'docs/evidence/miami-lh-preview-r1';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: [
  '--enable-unsafe-webgpu', '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
] });
await mkdir(output, { recursive: true });
const checks = [], errors = [], logs = [];
let phase = 'startup', activePage;
const fingerprint = async () => {
  const html = await (await fetch(origin)).text();
  const entry = html.match(/<script[^>]*src="([^"]+)"/)[1];
  return { entry, sha256: createHash('sha256').update(Buffer.from(await (await fetch(new URL(entry, origin))).arrayBuffer())).digest('hex') };
};
const source = await fingerprint();
try {
  for (const backend of ['webgl2', 'webgpu']) {
    phase = `${backend}-startup`;
    const page = activePage = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    page.on('pageerror', error => errors.push({ phase, error: error.message }));
    page.on('console', message => { if (['error', 'warning'].includes(message.type())) logs.push({ phase, type: message.type(), text: message.text() }); });
    await page.goto(origin, { waitUntil: 'networkidle' });
    if (backend === 'webgpu') await page.locator('#backend').selectOption(backend);
    await page.waitForFunction(expected => document.querySelector('#scene-status')?.textContent.startsWith(expected) && document.querySelector('#tile-status')?.textContent.includes('1 selected'), backend === 'webgpu' ? 'WebGPU' : 'WebGL2', { timeout: 30000 });
    await page.waitForTimeout(2500);
    const check = async (label, extra = {}) => {
      assert.equal(await page.locator('#error').isVisible(), false);
      checks.push({ backend, label, state: await page.locator('#state').innerText(), scene: await page.locator('#scene-status').innerText(), tiles: await page.locator('#tile-status').innerText(), ...extra });
      console.log(JSON.stringify(checks.at(-1)));
    };
    const shot = async name => page.screenshot({ path: `${output}/${backend}-${name}.png` });
    const position = async id => (await page.locator(`#${id}-status`).innerText()).match(/-?\d+\.\d+/g).map(Number);
    const press = async (key, duration) => { await page.locator('canvas').focus(); await page.keyboard.down(key); await page.waitForTimeout(duration); await page.keyboard.up(key); await page.waitForTimeout(300); };
    await check('explicit-backend-loaded');
    for (const view of ['front', 'rear']) {
      phase = `${backend}-${view}`;
      await page.locator(`#${view}`).click();
      for (const fov of [65, 18, 85]) {
        if (fov === 65) await page.locator('#wide').click();
        else if (fov === 18) await page.locator('#scope').click();
        else { await page.locator('#fov').focus(); await page.keyboard.press('End'); }
        assert.equal(await page.locator('#fov-label').innerText(), `${fov}°`);
        await page.waitForTimeout(500); await shot(`${view}-${fov}-panels`);
        const before = createHash('sha256').update(await page.locator('canvas').screenshot()).digest('hex');
        await page.locator('#occluders').click();
        assert.equal(await page.locator('#occluders').getAttribute('aria-pressed'), 'false');
        await page.waitForTimeout(500); await shot(`${view}-${fov}-open`);
        const after = createHash('sha256').update(await page.locator('canvas').screenshot()).digest('hex');
        assert.notEqual(before, after, 'Normal panel toggle changes actual raster');
        await page.locator('#occluders').click();
        await check(`${view}-${fov}-panel-toggle`, { before, after });
      }
    }
    await page.locator('#overview').click(); await page.locator('#wide').click(); await page.waitForTimeout(500);
    await shot('overview');
    const beforeOrbit = createHash('sha256').update(await page.locator('canvas').screenshot()).digest('hex');
    await page.mouse.move(1100, 400); await page.mouse.down(); await page.mouse.move(1250, 450, { steps: 12 }); await page.mouse.up(); await page.mouse.wheel(0, -300); await page.waitForTimeout(600);
    assert.notEqual(createHash('sha256').update(await page.locator('canvas').screenshot()).digest('hex'), beforeOrbit); await check('mouse-orbit-and-zoom');
    phase = `${backend}-physics`;
    const ballRest = await position('ball'); assert.ok(Math.abs(ballRest[1] - 8.575) < .04, `Ball supported at ${ballRest[1]}`);
    await page.locator('#drop').click(); await page.waitForTimeout(180); const ballAir = await position('ball'); assert.ok(ballAir[1] > 10.5);
    await page.waitForTimeout(2600); const ballLanded = await position('ball'); assert.ok(Math.abs(ballLanded[1] - 8.575) < .05); await check('drop-gravity-floor-contact', { ballRest, ballAir, ballLanded });
    await page.locator('#reset-walker').click(); await page.locator('#walk').click(); await page.waitForTimeout(500);
    const start = await position('walker'); assert.ok(Math.abs(start[1] - 9.15) < .05); assert.ok(Math.abs(start[2] - 2) < .02);
    await press('w', 1700); const blocked = await position('walker');
    assert.ok(blocked[2] > 4.1 && blocked[2] < 4.23, `Obstacle stops capsule: ${blocked}`);
    await press('w', 700); const stillBlocked = await position('walker'); assert.ok(Math.abs(stillBlocked[2] - blocked[2]) < .03);
    await shot('walker-blocked'); await check('normal-walking-collides-with-obstacle', { start, blocked, stillBlocked });
    await press('d', 700); const side = await position('walker'); assert.ok(side[0] - blocked[0] > 1.4);
    await press('w', 900); const passed = await position('walker'); assert.ok(passed[2] > 6); await shot('walker-passed'); await check('sidestep-around-obstacle', { side, passed });
    await page.locator('#reset-walker').click(); await page.waitForTimeout(500); const reset = await position('walker'); assert.ok(Math.abs(reset[0] - 38.5) < .02 && Math.abs(reset[2] - 2) < .02); await check('normal-reset', { reset });
    await page.close(); activePage = undefined;
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(logs.filter(log => !(log.type === 'warning' && log.text === 'TilesRenderer: tiles versions at 1.1 or higher have limited support. Some new extensions and features may not be supported.')), []);
} catch (error) {
  errors.push({ phase, error: error.stack || String(error) });
  await activePage?.screenshot({ path: `${output}/failure.png` }).catch(() => {});
} finally {
  await writeFile(`${output}/result.json`, JSON.stringify({ origin, fingerprint: source, browser: browser.version(), viewport: { width: 1600, height: 1000 }, method: 'Normal UI controls and DOM position readouts. Actual GPU raster captures require separate visual review. Original asymmetric tile fixture plus independently authored Havok bodies; no provider data or game controller integration. No performance claim.', checks, errors, logs }, null, 2));
  await browser.close();
  console.log(JSON.stringify({ checks: checks.length, errors, logs }));
  if (errors.length) process.exitCode = 1;
}
