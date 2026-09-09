import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const origin = process.env.AUDIT_URL || 'http://127.0.0.1:4193';
const backend = process.env.AUDIT_BACKEND || 'webgpu';
const directory = `docs/evidence/sky-gameplay-${backend}-${process.env.AUDIT_VARIANT || 'integrated'}`;
const method = 'Fresh normal game launch, map fast travel, Creative time/weather/rule controls, keyboard noclip ascent, and pointer-lock mouse look. Test hooks only read loaded scene diagnostics; no game-state assignments or test actions.';
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const checks = [], errors = [];
page.on('pageerror', error => errors.push(error.stack || error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
const near = (actual, expected, tolerance = 1e-5) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} is near ${expected}`);
const writeResult = () => writeFile(`${directory}/result.json`, JSON.stringify({ origin, backend, method, resolution: [1600, 900], checks, errors }, null, 2));

async function creative() {
  await page.keyboard.press('F2');
  await page.locator('[data-change="time"]').waitFor({ state: 'visible' });
}
async function closePanel() { await page.locator('#panel [data-action="close"]').click(); }
async function setScene(time, weather) {
  await creative();
  const slider = page.locator('[data-change="time"]');
  await slider.focus();
  // Exercise the actual native range control with keyboard input. End/Home
  // and arrow keys also trigger its normal change handler.
  const steps = Math.round(time * 10), fromEnd = steps > 119;
  await slider.press(fromEnd ? 'End' : 'Home');
  for (let n = 0; n < (fromEnd ? 239 - steps : steps); n++) await slider.press(fromEnd ? 'ArrowLeft' : 'ArrowRight');
  near(Number(await slider.inputValue()), time);
  await page.locator('[data-change="weather"]').selectOption(weather);
  await closePanel();
  await page.waitForTimeout(1200);
}
async function look(yaw, pitch) {
  await page.locator('#game').click({ position: { x: 800, y: 450 }, delay: 30 });
  await page.waitForFunction(() => document.pointerLockElement?.id === 'game');
  let mouseX = 800, mouseY = 450;
  for (let attempt = 0; attempt < 8; attempt++) {
    const current = await page.evaluate(() => ({ yaw: window.__leonida.game.player.yaw, pitch: window.__leonida.game.player.pitch }));
    const deltaYaw = Math.atan2(Math.sin(yaw - current.yaw), Math.cos(yaw - current.yaw));
    if (Math.abs(deltaYaw) < .01 && Math.abs(pitch - current.pitch) < .01) break;
    mouseX += Math.max(-450, Math.min(450, deltaYaw / .0025));
    mouseY += Math.max(-250, Math.min(250, (pitch - current.pitch) / .002));
    await page.mouse.move(mouseX, mouseY, { steps: 12 });
    await page.waitForTimeout(180);
  }
  await page.waitForTimeout(500);
  const current = await page.evaluate(() => ({ yaw: window.__leonida.game.player.yaw, pitch: window.__leonida.game.player.pitch }));
  near(Math.atan2(Math.sin(current.yaw - yaw), Math.cos(current.yaw - yaw)), 0, .02);
  near(current.pitch, pitch, .02);
}
async function capture(label, time, weather) {
  const state = await page.evaluate(() => {
    const { scene, player } = window.__leonida.game;
    const dome = scene.getMeshByName('sky/dome'), stars = scene.getMeshByName('sky/stars');
    const material = dome?.material, sun = scene.getLightByName('sun'), V = player.position.constructor;
    const meshState = mesh => mesh ? { name: mesh.name, enabled: mesh.isEnabled(), pickable: mesh.isPickable, applyFog: mesh.applyFog, infiniteDistance: mesh.infiniteDistance, triangles: mesh.getTotalIndices() / 3, material: mesh.material?.name, materialId: mesh.material?.uniqueId, depthWriteDisabled: mesh.material?.disableDepthWrite, renderingGroupId: mesh.renderingGroupId, scale: mesh.scaling.asArray(), effectReady: mesh.subMeshes?.[0]?.effect?.isReady() ?? null } : null;
    const sunDirection = material?.sunPosition.normalizeToNew();
    const active = scene.getActiveMeshes().data.slice(0, scene.getActiveMeshes().length);
    const world = active.filter(mesh => !mesh.metadata?.sky && mesh.isVisible && mesh.isEnabled() && mesh.getTotalVertices() && mesh.material);
    const opaque = world.filter(mesh => !mesh.material.needAlphaBlendingForMesh(mesh) && mesh.renderingGroupId === dome?.renderingGroupId);
    const distant = world.map(mesh => ({ name: mesh.name, material: mesh.material.name, distance: V.Distance(mesh.getBoundingInfo().boundingSphere.centerWorld, scene.activeCamera.position), materialId: mesh.material.uniqueId, triangles: mesh.getTotalIndices() / 3 })).filter(mesh => mesh.distance > 400).sort((a, b) => b.distance - a.distance).slice(0, 12);
    const { frameTimes, fps, ...snapshot } = window.__leonida.snapshot();
    return { ...snapshot, clock: document.querySelector('#clock')?.textContent, weather: document.querySelector('#weather')?.textContent,
      view: { yaw: player.yaw, pitch: player.pitch, camera: scene.activeCamera.position.asArray(), far: scene.activeCamera.maxZ, forward: scene.activeCamera.getForwardRay().direction.asArray() },
      sky: { dome: meshState(dome), stars: meshState(stars), meshCount: scene.meshes.filter(mesh => mesh.metadata?.sky).length, materialCount: scene.materials.filter(mat => mat.name.startsWith('sky/')).length, sunPosition: material?.sunPosition.asArray(), sunDirection: sunDirection?.asArray(), turbidity: material?.turbidity, mieCoefficient: material?.mieCoefficient, rayleigh: material?.rayleigh, shaderLanguage: material?.shaderLanguage, starAlpha: stars?.material?.alpha },
      lighting: sun ? { direction: sun.direction.asArray(), intensity: sun.intensity, solarDot: V.Dot(sun.direction.normalizeToNew(), sunDirection), position: sun.position.asArray(), diffuse: sun.diffuse.asArray(), environmentIntensity: scene.environmentIntensity } : null,
      fog: { color: scene.fogColor.asArray(), density: scene.fogDensity },
      visibility: { activeWorldMeshes: world.length, opaqueMaterialOrderViolations: opaque.filter(mesh => mesh.material.uniqueId < material.uniqueId).map(mesh => mesh.name), activeDistantMeshes: distant },
    };
  });
  checks.push({ label, requested: { time, weather }, ...state });
  await page.screenshot({ path: `${directory}/${label}.png` });
  await writeResult();
  console.log(label, JSON.stringify({ clock: state.clock, weather: state.weather, sky: state.sky, lighting: state.lighting, fog: state.fog, visibility: state.visibility }));
  assert.equal(state.backend, backend === 'webgpu' ? 'WebGPU' : 'WebGL2');
  assert.equal(state.weather, weather.toUpperCase());
  assert.equal(state.sky.shaderLanguage, backend === 'webgpu' ? 1 : 0);
  assert.equal(state.sky.meshCount, 2); assert.equal(state.sky.materialCount, 2);
  for (const mesh of [state.sky.dome, state.sky.stars]) {
    assert.ok(mesh.infiniteDistance && mesh.depthWriteDisabled && !mesh.pickable && !mesh.applyFog);
  }
  assert.equal(state.sky.dome.triangles, 12); assert.equal(state.sky.stars.triangles, 320);
  assert.ok(state.sky.dome.effectReady, 'loaded sky shader is compiled and ready');
  near(Math.hypot(...state.sky.sunPosition), 450000, .001);
  near(state.lighting.solarDot, -1);
  const [x, y] = state.sky.sunDirection;
  const elevation = y / Math.hypot(x, y), daylight = Math.max(0, elevation), night = Math.max(0, Math.min(1, (-elevation - .025) / .2));
  near(state.lighting.intensity, daylight * 2.6 * (weather === 'Rain' ? .4 : 1));
  near(state.sky.starAlpha, night * (weather === 'Rain' ? 0 : weather === 'Haze' ? .18 : .8));
  assert.equal(state.sky.stars.enabled, state.sky.starAlpha > .001);
  if (state.sky.stars.enabled) assert.ok(state.sky.stars.effectReady, 'visible star shader is ready');
  near(state.sky.turbidity, weather === 'Rain' ? 18 : weather === 'Haze' ? 10 : 3.8);
  near(state.fog.density, weather === 'Rain' ? .003 : weather === 'Haze' ? .004 : .00125);
  const dayColor = weather === 'Rain' ? [.36, .4, .43] : weather === 'Haze' ? [.64, .65, .62] : [.56, .7, .8];
  const twilight = [.46, .32, .28], nightColor = [.018, .027, .048];
  for (let channel = 0; channel < 3; channel++) {
    const horizon = twilight[channel] + (dayColor[channel] - twilight[channel]) * Math.min(1, daylight * 3);
    near(state.fog.color[channel], horizon + (nightColor[channel] - horizon) * night);
  }
  assert.ok(state.visibility.activeWorldMeshes > 10, 'world geometry remains active with the sky');
  assert.deepEqual(state.visibility.opaqueMaterialOrderViolations, [], 'depth-free sky draws before opaque world materials');
  near(state.sky.dome.scale[0], state.view.far * .55 / 1000);
  near(state.sky.stars.scale[0], state.view.far * .98);
  const [hour, minute] = state.clock.split(':').map(Number);
  assert.ok(Math.abs(hour + minute / 60 - time) < .15, 'Creative clock control reached the requested time');
  return state;
}

try {
  await page.goto(`${origin}/?backend=${backend}&test`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-action="play"]').waitFor({ state: 'visible', timeout: 120000 });
  const module = await page.locator('script[type="module"]').getAttribute('src');
  const [moduleBytes, manifestBytes] = await Promise.all([module, '/world/manifest.json'].map(async path => Buffer.from(await (await fetch(new URL(path, origin))).arrayBuffer())));
  checks.push({ label: 'build', module, sha256: createHash('sha256').update(moduleBytes).digest('hex'), browser: browser.version(), manifest: { build: JSON.parse(manifestBytes).build, sha256: createHash('sha256').update(manifestBytes).digest('hex') } });
  await page.locator('[data-action="play"]').click(); await page.waitForTimeout(1800);
  await creative();
  await page.locator('[data-change="god"]').check();
  await page.locator('[data-change="police"]').uncheck();
  await page.locator('[data-action="clear-weapons"]').click();
  await closePanel();
  await setScene(12, 'Clear'); await capture('day-street', 12, 'Clear');
  const destination = await page.evaluate(() => window.__leonida.game.world.locations.filter(location => /beach/i.test(location.name + location.type)).sort((a, b) => Math.abs(a.x - 180) - Math.abs(b.x - 180))[0]?.id);
  assert.ok(destination, 'normal beach map destination exists');
  await page.keyboard.press('m'); await page.locator(`[data-action="teleport"][data-value="${destination}"]`).click();
  await page.waitForFunction(() => !window.__leonida.snapshot().streamingBusy); await page.waitForTimeout(1800);
  await creative(); await page.locator('[data-change="noclip"]').check(); await closePanel();
  const ground = await page.evaluate(() => window.__leonida.snapshot().position[1]);
  await page.keyboard.down('Space'); await page.waitForTimeout(1700); await page.keyboard.up('Space');
  await page.waitForTimeout(400);
  assert.ok(await page.evaluate(() => window.__leonida.snapshot().position[1]) > ground + 30, 'normal Creative flight ascended for a coastal skyline view');
  await look(-Math.PI / 2, .08);
  for (const [label, time, weather] of [['day-coast', 12, 'Clear'], ['sunset', 17.8, 'Clear'], ['night', 23, 'Clear'], ['haze', 15, 'Haze'], ['rain', 15, 'Rain'], ['night-rain', 23, 'Rain']]) {
    await setScene(time, weather); await capture(label, time, weather);
  }
  await setScene(23, 'Clear'); await look(-Math.PI / 2, -.5); await capture('night-stars', 23, 'Clear');
  assert.equal(errors.length, 0, 'no browser runtime or console errors');
} catch (error) {
  errors.push(error.stack || String(error)); await page.screenshot({ path: `${directory}/failure.png` }).catch(() => {});
} finally {
  await writeResult(); await browser.close(); console.log('RESULT', JSON.stringify({ stages: checks.filter(check => check.label !== 'build').length, errors }));
  if (errors.length) process.exitCode = 1;
}
