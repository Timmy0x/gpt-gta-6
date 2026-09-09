import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import HavokPhysics from "@babylonjs/havok";
import { Color3, DirectionalLight, HavokPlugin, MeshBuilder, NullEngine, PhysicsAggregate, PhysicsShapeType, Scene, ShadowGenerator, UniversalCamera, Vector3, type PhysicsEngineV2 } from "@babylonjs/core";
import { Population } from "../src/gameplay/Population";
import { Officer } from "../src/gameplay/police/Officer";
import { validateCasualties } from "../src/gameplay/police/casualties";
import { RagdollReactions } from "../src/gameplay/combat/RagdollReactions";
import { WantedSystem } from "../src/gameplay/Wanted";
import { VehicleSystem } from "../src/vehicles/VehicleSystem";
import type { Player } from "../src/gameplay/Player";
import type { WorldContract } from "../src/core/contracts";

async function setup(){
 const bytes=await readFile(new URL("../node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm",import.meta.url));
 const havok=await HavokPhysics({wasmBinary:bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer});
 const engine=new NullEngine(),scene=new Scene(engine);scene.enablePhysics(new Vector3(0,-9.81,0),new HavokPlugin(true,havok));
 const shadows=new ShadowGenerator(128,new DirectionalLight("sun",new Vector3(0,-1,0),scene));
 const ground=MeshBuilder.CreateBox("ground",{width:1400,depth:1400,height:1},scene);ground.position.y=-.5;new PhysicsAggregate(ground,PhysicsShapeType.BOX,{mass:0,friction:.8},scene);
 const world:WorldContract={spawn:new Vector3(3,1,-28),roads:[],obstacles:[],locations:[],waterLevel:0,update(){},dispose(){}};
 const camera=new UniversalCamera("observer",new Vector3(3,2,-30),scene);camera.setTarget(new Vector3(3,1,-20));
 camera.getViewMatrix(true);camera.getProjectionMatrix(true);
 const player={position:world.spawn.clone(),camera,name:"Jason",aim:false,vehicle:null,deadTimer:0,hurt(){}} as unknown as Player;
 const wanted=new WantedSystem(),vehicles=new VehicleSystem({scene,shadows}),population=new Population(scene,shadows,world,vehicles,player,wanted),reactions=new RagdollReactions(scene),physics=scene.getPhysicsEngine() as PhysicsEngineV2;
 population.onCharacterHit=(model,impulse,fatal)=>reactions.hit(model,impulse,fatal);
 const step=(seconds:number)=>{for(let i=0;i<seconds*60;i++){population.update(1/60);physics._step(1/60);reactions.update(1/60);}};
 const dispose=()=>{reactions.dispose();population.police.removeResponse(population.drivers);population.facility.dispose();population.pedestrians.forEach(p=>p.model.dispose());scene.dispose();engine.dispose();};
 return {scene,shadows,player,wanted,population,reactions,physics,step,dispose};
}

test("ordinary player recovery preserves lethal civilian, guard and officer casualties while nonfatal victims recover",async t=>{
 const f=await setup();try{
  const dead=f.population.pedestrians[0],living=f.population.pedestrians[1];dead.model.position(new Vector3(0,0,0));living.model.position(new Vector3(5,0,0));
  const officer=new Officer("officer-700","patrol","retired",f.scene,f.shadows);officer.dismount(new Vector3(9,1,0));f.population.police.officers.push(officer);
  f.population.hurtPed(dead,200);f.population.hurtPed(living,25);f.population.hurtOfficer(officer,200);f.population.hurtOfficer(f.population.facility.guards[0],200);
  f.step(4);assert.equal(living.health,75);assert.equal(living.model.root.metadata?.ragdollActive,false,"nonfatal hit can get up without restoring health");
  const deadPosition=dead.model.root.position.clone(),officerId=officer.id;
  f.reactions.reset({preserveFatal:true});f.population.reset(false);f.step(12);
  assert.equal(dead.health,0);assert.equal(dead.activity,"dead");assert.equal(dead.model.dead,true);assert.equal(dead.model.root.metadata.ragdollActive,true);
  assert.ok(Vector3.Distance(deadPosition,dead.model.root.position)<.001,"recovery does not relocate a dead civilian to its home");
  assert.equal(living.health,75,"player recovery does not heal an injured survivor");assert.equal(f.population.facility.guards[0].health,0);assert.equal(officer.health,0);assert.ok(f.population.police.officers.some(o=>o.id===officerId));assert.equal(officer.controller,null);
  assert.equal(f.reactions.active.length,0,"settled casualty physics released while dead visuals remain");
  f.reactions.reset();f.population.reset();assert.ok(f.population.pedestrians.every(p=>p.health===100&&!p.model.dead));assert.ok(f.population.facility.guards.every(g=>g.health===140&&!g.model.dead));assert.equal(f.population.police.officers.length,0);
  t.diagnostic("Fatal health/dead gates survive ordinary recovery; explicit encounter reset revives; nonfatal recovery retains75health.");
 }finally{f.dispose();}
});

