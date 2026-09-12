// Normal UI and keyboard/mouse controls; game state is only observed.
import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {MapViewport} from '../src/ui/MapViewport.ts';
import {vehicleFootRoute} from '../src/gameplay/police/vehicleFootRoute.ts';

const origin=process.env.AUDIT_URL||'http://127.0.0.1:4261';
const backend=process.env.AUDIT_BACKEND||'webgpu';
const output=process.env.AUDIT_OUTPUT||`docs/evidence/road-cars/normal-r1-${backend}`;
const kinds=(process.env.AUDIT_KINDS||'coupe,sedan,suv,truck,police,hatchback,executive,van,offroad,mpv').split(',');
await mkdir(output,{recursive:true});
const html=await(await fetch(origin)).text(),entry=html.match(/<script[^>]*src="([^"]+)"/)[1];
const fingerprint={entry,sha256:createHash('sha256').update(Buffer.from(await(await fetch(origin+entry)).arrayBuffer())).digest('hex'),world:(await(await fetch(origin+'/world/manifest.json')).json()).build};
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
const page=await browser.newPage({viewport:{width:1600,height:900}});
page.setDefaultTimeout(30000);
const checks=[],errors=[],warnings=[],requests=[],held=new Set();let mx=800,my=450;
page.on('pageerror',e=>errors.push(e.stack||e.message));
page.on('console',m=>{if(m.type()==='error')errors.push(m.text());if(m.type()==='warning')warnings.push(m.text());});
page.on('request',r=>{if(r.url().includes('/vehicles/carla/'))requests.push(r.url());});
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[2]-b[2]);
const angle=n=>Math.atan2(Math.sin(n),Math.cos(n));
const state=()=>page.evaluate(()=>{
  const g=window.__leonida.game,p=g.player;
  const vehicle=v=>{
    const b=v.root.getHierarchyBoundingVectors(true,m=>m.isEnabled());
    return {id:v.id,kind:v.kind,source:v.root.metadata.sourceModel,position:v.root.position.asArray(),heading:v.heading,right:v.root.right.asArray(),width:v.tuning.width,speed:v.speed,health:v.health,headlights:v.headlights,siren:v.siren,grounded:v.grounded,input:{...v.input},occupied:v.occupied,locked:!!v.controlLocked,bounds:{min:b.min.asArray(),max:b.max.asArray()},shapeChildren:v.body.shape.getNumChildren(),meshes:v.root.getChildMeshes().length,
      doors:v.model.doors.map(d=>({front:d.front,side:d.side,angle:d.angle,enabled:d.mesh.isEnabled(),hinge:d.mesh.getAbsolutePosition().asArray()})),
      windows:v.model.windows.map(m=>({name:m.name,position:m.getAbsolutePosition().asArray(),enabled:m.isEnabled()})),
      lamps:v.model.lights.map(m=>({name:m.name,enabled:m.isEnabled(),position:m.getAbsolutePosition().asArray()}))};
  };
  return {backend:window.__leonida.snapshot().backend,player:p.position.asArray(),yaw:p.yaw,pitch:p.pitch,name:p.name,phase:p.vehiclePhase,message:p.interactionMessage,vehicle:p.vehicle&&vehicle(p.vehicle),cars:g.vehicles.list.map(vehicle),beams:g.vehicles.equipment.beams.filter(b=>b.isEnabled()).map(b=>b.position.asArray()),weaponWheel:!!g.combat.handling,
    camera:p.camera.position.asArray(),forward:p.camera.getForwardRay().direction.asArray(),joints:Object.fromEntries(['pelvis','head','leftHand','rightHand','leftFoot','rightFoot'].map(n=>[n,p.model.jointPosition(n).asArray()])),streaming:window.__leonida.snapshot().streamingBusy,simTime:window.__leonida.snapshot().simTime};
});
async function keys(...desired){const next=new Set(desired);for(const k of held)if(!next.has(k)){await page.keyboard.up(k);held.delete(k);}for(const k of next)if(!held.has(k)){await page.keyboard.down(k);held.add(k);}}
async function capture(label){const s=await state();checks.push({label,...s});await page.screenshot({path:`${output}/${label}.png`});console.log(JSON.stringify({label,name:s.name,phase:s.phase,car:s.vehicle?.kind,position:s.vehicle?.position,errors:errors.length}));return s;}
async function panel(){await keys();await page.keyboard.press('F2');await page.locator('#panel:not(.hidden)').waitFor();}
async function close(){await page.locator('[data-action="close"]').first().click();}
async function ready(){await page.waitForFunction(()=>!window.__leonida.snapshot().streamingBusy,null,{timeout:90000});}
async function pin(point){
  await keys();await page.keyboard.press('m');await page.locator('[data-map-command="world"]').click();
  const view=new MapViewport();view.fit(1000,620,[],true);const [x,y]=view.screen(point,1000,620),box=await page.locator('#bigmap').boundingBox();
  const ax=Math.round(box.x+x/1000*box.width),ay=Math.round(box.y+y/620*box.height);
  await page.mouse.move(ax,ay);await page.mouse.wheel(0,-1000);await page.waitForTimeout(200);
  view.zoomAt(Math.exp(1.5),(ax-box.x)/box.width*1000,(ay-box.y)/box.height*620,1000,620);
  const [zx,zy]=view.screen(point,1000,620);await page.mouse.click(box.x+zx/1000*box.width,box.y+zy/620*box.height);await page.locator('[data-map-command="travel"]').click();
  await page.locator('#panel').waitFor({state:'hidden',timeout:90000});await ready();await page.waitForTimeout(700);
  assert.ok(distance((await state()).player,[point.x,0,point.z])<12.1,'normal map travel reaches the selected road');
}
async function face(heading){
  await page.locator('#game').click({position:{x:800,y:450}});mx=800;my=450;
  for(let i=0;i<12;i++){
    const s=await state(),error=angle(heading-s.yaw);if(Math.abs(error)<.015)return;
    mx+=Math.max(-450,Math.min(450,error/.0025));await page.mouse.move(mx,my);await page.waitForTimeout(100);
  }
  assert.ok(Math.abs(angle(heading-(await state()).yaw))<.03,'normal mouse turn aligns with the road');
}
async function walkToDoor(id){
  const map=await page.evaluate(()=>({roads:window.__leonida.game.world.roads,obstacles:window.__leonida.game.world.obstacles.map(({x,z,w,d,height})=>({x,z,w,d,height}))}));
  const deadline=Date.now()+30000;let route=[],lastRoute=0;
  while(Date.now()<deadline){
    const s=await state(),v=s.cars.find(v=>v.id===id);assert.ok(v);
    const door=v.doors.filter(d=>d.front&&d.enabled).sort((a,b)=>distance(s.player,a.hinge)-distance(s.player,b.hinge))[0],goal=door.hinge.map((n,i)=>n+v.right[i]*door.side*1.2);goal[1]=.94;
    if(distance(s.player,v.position)<2.2){await keys();return;}
    if(distance(s.player,goal)<.55){await keys();return;}
    if(Date.now()-lastRoute>900||!route.length){
      const p=a=>({x:a[0],y:a[1],z:a[2]});
      route=vehicleFootRoute(p(s.player),p(goal),map.roads,map.obstacles,s.cars.map(c=>({root:{position:p(c.position),isEnabled:()=>true,getHierarchyBoundingVectors:()=>({min:p(c.bounds.min),max:p(c.bounds.max)})}})));lastRoute=Date.now();
    }
    while(route.length>1&&Math.hypot(route[0].x-s.player[0],route[0].z-s.player[2])<.4)route.shift();
    const target=route[0]||{x:goal[0],z:goal[2]},dx=target.x-s.player[0],dz=target.z-s.player[2];
    const lx=dx*Math.cos(s.yaw)-dz*Math.sin(s.yaw),lz=dx*Math.sin(s.yaw)+dz*Math.cos(s.yaw),threshold=Math.hypot(lx,lz)*.3,next=[];
    if(Math.abs(lx)>threshold)next.push(lx>0?'d':'a');if(Math.abs(lz)>threshold)next.push(lz>0?'w':'s');
    await keys(...next);await page.waitForTimeout(distance(s.player,goal)>2?100:60);
  }
  throw new Error(`Normal walking did not reach the driver door of ${id}`);
}
async function enter(kind,id,suffix){
  await walkToDoor(id);await capture(`${kind}-${suffix}-at-door`);await page.keyboard.press('e');
  await page.waitForFunction(()=>window.__leonida.game.player.vehicle||window.__leonida.game.player.interactionMessage,null,{timeout:2500});
  const phases=new Set(),deadline=Date.now()+7500;
  while(Date.now()<deadline){
    const s=await state();assert.equal(s.vehicle?.id,id,`${kind}: normal E selects the intended car (${s.message})`);
    if(!phases.has(s.phase)){phases.add(s.phase);await capture(`${kind}-${suffix}-${s.phase}`);}
    if(s.phase==='seated')return;
    assert.equal(s.vehicle.input.throttle,0,`${kind}: transition cannot apply throttle`);await page.waitForTimeout(60);
  }
  throw new Error(`${kind}: entry did not hand off to the seat`);
}
async function exit(kind,suffix){
  await keys();await page.keyboard.press('e');await page.waitForFunction(()=>window.__leonida.game.player.vehiclePhase==='exiting',null,{timeout:2500});await capture(`${kind}-${suffix}-exiting`);
  await page.waitForFunction(()=>window.__leonida.game.player.vehicle===null,null,{timeout:5000});await capture(`${kind}-${suffix}-on-foot`);
}
let frames=[];
try{
  await page.goto(`${origin}/?backend=${backend}&test`,{waitUntil:'domcontentloaded'});await page.locator('[data-action="play"]').waitFor({state:'visible',timeout:180000});await page.locator('[data-action="play"]').click();
  assert.equal((await state()).backend,backend==='webgpu'?'WebGPU':'WebGL2');
  await panel();await page.locator('[data-change="police"]').uncheck();await page.locator('[data-change="god"]').check();
  for(const name of ['peds','traffic'])await page.locator(`[data-change="${name}"]`).press('Home');
  await page.locator('[data-change="time"]').fill('14');await page.locator('[data-change="time"]').dispatchEvent('change');await close();
  const site=await page.evaluate(()=>{
    const g=window.__leonida.game;
    return g.world.roads.filter(n=>n.x<-680&&n.x>-1100&&n.z>-600&&n.z<500).map(n=>({x:n.x,z:n.z})).find(n=>{
      for(let z=n.z-6;z<n.z+70;z+=2)if(g.world.obstacles.some(o=>o.height>.25&&Math.abs(o.x-n.x)<o.w/2+2&&Math.abs(o.z-z)<o.d/2+2))return false;
      return !g.vehicles.list.some(v=>Math.abs(v.root.position.x-n.x)<4&&v.root.position.z>n.z-8&&v.root.position.z<n.z+75);
    });
  });assert.ok(site,'an authored western road has a clear 70m driving corridor');checks.push({label:'selected-road',site});
  await page.evaluate(()=>{
    window.roadCarFrames=[];
    const g=window.__leonida.game;
    g.scene.onAfterRenderObservable.add(()=>{
      const p=g.player,v=p.vehicle;if(!v||!p.transitioning||window.roadCarFrames.length>=30000)return;
      window.roadCarFrames.push({time:window.__leonida.snapshot().simTime,kind:v.kind,name:p.name,phase:p.vehiclePhase,position:p.model.root.getAbsolutePosition().asArray(),carPosition:v.root.position.asArray(),joints:Object.fromEntries(['head','pelvis','leftHand','rightHand','leftFoot','rightFoot'].map(n=>[n,p.model.jointPosition(n).asArray()])),doors:v.model.doors.map(d=>d.angle),input:{...v.input},locked:v.controlLocked});
    });
  });
  for(const kind of kinds){
    await pin(site);await face(0);if((await state()).name!=='Jason'){await page.keyboard.press((await state()).weaponWheel?'Alt':'Tab');await page.waitForTimeout(350);}
    const before=new Set((await state()).cars.map(v=>v.id));await panel();await page.locator('#spawn-kind').selectOption(kind);await page.locator('[data-action="spawn"]').click();await ready();
    await page.waitForFunction(k=>window.__leonida.game.vehicles.list.some(v=>v.kind===k&&v.root.metadata.sourceModel),kind,{timeout:90000});await close();await page.waitForTimeout(1300);
    const created=(await state()).cars.filter(v=>v.kind===kind&&!before.has(v.id)).at(-1);assert.ok(created?.source,`${kind}: creative spawn uses a licensed source body`);await capture(`${kind}-spawned`);
    await enter(kind,created.id,'jason');await face(1.45);await capture(`${kind}-jason-seat-side`);await face(0);await exit(kind,'jason');
    await page.keyboard.press((await state()).weaponWheel?'Alt':'Tab');await page.waitForTimeout(350);assert.equal((await state()).name,'Lucia');await enter(kind,created.id,'lucia');await face(-1.45);await capture(`${kind}-lucia-seat-side`);await face(0);
    const start=(await state()).vehicle.position;await keys('w');await page.waitForTimeout(2300);await keys();const driven=await capture(`${kind}-driving`);assert.ok(distance(driven.vehicle.position,start)>4,`${kind}: normal throttle moves the source car`);
    await keys('Space');await page.waitForFunction(()=>Math.abs(window.__leonida.game.player.vehicle.speed)<.8,null,{timeout:8000});await keys();
    await panel();await page.locator('[data-change="time"]').fill('23');await page.locator('[data-change="time"]').dispatchEvent('change');await close();await page.waitForTimeout(650);
    await face(Math.PI);let lit=await capture(`${kind}-night-lights`);assert.ok(lit.vehicle.lamps.some(l=>l.enabled&&l.name.startsWith('headlight-')));assert.ok(lit.beams.some(b=>lit.vehicle.lamps.some(l=>l.name.startsWith('headlight-')&&distance(l.position,b)<.15)),`${kind}: occupied headlamp receives a real beam`);
    await page.keyboard.press('l');await page.waitForFunction(()=>window.__leonida.game.player.vehicle.headlights===false);await capture(`${kind}-lights-off`);await page.keyboard.press('l');
    if(kind==='police'){await panel();await page.locator('[data-action="vehicle-siren"]').click();await close();await page.waitForTimeout(400);lit=await capture('police-siren');assert.equal(lit.vehicle.siren,true);}
    await exit(kind,'lucia');await panel();await page.locator('[data-change="time"]').fill('14');await page.locator('[data-change="time"]').dispatchEvent('change');await page.locator('[data-action="remove-vehicle"]').click();await close();
    assert.equal((await state()).cars.some(v=>v.id===created.id),false,`${kind}: normal creative removal releases the tested car`);
  }
  frames=await page.evaluate(()=>window.roadCarFrames);
  assert.ok(frames.length>kinds.length*20,'frame observations cover real entry and exit transitions');
  assert.ok(frames.every(f=>f.locked&&f.input.throttle===0),'all sampled transitions retain control handoff lock');
  assert.equal(errors.length,0);
}catch(e){errors.push(e.stack||String(e));await capture('failure').catch(()=>{});frames=await page.evaluate(()=>window.roadCarFrames||[]).catch(()=>[]);}
finally{
  await keys();await writeFile(`${output}/frames.json`,JSON.stringify(frames));await writeFile(`${output}/result.json`,JSON.stringify({origin,backend,browser:browser.version(),fingerprint,method:'Normal UI map travel and vehicle spawn/removal; telemetry-guided WASD door approach, E entry/exit for Jason and Lucia, normal character switch, W propulsion, Space braking, night and L headlight toggle, police siren button. Read-only model and per-render joint/door observations. Weapon drive-by remains a separate combined-build gate.',kinds,checks,errors,warnings,requests,frameSamples:frames.length},null,2));
  await browser.close();console.log(JSON.stringify({output,checks:checks.length,errors,warnings: warnings.length,frames:frames.length}));if(errors.length||warnings.length)process.exitCode=1;
}
