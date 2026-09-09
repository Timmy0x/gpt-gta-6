import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';

const flightOnly=process.argv.includes('--flight-only');
const smoke=process.argv.includes('--smoke')||flightOnly;
const duration=Number(process.env.AUDIT_SECONDS || (flightOnly ? 180 : smoke ? 120 : 1800));
const baseURL=process.env.AUDIT_URL || 'http://127.0.0.1:4175';
const buildLabel=process.env.AUDIT_BUILD_LABEL || 'ce382f3';
const expectedMainHash=process.env.AUDIT_EXPECTED_MAIN_SHA256 || 'd93125df258fd0ae3e0c2619a69b33f5a911e4326fec55ffb3559601c5ca12df';
const stamp=new Date().toISOString().replace(/[:.]/g,'-');
const output=path.resolve('docs/evidence/stability',`${flightOnly?'flight-check':smoke?'smoke':'baseline'}-${stamp}`);
await fs.mkdir(output,{recursive:true});
await fs.copyFile(new URL(import.meta.url),path.join(output,'harness.mjs'));
const files={events:path.join(output,'events.jsonl'),samples:path.join(output,'samples.jsonl'),frames:path.join(output,'frames.jsonl'),result:path.join(output,'result.json')};
const events=[],errors=[],samples=[],frameTimes=[];let browser,page,cdp,measurementStart=0,lastCheckpoint=0,lastSample=0,currentPhase='launch',stopped=false;
const held=new Set();
function event(kind,details={}) {const item={utc:new Date().toISOString(),elapsed:measurementStart?(performance.now()-measurementStart)/1000:0,phase:currentPhase,...details,event:kind};events.push(item);return fs.appendFile(files.events,JSON.stringify(item)+'\n');}
async function fingerprint(){
  const htmlResponse=await fetch(baseURL+'/');
  if(!htmlResponse.ok)throw new Error(`Cannot fingerprint served build: ${htmlResponse.status}`);
  const html=await htmlResponse.text(),urls=[...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map(m=>m[1]),records=[];
  const manifest=await fetch(baseURL+'/world/manifest.json');
  if(manifest.ok&&/json/i.test(manifest.headers.get('content-type')??''))urls.push('/world/manifest.json');
  const enqueue=url=>{if(!urls.includes(url))urls.push(url);};
  for(const url of urls){
    const response=await fetch(new URL(url,baseURL));
    if(!response.ok)throw new Error(`Fingerprint asset failed: ${url} ${response.status}`);
    const data=Buffer.from(await response.arrayBuffer());records.push({url,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')});
    if(url.endsWith('.js'))for(const match of data.toString('utf8').matchAll(/\/assets\/[A-Za-z0-9_.-]+\.wasm/g))enqueue(match[0]);
    if(url==='/world/manifest.json'){
      const world=JSON.parse(data.toString('utf8'));
      for(const entry of [...world.chunks,...world.materials])enqueue('/world/'+entry.url);
    }
    if(url.startsWith('/world/materials/')){
      const material=gunzipSync(data).toString('utf8');
      for(const match of material.matchAll(/(?:\/world\/)?textures\/[A-Za-z0-9_.-]+\.png/g))enqueue(match[0].startsWith('/')?match[0]:'/world/'+match[0]);
    }
  }
  return {htmlSha256:createHash('sha256').update(html).digest('hex'),assets:records};
}
const startedFingerprint=await fingerprint();
if(process.argv.includes('--fingerprint-only')){await fs.writeFile(path.join(output,'fingerprint.json'),JSON.stringify(startedFingerprint,null,2));console.log(JSON.stringify({assets:startedFingerprint.assets.length,bytes:startedFingerprint.assets.reduce((sum,a)=>sum+a.bytes,0),output}));process.exit(0);}
if(!startedFingerprint.assets.some(asset=>asset.sha256===expectedMainHash))throw new Error(`Frozen ${buildLabel} JavaScript fingerprint mismatch`);
let hardware={};try{const raw=JSON.parse(execFileSync('system_profiler',['SPHardwareDataType','SPDisplaysDataType','-json'],{encoding:'utf8'}));const h=raw.SPHardwareDataType?.[0]??{},g=raw.SPDisplaysDataType?.[0]??{};hardware={model:h.machine_name,modelId:h.machine_model,chip:h.chip_type,memory:h.physical_memory,cpuCores:h.number_processors,gpu:g.sppci_model,gpuCores:g.sppci_cores};}catch(error){hardware={unavailable:error.message};}
const metadata={commit:buildLabel,mode:flightOnly?'functional flight harness check, not isolated performance':smoke?'harness smoke':'30-minute stability baseline',targetSeconds:duration,url:baseURL,viewport:{width:1920,height:1080},deviceScaleFactor:1,quality:'high',requestedBackend:'WebGPU',hardware,os:{platform:os.platform(),release:os.release(),arch:os.arch()},startedFingerprint,methods:{control:'Physical keyboard/mouse events; closed-loop steering reads live vehicle state. Phase transitions place a vehicle with explicit test hooks; creative controls set weather/wanted/invulnerability, save/load and fast travel. Every hook placement/recovery is logged.',frameTimes:'Raw milliseconds between Babylon onAfterRender observer callbacks. Includes running creative overlay rendering; map/pause rendering also retained and marked paused in resource samples. This measures delivered render callbacks, not display presentation or GPU execution time.',memory:'CDP Performance JSHeapUsedSize/TotalSize and DOM counters; Babylon live mesh/body/material/multiMaterial/texture/geometry counts. No forced GC. GPU allocation and whole-process RSS unavailable in this sandbox.',concurrency:flightOnly?'Functional flight check; other integration browsers may run concurrently. Performance is not isolated.':'One harness GPU browser at a time; other agents may edit source or run CPU checks. Served build stays frozen.'}};
await fs.writeFile(path.join(output,'metadata.json'),JSON.stringify(metadata,null,2));
async function keys(next=[]) {const set=new Set(next);for(const key of [...held])if(!set.has(key)){await page.keyboard.up(key);held.delete(key);}for(const key of set)if(!held.has(key)){await page.keyboard.down(key);held.add(key);}}
async function snapshot(){return page.evaluate(()=>{const g=window.__leonida.game,s=window.__leonida.snapshot(),v=g.player.vehicle;return {simTime:s.simTime,backend:s.backend,quality:s.quality,resolution:s.resolution,position:s.position,health:s.health,vehicle:v?{id:v.id,kind:v.kind,health:v.health,speed:v.speed,forwardSpeed:v.forwardSpeed,heading:v.heading,rotation:v.root.rotationQuaternion?.toEulerAngles().asArray(),velocity:v.body.getLinearVelocity().asArray(),position:v.root.position.asArray()}:null,wanted:s.wanted,police:s.population.police,streaming:s.streaming,paused:s.paused,shots:s.shots,crashes:s.crashCount,character:s.character,interactionMessage:g.player.interactionMessage};});}
async function sample(force=false){const now=performance.now();if(!force&&now-lastSample<10000)return;lastSample=now;
  const telemetry=await page.evaluate(()=>{const g=window.__leonida.game,scene=g.scene,a=window.__stabilityAudit,frames=a.frames.splice(0),s=window.__leonida.snapshot();return {frames,snapshot:{...s,frameTimes:undefined},counts:{meshes:scene.meshes.length,activeMeshes:scene.getActiveMeshes().length,bodies:scene.getPhysicsEngine().getBodies().length,materials:scene.materials.length,multiMaterials:scene.multiMaterials.length,textures:scene.textures.length,geometries:scene.geometries.length,skeletons:scene.skeletons.length,transformNodes:scene.transformNodes.length,observers:scene.onBeforeRenderObservable.observers.length,props:g.damage.props.length,debris:g.damage.debris.length,grenades:g.combat.projectiles.grenades.length,ragdolls:g.combat.reactions.active.length,vehicles:g.vehicles.list.length,peds:g.population.pedestrians.length,officers:g.population.officers.length},pageMemory:performance.memory?{used:performance.memory.usedJSHeapSize,total:performance.memory.totalJSHeapSize,limit:performance.memory.jsHeapSizeLimit}:null};});
  const metrics=await cdp.send('Performance.getMetrics'),dom=await cdp.send('Memory.getDOMCounters'),m=Object.fromEntries(metrics.metrics.map(v=>[v.name,v.value]));
  for(const frame of telemetry.frames)frameTimes.push(frame[1]);if(telemetry.frames.length)await fs.appendFile(files.frames,telemetry.frames.map(([at,ms,phase])=>JSON.stringify({at,ms,phase:phase??currentPhase})).join('\n')+'\n');
  const item={utc:new Date().toISOString(),elapsed:(now-measurementStart)/1000,phase:currentPhase,...telemetry,frames:undefined,cdp:{heapUsed:m.JSHeapUsedSize,heapTotal:m.JSHeapTotalSize,nodes:dom.nodes,documents:dom.documents,listeners:dom.jsEventListeners,taskDuration:m.TaskDuration,layoutCount:m.LayoutCount}};samples.push(item);await fs.appendFile(files.samples,JSON.stringify(item)+'\n');
  if(item.cdp.heapUsed>2_000_000_000)throw new Error('Safety stop: JS heap exceeds2GB');
  if(telemetry.counts.bodies>2200||telemetry.counts.meshes>18000)throw new Error('Safety stop: body/mesh growth exceeded harness bounds');
  if(now-lastCheckpoint>=60000||force){lastCheckpoint=now;console.log('CHECKPOINT',JSON.stringify({utc:item.utc,elapsed:item.elapsed,phase:currentPhase,position:item.snapshot.position,vehicle:item.snapshot.vehicle,wanted:item.snapshot.wanted,heapMB:Math.round(item.cdp.heapUsed/1e6),counts:item.counts,errors:errors.length}));await fs.writeFile(path.join(output,'checkpoint.json'),JSON.stringify({metadata,sample:item,events:events.length,frames:frameTimes.length},null,2));}
}
async function beginPhase(name){currentPhase=name;await page.evaluate(phase=>{window.__stabilityAudit.phase=phase;},name);await event('phase-start');}
async function tick(ms=250){await page.waitForTimeout(ms);await sample();if(errors.some(e=>e.fatal))throw new Error('Fatal browser error detected');}
async function panel(name){await keys();const selector=`#panel:not(.hidden)`;if(await page.locator(selector).count()){const current=await page.evaluate(()=>document.querySelector('#panel').textContent);if((name==='creative'&&current.includes('The world is yours'))||(name==='map'&&current.includes('Somewhere to go')))return;await page.locator('[data-action="close"]').click();}await page.keyboard.press(name==='creative'?'F2':'m');await page.locator(selector).waitFor({timeout:10000});}
async function closePanel(){if(await page.locator('#panel:not(.hidden)').count())await page.locator('[data-action="close"]').click();}
async function creative(values={}){await panel('creative');for(const [key,value]of Object.entries(values)){const element=page.locator(`[data-change="${key}"]`);if(typeof value==='boolean'){await element.setChecked(value);}else await element.selectOption(String(value));}await closePanel();}
async function placeVehicle(kind,position,heading=0){await keys();await closePanel();await event('hook-fixture-place',{kind,position,heading});await page.evaluate(({kind,position,heading})=>{const g=window.__leonida.game;g.player.exit(true);const old=g.vehicles.list.find(v=>v.id==='stability-fixture');if(old)g.vehicles.remove(old);const Vec=g.player.position.constructor,p=new Vec(...position);g.world.ensureCollision(p);const v=g.vehicles.spawn(kind,p,heading,'stability-fixture');g.player.teleport(p.add(new Vec(3,1,0)));g.player.yaw=heading;g.player.pitch=.08;}, {kind,position,heading});await tick(500);await page.keyboard.press('e');await tick(800);let state=await snapshot();if(state.vehicle?.kind!==kind){await event('hook-entry-fallback',{kind,reason:'normal E could not enter fixture from generated approach'});await page.evaluate(()=>{const g=window.__leonida.game,v=g.vehicles.list.find(v=>v.id==='stability-fixture'),Vec=g.player.position.constructor;g.player.teleport(v.root.position.add(new Vec(v.tuning.width*.5+.55,.1,0)));g.player.enter(v);});await tick(800);state=await snapshot();}if(state.vehicle?.kind!==kind)throw new Error(`Unable to enter ${kind} fixture`);return state;}
function angle(a){return Math.atan2(Math.sin(a),Math.cos(a));}
async function driveUntil(end,kind,points){let index=0,lastPosition=null,stuck=0,nextSwitch=performance.now()+45000,progress=0,recoveries=0,airborneSeconds=0,distanceTravelled=0,minAltitude=Infinity,maxAltitude=-Infinity;const started=performance.now();let last=started,nextFlightLog=0;
  while(performance.now()<end){const state=await snapshot(),v=state.vehicle;if(!v||v.kind!==kind){await event('vehicle-lost',{kind,state});break;}const now=performance.now(),elapsed=(now-last)/1000;last=now;const p=v.position;minAltitude=Math.min(minAltitude,p[1]);maxAltitude=Math.max(maxAltitude,p[1]);if(lastPosition)distanceTravelled+=Math.hypot(p[0]-lastPosition[0],p[1]-lastPosition[1],p[2]-lastPosition[2]);let target=points[index];const dist=Math.hypot(target[0]-p[0],target[1]-p[2]);if(dist<(kind==='plane'?100:kind==='helicopter'?45:14)){index=(index+1)%points.length;target=points[index];progress++;}
    const desired=Math.atan2(target[0]-p[0],target[1]-p[2]),error=angle(desired-v.heading),controls=[];
    if(kind==='plane'){
      if(v.forwardSpeed<34)controls.push('w');
      // Keep a broad physical circuit within the authored district rather than commanding sharp corners.
      const orbitAngle=Math.atan2(p[2]+30,p[0]+170)+.5;
      const orbit=[-170+190*Math.cos(orbitAngle),-30+190*Math.sin(orbitAngle)];
      const headingError=angle(Math.atan2(orbit[0]-p[0],orbit[1]-p[2])-v.heading);
      if(p[1]>12&&Math.abs(headingError)>.10)controls.push(headingError>0?'d':'a');
      const vertical=v.velocity?.[1]??0,airspeed=v.forwardSpeed;
      const desiredAoA=Math.max(-.05,Math.min(.19,.14+(65-p[1])*.002-vertical*.018));
      const elevator=Math.max(-1,Math.min(1,(desiredAoA-.025)/.17));
      const duty=Math.abs(elevator);
      if(p[1]<3&&airspeed>21)controls.push('Shift');
      else if(p[1]>=3&&((now-started)/1000%1)<duty)controls.push(elevator>=0?'Shift':'c');
      if(p[1]>8)airborneSeconds+=elapsed;
      if(flightOnly&&now>nextFlightLog){nextFlightLog=now+2000;await event('flight-control-sample',{vehicle:v,controls,headingError,desiredAoA,duty});}
    }
    else if(kind==='helicopter'){if(Math.abs(error)>.1)controls.push(error>0?'d':'a');if(Math.abs(error)<.8)controls.push('w');if(p[1]<35)controls.push('Shift');else if(p[1]>55)controls.push('c');if(p[1]>8)airborneSeconds+=elapsed;}
    else{const targetSpeed=kind==='boat'?9:Math.abs(error)>.7?5:Math.abs(error)>.3?9:15;if(Math.abs(error)>.07)controls.push(error>0?'d':'a');if(v.forwardSpeed<targetSpeed)controls.push('w');else if(v.forwardSpeed>targetSpeed+2)controls.push('s');}
    await keys(controls);if(lastPosition&&Math.hypot(p[0]-lastPosition[0],p[2]-lastPosition[2])<.05&&Math.abs(v.speed)<1)stuck+=elapsed;else stuck=0;lastPosition=p;
    if(v.health<30||p[1]<-4||Math.abs(p[0])>1050||Math.abs(p[2])>1050||stuck>14){recoveries++;await event('hook-recovery',{kind,reason:v.health<30?'damage':stuck>14?'stuck':'out-of-envelope',position:p,health:v.health});await keys();if(recoveries>(kind==='plane'?2:8))throw new Error(`${kind} fixture required too many recoveries in one phase`);if(kind==='plane'){
      await event('hook-runway-recovery',{position:[3.3,1.05,-275],previousPosition:p,geographicGap:p[2]>252||p[2]<-310||p[0]<-552||p[0]>210});
      await page.evaluate(()=>{const g=window.__leonida.game,v=g.player.vehicle,Vec=g.player.position.constructor;v.root.rotationQuaternion.copyFromFloats(0,0,0,1);v.root.computeWorldMatrix(true);g.vehicles.recover(v,new Vec(3.3,1.05,-275));});index=0;
    }else await page.evaluate(({point,kind})=>{const g=window.__leonida.game,v=g.player.vehicle,Vec=g.player.position.constructor;g.vehicles.recover(v,new Vec(point[0],kind==='boat'?.4:kind==='helicopter'?12:1.05,point[1]));},{point:points[index],kind});stuck=0;lastPosition=null;}
    if(now>nextSwitch){const before=state.character;await page.keyboard.press('Tab');await tick(350);nextSwitch=now+45000;const after=(await snapshot()).character;await event('normal-character-switch',{before,after,changed:before!==after});}
    await tick(300);
  }
  await keys();await event('physical-phase-result',{kind,seconds:(performance.now()-started)/1000,waypoints:progress,recoveries,airborneSeconds,distanceTravelled,minAltitude,maxAltitude,state:await snapshot()});
}
async function destructionUntil(end){await keys();await page.evaluate(()=>{const g=window.__leonida.game,Vec=g.player.position.constructor;g.player.exit(true);g.player.teleport(new Vec(-288,1.2,140));g.player.yaw=0;g.player.pitch=-.1;});await event('hook-fixture-foot-position',{position:[-288,1.2,140]});await creative({wanted:4,god:true,ammo:true});let rounds=0,next=0;
  while(performance.now()<end){if(performance.now()>next){rounds++;await panel('creative');for(const kind of ['wood','fence','metal']){await page.locator('#prop-kind').selectOption(kind);await page.locator('[data-action="prop"]').click();}await page.locator('[data-action="ignite"]').click();await closePanel();await page.keyboard.press('Digit3');await page.mouse.move(960,540);await page.mouse.down({button:'left'});await tick(1450);await page.mouse.up({button:'left'});await event('normal-grenade-throw',{round:rounds});next=performance.now()+(smoke?5000:18000);if(rounds%3===0){await panel('creative');await page.locator('[data-action="remove-prop"]').click();await page.locator('[data-action="remove-prop"]').click();await closePanel();}}
    await keys(Math.floor(performance.now()/3000)%2?['a']:['d']);await tick(300);
  }await keys();await event('destruction-result',{rounds,state:await snapshot()});
}
async function mixedUntil(end){const ids=['palma-market','mangrove-estates','restricted-compound','marina','ocean-drive','south-wharf'];let visit=0;
  while(performance.now()<end){const id=ids[visit%ids.length];await panel('map');await page.locator(`[data-action="teleport"][data-value="${id}"]`).click();await event('creative-ui-fast-travel',{location:id});await tick(1000);await page.keyboard.press('Tab');await keys(['w']);await tick(smoke?1000:5000);await keys();await panel('creative');await page.locator('[data-action="save"]').click();await tick(300);await page.locator('[data-action="load"]').click();await closePanel();await event('creative-ui-save-load',{visit,location:id});visit++;const segmentEnd=Math.min(end,performance.now()+(smoke?1500:25000));while(performance.now()<segmentEnd){await keys(['w']);await tick(500);}await keys();}
}
let completed=false,failure=null;
try{
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu','--disable-background-timer-throttling','--disable-renderer-backgrounding','--enable-precise-memory-info']});
 page=await browser.newPage({viewport:metadata.viewport,deviceScaleFactor:1});page.setDefaultTimeout(15000);cdp=await page.context().newCDPSession(page);await cdp.send('Performance.enable');metadata.browser=await browser.version();
 page.on('pageerror',error=>{const record={utc:new Date().toISOString(),phase:currentPhase,message:error.message,stack:error.stack,fatal:true};errors.push(record);void event('pageerror',record);});page.on('crash',()=>{errors.push({message:'Renderer crashed',fatal:true});});page.on('console',message=>{if(message.type()==='error'){const record={utc:new Date().toISOString(),phase:currentPhase,message:message.text(),fatal:/device.*lost|out of memory|GPU.*crash/i.test(message.text())};errors.push(record);void event('console-error',record);}});page.on('requestfailed',request=>void event('request-failed',{url:request.url(),failure:request.failure()}));
 await page.goto(baseURL+'/?backend=webgpu&test',{waitUntil:'networkidle',timeout:60000});await page.locator('#welcome:not(.hidden)').waitFor({timeout:90000});await page.locator('[data-action="play"]').click();await page.waitForTimeout(6000);
 const initial=await snapshot();if(initial.backend!=='WebGPU'||initial.resolution[0]!==1920||initial.resolution[1]!==1080||initial.quality!=='high')throw new Error('Required backend/resolution/quality not active: '+JSON.stringify(initial));
 metadata.gpu=await page.evaluate(async()=>{const adapter=await navigator.gpu?.requestAdapter({powerPreference:'high-performance'});return adapter?{vendor:adapter.info.vendor,architecture:adapter.info.architecture,device:adapter.info.device,description:adapter.info.description}:null;});
 await creative({god:true});await page.keyboard.down('w');await page.waitForTimeout(450);await page.keyboard.up('w');await page.keyboard.press('e');await page.waitForTimeout(1200);await event('normal-initial-entry',{state:await snapshot()});
 await page.evaluate(()=>{const g=window.__leonida.game;window.__stabilityAudit={start:performance.now(),last:performance.now(),frames:[]};g.scene.onAfterRenderObservable.add(()=>{const a=window.__stabilityAudit,now=performance.now();a.frames.push([now-a.start,now-a.last,a.phase??'launch']);a.last=now;});});
 measurementStart=performance.now();lastSample=measurementStart-10000;lastCheckpoint=measurementStart;metadata.measurementStartedUTC=new Date().toISOString();await fs.writeFile(path.join(output,'metadata.json'),JSON.stringify(metadata,null,2));console.log('MEASUREMENT_START',JSON.stringify({output,utc:metadata.measurementStartedUTC,duration,expectedEnd:new Date(Date.now()+duration*1000).toISOString()}));
 const phaseDuration=duration/6,phaseEnd=i=>measurementStart+phaseDuration*(i+1)*1000;
 if(flightOnly){await beginPhase('plane-functional-flight-check');await creative({wanted:0});await placeVehicle('plane',[3.3,1.05,-275]);await driveUntil(measurementStart+duration*1000,'plane',[[3,50],[-288,100],[-380,-200],[100,-250]]);await sample(true);await page.screenshot({path:path.join(output,'flight-check.png')});completed=true;}else{
 await beginPhase('ground-traversal-and-pursuit');await placeVehicle('coupe',[3,1.05,-210]);await creative({wanted:3});await driveUntil(phaseEnd(0),'coupe',[[3.3,212.7],[-428.7,212.7],[-428.7,-284.7],[140.7,-284.7],[140.7,212.7]]);await sample(true);await page.screenshot({path:path.join(output,'01-driving.png')});
 await beginPhase('boat-coastal-navigation');await creative({wanted:0,weather:'Rain'});await placeVehicle('boat',[270,.4,-250]);await driveUntil(phaseEnd(1),'boat',[[260,150],[400,190],[400,-230],[250,-230]]);await sample(true);await page.screenshot({path:path.join(output,'02-boat.png')});
 await beginPhase('helicopter-city-traversal');await creative({weather:'Clear',wanted:2});await placeVehicle('helicopter',[0,2,-210]);await driveUntil(phaseEnd(2),'helicopter',[[0,150],[-400,150],[-400,-210],[130,-210]]);await sample(true);await page.screenshot({path:path.join(output,'03-helicopter.png')});
 await beginPhase('plane-physical-flight');await creative({wanted:0});await placeVehicle('plane',[3,1.05,-275]);await driveUntil(phaseEnd(3),'plane',[[3,200],[-400,200],[-400,-230],[200,-230]]);await sample(true);await page.screenshot({path:path.join(output,'04-plane.png')});
 await beginPhase('grenades-fire-and-four-star-pursuit');await destructionUntil(phaseEnd(4));await sample(true);await page.screenshot({path:path.join(output,'05-destruction.png')});
 await beginPhase('chunk-travel-save-load-character-switch');await creative({wanted:0});await mixedUntil(phaseEnd(5));await sample(true);await page.screenshot({path:path.join(output,'06-save-load.png')});completed=true;}
}catch(error){failure={message:error.message,stack:error.stack,phase:currentPhase,utc:new Date().toISOString()};console.error('AUDIT_FAILURE',JSON.stringify(failure));await event('failure',failure);try{await keys();if(measurementStart)await sample(true);await page.screenshot({path:path.join(output,'failure.png'),timeout:10000});}catch{} }
finally{
 if(page&&measurementStart){try{await sample(true);}catch{}}
 const sorted=frameTimes.filter(n=>Number.isFinite(n)&&n>0).sort((a,b)=>a-b),tail=sorted.slice(Math.floor(sorted.length*.99)),mean=a=>a.reduce((sum,n)=>sum+n,0)/Math.max(1,a.length);
 const endedFingerprint=await fingerprint().catch(error=>({error:error.message}));
 const result={metadata,completed,failure,endedUTC:new Date().toISOString(),durationSeconds:measurementStart?(performance.now()-measurementStart)/1000:0,errors,eventsCount:events.length,samplesCount:samples.length,framesCount:sorted.length,performance:{medianFPS:1000/sorted[Math.floor(sorted.length*.5)],meanFPS:1000/mean(sorted),p99FrameMs:sorted[Math.floor(sorted.length*.99)],p99EquivalentFPS:1000/sorted[Math.floor(sorted.length*.99)],meanSlowestOnePercentFrameMs:mean(tail),onePercentLowFPS:1000/mean(tail),maxFrameMs:sorted.at(-1)},resources:{first:samples[0],last:samples.at(-1),maxHeapUsed:Math.max(...samples.map(s=>s.cdp.heapUsed)),minHeapUsed:Math.min(...samples.map(s=>s.cdp.heapUsed))},endedFingerprint,frozenBuildUnchanged:JSON.stringify(startedFingerprint)===JSON.stringify(endedFingerprint),output};
 await fs.writeFile(files.result,JSON.stringify(result,null,2));console.log('AUDIT_RESULT',JSON.stringify({completed,failure,output,seconds:result.durationSeconds,performance:result.performance,frames:result.framesCount,samples:samples.length,errors:errors.length,frozenBuildUnchanged:result.frozenBuildUnchanged}));if(browser)await Promise.race([browser.close(),new Promise(resolve=>setTimeout(resolve,5000))]);
 process.exit(completed&&errors.length===0?0:1);
}
