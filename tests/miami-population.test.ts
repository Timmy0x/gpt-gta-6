import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import HavokPhysics from '@babylonjs/havok';
import { DirectionalLight, HavokPlugin, MeshBuilder, NullEngine, PhysicsAggregate, PhysicsEngineV2, PhysicsShapeType, RawTexture, Scene, ShadowGenerator, Vector3 } from '@babylonjs/core';
import type { WorldContract } from '../src/core/contracts';
import type { Player } from '../src/gameplay/Player';
import { Population, LOCAL_POPULATION_BUDGET } from '../src/gameplay/Population';
import { WantedSystem } from '../src/gameplay/Wanted';
import { bodyInjuryEffects } from '../src/gameplay/Injuries';
import { hasCasualtyState, snapshotCasualty, validateCasualties } from '../src/gameplay/police/casualties';
import { RagdollReactions } from '../src/gameplay/combat/RagdollReactions';
import { VehicleSystem } from '../src/vehicles/VehicleSystem';
import { MiamiWorld } from '../src/world/miami/MiamiWorld';
import { buildMiamiPopulationSites } from '../src/world/miami/MiamiPopulationSites';
import { WorldBoundary } from '../src/world/WorldBoundary';
import type { MiamiDataset } from '../src/world/miami/types';

async function physicsFixture() {
  const bytes = await readFile(new URL('../node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm', import.meta.url));
  const havok = await HavokPhysics({wasmBinary: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer});
  const engine = new NullEngine(), scene = new Scene(engine);
  scene.enablePhysics(new Vector3(0,-9.81,0),new HavokPlugin(false,havok));
  const physics = scene.getPhysicsEngine() as PhysicsEngineV2;
  const shadows = new ShadowGenerator(16,new DirectionalLight('fixture',Vector3.Down(),scene));
  return {engine,scene,physics,shadows};
}
function populationFixture(f: Awaited<ReturnType<typeof physicsFixture>>, world: WorldContract) {
  const player = {position:world.spawn.clone(),vehicle:null,deadTimer:0,aim:false,god:false,name:'Jason',
    boundary:new WorldBoundary({bounds:world.bounds,fallback:world.spawn,floorHeight:()=>-22})} as unknown as Player;
  const vehicles = new VehicleSystem({scene:f.scene,shadows:f.shadows});
  const population = new Population(f.scene,f.shadows,world,vehicles,player,new WantedSystem());
  population.policeEnabled=false;
  const reactions=new RagdollReactions(f.scene);
  population.onCharacterHit=(model,impulse,fatal,impact)=>reactions.hit(model,impulse,fatal,impact);
  population.onCharacterRestored=model=>reactions.restore(model);
  const step=(frames:number)=>{for(let i=0;i<frames;i++){population.update(1/60);vehicles.update(1/60);f.physics._step(1/60);reactions.update(1/60);f.scene.onBeforeRenderObservable.notifyObservers(f.scene);}};
  return {player,vehicles,population,reactions,step,dispose(){reactions.dispose();vehicles.dispose();population.pedestrians.forEach(p=>p.model.dispose());f.scene.dispose();f.engine.dispose();}};
}
async function flatFixture() {
  const f=await physicsFixture();
  const floor=MeshBuilder.CreateBox('floor',{width:1400,depth:1400,height:1},f.scene);floor.position.y=-22.5;
  new PhysicsAggregate(floor,PhysicsShapeType.BOX,{mass:0},f.scene);
  const pedestrianSites = [-400,0,400].flatMap((x,region)=>Array.from({length:35},(_,i)=>({id:`miami-local-test-${region}-${i}`,
    position:new Vector3(x+(i%7-3)*10,-22,30+Math.floor(i/7)*10),target:new Vector3(x+(i%7-3)*10,-22,36+Math.floor(i/7)*10)})));
  const world:WorldContract={worldId:'miami-test',spawn:new Vector3(0,-21.06,0),pedestrianSpawns:[],pedestrianSites,
    roads:[],locations:[],obstacles:[],waterLevel:-24,bounds:{minX:-690,maxX:690,minZ:-690,maxZ:690},restrictedFacility:false,
    hasGroundCoverage:(x,z)=>Math.abs(x)<690&&Math.abs(z)<690,collisionReady:()=>true,update(){},dispose(){}};
  return {...f,...populationFixture(f,world),world};
}

