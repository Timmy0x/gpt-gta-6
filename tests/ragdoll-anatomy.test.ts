import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import HavokPhysics from '@babylonjs/havok';
import { DirectionalLight, LoadAssetContainerAsync, Material, FreeCamera, HavokPlugin, MeshBuilder, NullEngine, PhysicsAggregate, PhysicsConstraintAxis as Axis, Physics6DoFConstraint, PhysicsShapeType, Scene, ShadowGenerator, Vector3, type PhysicsEngineV2 } from '@babylonjs/core';
import { Character } from '../src/gameplay/Character';
import { skinSupportMinimum } from '../src/gameplay/combat/RagdollAnatomy';
import { RagdollReactions } from '../src/gameplay/combat/RagdollReactions';
import { advanceBodyInjuries, applyBodyImpact, bodyInjuryEffects, cloneBodyInjuries } from '../src/gameplay/Injuries';
import { Officer } from '../src/gameplay/police/Officer';
import { prepareCharacterAssets, prepareCivilianAssets } from '../src/gameplay/characters/RocketboxSkin';
import { skinFrameMetrics } from '../scripts/characters/interaction/frame-metrics';
const binary = await readFile(new URL('../node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm', import.meta.url));
const havok = await HavokPhysics({ wasmBinary: binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.byteLength) as ArrayBuffer });
function fixture() {
 const engine = new NullEngine(), scene = new Scene(engine); scene.enablePhysics(new Vector3(0,-9.81,0), new HavokPlugin(true,havok));
 const physics = scene.getPhysicsEngine() as PhysicsEngineV2, shadows = new ShadowGenerator(16, new DirectionalLight('sun',Vector3.Down(),scene));
 scene.activeCamera = new FreeCamera('test',new Vector3(0,3,-5),scene);
 const floor=MeshBuilder.CreateBox('floor',{width:100,height:1,depth:100},scene);floor.position.y=-.5;new PhysicsAggregate(floor,PhysicsShapeType.BOX,{mass:0},scene);
 const reactions = new RagdollReactions(scene);
 const step=(models: Character[], frames:number, read?: (frame:number)=>void) => { for(let frame=0;frame<frames;frame++) {
  for(const model of models) advanceBodyInjuries(model.bodyInjuries,1/60);
  reactions.update(1/60); physics._step(1/60); scene.onBeforeRenderObservable.notifyObservers(scene); scene.onBeforeActiveMeshesEvaluationObservable.notifyObservers(scene); scene.onAfterActiveMeshesEvaluationObservable.notifyObservers(scene); read?.(frame); scene.onAfterRenderObservable.notifyObservers(scene);
 }};
 return {engine,scene,physics,shadows,reactions,step,dispose(){reactions.dispose();scene.dispose();engine.dispose();}};
}
test('native anatomical fall keeps knees one-way at every yaw and supports the extremities', t=>{
 const f=fixture(); t.after(()=>f.dispose());
 for(const yaw of [0,Math.PI/2,Math.PI,-Math.PI/2]) {
  const model=new Character(f.scene,f.shadows,'yaw-'+yaw); model.root.rotation.y=yaw;model.root.position.y=.025;model.animate(1/60,0);
  f.reactions.hit(model,new Vector3(Math.sin(yaw)*25,0,Math.cos(yaw)*25),true);
  const reaction=f.reactions.active.find(r=>r.model===model)!;
  assert.equal(reaction.bones.length,15);assert.equal(reaction.ragdoll.getConstraints().length,14);
  for(const joint of reaction.ragdoll.getConstraints()) {
   assert.ok(joint instanceof Physics6DoFConstraint);assert.ok(!joint.isCollisionsEnabled);
   for(const axis of [Axis.ANGULAR_X,Axis.ANGULAR_Y,Axis.ANGULAR_Z]) assert.notEqual(joint.getAxisMode(axis),null);
  }
  let minimum=Infinity, minimumBone="", maxKnee=-Infinity,minKnee=Infinity,minElbow=Infinity,maxElbow=-Infinity,maxSpeed=0,maxFootError=0,maxPivotError=0;
  const footOffsets=[13,14].map(i=>reaction.bones[i].bone.getAbsolutePosition(model.root).subtract(reaction.ragdoll.getAggregate(i).transformNode.position));
  f.step([model],300,()=>{
   const metric=skinFrameMetrics(model.parts,[]);if(metric.minimumY<minimum){minimum=metric.minimumY;minimumBone=metric.minimumBone??"";}
   for(const side of ['left','right']) {
    const angle=(upper:string,middle:string,end:string)=>{const a=model.skeleton.bones.find(b=>b.name.endsWith('/'+side+upper))!,b=model.skeleton.bones.find(b=>b.name.endsWith('/'+side+middle))!,c=model.skeleton.bones.find(b=>b.name.endsWith('/'+side+end))!;const u=b.getAbsolutePosition(model.root).subtract(a.getAbsolutePosition(model.root)).normalize(),v=c.getAbsolutePosition(model.root).subtract(b.getAbsolutePosition(model.root)).normalize();return Math.atan2(Vector3.Dot(Vector3.Cross(u,v),a.getDirection(Vector3.Right(),model.root)),Vector3.Dot(u,v));};
    const knee=angle('Thigh','Calf','Foot'),elbow=angle('Arm','Forearm','Hand');
    maxKnee=Math.max(maxKnee,knee);minKnee=Math.min(minKnee,knee);minElbow=Math.min(minElbow,elbow);maxElbow=Math.max(maxElbow,elbow);
   }
   for(const joint of reaction.ragdoll.getConstraints()) {const pair=joint.getBodiesUsingConstraint()[0]; const a=pair.parentBody.transformNode,b=pair.childBody.transformNode;maxPivotError=Math.max(maxPivotError,Vector3.Distance(joint.options.pivotA!.applyRotationQuaternion(a.rotationQuaternion!).add(a.position),joint.options.pivotB!.applyRotationQuaternion(b.rotationQuaternion!).add(b.position)));}
   for(const [j,i] of [13,14].entries()) { const n=reaction.ragdoll.getAggregate(i).transformNode; const expected=footOffsets[j].applyRotationQuaternion(n.rotationQuaternion!).add(n.position);maxFootError=Math.max(maxFootError,Vector3.Distance(expected,reaction.bones[i].bone.getAbsolutePosition(model.root))); }
   for(let i=0;i<15;i++) maxSpeed=Math.max(maxSpeed,reaction.ragdoll.getAggregate(i).body.getLinearVelocity().length());
  });
  t.diagnostic(JSON.stringify({yaw,minimum,minimumBone,minKnee,maxKnee,minElbow,maxElbow,maxSpeed,maxFootError,maxPivotError,pelvis:reaction.ragdoll.getAggregate(0).transformNode.position.asArray()}));
  assert.ok(minimum > -.02, 'anatomical surface remains within the 2 cm native contact tolerance');
  assert.ok(minKnee >= -.025 && maxKnee <= 2.46, 'knees remain within their one-way anatomical range with bounded solver tolerance');
  assert.ok(minElbow >= -2.5 && maxElbow <= .025, 'elbows cannot fold backward');
  assert.ok(maxPivotError < .075 && maxFootError < .075, 'native joint projection stays bounded');
  assert.ok(maxSpeed < 5, 'a small hit cannot explode the body into high velocities');
  f.reactions.resetCharacter(model);model.dispose();
 }
});
test('regional partial injuries stay standing; a critical physical fall hands off once without healing trauma',t=>{
 const f=fixture();t.after(()=>f.dispose());const model=new Character(f.scene,f.shadows,'injury');t.after(()=>model.dispose());
 model.bodyInjuries=applyBodyImpact(null,{region:'leftLeg',kind:'projectile',damage:20,health:80});
 f.reactions.hit(model,new Vector3(1,0,0),false,{region:'leftLeg',kind:'projectile',damage:20,health:80});
 assert.equal(f.reactions.active.length,0);assert.equal(bodyInjuryEffects(model.bodyInjuries).mode,'limping');assert.equal(model.injury,null);
 model.bodyInjuries=applyBodyImpact(model.bodyInjuries,{region:'leftLeg',kind:'projectile',damage:40,health:40});
 model.bodyInjuries.fallRemaining=.001;
 let handoffs=0;f.reactions.onHandoff=(actor,anchor)=>{assert.equal(actor,model);assert.ok(anchor.y>=0&&anchor.y<.1);handoffs++;};
 f.reactions.hit(model,new Vector3(0,0,2),false,{region:'leftLeg',kind:'projectile',damage:40,health:40});
 f.step([model],1);assert.equal(handoffs,0,'an expired injury timer cannot truncate an upright physical fall');
 assert.equal(f.reactions.active.length,1); let previous=model.skeleton.bones.map(b=>b.getAbsolutePosition(model.root).clone()), minimum=Infinity, largestStep=0;
 f.step([model],240,()=>{const metric=skinFrameMetrics(model.parts,[]);minimum=Math.min(minimum,metric.minimumY);const current=model.skeleton.bones.map(b=>b.getAbsolutePosition(model.root).clone());for(let i=0;i<current.length;i++)largestStep=Math.max(largestStep,Vector3.Distance(current[i],previous[i]));previous=current;});
 t.diagnostic(JSON.stringify({handoffMinimum:minimum,largestJointStep:largestStep}));
 assert.equal(handoffs,1);assert.equal(model.root.metadata.ragdollActive,false);assert.equal(f.reactions.active.length,0);assert.equal(bodyInjuryEffects(model.bodyInjuries).mode,'crawling');assert.equal(model.bodyInjuries.regions.leftLeg.severity,1);
 f.step([model],30);assert.equal(handoffs,1);
});
test('critical zero-impulse injuries lose balance and complete a supported fall from standing and a walking pose', async t=>{
 const f=fixture();t.after(()=>f.dispose());f.scene.defaultMaterial=new Material('test/no-shader',f.scene);
 const load=async(url:string)=>LoadAssetContainerAsync(new Uint8Array(await readFile(new URL('../public'+new URL(url).pathname,import.meta.url))),f.scene,{pluginExtension:'.glb',pluginOptions:{gltf:{skipMaterials:true}}});
 await prepareCharacterAssets(f.scene,'http://local/characters/rocketbox/',load);await prepareCivilianAssets(f.scene,'http://local/characters/civilians/',load);
 const failures:string[]=[];
 for(const [index,variant] of (['Jason','Lucia','male-adult-03','female-adult-06'] as const).entries())for(const sourcePose of ['standing','walking']){
  const player=variant==='Jason'||variant==='Lucia',model=new Character(f.scene,f.shadows,variant,'#fff',variant==='Lucia'||variant.startsWith('female'),undefined,player?{licensedPlayerSkin:true}:{licensedCivilianSkin:variant});
  model.root.rotation.y=index*Math.PI/2;model.root.position.y=.025;for(let frame=0;frame<30;frame++)model.animate(1/60,sourcePose==='walking'?2.1:0);
  model.bodyInjuries=applyBodyImpact(null,{region:'torso',kind:'fire',damage:58,health:48.74});
  f.reactions.hit(model,Vector3.Zero(),false,{region:'torso',kind:'fire',damage:58,health:48.74});let minimum=Infinity,handoffs=0;
  f.reactions.onHandoff=()=>{handoffs++;};
  f.step([model],360,()=>{minimum=Math.min(minimum,skinFrameMetrics(model.parts.slice(1),[]).minimumY);});
  t.diagnostic(JSON.stringify({variant,sourcePose,zeroImpulseMinimum:minimum,handoffs,active:model.root.metadata.ragdollActive,handoff:model.root.metadata.ragdollHandoffActive,pelvisY:model.jointPosition('pelvis').y,chestY:model.jointPosition('chest').y}));
  if(handoffs!==1||model.root.metadata.ragdollActive||model.root.metadata.ragdollHandoffActive)failures.push(`${variant}/${sourcePose}: zero-impulse collapse never reached supported crawl`);
  if(minimum<-.02)failures.push(`${variant}/${sourcePose}: zero-impulse skin penetrates ${minimum}`);
  f.reactions.resetCharacter(model);model.dispose();
 }
 assert.deepEqual(failures,[]);
});

