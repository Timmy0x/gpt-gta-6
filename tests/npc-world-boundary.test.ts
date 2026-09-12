import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import HavokPhysics from '@babylonjs/havok';
import { CharacterSupportedState, DirectionalLight, HavokPlugin, MeshBuilder, NullEngine, PhysicsAggregate, PhysicsCharacterController, PhysicsShapeType, Scene, ShadowGenerator, UniversalCamera, Vector3, type PhysicsEngineV2 } from '@babylonjs/core';
import { WorldBoundary } from '../src/world/WorldBoundary';
import { Population } from '../src/gameplay/Population';
import { Officer } from '../src/gameplay/police/Officer';
import { bodyInjuryEffects, createBodyInjuries } from '../src/gameplay/Injuries';
import { protectNpcController } from '../src/gameplay/NpcBoundary';
import { VehicleSystem } from '../src/vehicles/VehicleSystem';
import { WantedSystem } from '../src/gameplay/Wanted';
import type { Player } from '../src/gameplay/Player';
import type { WorldContract } from '../src/core/contracts';
const bytes = await readFile(new URL('../node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm', import.meta.url));
const havok = await HavokPhysics({ wasmBinary: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer });
const bounds = {minX:-180,maxX:180,minZ:-180,maxZ:180}, floor = -40, dt = 1/60;
function fixture(guards = false) {
  const engine = new NullEngine(), scene = new Scene(engine);
  scene.enablePhysics(new Vector3(0,-9.81,0),new HavokPlugin(true,havok));
  const physics=scene.getPhysicsEngine() as PhysicsEngineV2;
  const shadows=new ShadowGenerator(128,new DirectionalLight('npc-boundary-light',Vector3.Down(),scene));
  const mesh=MeshBuilder.CreateBox('finite 360 m support only',{width:360,depth:360,height:1},scene);mesh.position.y=floor-.5;
  new PhysicsAggregate(mesh,PhysicsShapeType.BOX,{mass:0,friction:.8},scene);
  const spawn=new Vector3(0,floor+.94,0),boundary=new WorldBoundary({bounds,floorHeight:()=>floor,fallback:spawn});
  const camera=new UniversalCamera('observer',spawn.add(new Vector3(0,2,-5)),scene);camera.setTarget(spawn);camera.getViewMatrix(true);camera.getProjectionMatrix(true);
  const player={position:spawn.clone(),boundary,camera,name:'Jason',aim:false,vehicle:null,deadTimer:0,hurt(){}} as unknown as Player;
  const world:WorldContract={spawn,roads:[],pedestrianSpawns:[],restrictedFacility:guards,obstacles:[],locations:[],waterLevel:-42,update(){},dispose(){}};
  const vehicles=new VehicleSystem({scene,shadows}),wanted=new WantedSystem(),population=new Population(scene,shadows,world,vehicles,player,wanted);
  return {scene,physics,shadows,boundary,population,world,wanted,player,dispose(){population.facility.dispose();population.police.removeResponse(population.drivers);population.pedestrians.forEach(p=>p.model.dispose());scene.dispose();engine.dispose();}};
}
function assertSupported(controller:PhysicsCharacterController) {
  const p=controller.getPosition();
  assert.ok(Math.abs(p.x)+.90<=180.002&&Math.abs(p.z)+.90<=180.002,`full footprint ${p.asArray()}`);
  assert.ok(p.y>floor+.20&&p.y<floor+1.05,`negative local-height support ${p.y}`);
  assert.equal(controller.checkSupport(dt,Vector3.Down()).supportedState,CharacterSupportedState.SUPPORTED);
}

test('citizen spawn uses the actual map boundary: sustained corner flee stays on finite negative ground and can return',()=>{
  const f=fixture();try{
    const ped=f.population.spawnPed(new Vector3(175,floor,175),undefined,true,'boundary-citizen'),outward=new Vector3(1,0,1).normalize();
    for(let i=0;i<900;i++){ped.movement!.move(dt,outward,6,bodyInjuryEffects(null));f.physics._step(dt);if(i>5)assertSupported(ped.movement!.controller!);}
    const edge=ped.movement!.controller!.getPosition().clone();assert.ok(edge.x>179&&edge.z>179);
    let actual=0;for(let i=0;i<120;i++){actual=ped.movement!.move(dt,new Vector3(-1,0,0),4,bodyInjuryEffects(null));f.physics._step(dt);}
    assert.ok(ped.model.root.position.x<edge.x-7.5);assert.ok(Math.abs(actual-4)<.02,'animation retains actual inward speed');
    assert.ok(Math.abs(ped.model.root.position.z-edge.z)<.01);
  }finally{f.dispose();}
});

