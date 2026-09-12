import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import HavokPhysics from "@babylonjs/havok";
import { Color3, DirectionalLight, HavokPlugin, MeshBuilder, NullEngine, PhysicsAggregate, PhysicsShapeType, Scene, ShadowGenerator, UniversalCamera, Vector3, type PhysicsEngineV2 } from "@babylonjs/core";
import { Population } from "../src/gameplay/Population";
import { Officer } from "../src/gameplay/police/Officer";
import { bodyInjuryEffects } from "../src/gameplay/Injuries";
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
 population.onCharacterHit=(model,impulse,fatal,impact)=>reactions.hit(model,impulse,fatal,impact);
 population.onCharacterRestored=model=>reactions.restore(model);
 const step=(seconds:number)=>{for(let i=0;i<seconds*60;i++){population.update(1/60);physics._step(1/60);reactions.update(1/60);scene.onBeforeRenderObservable.notifyObservers(scene);}};
 const dispose=()=>{reactions.dispose();population.police.removeResponse(population.drivers);population.facility.dispose();population.pedestrians.forEach(p=>p.model.dispose());scene.dispose();engine.dispose();};
 return {scene,shadows,player,wanted,population,reactions,physics,vehicles,step,dispose};
}

test("ordinary player recovery preserves lethal civilian, guard and officer casualties while nonfatal victims recover",async t=>{
 const f=await setup();try{
  const dead=f.population.pedestrians[0],living=f.population.pedestrians[1];dead.model.position(new Vector3(0,0,0));living.model.position(new Vector3(5,0,0));
  const officer=new Officer("officer-700","patrol","retired",f.scene,f.shadows);officer.dismount(new Vector3(9,1,0));f.population.police.officers.push(officer);
  f.population.hurtPed(dead,200);f.population.hurtPed(living,25);f.population.hurtOfficer(officer,200);f.population.hurtOfficer(f.population.facility.guards[0],200);
  f.step(4);assert.equal(living.health,75);assert.equal(bodyInjuryEffects(living.model.bodyInjuries).mode,"hunched");assert.equal(!!living.model.root.metadata?.ragdollActive,false,"minor damage keeps the survivor standing");
  f.step(9);assert.equal(bodyInjuryEffects(living.model.bodyInjuries).mode,"hunched","partial impairment remains after thirteen seconds");
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
  assert.equal(custom.movement?.controller,null);assert.equal(ambient.movement?.controller,null);assert.equal(f.physics.getBodies().length,baseline+f.population.pedestrians.filter(p=>p.movement?.controller).length,"only living nearby civilian controllers are added");
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

test('a wounded police driver remains supported in the cabin and an able passenger does not operate the car', async () => {
 const f=await setup();try {
  const vehicle=f.vehicles.spawn('police',new Vector3(5,1,-22));
  const driver={v:vehicle,target:0,previous:0,police:true,stuck:0,assignment:'patrol' as const};f.population.drivers.push(driver);
  for(const seat of [0,1])f.population.police.officers.push(new Officer(`officer-${920+seat}`,'patrol',vehicle.id,f.scene,f.shadows,seat));
  f.wanted.setLevel(1,f.player.position);f.step(.02);
  const operator=f.population.police.officers.find(o=>o.id==='officer-920')!;
  // This fixture deliberately stays seated so the damage path cannot create
  // free rigid bodies overlapping the closed police-car chassis.
  operator.controller?.dispose();operator.controller=null;operator.state='riding';
  f.population.hurtOfficer(operator,55,'projectile',{region:'leftLeg'});
  assert.equal(operator.state,'riding');assert.equal(!!operator.model.root.metadata?.ragdollActive,false);
  assert.equal(bodyInjuryEffects(operator.model.bodyInjuries).canStand,false);
  vehicle.input.throttle=1;f.step(.2);
  assert.equal(vehicle.input.throttle,0);assert.equal(vehicle.input.brake,1);assert.equal(operator.state,'riding');
  const old=operator.model.root.position.clone();vehicle.body.setLinearVelocity(new Vector3(0,0,4));f.step(.2);
  assert.ok(Vector3.Distance(old,operator.model.root.position)>.05,'seated injured crew follows vehicle motion');
  f.population.hurtOfficer(operator,200,'projectile',{region:'torso'});f.step(.2);
  assert.equal(operator.health,0);assert.equal(operator.state,'riding');assert.equal(operator.controller,null);
  assert.equal(!!operator.model.root.metadata?.ragdollActive,false);assert.equal(vehicle.input.throttle,0);
 }finally{f.dispose();}
});


test('injured police seats survive vehicle replacement, response reset and casualty load', async () => {
 const f=await setup();try {
  let car=f.vehicles.spawn('police',new Vector3(5,1,-22));
  f.population.drivers.push({v:car,target:-1,previous:-1,police:true,stuck:0,assignment:'patrol'});
  for(const seat of [0,1]){
   const officer=new Officer(`officer-${970+seat}`,'patrol',car.id,f.scene,f.shadows,seat);
   f.population.police.officers.push(officer);
   f.population.hurtOfficer(officer,seat?200:55,'projectile',{region:seat?'torso':'leftLeg'});
  }
  f.step(.1);
  const saved=f.population.serializeCasualties();
  assert.ok(validateCasualties(saved));
  assert.deepEqual(saved.police.map(o=>[o.vehicleId,o.seat]),[[car.id,0],[car.id,1]]);
  assert.equal(validateCasualties({...saved,police:[{...saved.police[0],seat:2}]}),false);
  const carSave=f.vehicles.serialize(car);
  f.reactions.reset();f.population.reset();
  car=f.vehicles.restore(carSave);
  for(let cycle=0;cycle<3;cycle++){
   assert.ok(f.population.restoreCasualties(saved));f.step(.2);
   assert.equal(f.population.police.officers.length,2);
   assert.equal(f.population.drivers.filter(d=>d.v===car).length,1);
   assert.equal(car.input.throttle,0);
   for(const officer of f.population.police.officers){
    assert.equal(officer.state,'riding');assert.equal(officer.vehicleId,car.id);
    assert.equal(officer.controller,null);assert.equal(!!officer.model.root.metadata?.ragdollActive,false);
    assert.equal(officer.health,officer.seat?0:64.25);
   }
   f.population.reset(false);f.step(.2);
   assert.ok(f.vehicles.list.includes(car),'ordinary player recovery retains the injured crew cabin');
  }
  f.population.policeEnabled=false;
  car.body.setLinearVelocity(new Vector3(0,0,3));
  const previous=f.population.police.officers[0].model.root.position.clone();f.step(.2);
  assert.ok(Vector3.Distance(previous,f.population.police.officers[0].model.root.position)>.02,'retained casualties follow a pushed car even with police disabled');
 }finally{f.dispose();}
});


test("partial and critical regional wounds survive version-three saves without duplicating officers",async()=>{
 const f=await setup();try{
  const partial=f.population.pedestrians[0],critical=f.population.pedestrians[1];
  partial.model.position(new Vector3(3,0,-23));critical.model.position(new Vector3(7,0,-23));
  f.population.hurtPed(partial,20,"projectile",{region:"leftLeg"});
  f.population.hurtPed(critical,55,"projectile",{region:"rightLeg"});f.step(12);
  assert.equal(partial.health,87);assert.equal(bodyInjuryEffects(partial.model.bodyInjuries).mode,"limping");
  assert.equal(critical.health,64.25);assert.equal(bodyInjuryEffects(critical.model.bodyInjuries).mode,"crawling");
  const officer=new Officer("officer-851","patrol","retired",f.scene,f.shadows);officer.dismount(new Vector3(10,1,-23));f.population.police.officers.push(officer);
  f.population.hurtOfficer(officer,20,"projectile",{region:"rightArm"});
  const saved=JSON.parse(JSON.stringify(f.population.serializeCasualties()));assert.equal(saved.version,3);assert.ok(validateCasualties(saved));
  const entry=saved.civilians.find((p:{id:string})=>p.id===critical.id)!;assert.equal(entry.fallen,true);assert.ok(entry.pose!.length>=17);
  f.reactions.reset({preserveFatal:true});f.population.reset(false);f.step(20);
  assert.equal(bodyInjuryEffects(critical.model.bodyInjuries).mode,"crawling");assert.equal(critical.health,64.25);
  f.reactions.reset();f.population.reset();
  for(let cycle=0;cycle<4;cycle++){
   assert.equal(f.population.restoreCasualties(saved),true);f.step(.6);
   assert.equal(f.population.police.officers.filter(o=>o.id===officer.id).length,1);
   assert.equal(bodyInjuryEffects(partial.model.bodyInjuries).limpSide,-1);assert.equal(partial.model.bodyInjuries!.regions.rightLeg.severity,0);
   assert.equal(bodyInjuryEffects(critical.model.bodyInjuries).mode,"crawling");
  }
  for(const invalid of [{...entry,bodyInjuries:{...entry.bodyInjuries,fallRemaining:Infinity}},{...entry,pose:[{name:"head",position:[0,0,0],rotation:[0,0,0,5]}]}])assert.equal(validateCasualties({...saved,civilians:[invalid]}),false);
 }finally{f.dispose();}
});

test("legacy version-one fatalities and version-two timed or incapacitating injuries retain their saved meanings",async()=>{
 const f=await setup();try{
  const [dead,timed,serious]=f.population.pedestrians;
  const base={guards:[],police:[],nextOfficerId:1};
  const oldFatal={version:1,...base,civilians:[{id:dead.id,x:3,y:.25,z:-23,yaw:0}]};
  assert.ok(validateCasualties(oldFatal));assert.ok(f.population.restoreCasualties(oldFatal));f.step(10);assert.equal(dead.health,0);assert.equal(dead.model.dead,true);
  const oldInjuries={version:2,...base,civilians:[{id:timed.id,x:6,y:.25,z:-23,yaw:0,health:80,recoverySeconds:6,kind:"melee"},{id:serious.id,x:9,y:.25,z:-23,yaw:0,health:68,recoverySeconds:null,kind:"projectile"}]};
  assert.ok(validateCasualties(oldInjuries));assert.ok(f.population.restoreCasualties(oldInjuries));f.step(4);
  assert.equal(timed.model.root.metadata.ragdollActive,true);assert.equal(serious.model.root.metadata.ragdollActive,true);
  f.step(7);assert.equal(timed.model.root.metadata.ragdollActive,false);assert.equal(timed.health,80);
  assert.equal(serious.model.injury?.remaining,null);assert.equal(serious.health,68);assert.equal(serious.model.root.metadata.ragdollActive,true);
 }finally{f.dispose();}
});

test("concurrent critical survivors obey the physical-body budget and remain injured across ordinary recovery",async()=>{
 const f=await setup();try{
  const baseline=f.physics.getBodies().length,victims=f.population.pedestrians.slice(0,12);
  for(const [i,ped]of victims.entries()){
   ped.model.position(new Vector3(3+i*3,0,-23));f.population.hurtPed(ped,55,"projectile",{region:i%2?"rightLeg":"leftLeg"});
  }
  assert.ok(f.reactions.active.length<=8);assert.ok(f.physics.getBodies().length<=baseline+8*15);
  f.step(20);assert.ok(victims.every(p=>p.health===64.25&&bodyInjuryEffects(p.model.bodyInjuries).mode==="crawling"));
  assert.equal(f.reactions.active.length,0);
  f.reactions.reset({preserveFatal:true});f.population.reset(false);f.step(12);
  assert.ok(victims.every(p=>!p.model.dead&&bodyInjuryEffects(p.model.bodyInjuries).mode==="crawling"));
  assert.equal(f.physics.getBodies().filter(body=>body.transformNode.metadata?.ragdoll).length,0);
 }finally{f.dispose();}
});

test("production Combat shots damage a settled surviving target and can make the injury fatal",async()=>{
 const [{Combat},{DamageSystem},{Character}]=await Promise.all([import("../src/gameplay/Combat"),import("../src/gameplay/Damage"),import("../src/gameplay/Character")]);
 const f=await setup(),model=new Character(f.scene,f.shadows,"injury-shooter"),damage=new DamageSystem(f.scene,f.shadows,{spawn:f.player.position,roads:[],obstacles:[],locations:[],waterLevel:0,update(){},dispose(){}},false);
 model.position(new Vector3(3,.05,-28));Object.assign(f.player,{model,input:{mouseDown:false},transitioning:false,pitch:0,controller:{getVelocity:()=>Vector3.Zero()}});
 const combat=new Combat(f.scene,f.player,f.population,damage,f.vehicles,f.wanted);
 const advance=(seconds:number)=>{for(let i=0;i<seconds*60;i++){f.population.update(1/60);f.physics._step(1/60);combat.update(1/60,false);f.scene.onBeforeRenderObservable.notifyObservers(f.scene);}};
 try{
  const ped=f.population.pedestrians[0];ped.model.position(new Vector3(3,0,-22));
  const aim=()=>{ped.model.skeleton.computeAbsoluteMatrices(true);ped.model.torso.computeWorldMatrix(true);const target=ped.model.skeleton.bones.find(b=>b.name.endsWith("/chest"))!.getAbsolutePosition(ped.model.torso);f.player.camera.setTarget(target);f.player.camera.getViewMatrix(true);};
  combat.select(0);combat.handling.update(1);
  aim();combat.fire();assert.equal(ped.health,68,"normal weapon damage reaches the production civilian hit handler");advance(9);
  assert.equal(combat.reactions.active.length,0);assert.equal(bodyInjuryEffects(ped.model.bodyInjuries).mode,"hunched");
  for(let shot=0;shot<3;shot++){aim();combat.fire();advance(1);}
  assert.equal(ped.health,0,"visible skinned mesh remains hittable after physical ragdoll disposal");advance(10);
  assert.equal(ped.model.dead,true);assert.equal(ped.model.root.metadata.injuryStatus,"dead");
 }finally{combat.dispose();damage.dispose();model.dispose();f.dispose();}
});


test("an incapacitated response crew does not permanently reserve an offscreen patrol assignment",async()=>{
 const f=await setup();try{
  const car=f.vehicles.spawn("police",new Vector3(-200,1,0));
  f.population.drivers.push({v:car,target:0,previous:0,police:true,stuck:0,assignment:"patrol"});
  const officer=new Officer("officer-860","patrol",car.id,f.scene,f.shadows);officer.dismount(new Vector3(-197,1,0));f.population.police.officers.push(officer);
  f.population.hurtOfficer(officer,55,"projectile",{region:"leftLeg"});f.step(13);
  assert.equal(officer.health,64.25);assert.equal(bodyInjuryEffects(officer.model.bodyInjuries).mode,"crawling");
  assert.ok(f.population.police.officers.includes(officer),"injured person remains while the orphaned response vehicle retires");
  assert.ok(!f.population.drivers.some(d=>d.v.id===car.id));assert.ok(!f.vehicles.list.includes(car));
 }finally{f.dispose();}
});
