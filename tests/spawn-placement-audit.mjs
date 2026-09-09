import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const origin=process.env.AUDIT_URL||'http://127.0.0.1:4182',backend=process.env.AUDIT_BACKEND||'webgpu',out=`docs/evidence/safe-spawn-${backend}${process.env.AUDIT_SUFFIX||""}`;await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu']});const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[],checks=[];
const state=()=>page.evaluate(()=>{const g=window.__leonida.game;return{position:g.player.position.asArray(),vehicles:g.vehicles.list.map(v=>({id:v.id,kind:v.kind,position:v.root.position.asArray(),heading:v.heading,width:v.tuning.width,length:v.tuning.length,health:v.health})),toast:document.querySelector('#toast')?.textContent}});
page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto(`${origin}/?backend=${backend}&test`,{waitUntil:'domcontentloaded'});await page.locator('#welcome:not(.hidden)').waitFor({timeout:120000});await page.locator('[data-action="play"]').click();await page.waitForTimeout(2000);const initial=await state();checks.push({name:'initial',state:initial});
 await page.keyboard.press('F2');await page.locator('#spawn-kind').selectOption('concept');
 for(let i=0;i<2;i++){
  await page.locator('[data-action="spawn"]').click();await page.waitForFunction(expected=>window.__leonida.game.vehicles.list.filter(v=>v.kind==='concept').length===expected,initial.vehicles.filter(v=>v.kind==="concept").length+i+1,{timeout:45000});await page.waitForTimeout(1500);const s=await state();checks.push({name:`concept-${i+1}`,state:s});
  const newer=s.vehicles.filter(v=>!initial.vehicles.some(old=>old.id===v.id));
  for(const v of newer){assert.ok(v.health>99,'spawned detailed car is not damaged by overlapping another car');for(const other of s.vehicles){if(v.id===other.id)continue;const dx=Math.abs(v.position[0]-other.position[0]),dz=Math.abs(v.position[2]-other.position[2]);assert.ok(dx>(v.width+other.width)/2||dz>(v.length+other.length)/2,'axis-aligned startup vehicles do not share a footprint');}}
 }
 await page.locator('[data-action="close"]').click();await page.screenshot({path:`${out}/two-clear-concept-cars.png`});
}catch(e){errors.push(e.stack||e.message);await page.screenshot({path:`${out}/failure.png`}).catch(()=>{});}finally{await fs.writeFile(`${out}/result.json`,JSON.stringify({origin,backend,checks,errors},null,2));await browser.close();}
console.log(JSON.stringify({out,errors,checks:checks.map(c=>({name:c.name,newCars:c.state.vehicles.filter(v=>v.kind==='concept')}))}));process.exit(errors.length?1:0);
