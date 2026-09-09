import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
const output = new URL('../docs/evidence/', import.meta.url).pathname;
await mkdir(output, { recursive: true });
const suffix = process.env.POLICE_AUDIT_SUFFIX || 'normal-webgl';
const base = process.env.POLICE_AUDIT_URL || 'http://127.0.0.1:4175';
const prefix = `${output}police-checkpoint-${suffix}`;
const observations = [], errors = [], consoleMessages = [];
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal', '--enable-webgl', '--ignore-gpu-blocklist'] });
const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const page = await context.newPage();
page.on('pageerror', e => { errors.push({ message: e.message, stack: e.stack }); console.log('PAGEERROR', e.message); });
page.on('requestfailed', r => errors.push({ url: r.url(), failure: r.failure() }));
page.on('console', m => { if (['warning', 'error'].includes(m.type())) consoleMessages.push({ type: m.type(), text: m.text(), location: m.location() }); });
page.on('response', r => { if (r.status() >= 400) consoleMessages.push({ status: r.status(), url: r.url() }); });
const saveReport = () => writeFile(`${prefix}.json`, JSON.stringify({ observations, errors, consoleMessages }, null, 2));
const capture = label => page.screenshot({ path: `${prefix}-${label}.png` });
const state = () => page.evaluate(() => { const { frameTimes, ...value } = window.__leonida.snapshot(); return { ...value, frameSamples: frameTimes.length }; });
const record = async label => { const value = await state(); const entry = { label, wallTime: new Date().toISOString(), ...value }; observations.push(entry); console.log(JSON.stringify(entry)); await saveReport(); return value; };
const open = async () => { await page.keyboard.press('F2'); await page.locator('#spawn-kind').waitFor({ state: 'visible' }); };
const close = async () => { await page.locator('#panel [data-action="close"]').click(); await page.locator('#panel').waitFor({ state: 'hidden' }); };
const configure = async (level, god) => { await page.mouse.up({ button: 'right' }); await page.mouse.up({ button: 'left' }); await open(); await page.locator('[data-action="reset"]').click(); await page.locator('[data-change="god"]').setChecked(god); await page.locator('[data-change="wanted"]').selectOption(String(level)); await close(); await page.mouse.move(800, 450); };
const observe = async (label, seconds, stopAfterRecovery = false) => {
  const end = Date.now() + seconds * 1000;
  let next = 0, outcomeBefore = '', hadOutcome = false, capturedFoot = false, capturedTactical = false, lastSim = -1, stalled = 0;
  while (Date.now() < end) {
    const outcome = await page.locator('#outcome').isVisible() ? await page.locator('#outcome').innerText() : '';
    if (outcome !== outcomeBefore) { observations.push({ label: `${label}-outcome`, value: outcome, cash: await page.locator('#money').innerText(), at: new Date().toISOString() }); console.log(label, 'OUTCOME', outcome); if (outcome) { await capture(`${label}-${outcome.toLowerCase()}`); hadOutcome = true; } outcomeBefore = outcome; if (!outcome && hadOutcome && stopAfterRecovery) break; }
    if (Date.now() > next) {
      const value = await record(`${label}-${Math.round(seconds - (end - Date.now()) / 1000)}s`);
      const police = value.population.police;
      if (police.activeFoot > 0 && !capturedFoot) { await capture(`${label}-first-foot`); capturedFoot = true; }
      if (police.swat > 0 && !capturedTactical) { await capture(`${label}-tactical`); capturedTactical = true; }
      stalled = value.simTime === lastSim && !value.paused ? stalled + 1 : 0; lastSim = value.simTime;
      if (stalled >= 2) throw new Error(`Simulation stopped during ${label}`);
      next = Date.now() + 5000;
    }
    await page.waitForTimeout(300);
  }
  const final = await record(`${label}-end`); await capture(`${label}-end`);
  observations.push({ label: `${label}-outcome-summary`, hadOutcome, capturedFoot, capturedTactical, health: final.health, cash: await page.locator('#money').innerText() });
};
const readSave = async label => { const storage = await context.storageState(); const entry = storage.origins.flatMap(o => o.localStorage).find(v => v.name === 'leonida.sandbox.v1'); if (!entry) throw new Error('UI save was not written'); const value = JSON.parse(entry.value); const summary = { label, vehicles: value.vehicles.map(v => ({ id: v.id, kind: v.kind, health: v.health, damage: v.damage })), civilians: value.civilians, props: value.props, player: value.player, weather: value.weather }; observations.push(summary); return summary; };
try {
  await page.goto(`${base}/?backend=webgl`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.locator('[data-action="play"]').waitFor({ state: 'visible', timeout: 120000 });
  const module = await page.locator('script[type="module"]').getAttribute('src');
  observations.push({ label: 'environment', title: await page.title(), url: page.url(), module, browser: browser.version(), cpu: os.cpus()[0]?.model, platform: os.platform(), release: os.release(), resolution: [1600,900], headless: true, controls: 'normal UI and keyboard/mouse; no ?test; read-only snapshot and UI-generated sandbox saves', concurrentGPUAudit: true });
  await capture('welcome'); await page.locator('[data-action="play"]').click(); await page.waitForFunction(() => window.__leonida?.snapshot().simTime > .2, null, { timeout: 30000 }); await record('launched');
  await configure(1, false); await observe('level-1-compliance', 65, true);
  await configure(2, false); await page.mouse.down({ button: 'right' }); await observe('level-2-armed-threat', 28, true); await page.mouse.up({ button: 'right' });
  await configure(3, true); await page.mouse.down({ button: 'right' }); await observe('level-3-tactical', 28); await page.mouse.up({ button: 'right' });
  await configure(4, true); await page.mouse.down({ button: 'right' }); await observe('level-4-roadblock-air', 38); await page.mouse.up({ button: 'right' });
  await configure(5, true); await page.mouse.down({ button: 'right' }); await observe('level-5-response', 42);
  const beforeShots = await record('before-player-fire'); await page.mouse.down({ button: 'left' }); await page.waitForTimeout(1200); await page.mouse.up({ button: 'left' }); const afterShots = await record('after-player-fire');
  observations.push({ label: 'normal-player-fire', shotsDelta: afterShots.shots - beforeShots.shots, resisting: afterShots.population.police.resisting });
  await capture('armed-response'); await page.mouse.move(1100, 320, { steps: 15 }); await page.waitForTimeout(800); await capture('response-sky-view'); await page.mouse.up({ button: 'right' });
  await configure(0, true); await open(); await page.locator('[data-action="ped"]').click(); await page.locator('#spawn-kind').selectOption('sedan'); await page.locator('[data-action="spawn"]').click(); await page.locator('[data-action="save"]').click(); const beforeSave = await readSave('ui-save-before');
  await page.locator('[data-action="ped"]').click(); await page.locator('#spawn-kind').selectOption('suv'); await page.locator('[data-action="spawn"]').click(); await record('post-save-additions'); await page.locator('[data-action="load"]').click(); await page.locator('[data-action="save"]').click(); const afterSave = await readSave('ui-save-after');
  const beforeIds = beforeSave.vehicles.map(v=>v.id), afterIds = afterSave.vehicles.map(v=>v.id), beforeCivilians = beforeSave.civilians.map(v=>v.id), afterCivilians = afterSave.civilians.map(v=>v.id);
  observations.push({ label: 'save-stable-ids', vehicleIdsMatch: JSON.stringify(beforeIds) === JSON.stringify(afterIds), civilianIdsMatch: JSON.stringify(beforeCivilians) === JSON.stringify(afterCivilians), beforeIds, afterIds, beforeCivilians, afterCivilians, uniqueCivilians: new Set(afterCivilians).size === afterCivilians.length });
  await close(); await page.waitForTimeout(600); await record('save-restored'); await capture('save-restored');
} catch (e) { errors.push({ auditFailure: e.message, stack: e.stack }); console.error(e); await capture('failure').catch(()=>{}); }
finally { await saveReport(); await context.close(); await browser.close(); console.log(JSON.stringify({ artifact: `${prefix}.json`, errorCount: errors.length, warningCount: consoleMessages.length })); }