test('source residents retire with exact limb injuries and death, survive travel, save/load, density zero and explicit reset',async t=>{
  const f=await flatFixture();t.after(()=>f.dispose());
  f.step(240);assert.ok(f.population.pedestrians.length>10);
  const dead=f.population.pedestrians[0],injured=f.population.pedestrians[1];
  f.population.hurtPed(dead,200,'projectile',{region:'head'});
  f.population.hurtPed(injured,55,'projectile',{region:'leftLeg'});
  f.step(120);const woundedHealth=injured.health, mode=bodyInjuryEffects(injured.model.bodyInjuries).mode;
  assert.ok(['crawling','down'].includes(mode));assert.ok(woundedHealth>0&&woundedHealth<100);
  const exact=JSON.parse(JSON.stringify(f.population.serializeCasualties()));assert.equal(exact.version,4);assert.ok(validateCasualties(exact));
  const death=exact.civilians.find((p:{id:string})=>p.id===dead.id),wound=exact.civilians.find((p:{id:string})=>p.id===injured.id);
  assert.ok(death&&wound);
  f.player.position.x=400;f.step(180);
  assert.equal(dead.model.root.isDisposed(),true);assert.equal(injured.model.root.isDisposed(),true);
  assert.ok(f.population.pedestrians.length<=LOCAL_POPULATION_BUDGET.pedestrians);
  const saved=JSON.parse(JSON.stringify(f.population.serializeCasualties()));
  assert.equal(saved.civilians.find((p:{id:string})=>p.id===dead.id)?.health,death.health);
  assert.equal(saved.civilians.find((p:{id:string})=>p.id===injured.id)?.health,wound.health);
  const retirement=JSON.parse(JSON.stringify(saved.civilians));
  f.step(600);assert.deepEqual(f.population.serializeCasualties().civilians,retirement,'retired pose, limb injuries and health remain frozen while away');
  f.population.reset(false);f.player.position.x=0;f.step(120);
  const returnedDead=f.population.pedestrians.find(p=>p.id===dead.id), returnedInjured=f.population.pedestrians.find(p=>p.id===injured.id);
  assert.ok(returnedDead&&returnedInjured);assert.equal(returnedDead.health,0);assert.equal(returnedDead.model.dead,true);
  assert.ok(returnedInjured.health<=woundedHealth+.1);assert.equal(bodyInjuryEffects(returnedInjured.model.bodyInjuries).canStand,false);
  f.population.density=0;f.step(60);assert.equal(returnedDead.model.root.isEnabled(),true);assert.equal(returnedInjured.model.root.isEnabled(),true);
  f.player.position.x=400;f.step(60);f.player.position.x=0;f.step(120);
  assert.equal(f.population.pedestrians.length,2,'zero crowd density still restores the two existing casualties');
  assert.equal(f.population.pedestrians.find(p=>p.id===dead.id)?.health,0);
  const clone=await flatFixture();try{
    clone.player.position.x=400;clone.population.density=0;
    assert.equal(clone.population.restoreCasualties(saved),true);clone.step(120);assert.equal(clone.population.pedestrians.length,0);
    assert.ok(clone.population.serializeCasualties().civilians.some(p=>p.id===dead.id&&p.health===0));
    clone.player.position.x=0;clone.population.density=1;clone.step(120);
    const restored=clone.population.pedestrians.find(p=>p.id===injured.id);assert.ok(restored);assert.equal(bodyInjuryEffects(restored.model.bodyInjuries).canStand,false);
    assert.equal(clone.population.pedestrians.find(p=>p.id===dead.id)?.health,0);
    clone.population.reset();assert.equal(clone.population.serializeCasualties().civilians.length,0);
  }finally{clone.dispose();}
});