test('officer belt, torso equipment, patches and helmet follow their bones through a physical fall',t=>{
 const f=fixture();t.after(()=>f.dispose());const officer=new Officer('gear','military','none',f.scene,f.shadows);t.after(()=>officer.dispose());
 const pairs=[['duty-belt','pelvis'],['headwear','head'],['ballistic-vest','chest'],['radio','chest'],['field-pack','chest'],['shoulder-patch','rightArm'],['reserve-armband','leftArm']];
 const positions:Record<string,number[]>={'duty-belt':[0,1.02,0],headwear:[0,1.78,0],'ballistic-vest':[0,1.27,0],radio:[-.17,1.32,.14],'field-pack':[0,1.24,-.2],'shoulder-patch':[.239,1.39,0],'reserve-armband':[-.24,1.36,0]};
 const offsets=pairs.map(([part,bone])=>{const mesh=officer.model.parts.find(m=>m.name==='gear/'+part)!;const joint=officer.model.skeleton.bones.find(b=>b.name==='gear/'+bone)!;assert.equal(mesh.parent,joint);mesh.computeWorldMatrix(true);assert.ok(Vector3.Distance(mesh.absolutePosition,Vector3.FromArray(positions[part]))<.0001);return {mesh,joint,distance:Vector3.Distance(mesh.absolutePosition,joint.getAbsolutePosition(officer.model.root))};});
 f.reactions.hit(officer.model,new Vector3(35,0,20),true);f.step([officer.model],180,()=>{officer.model.skeleton.computeAbsoluteMatrices(true);officer.model.skeleton.prepare(true);for(const {mesh,joint,distance} of offsets){mesh.computeWorldMatrix(true);assert.ok(Math.abs(Vector3.Distance(mesh.absolutePosition,joint.getAbsolutePosition(officer.model.root))-distance)<.001,mesh.name+JSON.stringify({actual:Vector3.Distance(mesh.absolutePosition,joint.getAbsolutePosition(officer.model.root)),distance,world:mesh.absolutePosition.asArray(),joint:joint.getAbsolutePosition(officer.model.root).asArray()}));}});
});

