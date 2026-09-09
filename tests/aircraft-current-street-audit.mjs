import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const origin=process.env.AUDIT_URL||'http://127.0.0.1:5174', label=process.env.AUDIT_LABEL||'metre-uv-v5', backend=process.env.AUDIT_BACKEND||'webgpu';
const output=`docs/evidence/aircraft-controls-${label}-${backend}`;await fs.mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
const results=[],errors=[];
const indexResponse=await fetch(origin),indexHtml=await indexResponse.text(),entryPath=indexHtml.match(/<script[^>]*src="([^"]+)"/)[1];
const entryBytes=Buffer.from(await(await fetch(origin+entryPath)).arrayBuffer());
const worldManifest=await(await fetch(origin+'/world/manifest.json')).json();
assert.equal(worldManifest.build,'authored-860409-v4-metre-uv');
const fingerprint={entryPath,entrySha256:createHash('sha256').update(entryBytes).digest('hex'),worldBuild:worldManifest.build};
for(const kind of (process.env.AUDIT_KIND?[process.env.AUDIT_KIND]:['helicopter','plane'])){
 const page=await browser.newPage({viewport:{width:1440,height:900}});page.on('pageerror',e=>errors.push(e.message));
 const snapshot=()=>page.evaluate(()=>{const g=window.__leonida.game,v=g.player.vehicle;return {backend:window.__leonida.snapshot().backend,player:g.player.position.asArray(),vehicle:v?{id:v.id,kind:v.kind,position:v.root.position.asArray(),health:v.health,speed:v.speed,forwardSpeed:v.forwardSpeed,rotation:v.root.rotationQuaternion.toEulerAngles().asArray(),velocity:v.body.getLinearVelocity().asArray(),grounded:v.grounded,input:v.input,occupied:v.occupied,engineRunning:v.engineRunning}:null,aircraft:g.vehicles.list.filter(v=>v.kind==='plane'||v.kind==='helicopter').map(v=>({id:v.id,kind:v.kind,position:v.root.position.asArray(),health:v.health,input:{...v.input},occupied:v.occupied})),prompt:document.querySelector('#prompt')?.textContent,toast:document.querySelector('#toast')?.textContent,paused:window.__leonida.snapshot().paused,panel:document.querySelector('#panel')?.className,input:{axisY:g.input?.axis?.('y')}}});
 try{
 await page.goto(`${origin}/?backend=${backend}&test`,{waitUntil:'domcontentloaded'});await page.locator('#welcome:not(.hidden)').waitFor({timeout:120000});await page.locator('[data-action="play"]').click();await page.waitForTimeout(1800);
 await page.keyboard.press('F2');await page.locator('#spawn-kind').selectOption(kind);await page.locator('[data-action="spawn"]').click();await page.waitForFunction(()=>!window.__leonida.snapshot().streamingBusy);await page.waitForTimeout(2000);await page.locator('[data-action="close"]').click();await page.waitForTimeout(800);
 await page.screenshot({path:`${output}/${kind}-spawn.png`});results.push({kind,phase:'spawn',state:await snapshot()});await page.keyboard.press('e');await page.waitForTimeout(1100);results.push({kind,phase:'entry',state:await snapshot()});
 if(label==='before')for(const [phase,keys,seconds]of [['w-only',['w'],8],['lift',['w','Shift'],kind==='plane'?16:8]]){
 for(const k of keys)await page.keyboard.down(k);
 for(let i=0;i<seconds;i++){await page.waitForTimeout(1000);const state=await snapshot();results.push({kind,phase,second:i+1,state});console.log(JSON.stringify({kind,phase,second:i+1,state}));}
 for(const k of keys)await page.keyboard.up(k);await page.screenshot({path:`${output}/${kind}-${phase}.png`});
 }

 if(label!=='before'){
   const entered=await snapshot();assert.equal(entered.backend,backend==='webgpu'?'WebGPU':'WebGL2','actual renderer matches requested path');assert.equal(entered.vehicle?.kind,kind,'normal E enters UI-spawned aircraft');assert.match(entered.prompt,/SPACE|SHIFT/,'persistent HUD explains lift');assert.ok(entered.vehicle.health>99,'normal spawn does not damage aircraft');
   if(kind==='plane')await page.keyboard.down('w');
   const start=performance.now();
   if(kind==='plane'){
     while(performance.now()-start<12000){const s=await snapshot();if(s.vehicle.speed>=25)break;await page.waitForTimeout(200);}
   }
   await page.keyboard.down('Space');
   let airborne=false;
   for(let i=0;i<60;i++){await page.waitForTimeout(200);const state=await snapshot();results.push({kind,phase:'takeoff',second:(performance.now()-start)/1000,state});if(state.vehicle.position[1]>8){airborne=true;break;}}
   assert.ok(airborne,'normal throttle and displayed lift key cause physical takeoff');
   const flight=await snapshot();await page.screenshot({path:`${output}/${kind}-airborne.png`});assert.ok(flight.vehicle.health>95,'takeoff path is clear of traffic and starter car');
   await page.keyboard.up('w');await page.keyboard.up('Space');
   if(kind==='helicopter')await page.keyboard.down('c');
   else{await page.keyboard.down('w');}
   let landed=false;
   let throttleHeld=kind==='plane',elevatorHeld=false,brakeHeld=false,elevatorCarry=0;
   for(let i=0;i<140;i++){
     if(kind==='plane'){
       const v=(await snapshot()).vehicle, onGround=v.grounded>0&&v.position[1]<1.1;
       const desiredAoA=Math.max(.04,Math.min(.195,.12+(-1.8-v.velocity[1])*.01));
       const duty=(desiredAoA-.025)/.17;
       elevatorCarry+=duty;
       const needThrottle=!onGround&&v.forwardSpeed<32,needElevator=!onGround&&elevatorCarry>=1;
       if(needElevator)elevatorCarry-=1;
       if(needThrottle!==throttleHeld){await page.keyboard[needThrottle?'down':'up']('w');throttleHeld=needThrottle;}
       if(needElevator!==elevatorHeld){await page.keyboard[needElevator?'down':'up']('Space');elevatorHeld=needElevator;}
       if(onGround&&!brakeHeld){await page.keyboard.down('s');brakeHeld=true;}
     }
     await page.waitForTimeout(200);const state=await snapshot();results.push({kind,phase:'landing',second:i*.2,state});if(i%5===0)console.log(JSON.stringify({kind,phase:'landing',state}));if(state.vehicle.position[1]<1.45&&state.vehicle.speed<1.5&&Math.abs(state.vehicle.velocity[1])<.8){landed=true;break;}}
   await page.keyboard.up('c');await page.keyboard.up('s');await page.keyboard.up('Space');await page.keyboard.up('w');
   assert.ok(landed,'aircraft returns to the ground and comes to a halt through controls');
   const landedState=await snapshot();assert.ok(landedState.vehicle.health>90,'controlled landing preserves functional aircraft');await page.screenshot({path:`${output}/${kind}-landed.png`});
   const aircraftId=landedState.vehicle.id;
   await page.keyboard.down('w');await page.waitForTimeout(100);assert.equal((await snapshot()).vehicle.input.throttle,1,'throttle is held before exit');
   await page.keyboard.press('e');await page.keyboard.up('w');await page.waitForTimeout(900);
   const exited=await snapshot();assert.equal(exited.vehicle,null,'normal E exits landed aircraft');
   const abandoned=exited.aircraft.find(v=>v.id===aircraftId);assert.equal(abandoned.occupied,false);
   assert.deepEqual(abandoned.input,{throttle:0,steer:0,brake:1,handbrake:false,lift:0},'exit clears held flight controls and applies idle brake');
   results.push({kind,phase:'exit-with-held-throttle',state:exited});await page.screenshot({path:`${output}/${kind}-exited.png`});
 }
 }catch(e){errors.push(`${kind}: ${e.stack}`);await page.screenshot({path:`${output}/${kind}-failure.png`}).catch(()=>{});}finally{await page.close();}
}
await fs.writeFile(`${output}/result.json`,JSON.stringify({origin,backend,label,fingerprint,scope:'Normal fresh play, Creative UI aircraft spawn, E entry, displayed flight controls, read-only telemetry-guided keyboard landing, and E exit while throttle is held. No game state mutations or teleport hooks.',results,errors},null,2));await browser.close();console.log(JSON.stringify({output,errors}));process.exit(errors.length?1:0);