test("casualty save round trip retains ambient/custom civilian IDs, fixed guards and retired officers without resurrection or extra physics",async()=>{
 const f=await setup();try{
  f.population.onCharacterHit=null;
  const custom=f.population.spawnPed(new Vector3(7,0,4),undefined,true,"custom-victim"),ambient=f.population.pedestrians[2];
  f.population.hurtPed(custom,200);f.population.hurtPed(ambient,200);f.population.hurtOfficer(f.population.facility.guards[2],200);
  const officer=new Officer("officer-950","swat","retired",f.scene,f.shadows);officer.model.position(new Vector3(8,0,4));f.population.police.officers.push(officer);f.population.hurtOfficer(officer,200);
  const saved=JSON.parse(JSON.stringify(f.population.serializeCasualties()));assert.ok(validateCasualties(saved));
  f.population.reset();const baseline=f.physics.getBodies().length;assert.equal(f.population.restoreCasualties(saved),true);
  assert.equal(custom.health,0);assert.equal(ambient.health,0);assert.equal(f.population.facility.guards[2].health,0);assert.equal(f.population.police.officers[0].id,"officer-950");assert.equal(f.population.police.officers[0].health,0);
  f.population.policeEnabled=false;f.step(35);f.player.position.set(-465,1,144);f.step(1);f.player.position.set(3,1,-28);f.step(1);
  assert.equal(f.population.facility.guards[2].health,0,"streaming activation cannot revive the guard");assert.equal(custom.model.dead,true);assert.ok(f.population.police.officers.every(o=>o.health===0));
  assert.ok(f.physics.getBodies().length<=baseline+3,"dead actors do not allocate replacement controllers");
  const repeated=f.population.serializeCasualties();assert.ok(repeated.nextOfficerId>950);assert.equal(repeated.civilians.length,2);assert.equal(repeated.guards.length,1);assert.ok(repeated.police.length<=1);
  assert.equal(f.population.restoreCasualties({...saved,guards:Array(5).fill(saved.guards[0])}),false);
  assert.equal(f.population.restoreCasualties({...saved,civilians:[{...saved.civilians[0],x:Infinity}]}),false);
  assert.equal(f.population.restoreCasualties({...saved,police:[{...saved.police[0],role:"military"}]}),false);
 }finally{f.dispose();}
});