test('licensed skins remain grounded through standing and walking falls and crawl handoff at all four headings', async t => {
 const f=fixture();t.after(()=>f.dispose());f.scene.defaultMaterial=new Material('test/no-shader',f.scene);
 const load=async(url:string)=>LoadAssetContainerAsync(new Uint8Array(await readFile(new URL('../public'+new URL(url).pathname,import.meta.url))),f.scene,{pluginExtension:'.glb',pluginOptions:{gltf:{skipMaterials:true}}});
 await prepareCharacterAssets(f.scene,'http://local/characters/rocketbox/',load);await prepareCivilianAssets(f.scene,'http://local/characters/civilians/',load);
 const failures: string[] = [];
 for(const variant of ['Jason','Lucia','male-adult-03','female-adult-06'] as const) for(const yaw of [0,Math.PI/2,Math.PI,-Math.PI/2]) for(const sourcePose of ['standing','walking']) {
  const player=variant==='Jason'||variant==='Lucia';const model=new Character(f.scene,f.shadows,variant,'#fff',variant==='Lucia'||variant.startsWith('female'),undefined,player?{licensedPlayerSkin:true}:{licensedCivilianSkin:variant});
  model.root.rotation.y=yaw;model.root.position.y=.025;for(let frame=0;frame<30;frame++)model.animate(1/60,sourcePose==='walking'?2.1:0);
  f.scene.onBeforeActiveMeshesEvaluationObservable.notifyObservers(f.scene);
  model.bodyInjuries=applyBodyImpact(null,{region:'leftLeg',kind:'projectile',damage:58,health:45});
  f.reactions.hit(model,new Vector3(Math.sin(yaw)*2,0,Math.cos(yaw)*2),false,{region:'leftLeg',kind:'projectile',damage:58,health:45});
  let minimum=Infinity,minPhysical=Infinity,minHandoff=Infinity,maxJointStep=0,vertexChecks=0,physicalBone="",handoffBone="",maxHandoffPelvis=0,maxHandoffClearance=0,maxStepBone="",maxStepFrame=0,handoffFrame=0,maxRollTrunkGap=0,maxRollTrunkBone="",maxRollTrunkFrame=0,maxRollSupportGap=0,unsupportedFrames=0,maxUnsupportedFrames=0;let previous=model.skeleton.bones.map(b=>b.getAbsolutePosition(model.root).clone());
  f.step([model],300,frame=>{
   const m=skinFrameMetrics(model.parts.slice(1),[]);assert.ok(Math.abs(skinSupportMinimum(model)-m.minimumY)<.00001, "cached skin support agrees with the independently CPU-skinned vertex positions");minimum=Math.min(minimum,m.minimumY);vertexChecks+=m.vertices;
   const trunkMinimum=Math.min(...Object.entries(m.minimumByBone).filter(([name])=>/Bip01_(?:Pelvis|Spine|[LR]_(?:Thigh|Calf))/.test(name)).map(([,height])=>height));
   assert.ok(Math.abs(skinSupportMinimum(model,Vector3.UpReadOnly,'trunk')-trunkMinimum)<.00001,'trunk support mask matches independently skinned pelvis, spine and leg vertices');
   if(model.root.metadata.ragdollActive) {if(m.minimumY<minPhysical) {minPhysical=m.minimumY;physicalBone=m.minimumBone;}} else if(m.minimumY<minHandoff) {minHandoff=m.minimumY;handoffBone=m.minimumBone;}
   if(model.root.metadata.ragdollHandoffActive){maxHandoffPelvis=Math.max(maxHandoffPelvis,model.jointPosition('pelvis').y);maxHandoffClearance=Math.max(maxHandoffClearance,m.minimumY);handoffFrame++;if(handoffFrame>=12){const supportGap=Math.min(...Object.entries(m.minimumByBone).filter(([name])=>/Bip01_(?:Pelvis|Spine|[LR]_(?:Thigh|Calf|Clavicle|UpperArm))/.test(name)).map(([,height])=>height))-model.root.position.y;maxRollSupportGap=Math.max(maxRollSupportGap,supportGap);unsupportedFrames=supportGap>.025?unsupportedFrames+1:0;maxUnsupportedFrames=Math.max(maxUnsupportedFrames,unsupportedFrames);const gap=skinSupportMinimum(model,Vector3.UpReadOnly,'trunk')-model.root.position.y;if(gap>maxRollTrunkGap){maxRollTrunkGap=gap;maxRollTrunkBone=m.minimumBone;maxRollTrunkFrame=frame;}}}
   const joints=model.skeleton.bones.map(b=>b.getAbsolutePosition(model.root).clone());for(let i=0;i<joints.length;i++){const distance=Vector3.Distance(joints[i],previous[i]);if(distance>maxJointStep){maxJointStep=distance;maxStepBone=model.skeleton.bones[i].name;maxStepFrame=frame;}}previous=joints;
  });
  t.diagnostic(JSON.stringify({variant,yaw,sourcePose,minimum,minPhysical,minHandoff,maxJointStep,vertexChecks,physicalBone,handoffBone,maxHandoffPelvis,maxHandoffClearance,maxStepBone,maxStepFrame,maxRollTrunkGap,maxRollTrunkBone,maxRollTrunkFrame,maxRollSupportGap,maxUnsupportedFrames,finalPelvis:model.jointPosition('pelvis').asArray(),finalChest:model.jointPosition('chest').asArray()}));
  // The controller anchor is 15 mm above the road. Review accepts at most
  // 50 mm actual body clearance, with no more than 150 ms above 40 mm during
  // release. This excludes the former sustained hand-only push-up while
  // retaining the small, documented clearance of the authored crawl blend.
  if(maxRollSupportGap>.035||maxUnsupportedFrames>9)failures.push(`${variant}/${yaw}/${sourcePose}: shoulder/trunk/leg surface gap ${maxRollSupportGap} with ${maxUnsupportedFrames} unsupported consecutive frames`);
  if(minPhysical <= -.005) failures.push(`${variant}/${yaw}/${sourcePose}: native skin minimum ${minPhysical} exceeds 5 mm penetration`);
  if(minHandoff < 0) failures.push(`${variant}/${yaw}/${sourcePose}: handoff penetrates ${minHandoff}`);
  if(maxJointStep >= .12) failures.push(`${variant}/${yaw}/${sourcePose}: ${maxStepBone} jumps ${maxJointStep} at frame${maxStepFrame}`);
  if(model.root.metadata.ragdollHandoffActive||model.root.metadata.ragdollActive) failures.push(`${variant}/${yaw}/${sourcePose}: fall and handoff did not complete`);
  f.reactions.resetCharacter(model);model.dispose();
 }
 assert.deepEqual(failures, [], 'every source pose and heading clears the native contact and continuity gates');
});

