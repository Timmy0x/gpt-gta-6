import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import HavokPhysics from "@babylonjs/havok";
import { DirectionalLight, HavokPlugin, NullEngine, Scene, ShadowGenerator, Vector3, type PhysicsEngineV2 } from "@babylonjs/core";
import { ChunkResidency } from "../src/world/ChunkResidency";
import { createLaneGraph } from "../src/world/layout";
import type { WorldContract } from "../src/core/contracts";
import { Officer } from "../src/gameplay/police/Officer";
import { footRoute } from "../src/gameplay/police/rules";
import { distance } from "../src/core/math";
import { PoliceDirector, type Driver } from "../src/gameplay/police/PoliceDirector";
import { VehicleSystem } from "../src/vehicles/VehicleSystem";
import { WantedSystem } from "../src/gameplay/Wanted";
import type { Player } from "../src/gameplay/Player";

/** Production exported world collision, without raster/texture loading or visual verification. */
async function urban() {
  const wasm=await readFile(new URL("../node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm",import.meta.url));
  const havok=await HavokPhysics({wasmBinary:wasm.buffer.slice(wasm.byteOffset,wasm.byteOffset+wasm.byteLength) as ArrayBuffer});
  const engine=new NullEngine();
  const scene=new Scene(engine);scene.enablePhysics(new Vector3(0,-9.81,0),new HavokPlugin(true,havok));
  const shadows=new ShadowGenerator(128,new DirectionalLight("sun",new Vector3(0,-1,0),scene));
  const manifest=JSON.parse(await readFile(new URL("../public/world/manifest.json",import.meta.url),"utf8"));
  const spawn=new Vector3(3.3,1.2,-28),residency=new ChunkResidency(scene,shadows,spawn);
  for(const collider of manifest.colliders)residency.registerCollider(collider);
  const world:WorldContract&{ensureCollision:(p:Vector3)=>void}={spawn,roads:createLaneGraph(),obstacles:manifest.colliders.flatMap((c:{obstacle?:unknown})=>c.obstacle?[c.obstacle]:[]),locations:[],waterLevel:0,update(){},ensureCollision:p=>residency.ensureCollision(p),dispose:()=>residency.dispose()};
  return {engine,scene,shadows,world,physics:scene.getPhysicsEngine() as PhysicsEngineV2};
}

test("roadblock officer reaches the central suspect using production urban Havok collision",async t=>{
  const {engine,scene,shadows,world,physics}=await urban();
  try {
    const officer=new Officer("officer-10","patrol","fixture",scene,shadows);
    officer.dismount(new Vector3(68.7,1.15,193.96));
    const goal={x:3.3,z:-28};let timer=0;const samples=[];
    for(let frame=0;frame<60*65;frame++) {
      const p=officer.position;world.ensureCollision(p);timer-=1/60;
      if(timer<=0){officer.path=footRoute(p,goal,world.roads,world.obstacles);timer=1;}
      while(officer.path.length&&distance(p,officer.path[0])<1.1)officer.path.shift();
      const n=officer.path[0];officer.move(1/60,n?new Vector3(n.x-p.x,0,n.z-p.z).normalize():Vector3.Zero(),n&&distance(p,goal)>2?4.4:0,false);physics._step(1/60);
      if(frame%600===0)samples.push({seconds:frame/60,p:officer.position.asArray(),path:officer.path.slice(0,3)});
    }
    t.diagnostic(JSON.stringify({obstacles:world.obstacles.length,samples,end:officer.position.asArray()}));
    assert.ok(distance(officer.position,goal)<8,"officer must make sustained progress rather than oscillate between lane connectors");officer.dispose();
  }finally{world.dispose();scene.dispose();engine.dispose();}
});

