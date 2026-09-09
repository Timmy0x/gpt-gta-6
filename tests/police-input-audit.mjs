import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
const prefix = 'docs/evidence/police-checkpoint-input-probe';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal', '--enable-webgl', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const events = [], errors = [], checks = [];
page.on('pageerror', e => errors.push(e.stack || e.message));
await page.exposeFunction('reportObservedInput', e => events.push(e));
const read = async label => { const value = await page.evaluate(() => { const g = window.__leonida.game; return { activeElement: document.activeElement?.outerHTML.slice(0,150), target: document.elementsFromPoint(800,450).map(e=>[e.tagName,e.id,getComputedStyle(e).pointerEvents]), focus:document.hasFocus(), visibility:document.visibilityState, pointerLock:document.pointerLockElement?.id, inputAim:g.player.input.aim, inputFire:g.player.input.mouseDown, playerAim:g.player.aim, health:g.player.health, shots:g.combat.shots, snapshot:window.__leonida.snapshot() }; }); delete value.snapshot.frameTimes; checks.push({label,...value}); console.log(JSON.stringify({label,...value})); return value; };
try {
  await page.goto('http://127.0.0.1:4175/?backend=webgl&test', { waitUntil:'domcontentloaded' });
  await page.locator('[data-action="play"]').waitFor({state:'visible',timeout:120000});
  await page.evaluate(() => { for(const type of ['mousedown','mouseup','click','contextmenu','pointerlockchange','blur','focus']) document.addEventListener(type,e=>window.reportObservedInput({type,target:e.target?.id,button:e.button,buttons:e.buttons,x:e.clientX,y:e.clientY,pointerLock:document.pointerLockElement?.id,time:performance.now()}),true); });
  await page.locator('[data-action="play"]').click(); await page.waitForTimeout(3000);
  await page.keyboard.press('F2'); await page.locator('#spawn-kind').waitFor({state:'visible'});
  await page.locator('[data-action="reset"]').click(); await page.locator('[data-change="god"]').check(); await page.locator('[data-change="wanted"]').selectOption('2');
  await page.locator('#panel [data-action="close"]').click(); await page.locator('#panel').waitFor({state:'hidden'});
  await page.mouse.move(800,450); await read('before-mouse');
  await page.mouse.down({button:'right'}); await page.waitForTimeout(500); await read('after-right');
  await page.mouse.down({button:'left'}); await page.waitForTimeout(600); await read('during-left'); await page.mouse.up({button:'left'}); await page.mouse.up({button:'right'}); await read('after-release');
  await page.locator('#game').click({button:'right',position:{x:750,y:440},delay:500}); await read('canvas-right-locator');
  await page.mouse.move(750,440); await page.mouse.down({button:'right'}); await page.waitForTimeout(250);
  await page.mouse.down({button:'left'}); await page.waitForTimeout(400); await page.mouse.up({button:'left'}); await read('off-center-fire'); await page.mouse.up({button:'right'});
  await page.screenshot({path:`${prefix}.png`});
} catch(e) {errors.push(e.stack || e.message); console.error(e);}
finally { await writeFile(`${prefix}.json`,JSON.stringify({method:'Normal keyboard/mouse controls; ?test only exposes read-only input state; passive DOM event observation only',checks,events,errors},null,2)); await browser.close(); }