test('mid-fall restoration, repeated fatal hits, and explicit player reset preserve other casualties and release owned bodies', async t => {
 const f=fixture();t.after(()=>f.dispose());f.scene.defaultMaterial=new Material('test/no-shader',f.scene);
 const load=async(url:string)=>LoadAssetContainerAsync(new Uint8Array(await readFile(new URL('../public'+new URL(url).pathname,import.meta.url))),f.scene,{pluginExtension:'.glb',pluginOptions:{gltf:{skipMaterials:true}}});
 await prepareCharacterAssets(f.scene,'http://local/characters/rocketbox/',load);
 const actor=new Character(f.scene,f.shadows,'player','#fff',false,undefined,{licensedPlayerSkin:true}),other=new Character(f.scene,f.shadows,'other');t.after(()=>{actor.dispose();other.dispose();});
 other.root.position.x=5;f.reactions.hit(other,new Vector3(1,0,0),true);
 actor.bodyInjuries=applyBodyImpact(null,{region:'torso',kind:'projectile',damage:58,health:35});f.reactions.hit(actor,new Vector3(2,0,0),false,{region:'torso',kind:'projectile',damage:58,health:35});f.step([actor],25);
 const savedState=cloneBodyInjuries(actor.bodyInjuries),savedRoot=actor.root.position.clone(),savedRotation=actor.root.rotation.clone(),savedPose=actor.skeleton.bones.map(b=>({position:b.getPosition().clone(),rotation:b.getRotationQuaternion().clone()}));
 f.reactions.resetCharacter(actor);actor.bodyInjuries=savedState;actor.root.position.copyFrom(savedRoot);actor.root.rotation.copyFrom(savedRotation);for(const [i,b] of actor.skeleton.bones.entries()){b.setPosition(savedPose[i].position);b.setRotationQuaternion(savedPose[i].rotation);}actor.root.metadata={ragdollActive:true};
 const before=actor.skeleton.bones.map(b=>b.getAbsolutePosition(actor.root).clone());let handoffs=0;f.reactions.onHandoff=m=>{if(m===actor)handoffs++;};f.reactions.restore(actor);
 for(const [i,b] of actor.skeleton.bones.entries()) assert.ok(Vector3.Distance(before[i],b.getAbsolutePosition(actor.root))<.00001,'restoring a mid-fall pose cannot replace it with a standing frame');
 assert.ok(actor.bodyInjuries!.fallRemaining<1);f.step([actor],240);assert.equal(handoffs,1);assert.equal(bodyInjuryEffects(actor.bodyInjuries).mode,'crawling');assert.equal(actor.bodyInjuries!.regions.torso.severity,savedState!.regions.torso.severity);
 f.reactions.hit(actor,new Vector3(-1,0,2),true,{region:'head',kind:'projectile',damage:50,health:0});f.step([],15);f.reactions.hit(actor,new Vector3(0,0,3),true,{region:'torso',kind:'projectile',damage:30,health:0});
 assert.equal(f.reactions.active.filter(r=>r.model===actor).length,1,'repeat hits reuse the same owned bodies');assert.equal(f.physics.getBodies().filter(b=>b.transformNode.metadata?.ragdollModel===actor).length,15);
 f.reactions.resetCharacter(actor);assert.equal(f.physics.getBodies().filter(b=>b.transformNode.metadata?.ragdollModel===actor).length,0);assert.equal(actor.root.metadata.ragdollActive,false);assert.equal(other.dead,true);assert.ok(other.root.metadata.ragdollActive);
 f.step([],600);assert.equal(handoffs,1);assert.equal(other.dead,true);assert.equal(f.physics.getBodies().filter(b=>b.transformNode.metadata?.ragdoll).length,0,'settled fatal poses retain no dynamic bodies');
});

