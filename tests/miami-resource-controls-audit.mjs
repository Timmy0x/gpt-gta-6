import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const origin = process.env.AUDIT_URL || 'http://127.0.0.1:4693';
const output = process.env.AUDIT_OUTPUT || 'docs/evidence/miami-resource-controls-r1';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const checks = [], errors = [], warnings = [];
const html = await (await fetch(origin)).text(), entry = html.match(/<script[^>]*src="([^"]+)"/)[1];
const fingerprint = { entry, sha256: createHash('sha256').update(Buffer.from(await (await fetch(new URL(entry, origin))).arrayBuffer())).digest('hex') };
try {
  for (const mode of ['rh-source', 'lh-webgl2', 'lh-webgpu']) {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    page.on('pageerror', error => errors.push({ mode, message: error.message }));
    page.on('console', message => { if (message.type() === 'error') errors.push({ mode, message: message.text() }); if (message.type() === 'warning') warnings.push({ mode, message: message.text() }); });
    await page.goto(origin, { waitUntil: 'networkidle' });
    if (mode !== 'rh-source') { await page.locator('#renderer').selectOption(mode); await page.waitForLoadState('networkidle'); }
    await page.locator('#source').selectOption('fixture'); assert.equal(await page.locator('#auth').isVisible(), false); assert.equal(await page.locator('#ion-options').isVisible(), false); await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await page.waitForFunction(() => Number(document.querySelector('#metrics')?.dataset.visible) === 2, null, { timeout: 25000 });
    await page.waitForTimeout(2500);
    const panel = page.locator('#resource-estimates');
    const text = await panel.innerText();
    assert.match(text, /2 resident · 2 visible · 0 cached/);
    assert.match(text, /Encoded GLB: (?!0 B)/);
    assert.doesNotMatch(text, /Resource inspection unavailable/);
    await page.screenshot({ path: `${output}/${mode}-fixture.png` });
    await page.locator('summary').click();
    const stream = page.locator('#stream-status');
    assert.match(await stream.innerText(), /LRU admitted: 2 \/ 960/);
    for (const capacity of ['480', '960', '240']) {
      await page.getByRole('combobox', { name: 'Cache capacity', exact: true }).selectOption(capacity);
      await page.waitForFunction(capacity => document.querySelector('#stream-status').textContent.includes(`LRU admitted: 2 / ${capacity}`), capacity);
      assert.equal(await page.locator('#metrics').getAttribute('data-visible'), '2');
    }

    const profile = JSON.parse(await page.locator('#structural-profile').innerText());
    assert.equal(profile.loadedContent.glb, 2); assert.equal(profile.missingGltfMetadata, 0);
    assert.equal(profile.buffers.embedded, 2); assert.equal(profile.images.external, 0);
    await page.locator('.resource-panel').screenshot({ path: `${output}/${mode}-resources.png` });
    const frame = await page.locator('#frame-status').innerText();
    if (mode !== 'rh-source') assert.match(frame, /LH metres · one scene\/camera · game postprocess/);
    await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
    assert.match(await panel.innerText(), /No resident tiles/); assert.match(await page.locator('#structural-profile').innerText(), /No connection/);
    assert.match(await stream.innerText(), /Streaming · disconnected/);
    checks.push({ cacheControls: ['480','960','240'], streamingCleared: true, mode, frame, resourcePanel: text, loadedGlb: profile.loadedContent.glb, disconnectCleared: true });
    console.log(JSON.stringify(checks.at(-1))); await page.close();
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings.filter(item => item.message !== 'TilesRenderer: tiles versions at 1.1 or higher have limited support. Some new extensions and features may not be supported.'), []);
} catch (error) { errors.push({ message: error.stack || String(error) }); }
finally {
  await writeFile(`${output}/result.json`, JSON.stringify({ origin, fingerprint, browser: browser.version(), scope: 'Normal UI original fixture loading and resource diagnostics in RH WebGL2, LH WebGL2 and LH WebGPU. No provider data or credentials. Resource estimates are not measured VRAM.', checks, errors, warnings }, null, 2));
  await browser.close(); console.log(JSON.stringify({ checks: checks.length, errors })); if (errors.length) process.exitCode = 1;
}