test('native placement excludes occupied, wet and obstructed source candidates and obeys collision/density holds',async t=>{
  const f=await flatFixture();t.after(()=>f.dispose());
  const wall=MeshBuilder.CreateBox('blocked-site',{width:200,depth:200,height:20},f.scene);wall.position.set(0,-12,60);
  new PhysicsAggregate(wall,PhysicsShapeType.BOX,{mass:0},f.scene);
  f.physics._step(1/60);f.step(120);assert.equal(f.population.pedestrians.length,0);
  wall.dispose();f.world.hasGroundCoverage=()=>false;f.step(120);assert.equal(f.population.pedestrians.length,0);
  f.world.hasGroundCoverage=()=>true;f.world.collisionReady=()=>false;f.step(120);assert.equal(f.population.pedestrians.length,0);
  f.world.collisionReady=()=>true;f.population.density=0;f.step(120);assert.equal(f.population.pedestrians.length,0);
  f.population.density=1;f.step(120);assert.ok(f.population.pedestrians.length>0);
  for(const ped of f.population.pedestrians)assert.ok(Vector3.Distance(ped.model.root.position,f.player.position)>15,'no actor born inside the player');
});

test('local traffic retires pristine offscreen cars but preserves damaged and injured occupants, stable IDs and saves',async t=>{
  const f=await flatFixture();t.after(()=>f.dispose());f.population.density=0;
  for(const x of [0,400])for(let i=0;i<8;i++){
    const id=f.world.roads.length;
    f.world.roads.push({id,x:x+60,y:-22,z:-60+i*14,next:i===7?[]:[id+1]});
  }
  f.step(180);assert.ok(f.population.drivers.length>=2);
  const damaged=f.population.drivers[0], healthy=f.population.drivers[1];
  damaged.v.model.windows[0].setEnabled(false);
  const crew=f.population.pedestrians.find(p=>p.vehicleId===damaged.v.id)!;
  const snapshot=f.population.serializeCasualties();assert.ok(snapshot.civilians.some(p=>p.id===crew.id&&p.vehicleId===damaged.v.id&&p.health===100),'changed car is included through its seated crew save');
  f.player.position.x=400;f.step(120);
  assert.equal(healthy.v.root.isDisposed(),true);assert.equal(damaged.v.root.isDisposed(),false);
  assert.ok(f.vehicles.list.includes(damaged.v));assert.equal(crew.model.root.isDisposed(),false);
  assert.equal(f.population.serializeCasualties().civilians.find(p=>p.id===crew.id)?.vehicleId,damaged.v.id);
  const wounded=f.population.drivers.find(d=>d.v!==damaged.v)!;
  const injured=f.population.pedestrians.find(p=>p.vehicleId===wounded.v.id)!;
  f.population.hurtPed(injured,55,'projectile',{region:'leftLeg'});assert.equal(f.population.occupancy.canDrive(wounded.v),false);
  f.player.position.x=0;f.step(120);assert.equal(wounded.v.root.isDisposed(),false);assert.ok(injured.health>0&&injured.health<100);
  assert.equal(f.population.drivers.filter(d=>d.v.id===damaged.v.id).length,1);assert.ok(f.vehicles.list.length<=48);
  f.population.trafficDensity=0;const count=f.vehicles.list.length;f.player.position.x=-400;f.step(180);
  assert.ok(f.vehicles.list.length<=count,'zero traffic density creates no replacement cars');
});

test('healthy crew in changed-car saves restores without acquiring a false permanent legacy injury',async t=>{
  const f=await flatFixture();t.after(()=>f.dispose());f.population.density=0;
  for(let i=0;i<8;i++)f.world.roads.push({id:i,x:60,y:-22,z:-60+i*14,next:i===7?[]:[i+1]});
  f.step(180);const changed=f.population.drivers[0];assert.ok(changed);
  // A cancelled approach leaves the original crew driving. Cosmetic damage
  // after it must still be compared against the original pristine baseline.
  changed.v.occupied=true;changed.v.controlLocked=true;f.step(60);
  changed.v.occupied=false;changed.v.controlLocked=false;
  assert.equal(changed.v.health,100);
  changed.v.model.windows[0].setEnabled(false);
  const crew=f.population.pedestrians.find(p=>p.vehicleId===changed.v.id)!;
  const saved=JSON.parse(JSON.stringify(f.population.serializeCasualties()));
  assert.ok(saved.civilians.some((entry:{id:string})=>entry.id===crew.id),'cancelled interaction preserves the changed-car crew save');
  const clone=await flatFixture();try{
    clone.population.density=0;clone.population.trafficDensity=0;
    const vehicle=clone.vehicles.restore(f.vehicles.serialize(changed.v));
    assert.equal(clone.population.restoreCasualties(saved),true);
    const restored=clone.population.pedestrians.find(p=>p.id===crew.id)!;assert.ok(restored);
    assert.equal(restored.health,100);assert.equal(restored.model.injury,null);
    assert.equal(hasCasualtyState(restored.model,restored.health),false);
    assert.equal(clone.population.occupancy.canDrive(vehicle),true);
    assert.equal(restored.model.root.metadata.injuryStatus,'healthy');
    const occupant=clone.population.occupancy.get(vehicle)!;
    occupant.onEjected(vehicle.root.position.add(new Vector3(3,0,0)));
    assert.equal(hasCasualtyState(restored.model,restored.health),false,'a later ejection cannot inherit permanent incapacitation');
  }finally{clone.dispose();}
});