test('fatal hits during crawl and physical-to-crawl handoff preserve low posture and anatomical limb lengths', async t => {
 const f=fixture();t.after(()=>f.dispose());f.scene.defaultMaterial=new Material('test/no-shader',f.scene);
 const load=async(url:string)=>LoadAssetContainerAsync(new Uint8Array(await readFile(new URL('../public'+new URL(url).pathname,import.meta.url))),f.scene,{pluginExtension:'.glb',pluginOptions:{gltf:{skipMaterials:true}}});
 await prepareCharacterAssets(f.scene,'http://local/characters/rocketbox/',load);await prepareCivilianAssets(f.scene,'http://local/characters/civilians/',load);
 const failures: string[] = [];
 for(const variant of ['Jason','Lucia','male-adult-03','female-adult-06'] as const) for(const startingPose of ['crawl','handoff']) {
  const player=variant==='Jason'||variant==='Lucia';const model=new Character(f.scene,f.shadows,variant,'#fff',variant==='Lucia'||variant.startsWith('female'),undefined,player?{licensedPlayerSkin:true}:{licensedCivilianSkin:variant});
  model.root.position.y=.025;model.bodyInjuries=applyBodyImpact(null,{region:'torso',kind:'projectile',damage:58,health:35});model.bodyInjuries.fallRemaining=0;
  if(startingPose==='handoff'){
   model.bodyInjuries.fallRemaining=1.2;f.reactions.hit(model,new Vector3(0,0,2),false,{region:'torso',kind:'projectile',damage:58,health:35});for(let frame=0;frame<300&&!model.root.metadata.ragdollHandoffActive;frame++)f.step([model],1);assert.equal(model.root.metadata.ragdollHandoffActive,true);f.step([model],21);
  } else {model.animate(0,0);model.applyInjuryPose(bodyInjuryEffects(model.bodyInjuries),0,0);f.scene.onBeforeActiveMeshesEvaluationObservable.notifyObservers(f.scene);}
  const initialSurfaceMaximum=skinFrameMetrics(model.parts.slice(1),[]).maximumY;
  const before=model.skeleton.bones.map(b=>b.getAbsolutePosition(model.root).clone()),lengths=model.skeleton.bones.map(b=>b.getPosition().length());
  f.reactions.hit(model,new Vector3(0,0,1),true,{region:'torso',kind:'projectile',damage:50,health:0});
  for(const [i,b] of model.skeleton.bones.entries())assert.ok(Vector3.Distance(before[i],b.getAbsolutePosition(model.root))<.0001,'fatal transition never resets to standing');
  const reaction=f.reactions.active.find(r=>r.model===model)!;
  const com=()=>reaction.bones.reduce((sum,b,i)=>sum+reaction.ragdoll.getAggregate(i).transformNode.position.y*b.mass,0)/reaction.bones.reduce((sum,b)=>sum+b.mass,0);
  const initialCom=com(),initialPelvis=model.jointPosition('pelvis').y;let maxComRise=0,maxPelvisRise=0;
  let minimum=Infinity,maximum=0,minimumBone="";
  f.step([],180,()=>{maxComRise=Math.max(maxComRise,com()-initialCom);maxPelvisRise=Math.max(maxPelvisRise,model.jointPosition('pelvis').y-initialPelvis);const metric=skinFrameMetrics(model.parts.slice(1),[]);if(metric.minimumY<minimum){minimum=metric.minimumY;minimumBone=metric.minimumBone;}maximum=Math.max(maximum,metric.maximumY);for(const [i,b] of model.skeleton.bones.entries())if(i)assert.ok(Math.abs(b.getPosition().length()-lengths[i])<.00001,'physical synchronization cannot stretch a bone');});
  t.diagnostic(JSON.stringify({variant,startingPose,fatalCrawlMinimum:minimum,fatalCrawlMaximum:maximum,initialSurfaceMaximum,minimumBone,maxComRise,maxPelvisRise}));if(minimum<=-.02)failures.push(`${variant}/${startingPose}: ${minimumBone} penetrates ${minimum}`);if(maximum>Math.max(1.15,initialSurfaceMaximum+.08))failures.push(`${variant}/${startingPose}: surface reaches ${maximum} from ${initialSurfaceMaximum}`);if(maxComRise>=.12||maxPelvisRise>=.20)failures.push(`${variant}/${startingPose}: body launch COM${maxComRise}/pelvis${maxPelvisRise}`);
  f.reactions.resetCharacter(model);model.dispose();
 }
 assert.deepEqual(failures, [], 'every repeated hit retains contact, source height and bounded body motion');
});