test('dispatch, restored responders and guards receive the same playable boundary',()=>{
  const f=fixture(true);try{
    f.world.roads.push(...[-160,-140,-120,-100,100,120,140,160].map((z,i)=>({id:i,x:40,y:floor+.05,z,next:[i-1,i+1].filter(n=>n>=0&&n<8)})));
    f.wanted.setLevel(1,f.player.position);f.population.police.update(.2,f.population.drivers,true,false);
    assert.ok(f.population.police.officers.length>0,'normal dispatch produced a responder');
    const dispatched=f.population.police.officers[0];
    f.population.police.restoreCasualties([{id:'officer-990',role:'patrol',x:0,y:floor,z:0,yaw:0,health:75,kind:'melee',recoverySeconds:0}],991,f.population.drivers);
    const restored=f.population.police.officers.find(o=>o.id==='officer-990')!;
    for(const [index,officer] of [dispatched,restored,f.population.facility.guards[0]].entries()){
      officer.model.injury=null;officer.model.root.metadata={};officer.dismount(new Vector3(175,floor+.94,index*4));
      for(let i=0;i<600;i++){officer.move(dt,Vector3.Right(),6,false);f.physics._step(dt);if(i>5)assertSupported(officer.controller!);}
      assert.ok(officer.position.x>179&&officer.position.x<179.102);assert.ok(officer.health>0);
      const edge=officer.position.x;for(let i=0;i<120;i++){officer.move(dt,Vector3.Left(),4,false);f.physics._step(dt);}
      assert.ok(officer.position.x<edge-7.5,'inward pursuit remains available');
    }
  }finally{f.dispose();}
});

test('citizen and officer prone capsules remain completely inside the supported edge',()=>{
  const f=fixture();try{
    const state=createBodyInjuries();state.critical=true;state.regions.torso.severity=.85;
    const ped=f.population.spawnPed(new Vector3(178.5,floor,178.5),undefined,true,'crawl-edge');ped.model.root.rotation.y=Math.PI/4;ped.model.bodyInjuries=structuredClone(state);
    const officer=new Officer('crawl-officer','patrol','none',f.scene,f.shadows,0,f.boundary);officer.dismount(new Vector3(-178.5,floor+.94,-178.5));officer.model.root.rotation.y=-3*Math.PI/4;officer.model.bodyInjuries=structuredClone(state);
    try{
      for(let i=0;i<900;i++){
        ped.movement!.move(dt,new Vector3(1,0,1).normalize(),.5,bodyInjuryEffects(ped.model.bodyInjuries));
        officer.move(dt,new Vector3(-1,0,-1).normalize(),.5,false);f.physics._step(dt);
        if(i>5){assertSupported(ped.movement!.controller!);assertSupported(officer.controller!);}
      }
      assert.equal(ped.movement!.controller!.footOffset,.32);assert.equal(officer.controller!.footOffset,.32);
      assert.equal(bodyInjuryEffects(ped.model.bodyInjuries).mode,'crawling');assert.equal(bodyInjuryEffects(officer.model.bodyInjuries).mode,'crawling');
    }finally{officer.dispose();}
  }finally{f.dispose();}
});

test('native controller guard preserves vertical and tangential velocity and repairs outside or below-floor positions without Y=0',()=>{
  const f=fixture();const controller=new PhysicsCharacterController(new Vector3(178.5,-10,0),{capsuleHeight:1.8,capsuleRadius:.3},f.scene);
  try{
    controller.setVelocity(new Vector3(8,3,2));assert.equal(protectNpcController(controller,f.boundary,.1),false);
    assert.equal(controller.getVelocity().y,3);assert.equal(controller.getVelocity().z,2);assert.ok(controller.getVelocity().x>0&&controller.getVelocity().x<1);
    controller.setVelocity(new Vector3(-8,-2,2));assert.equal(protectNpcController(controller,f.boundary,.1),false);assert.deepEqual(controller.getVelocity().asArray(),[-8,-2,2]);
    controller.setPosition(new Vector3(181,-39,0));controller.setVelocity(new Vector3(4,2,3));assert.equal(protectNpcController(controller,f.boundary,dt),true);
    assert.ok(controller.getPosition().x<179.1);assert.equal(controller.getPosition().y,-39);assert.equal(controller.getVelocity().y,2);assert.equal(controller.getVelocity().z,3);
    controller.setPosition(new Vector3(0,-55,0));assert.equal(protectNpcController(controller,f.boundary,dt),true);
    assert.ok(controller.getPosition().y>-40&&controller.getPosition().y<-39);assert.deepEqual(controller.getVelocity().asArray(),[0,0,0]);
  }finally{controller.dispose();f.dispose();}
});