test('cached lying corpses restore under low clearance in their saved pose and reject genuinely occupied lying space',async t=>{
  const f=await flatFixture();t.after(()=>f.dispose());f.population.density=0;f.population.trafficDensity=0;
  const ped=f.population.spawnPed(new Vector3(0,-22,30),undefined,false,'miami-local-test-1-3');
  ped.health=0;ped.model.dead=true;ped.model.root.rotation.z=Math.PI/2;
  const entry=snapshotCasualty(ped.id,ped.model,0);
  const saved={version:4,civilians:[entry],guards:[],police:[],nextOfficerId:1};
  ped.model.dispose();f.population.pedestrians=[];
  const canopy=MeshBuilder.CreateBox('low-overhang',{width:5,height:.2,depth:8},f.scene);canopy.position.set(0,-20.9,30);
  new PhysicsAggregate(canopy,PhysicsShapeType.BOX,{mass:0},f.scene);f.physics._step(1/60);
  // This wall occupies the saved torso itself; an overhead obstruction alone does not.
  const blocker=MeshBuilder.CreateBox('lying-space-blocked',{width:.8,height:1,depth:1},f.scene);blocker.position.set(-1,-21.7,30);
  new PhysicsAggregate(blocker,PhysicsShapeType.BOX,{mass:0},f.scene);f.physics._step(1/60);
  assert.equal(f.population.restoreCasualties(saved),true);f.step(120);
  assert.equal(f.population.pedestrians.some(p=>p.id===entry.id),false);
  assert.equal(f.population.serializeCasualties().civilians[0].health,0,'blocked restore preserves the same dead record');
  blocker.dispose();f.physics._step(1/60);f.step(120);
  const restored=f.population.pedestrians.find(p=>p.id===entry.id);assert.ok(restored);
  assert.equal(restored.health,0);assert.equal(restored.model.dead,true);
  assert.equal(canopy.isDisposed(),false,'the cached corpse fits while the standing obstruction remains');
});

test('civilian fallback falls onto native negative-height ground and preserves height when support is absent',async t=>{
  const f=await flatFixture();t.after(()=>f.dispose());f.population.onCharacterHit=null;f.step(60);
  const ped=f.population.pedestrians[0];assert.ok(ped);f.population.hurtPed(ped,200);
  assert.ok(Math.abs(ped.model.root.position.y+21.65)<.02);
  const stranded=f.population.spawnPed(new Vector3(900,-35,900));f.population.hurtPed(stranded,200);
  assert.equal(stranded.model.root.position.y,-35,'missing support never guesses ellipsoid-zero ground');
});

test('versioned source ledger retains more than sixty unique casualties without weakening legacy save bounds',()=>{
  const civilian={x:0,y:-22,z:0,yaw:0,health:0,recoverySeconds:null,kind:'projectile',fallen:true};
  const saved={version:4,civilians:Array.from({length:70},(_,i)=>({...civilian,id:`miami-local-${i}`})),guards:[],police:[],nextOfficerId:1};
  assert.equal(validateCasualties(saved),true);assert.equal(validateCasualties({...saved,version:3}),false);
  assert.equal(validateCasualties({...saved,civilians:[...saved.civilians,saved.civilians[0]]}),false);
  assert.equal(validateCasualties({...saved,civilians:Array.from({length:4097},(_,i)=>({...civilian,id:`miami-local-${i}`}))}),false);
});