test('same-tick handoff callbacks and restored survivors expose the last visible pose to a new hit', t => {
 const f=fixture();t.after(()=>f.dispose());
 const actor=new Character(f.scene,f.shadows,'same-tick'),restored=new Character(f.scene,f.shadows,'restored');t.after(()=>{actor.dispose();restored.dispose();});
 const pose=(model:Character)=>model.skeleton.bones.map(bone=>bone.getAbsolutePosition(model.root).clone());
 const matches=(model:Character,expected:Vector3[])=>pose(model).forEach((point,i)=>assert.ok(Vector3.Distance(point,expected[i])<.00001,'callbacks and snapshots cannot observe an undisplayed target'));
 actor.root.position.y=.025;actor.animate(0,0);actor.bodyInjuries=applyBodyImpact(null,{region:'leftLeg',kind:'projectile',damage:58,health:35});
 f.reactions.hit(actor,new Vector3(0,0,2),false,{region:'leftLeg',kind:'projectile',damage:58,health:35});let previous=pose(actor),handoffs=0;
 f.reactions.onHandoff=model=>{if(model!==actor)return;handoffs++;matches(actor,previous);f.reactions.hit(actor,Vector3.Zero(),true,{region:'torso',kind:'projectile',damage:50,health:0});matches(actor,previous);};
 f.step([actor],240,()=>{previous=pose(actor);});assert.equal(handoffs,1);assert.equal(actor.dead,true);assert.equal(f.reactions.active.filter(reaction=>reaction.model===actor).length,1);
 restored.root.position.set(4,.025,0);restored.bodyInjuries=applyBodyImpact(null,{region:'leftLeg',kind:'projectile',damage:58,health:35});restored.bodyInjuries.fallRemaining=0;restored.animate(0,0);restored.applyInjuryPose(bodyInjuryEffects(restored.bodyInjuries),0,0);
 const before=pose(restored);f.reactions.restore(restored);matches(restored,before);f.reactions.hit(restored,Vector3.Zero(),true,{region:'torso',kind:'projectile',damage:50,health:0});matches(restored,before);assert.equal(restored.root.metadata.ragdollHandoffActive,false);
});
