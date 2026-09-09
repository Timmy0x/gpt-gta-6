import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
const prefix = 'docs/evidence/police-checkpoint-threat-retest';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal', '--enable-webgl', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const checks = [], errors = [];
page.on('pageerror', e => errors.push(e.stack || e.message));
page.on('console', m => {if(m.type()==='error')errors.push(m.text());});
const save = () => writeFile(`${prefix}.json`,JSON.stringify({method:'Normal UI and keyboard/mouse, including canvas click to capture pointer. ?test enables read-only state inspection; no gameplay state mutations. Concurrent GPU testing, no performance gate.',checks,errors},null,2));
async function capture(label, screenshot = false) {
  const s = await page.evaluate(() => {const g = window.__leonida.game;const {frameTimes,...snapshot}=window.__leonida.snapshot();return {...snapshot,aim:g.player.aim,inputAim:g.player.input.aim,inputFire:g.player.input.mouseDown,officers:g.population.officers.map(o=>({id:o.id,role:o.role,state:o.state,health:o.health,position:o.model.root.position.asArray(),vehicleId:o.vehicleId,flashTime:o.flashTime})),responseVehicles:g.population.drivers.filter(d=>d.police).map(d=>({id:d.v.id,kind:d.v.kind,speed:d.v.speed,occupied:d.v.occupied,position:d.v.root.position.asArray()})),outcome:document.querySelector('#outcome').textContent};});
  checks.push({label,wallTime:new Date().toISOString(),...s});console.log(JSON.stringify({label,aim:s.aim,health:s.health,shots:s.shots,police:s.population.police,officers:s.officers,responseVehicles:s.responseVehicles}));await save();if(screenshot)await page.screenshot({path:`${prefix}-${label}.png`});return s;
}
async function configure(stars,god) {
  await page.mouse.up({button:'right'});await page.mouse.up({button:'left'});await page.keyboard.press('F2');await page.locator('#spawn-kind').waitFor({state:'visible'});
  await page.locator('[data-action="reset"]').click();await page.locator('[data-change="god"]').setChecked(god);await page.locator('[data-change="wanted"]').selectOption(String(stars));await page.locator('#panel [data-action="close"]').click();await page.waitForTimeout(300);
  await page.locator('#game').click({position:{x:800,y:450},delay:50});await page.waitForTimeout(300);await page.mouse.down({button:'right'});await page.waitForTimeout(300);
}
try {
  await page.goto('http://127.0.0.1:4175/?backend=webgl&test',{waitUntil:'domcontentloaded'});await page.locator('[data-action="play"]').waitFor({state:'visible',timeout:120000});checks.push({label:'build',module:await page.locator('script[type="module"]').getAttribute('src'),browser:browser.version()});
  await page.locator('[data-action="play"]').click();await page.waitForTimeout(3000);
  await configure(2,false);let s=await capture('level2-threat-start',true);if(!s.aim)throw new Error('Aim did not activate after ordinary canvas capture');
  for(let i=1;i<=7;i++){await page.waitForTimeout(5000);s=await capture(`level2-threat-${i*5}s`,i>=4);if(s.health<=0)break;}
  await configure(5,true);s=await capture('level5-threat-start',true);if(!s.aim)throw new Error('Aim did not activate for level 5');
  for(let i=1;i<=9;i++){await page.waitForTimeout(5000);s=await capture(`level5-threat-${i*5}s`,i%3===0);}
  await page.mouse.down({button:'left'});await page.waitForTimeout(400);await page.mouse.up({button:'left'});await capture('level5-fire',true);
  await page.mouse.move(1040,300,{steps:20});await page.waitForTimeout(600);await capture('level5-air-view',true);await page.mouse.up({button:'right'});
} catch(e) {errors.push(e.stack||e.message);console.error(e);await page.screenshot({path:`${prefix}-failure.png`}).catch(()=>{});}
finally {await save();await browser.close();console.log(JSON.stringify({artifact:`${prefix}.json`,errors}));}