test('actual R2 public source catalogue and native residents cover all named Miami destinations with bounded actors',async t=>{
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'name');Object.defineProperty(globalThis,'name',{value:'',configurable:true});
  t.after(()=>{if(descriptor)Object.defineProperty(globalThis,'name',descriptor);else Reflect.deleteProperty(globalThis,'name');});
  const f=await physicsFixture(), root=new URL('../public/',import.meta.url);
  const fetcher=(async(input:RequestInfo|URL)=>new Response(await readFile(new URL(new URL(String(input)).pathname.replace(/^\//,''),root)))) as typeof fetch;
  const world=new MiamiWorld({scene:f.scene,shadows:f.shadows},{baseUrl:'https://fixture.invalid/world/miami/',fetch:fetcher,
    loadTexture:()=>RawTexture.CreateRGBATexture(new Uint8Array([128,128,255,255]),1,1,f.scene)});
  await world.ready;const p=populationFixture(f,world);t.after(()=>{world.dispose();p.dispose();});
  assert.ok(world.pedestrianSites.length>100);assert.ok(world.pedestrianSites.length<=1024);
  const rebuilt=buildMiamiPopulationSites(world.mapData as MiamiDataset,world.pedestrianSpawns,(x,z)=>world.floorHeightAt(x,z),(x,z,r)=>world.hasGroundCoverage(x,z,r));
  assert.deepEqual(rebuilt.map(site=>site.id),world.pedestrianSites.map(site=>site.id),'public identity catalogue is reproducible');
  const visits=[];const emptyDestinations:string[]=[];let maxPeople=0,maxVehicles=0;
  for(const location of [world.locations[0],...world.locations.slice(1).sort((a,b)=>a.name.localeCompare(b.name))]) {
    const position=new Vector3(location.x,world.floorHeightAt(location.x,location.z)+.94,location.z);
    world.setActiveAnchors([]);await world.preparePosition(position);p.player.position.copyFrom(position);
    p.step(90);
    const nearby=p.population.pedestrians.filter(ped=>!ped.vehicleId&&Math.hypot(ped.model.root.position.x-position.x,ped.model.root.position.z-position.z)<125);
    const traffic=p.population.drivers.filter(driver=>Math.hypot(driver.v.root.position.x-position.x,driver.v.root.position.z-position.z)<180);
    maxPeople=Math.max(maxPeople,p.population.pedestrians.filter(ped=>!ped.vehicleId).length);maxVehicles=Math.max(maxVehicles,p.vehicles.list.length);
    console.log(JSON.stringify({populationVisit:location.name,pedestrians:nearby.length,traffic:traffic.length,vehicles:p.vehicles.list.length}));
    visits.push({id:location.id,name:location.name,pedestrians:nearby.length,traffic:traffic.length,position:position.asArray(),stats:p.population.ambientStats});
    if(!nearby.length)emptyDestinations.push(location.name);
    for(const ped of nearby)assert.equal(world.hasGroundCoverage(ped.model.root.position.x,ped.model.root.position.z,.29),true);
    assert.ok(p.population.ambientStats.residentPedestrians<=LOCAL_POPULATION_BUDGET.pedestrians);
    assert.ok(p.vehicles.list.length<=LOCAL_POPULATION_BUDGET.totalAmbientVehicles);
  }
  const report={catalogueSites:world.pedestrianSites.length,destinations:visits.length,maxPeople,maxVehicles,visits,
    emptyDestinations,limitations:['Roadside waiting residents use native clear ground where the source has no mapped sidewalk width.','Two accepted licensed civilian skins; photorealistic character diversity remains incomplete.','Sidewalk paths follow public road widths and require native support/clearance; contextual routines are walking and short pauses.','Changed traffic cars retain physical support and count against the 48 ambient vehicle cap.']};
  if(process.env.MIAMI_POPULATION_EVIDENCE){await mkdir(dirname(process.env.MIAMI_POPULATION_EVIDENCE),{recursive:true});await writeFile(process.env.MIAMI_POPULATION_EVIDENCE,JSON.stringify(report,null,2)+'\n');}
  assert.deepEqual(emptyDestinations,[],"all named destinations have native nearby civilian activity");
  t.diagnostic(JSON.stringify({catalogueSites:report.catalogueSites,destinations:report.destinations,maxPeople,maxVehicles,minPeople:Math.min(...visits.map(v=>v.pedestrians)),minTraffic:Math.min(...visits.map(v=>v.traffic))}));
});
