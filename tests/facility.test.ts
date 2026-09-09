import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import HavokPhysics from "@babylonjs/havok";
import { DirectionalLight, HavokPlugin, NullEngine, Scene, ShadowGenerator, Vector3, type PhysicsEngineV2 } from "@babylonjs/core";
import { ChunkResidency } from "../src/world/ChunkResidency";
import { createLaneGraph } from "../src/world/layout";
import { RestrictedFacility, FACILITY_RULES, insideFacility } from "../src/gameplay/RestrictedFacility";
import { Officer } from "../src/gameplay/police/Officer";
import { WantedSystem } from "../src/gameplay/Wanted";
import { VehicleSystem } from "../src/vehicles/VehicleSystem";
import type { Player } from "../src/gameplay/Player";
import type { WorldContract } from "../src/core/contracts";
import { distance } from "../src/core/math";

async function setup(){
  const bytes=await readFile(new URL("../node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm",import.meta.url));
  const havok=await HavokPhysics({wasmBinary:bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer});
  const engine=new NullEngine(),scene=new Scene(engine);scene.enablePhysics(new Vector3(0,-9.81,0),new HavokPlugin(true,havok));
  const shadows=new ShadowGenerator(128,new DirectionalLight("sun",new Vector3(0,-1,0),scene));
  const spawn=new Vector3(-452,1.05,144),residency=new ChunkResidency(scene,shadows,spawn);
  const manifest=JSON.parse(await readFile(new URL("../public/world/manifest.json",import.meta.url),"utf8"));
  for(const collider of manifest.colliders)residency.registerCollider(collider);
  const world:WorldContract&{ensureCollision:(p:Vector3)=>void}={spawn,obstacles:manifest.colliders.flatMap((c:{obstacle?:unknown})=>c.obstacle?[c.obstacle]:[]),roads:createLaneGraph(),locations:[],waterLevel:0,update(){},ensureCollision:p=>residency.ensureCollision(p),dispose:()=>residency.dispose()};
  let health=100;
  const player={position:spawn.clone(),heading:Math.PI*1.5,name:"Jason",vehicle:null,aim:false,deadTimer:0,hurt(amount:number){health=Math.max(0,health-amount);}} as unknown as Player;
  const wanted=new WantedSystem(),vehicles=new VehicleSystem({scene,shadows}),facility=new RestrictedFacility(scene,shadows,world,vehicles,player,wanted),physics=scene.getPhysicsEngine() as PhysicsEngineV2;
  const step=(seconds:number)=>{for(let i=0;i<seconds*60;i++){facility.update(1/60);wanted.update(1/60,player.position,facility.observesSuspect,null,"Jason");physics._step(1/60);}};
  const dispose=()=>{facility.dispose();world.dispose();scene.dispose();engine.dispose();};
  return {scene,shadows,physics,world,facility,player,wanted,step,dispose,health:()=>health};
}

test("annex gate physically blocks entry until normal visitor access opens its animated Havok body",async t=>{
  const f=await setup();
  try{
    const actor=new Officer("visitor-fixture","patrol","none",f.scene,f.shadows);actor.dismount(f.player.position);
    const walk=(seconds:number)=>{for(let n=0;n<seconds*60;n++){f.player.position.copyFrom(actor.position);f.facility.update(1/60);actor.move(1/60,new Vector3(-1,0,0),3,false);f.physics._step(1/60);}};
    walk(2);const closed=actor.position.clone();
    assert.ok(closed.x>-455.7,`closed boom stopped capsule at ${closed.x}`);assert.equal(insideFacility(closed),false);assert.equal(f.wanted.heat,0);
    assert.equal(f.facility.requestAccess(),true);f.step(1.6);assert.equal(f.facility.stats.gateOpen,true);walk(4);
    assert.ok(actor.position.x<-461,"raised real barrier permits physical entry");assert.equal(f.facility.phase,"authorized");assert.equal(f.wanted.heat,0);
    t.diagnostic(JSON.stringify({closed:closed.asArray(),authorized:actor.position.asArray(),guards:f.facility.stats.activeGuards}));actor.dispose();
  }finally{f.dispose();}
});

test("leaving within the annex warning avoids a crime; ignoring it leads to calm detention rather than automatic shooting",async t=>{
  const f=await setup();
  try{
    f.player.position.set(-463,1.05,144);f.step(2);assert.equal(f.facility.phase,"warning");assert.equal(f.wanted.heat,0);
    f.player.position.set(-452,1.05,144);f.step(.1);assert.equal(f.facility.phase,"quiet");assert.equal(f.wanted.heat,0);
    f.player.position.set(-464,1.05,144);let arrested=false;f.facility.onArrest=()=>{arrested=true;};f.step(16);
    assert.equal(f.facility.phase,"alarm");assert.equal(f.wanted.stars,3);assert.ok(arrested,"nearby guard detains compliant trespasser after warning");assert.equal(f.health(),100,"compliant person is not shot for trespass alone");
    assert.equal(f.facility.guards.length,FACILITY_RULES.guardCount);assert.ok(f.facility.guards.every(g=>g.role==="military"&&g.model.torso.metadata.officer===g));
    t.diagnostic(JSON.stringify({arrested,stats:f.facility.stats,health:f.health()}));
  }finally{f.dispose();}
});

test("visitor authorization is revoked by armed behavior, guard shots damage a resisting suspect, patrols and resets retain bounded stable actors",async t=>{
  const f=await setup();
  try{
    f.step(.1);assert.equal(f.facility.requestAccess(),true);const before=f.facility.guards[1].position.clone();f.step(9);
    assert.ok(distance(before,f.facility.guards[1].position)>5,"guard physically patrols while visitor access is active");
    f.player.position.set(-468,1.05,145);f.player.aim=true;f.step(12);
    assert.equal(f.facility.phase,"alarm");assert.equal(f.facility.accessRemaining,0);assert.ok(f.health()<100,"observed armed threat receives actual guard damage");assert.equal(f.facility.arrestProgress,0);
    const ids=f.facility.guards.map(g=>g.id);let callback=false;f.facility.onCharacterHit=()=>{callback=true;};f.facility.hurtGuard(f.facility.guards[0],25);assert.ok(callback);assert.equal(f.facility.guards[0].health,115);
    f.facility.reset();f.step(.1);assert.deepEqual(f.facility.guards.map(g=>g.id),ids);assert.equal(f.facility.guards.length,4);assert.ok(f.facility.guards.every(g=>g.health===140));
    f.player.position.set(3.3,1.05,-28);f.step(35);assert.equal(f.facility.stats.activeGuards,0);assert.ok(f.facility.guards.every(g=>!g.controller));
    t.diagnostic(JSON.stringify({healthAfterThreat:f.health(),guardIds:ids,phase:f.facility.phase}));
  }finally{f.dispose();}
});