test("urban cruiser follows lane corners instead of cutting into the garage approach",async t=>{
  const {engine,scene,shadows,world,physics}=await urban();
  try {
    const player={position:new Vector3(3.3,1.02,-28),heading:0,name:"Jason",vehicle:null,aim:true,deadTimer:0,hurt(){}} as unknown as Player;
    const vehicles=new VehicleSystem({scene,shadows});const wanted=new WantedSystem();wanted.setLevel(5,player.position);
    const director=new PoliceDirector(scene,shadows,world,vehicles,player,wanted);
    const start=world.roads.find(n=>Math.abs(n.x+3.3)<.01&&n.z===-134)!;
    const next=world.roads.find(n=>n.id===start.next[0])!;
    const vehicle=vehicles.spawn("police",new Vector3(start.x,1,start.z),Math.atan2(next.x-start.x,next.z-start.z));
    const officer=new Officer("fixture-cruiser","patrol",vehicle.id,scene,shadows);director.officers.push(officer);
    const drivers:Driver[]=[{v:vehicle,target:next.id,previous:start.id,police:true,stuck:0,assignment:"patrol"}];
    (director as unknown as {spawnTimer:number}).spawnTimer=Infinity;
    const samples=[];let arrived=false;
    for(let frame=0;frame<60*75;frame++){
      world.ensureCollision(vehicle.root.position);world.ensureCollision(player.position);
      director.update(1/60,drivers,true);vehicles.update(1/60);physics._step(1/60);
      if(frame%600===0)samples.push({seconds:frame/60,p:vehicle.root.position.asArray(),target:drivers[0]?.target,heading:vehicle.heading,speed:vehicle.speed,state:officer.state});
      if(officer.state!=="riding"&&distance(officer.position,player.position)<15){arrived=true;break;}
    }
    t.diagnostic(JSON.stringify({samples,end:vehicle.root.position.asArray(),officer:officer.position.asArray(),arrived}));
    assert.ok(arrived,"cruiser must reach a useful dismount location without wedging in a static urban corner");director.reset(drivers);
  }finally{world.dispose();scene.dispose();engine.dispose();}
});

test("a cruiser deflected to the observed garage blockage recovers or safely continues pursuit on foot",async t=>{
  const {engine,scene,shadows,world,physics}=await urban();
  try {
    const player={position:new Vector3(3.3,1.02,-28),heading:0,name:"Jason",vehicle:null,aim:true,deadTimer:0,hurt(){}} as unknown as Player;
    const vehicles=new VehicleSystem({scene,shadows}),wanted=new WantedSystem();wanted.setLevel(5,player.position);
    const director=new PoliceDirector(scene,shadows,world,vehicles,player,wanted);
    const target=world.roads.find(n=>Math.abs(n.x-3.3)<.01&&n.z===-10)!;
    const vehicle=vehicles.spawn("police",new Vector3(-44.4,1,-52),1.6),officer=new Officer("blocked-cruiser","patrol",vehicle.id,scene,shadows);
    const blockage=vehicles.spawn("sedan",new Vector3(-38,1,-52),1.6);vehicles.control(blockage,{throttle:0,steer:0,brake:1,handbrake:true,lift:0});
    director.officers.push(officer);const driver:Driver={v:vehicle,target:target.id,previous:target.id,police:true,stuck:0,assignment:"patrol"};const drivers=[driver];
    (director as unknown as {spawnTimer:number}).spawnTimer=Infinity;
    let arrived=false,sawReverse=false;const samples=[];
    for(let frame=0;frame<60*75;frame++){
      world.ensureCollision(vehicle.root.position);world.ensureCollision(officer.position);director.update(1/60,drivers,true);vehicles.update(1/60);physics._step(1/60);
      sawReverse||=vehicle.input.throttle<0;
      if(frame%600===0)samples.push({seconds:frame/60,car:vehicle.root.position.asArray(),officer:officer.position.asArray(),state:officer.state,recovery:driver.recovery?{...driver.recovery}:null});
      if(officer.state!=="riding"&&distance(officer.position,player.position)<15){arrived=true;break;}
    }
    t.diagnostic(JSON.stringify({arrived,sawReverse,samples,end:vehicle.root.position.asArray()}));assert.ok(arrived,"the obstructed responder must not remain indefinitely trapped at the garage facade");assert.ok(sawReverse,"a stationary traffic obstruction must trigger real backing controls instead of freezing the progress timer");director.reset(drivers);vehicles.remove(blockage);
  }finally{world.dispose();scene.dispose();engine.dispose();}
});
