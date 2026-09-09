import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const origin=process.env.AUDIT_URL || 'http://127.0.0.1:4176';
const prefix=`docs/evidence/facility-checkpoint-3-webgl${process.env.AUDIT_SUFFIX || ''}`;
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--use-angle=metal','--enable-webgl','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1600,height:900}});
const checks=[],errors=[],warnings=[],network=[];
page.on('pageerror',e=>{errors.push(e.stack||e.message);console.log('PAGEERROR',e.stack||e.message);});
page.on('console',m=>{if(m.type()==='error'){errors.push(m.text());console.log('CONSOLE_ERROR',m.text());}else if(m.type()==='warning')warnings.push(m.text());});
page.on('response',r=>{if(r.status()>=400)network.push({url:r.url(),status:r.status()});});
page.on('requestfailed',r=>network.push({url:r.url(),failure:r.failure()}));
const state=()=>page.evaluate(()=>{const {frameTimes,...s}=window.__leonida.snapshot(),g=window.__leonida.game,v=g.player.vehicle;return {...s,yaw:g.player.yaw,aim:g.player.aim,headlights:v?.headlights,doorAngles:v?.model.doors.map(d=>({side:d.side,angle:d.angle,enabled:d.mesh.isEnabled()})),mounted:g.player.model.root.parent?.name,guards:g.population.facility.guards.map(o=>({id:o.id,role:o.role,state:o.state,health:o.health,position:o.position.asArray(),enabled:o.model.root.isEnabled(),flashTime:o.flashTime})),toast:document.querySelector('#toast')?.textContent,prompt:document.querySelector('#prompt')?.textContent};});
async function save(){await writeFile(`${prefix}.json`,JSON.stringify({origin,method:'Separate headless Chrome WebGL2. Normal UI keyboard/mouse only; ?test for read-only diagnostics. Concurrent GPU work, no performance gate.',checks,errors,warnings,network},null,2));}
async function capture(label){const s=await state();checks.push({label,wallTime:new Date().toISOString(),...s});await save();await page.screenshot({path:`${prefix}-${label}.png`});console.log(label,JSON.stringify(s));return s;}
async function creative(){await page.mouse.up({button:'right'});await page.keyboard.press('F2');await page.locator('#spawn-kind').waitFor({state:'visible'});}
const close=()=>page.locator('#panel [data-action="close"]').click();
async function rotate(dx,dy=0){await page.mouse.move(800,450);await page.waitForTimeout(100);await page.locator('#game').click({position:{x:800,y:450},delay:30});await page.mouse.down({button:'right'});await page.mouse.move(800+dx,450+dy,{steps:20});await page.mouse.up({button:'right'});await page.waitForTimeout(500);}
async function lookYaw(target){for(let i=0;i<8;i++){const s=await state();let delta=target-s.yaw;while(delta>Math.PI)delta-=Math.PI*2;while(delta< -Math.PI)delta+=Math.PI*2;if(Math.abs(delta)<.025)return;await creative();await close();await rotate(Math.max(-450,Math.min(450,delta/.0025)));}throw new Error('Normal mouse drag could not reach requested view direction');}
try{
 await page.goto(`${origin}/?backend=webgl&test`,{waitUntil:'domcontentloaded'});
 checks.push({label:'build',module:await page.locator('script[type="module"]').getAttribute('src'),browser:browser.version()});
 await page.waitForTimeout(4000);const startup=await page.locator('body').innerText();console.log('STARTUP',startup);if(startup.includes('Unable to start:'))throw new Error(startup);
 await page.locator('[data-action="play"]').waitFor({state:'visible',timeout:100000});
 assert.equal((await state()).backend,'WebGL2');
 await page.locator('[data-action="play"]').click();await page.waitForTimeout(1800);
 await page.keyboard.down('w');await page.waitForTimeout(450);await page.keyboard.up('w');
 await page.keyboard.press('e');await page.waitForTimeout(240);await capture('entry-door');
 await page.waitForTimeout(1200);assert.ok((await state()).vehicle);
 await rotate(570,-90);await capture('cabin-side');
 await creative();await page.locator('[data-change="god"]').check();await page.locator('[data-change="time"]').fill('23');await page.locator('[data-change="time"]').dispatchEvent('change');await close();await page.waitForTimeout(1400);
 await capture('night-lights-on');await page.keyboard.press('l');await page.waitForTimeout(400);assert.equal((await capture('night-lights-off')).headlights,false);
 await page.keyboard.press('l');await page.waitForTimeout(350);await page.keyboard.press('e');await page.waitForTimeout(220);await capture('exit-door');
 await creative();await page.locator('[data-change="time"]').fill('15');await page.locator('[data-change="time"]').dispatchEvent('change');await page.locator('[data-action="clear-weapons"]').click();await page.locator('[data-action="reset"]').click();await page.locator('[data-change="god"]').uncheck();await close();
 await page.keyboard.press('m');await page.locator('[data-action="teleport"][data-value="restricted-compound"]').click();
 await page.waitForFunction(()=>Math.abs(window.__leonida.snapshot().position[0]+449)<3&&!window.__leonida.snapshot().streamingBusy,{},{timeout:45000});await page.waitForTimeout(1400);
 // Turn west through a normal RMB drag while still outside the annex.
 let s=await state();await lookYaw(-Math.PI/2);
 await capture('closed-gate');
 await page.keyboard.down('w');await page.waitForTimeout(2000);await page.keyboard.up('w');s=await capture('closed-gate-contact');assert.equal(s.facility.inside,false);
 await page.keyboard.press('e');await page.waitForTimeout(1700);s=await capture('visitor-access');assert.equal(s.facility.phase,'authorized');assert.equal(s.facility.gateOpen,true);
 await page.keyboard.down('w');await page.waitForTimeout(2200);await page.keyboard.up('w');s=await capture('inside-guard');assert.equal(s.facility.inside,true);
 await page.mouse.down({button:'right'});await page.waitForTimeout(700);s=await capture('armed-warning');assert.equal(s.facility.phase,'warning');
 await page.waitForTimeout(6800);s=await capture('armed-alarm');assert.equal(s.facility.phase,'alarm');
 // Shot states last one frame; use received damage over an interval instead.
 await page.waitForFunction(()=>window.__leonida.snapshot().health<100,{},{timeout:4000});s=await capture('guard-response');assert.ok(s.health<100);await page.mouse.up({button:'right'});
}catch(e){errors.push(e.stack||String(e));console.log('FAILURE',e.stack||String(e));await page.screenshot({path:`${prefix}-failure.png`}).catch(()=>{});}
finally{await save();await browser.close();console.log('RESULT',JSON.stringify({checks:checks.length,errors,network}));}
