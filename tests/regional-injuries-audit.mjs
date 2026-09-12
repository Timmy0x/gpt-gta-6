import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const origin = process.env.AUDIT_URL || 'http://127.0.0.1:4260', backend = process.env.AUDIT_BACKEND || 'webgpu';
const only = process.env.AUDIT_ONLY || 'all';
const output = process.env.AUDIT_OUTPUT || `docs/evidence/regional-injuries-r1-${backend}`;
await mkdir(output, {recursive: true});
const browser = await chromium.launch({channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--disable-background-timer-throttling', '--disable-renderer-backgrounding']});
const page = await browser.newPage({viewport: {width: 1600, height: 900}});
const checks = [], errors = [], warnings = []; let victimId, mx = 800, my = 450;
page.on('pageerror', e => errors.push(e.stack || e.message));
page.on('console', m => {if (m.type() === 'error') errors.push(m.text()); if (m.type() === 'warning') warnings.push(m.text());});
const state = () => page.evaluate(id => {
  const g = window.__leonida.game, p = g.player;
  const actor = (model, health) => ({health, dead:model.dead, body:model.bodyInjuries, position:model.root.position.asArray(), physical:!!model.root.metadata?.ragdollActive, handoff:!!model.root.metadata?.ragdollHandoffActive, skin:model.parts.filter(m=>m.isVisible&&m.isEnabled()).map(m=>({name:m.name,bones:m.skeleton?.bones.length})), joints:Object.fromEntries(['head','chest','leftHand','rightHand','leftFoot','rightFoot'].map(name=>[name,model.jointPosition(name).asArray()]))});
  const victim = g.population.pedestrians.find(p => p.id === id), ray = p.camera.getForwardRay();
  return {backend:window.__leonida.snapshot().backend, simTime:window.__leonida.snapshot().simTime, player:{...actor(p.model,p.health),name:p.name,position:p.position.asArray(),speed:p.speed,heading:p.heading,canFire:p.weaponFacingReady,stanceHeight:p.controller.shapeOptions.capsuleHeight}, camera:p.camera.position.asArray(), forward:ray.direction.asArray(), yaw:p.yaw,pitch:p.pitch,
    weapon:g.combat.weapon,shots:g.combat.shots, victim:victim?{id:victim.id,activity:victim.activity,...actor(victim.model,victim.health)}:null,
    creative:g.population.pedestrians.filter(p=>p.creative).map(p=>p.id), casualties:g.population.serializeCasualties(), physicalBodies:g.scene.getPhysicsEngine().getBodies().length, props:g.damage.props.filter(p=>p.id.startsWith('creative-prop-')).map(p=>({id:p.id,position:p.mesh.position.asArray(),burning:p.burning,health:p.health}))};
}, victimId);
async function capture(label) {const s=await state();checks.push({label,...s});await page.screenshot({path:`${output}/${label}.png`});console.log(label,JSON.stringify({victim:s.victim,player:s.player,shots:s.shots}));return s;}
async function creative() {await page.mouse.up({button:'left'});await page.mouse.up({button:'right'});await page.keyboard.press('F2');await page.locator('#spawn-kind').waitFor({state:'visible'});}
async function close() {await page.locator('#panel [data-action="close"]').click();}
async function openRoad() {await page.keyboard.press('m');await page.locator('[data-action="teleport"][data-value="inner-north-boulevard"]').click();await page.locator('#panel').waitFor({state:'hidden',timeout:90000});await page.waitForTimeout(800);}
async function lock() {await page.locator('#game').click({position:{x:800,y:450}});mx=800;my=450;await page.waitForTimeout(200);}
async function approachVisibleArm(region) {
  // A far arm is correctly occluded by the near arm/torso. Walk to the
  // requested side before firing instead of expecting bullets through it.
  const held=new Set(), deadline=performance.now()+24000;
  while(performance.now()<deadline) {
    const goal=await page.evaluate(({id,region})=>{const g=window.__leonida.game,m=g.population.pedestrians.find(p=>p.id===id).model;return m.root.position.add(m.root.right.scale(region==='leftArm'?-3.5:3.5)).subtract(m.root.forward.scale(2.5)).asArray();},{id:victimId,region});
    const s=await state(),dx=goal[0]-s.player.position[0],dz=goal[2]-s.player.position[2];
    const dist=Math.hypot(dx,dz);if(dist<.65){for(const k of held)await page.keyboard.up(k);return;}
    const x=dx*Math.cos(s.yaw)-dz*Math.sin(s.yaw),z=dx*Math.sin(s.yaw)+dz*Math.cos(s.yaw),next=new Set(['Shift']);
    if(Math.abs(x)>dist*.3)next.add(x>0?'d':'a');if(Math.abs(z)>dist*.3)next.add(z>0?'w':'s');
    for(const k of held)if(!next.has(k)){await page.keyboard.up(k);held.delete(k);}
    for(const k of next)if(!held.has(k)){await page.keyboard.down(k);held.add(k);}
    await page.waitForTimeout(120);
  }
  for(const k of held)await page.keyboard.up(k);
  throw Error(`Could not walk to the exposed ${region}`);
}
async function target(region) {return page.evaluate(({id,region})=>{
  const g=window.__leonida.game,model=g.population.pedestrians.find(p=>p.id===id).model,V=g.player.position.constructor;
  if(region==='head')return model.jointPosition('head').add(model.jointPosition('head').subtract(model.jointPosition('neck')).normalize().scale(.075)).asArray();
  if(region==='torso')return V.Lerp(model.jointPosition('chest'),model.jointPosition('pelvis'),.22).asArray();
  const side=region.startsWith('left')?'left':'right';
  return region.endsWith('Leg')?V.Lerp(model.jointPosition(side+'Calf'),model.jointPosition(side+'Foot'),.45).asArray():V.Lerp(model.jointPosition(side+'Arm'),model.jointPosition(side+'Forearm'),.55).asArray();
},{id:victimId,region});}
const angle=n=>Math.atan2(Math.sin(n),Math.cos(n));
async function aim(region) {
  for(let i=0;i<24;i++) {
    const [s,point]=await Promise.all([state(),target(region)]),d=point.map((v,j)=>v-s.camera[j]),length=Math.hypot(...d);
    const yaw=angle(Math.atan2(d[0],d[2])-Math.atan2(s.forward[0],s.forward[2])),pitch=Math.asin(s.forward[1])-Math.asin(d[1]/length);
    if(Math.abs(yaw)<.004&&Math.abs(pitch)<.005)return;
    mx+=Math.max(-450,Math.min(450,yaw/.0025));my+=Math.max(-250,Math.min(250,pitch/.0017));
    await page.mouse.move(mx,my);await page.waitForTimeout(70);
  }
}
async function shot(region) {
  const before=await state();
  for(let attempt=0;attempt<8;attempt++) {
    await aim(region);await page.mouse.down({button:'left'});await page.waitForTimeout(70);await page.mouse.up({button:'left'});await page.waitForTimeout(1150);
    const after=await state();if(after.victim.health<before.victim.health)return after;
  }
  throw Error(`Eight normal aimed shots missed ${region}`);
}
try {
  await page.goto(`${origin}/?backend=${backend}&test`,{waitUntil:'domcontentloaded'});
  await page.locator('[data-action="play"]').waitFor({state:'visible',timeout:120000});
  const module=await page.locator('script[type="module"]').getAttribute('src');checks.push({label:'build',module,sha256:createHash('sha256').update(Buffer.from(await(await fetch(new URL(module,origin))).arrayBuffer())).digest('hex'),world:(await(await fetch(`${origin}/world/manifest.json`)).json()).build,browser:browser.version()});
  await page.locator('[data-action="play"]').click();await page.waitForTimeout(1300);
  assert.equal((await state()).backend,backend==='webgpu'?'WebGPU':'WebGL2');
  await creative();await page.locator('[data-change="god"]').check();await page.locator('[data-change="police"]').uncheck();
  await page.locator('[data-change="peds"]').press('Home');await page.locator('[data-change="traffic"]').press('Home');
  await page.locator('[data-change="sim-speed"]').selectOption('.25');await page.locator('[data-action="remove-vehicle"]').click();await close();
  await openRoad();
  if (only !== 'player') {
  const victims=[];
  for(const region of ['leftLeg','rightLeg','torso','leftArm','rightArm','head']) {
    await creative();await page.locator('[data-action="ped"]').click();await close();victimId=(await state()).creative.at(-1);victims.push({id:victimId,region});
    await lock();await page.keyboard.press('1');await page.waitForTimeout(2600);await page.mouse.down({button:'right'});await page.waitForTimeout(500);
    if(region.endsWith('Arm')){await page.mouse.up({button:'right'});await approachVisibleArm(region);await page.mouse.down({button:'right'});await page.waitForTimeout(400);}
    await capture(`${region}-before`);let s=await shot(region);s=await capture(`${region}-hit`);
    assert.ok(s.victim.health>0&&s.victim.health<100,'one pistol hit is a surviving regional injury');
    assert.ok(s.victim.body.regions[region].severity>0,`${region} receives its own injury`);
    for(const [other,value]of Object.entries(s.victim.body.regions))if(other!==region)assert.equal(value.severity,0,`targeted ${region} leaves ${other} intact`);
    if(region!=='head')assert.equal(s.victim.physical,false,'partial hits do not automatically ragdoll');
    await page.mouse.up({button:'right'});
  }
  await creative();await page.locator('[data-change="sim-speed"]').selectOption('1');await close();
  await page.waitForTimeout(6500);let s=await capture('critical-head-crawling');assert.equal(s.victim.dead,false);assert.equal(s.victim.body.critical,true);assert.equal(s.victim.physical,false);
  assert.ok(s.victim.joints.chest[1]-s.victim.position[1]<.85);
  await creative();await page.locator('[data-action="save"]').click();await close();const saved=s.victim.body;
  await creative();await page.locator('[data-action="load"]').click();await close();await page.waitForTimeout(700);s=await capture('regional-save-restored');
  assert.equal(s.victim.body.critical,true);assert.equal(s.victim.health,36);assert.ok(s.victim.body.regions.head.severity>=saved.regions.head.severity-.005);
  assert.ok(victims.every(v=>s.casualties.civilians.some(entry=>entry.id===v.id&&entry.bodyInjuries.regions[v.region].severity>0)));
  await page.waitForTimeout(14000);s=await capture('critical-survivor-after-twenty-seconds');assert.equal(s.victim.body.critical,true);assert.equal(s.victim.dead,false);
  }
  if (only !== 'npc') {
    await openRoad();
    // Place a wooden prop, approach it with normal movement, and use the
    // exposed fire to exercise the real player damage route.
    await creative();await page.locator('[data-change="sim-speed"]').selectOption('1');
    await page.locator('#prop-kind').selectOption('wood');await page.locator('[data-action="prop"]').click();await close();
    await lock();await page.keyboard.press('Tab');
    const prop=(await state()).props.at(-1);assert.ok(prop);
    await page.keyboard.down('w');
    const deadline=performance.now()+4000;
    while(performance.now()<deadline) {const p=(await state()).player.position;if(Math.hypot(p[0]-prop.position[0],p[2]-prop.position[2])<1.35)break;await page.waitForTimeout(50);}
    await page.keyboard.up('w');
    await creative();await page.locator('[data-change="god"]').uncheck();await page.locator('[data-action="ignite"]').click();await close();
    await capture('player-fire-exposure');
    let partial=false, critical=false;
    const burnDeadline=performance.now()+26000;
    while(performance.now()<burnDeadline) {
      const s=await state();
      if(!partial&&s.player.health<90){partial=true;await capture('player-partial-torso');assert.ok(s.player.body.regions.torso.severity>0);}
      if(s.player.body?.critical){critical=true;break;}
      await page.waitForTimeout(150);
    }
    await creative();await page.locator('[data-action="extinguish"]').click();await close();
    assert.equal(partial,true,'fire affects player health through its own capsule');assert.equal(critical,true,'continued exposure accumulates into critical trauma');
    await page.waitForTimeout(3500);const before=await capture('player-critical-crawl');
    assert.equal(before.player.dead,false);assert.equal(before.player.stanceHeight,.64);assert.equal(before.player.physical,false);
    await lock();await page.keyboard.down('s');await page.keyboard.down('Shift');await page.waitForTimeout(3000);await page.keyboard.up('s');await page.keyboard.up('Shift');
    const crawled=await capture('player-crawled-away');
    const moved=Math.hypot(crawled.player.position[0]-before.player.position[0],crawled.player.position[2]-before.player.position[2]);
    assert.ok(moved>.3&&moved<3.5,`injury permits slow controlled crawling, not sprinting: ${moved}m`);
    await creative();await page.locator('[data-action="save"]').click();await close();
    await creative();await page.locator('[data-action="load"]').click();await close();await page.waitForTimeout(800);
    const restored=await capture('player-injury-save-restored');
    assert.equal(restored.player.body.critical,true);assert.equal(restored.player.stanceHeight,.64);assert.equal(restored.player.health,crawled.player.health);
    await page.waitForTimeout(8000);const retained=await capture('player-injury-retained');assert.equal(retained.player.body.critical,true);assert.equal(retained.player.dead,false);
  }
} catch(e) {errors.push(e.stack||String(e));await capture('failure').catch(()=>{});}
finally {await writeFile(`${output}/result.json`,JSON.stringify({origin,backend,method:'Normal sandbox spawn/settings, mouse aiming and pistol fire at six regions, delayed survival and normal save/load. Game diagnostics are read only; no direct game-state mutations.',checks,errors,warnings},null,2));await browser.close();console.log(JSON.stringify({checks:checks.length,errors,warnings}));if(errors.length)process.exitCode=1;}