test("dead response crews do not count as living dispatch and disabled-response cleanup remains bounded without resurrecting IDs",async()=>{
 const f=await setup();try{
  f.population.onCharacterHit=null;const baseline=f.physics.getBodies().length;
  f.population.world.roads.push(...[-240,-180,-120,-60,0,60,120,180,240].map((z,i)=>({id:i,x:80,z,next:[i-1,i+1].filter(n=>n>=0&&n<9)})));
  for(let i=0;i<12;i++){const o=new Officer(`officer-${100+i}`,"patrol","retired",f.scene,f.shadows);o.model.position(new Vector3(3+i*.2,0,-27));o.health=0;o.model.dead=true;o.state="injured";f.population.police.officers.push(o);}
  f.population.restoreCasualties(f.population.serializeCasualties());f.wanted.setLevel(1,f.player.position);f.step(.2);
  assert.ok(f.population.police.officers.some(o=>o.health>0),`twelve dead rigs do not suppress living response: ${JSON.stringify({stars:f.wanted.stars,phase:f.wanted.phase,counts:f.population.policeStats,roads:f.population.world.roads.length,drivers:f.population.drivers.length,casualties:f.population.serializeCasualties().police.length})}`);
  const retiredIds=new Set(f.population.police.officers.filter(o=>o.health<=0).map(o=>o.id));
  for(let cycle=0;cycle<40;cycle++){
   for(const o of [...f.population.police.officers])if(o.health>0)f.population.hurtOfficer(o,500);
   f.population.reset(false);f.wanted.setLevel(1,f.player.position);f.step(.1);
   assert.ok(f.population.police.officers.length<=36,"live actors plus visible casualties have a hard combined cap");
  }
  assert.ok(f.population.police.officers.filter(o=>o.health>0).every(o=>!retiredIds.has(o.id)));
  f.population.policeEnabled=false;f.player.position.set(1000,1,1000);f.player.camera.position.set(1000,2,998);f.player.camera.setTarget(new Vector3(1000,1,1010));f.player.camera.getViewMatrix(true);f.player.camera.getProjectionMatrix(true);f.step(30);
  assert.equal(f.population.police.officers.length,0,"old distant offscreen casualties retire even with police disabled");assert.equal(f.physics.getBodies().length,baseline);
 }finally{f.dispose();}
});

test("uniform trousers use the role palette and the firearm follows a live rigged hand through aiming",async()=>{
 const f=await setup();try{
  const officer=new Officer("uniform-fixture","military","none",f.scene,f.shadows);officer.dismount(new Vector3(0,1,0));
  const colors=officer.model.torso.getVerticesData("color")!,expected=Color3.FromHexString("#535e42"),denim=Color3.FromHexString("#485867");
  const count=(color:Color3)=>{let n=0;for(let i=0;i<colors.length;i+=4)if(Math.abs(colors[i]-color.r)<1/255&&Math.abs(colors[i+1]-color.g)<1/255&&Math.abs(colors[i+2]-color.b)<1/255)n++;return n;};
  assert.ok(count(expected)>60);assert.ok(count(expected.scale(.74))>200);assert.equal(count(denim),0);
  for(let i=0;i<90;i++){officer.move(1/60,new Vector3(0,0,1),0,true);f.physics._step(1/60);}officer.model.skeleton.computeAbsoluteMatrices(true);officer.model.torso.computeWorldMatrix(true);officer.weapon.computeWorldMatrix(true);
  assert.ok(officer.weapon.isEnabled());assert.ok(officer.weapon.parent?.name.endsWith("/rightHand"));
  const hand=officer.model.skeleton.bones.find(b=>b.name.endsWith("/rightHand"))!.getAbsolutePosition(officer.model.torso);
  assert.ok(Vector3.Distance(officer.weapon.absolutePosition,hand)<.3,`carbine ${officer.weapon.absolutePosition.asArray()} is beside posed hand ${hand.asArray()}`);
  assert.ok(officer.weapon.getDirection(Vector3.Forward()).normalize().z>.7,"aimed barrel points toward the suspect");const weapon=officer.weapon,flash=officer.flash;officer.dispose();assert.equal(weapon.isDisposed(),true);assert.equal(flash.isDisposed(),true);
 }finally{f.dispose();}
});

test("legacy saved health-zero creative civilians acquire a persistent corpse pose without a casualty field",async()=>{
 const f=await setup();try{
  const ped=f.population.spawnPed(new Vector3(8,0,3),undefined,true,"legacy-dead");ped.health=0;
  f.step(.2);assert.equal(ped.model.dead,true);assert.equal(ped.activity,"dead");assert.equal(ped.model.root.metadata.ragdollActive,true);
  const p=ped.model.root.position.clone();f.population.reset(false);f.step(9);assert.equal(ped.health,0);assert.ok(Vector3.Distance(p,ped.model.root.position)<.001);
 }finally{f.dispose();}
});
