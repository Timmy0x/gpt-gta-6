import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DirectionalLight,LoadAssetContainerAsync,Material,NullEngine,Scene,ShadowGenerator,UniversalCamera,Vector3} from '@babylonjs/core';
import {Character} from '../src/gameplay/Character';
import {Population} from '../src/gameplay/Population';
import {CIVILIAN_DETAIL_LIMIT,prepareCharacterAssets,prepareCivilianAssets,type CivilianSkin} from '../src/gameplay/characters/RocketboxSkin';

const playerBase='https://characters.test/rocketbox/',civilianBase='https://characters.test/civilians/';
function fixture(){
 const engine=new NullEngine(),scene=new Scene(engine);scene.defaultMaterial=new Material('cpu/no-shaders',scene);
 const shadows=new ShadowGenerator(16,new DirectionalLight('sun',Vector3.Down(),scene));
 const camera=new UniversalCamera('observer',new Vector3(0,1.5,0),scene);camera.setTarget(new Vector3(0,1.5,10));camera.getViewMatrix(true);
 const requests:string[]=[];
 const loader=async(url:string)=>{requests.push(url);const path=new URL(url).pathname;const bytes=await readFile(new URL(`../public/characters${path}`,import.meta.url));return LoadAssetContainerAsync(new Uint8Array(bytes),scene,{pluginExtension:'.glb',pluginOptions:{gltf:{skipMaterials:true}}});};
 const render=()=>{camera.getViewMatrix(true);scene.onBeforeRenderObservable.notifyObservers(scene);scene.onBeforeActiveMeshesEvaluationObservable.notifyObservers(scene);};
 const create=(variant:CivilianSkin,name:string=variant)=>new Character(scene,shadows,name,'#ffffff',variant==='female-adult-06',undefined,{licensedCivilianSkin:variant});
 const counts=()=>({meshes:scene.meshes.length,geometries:scene.geometries.length,skeletons:scene.skeletons.length,transforms:scene.transformNodes.length,shadowCasters:shadows.getShadowMap()!.renderList!.length});
 return {engine,scene,shadows,camera,requests,loader,render,create,counts,dispose(){shadows.dispose();scene.dispose();engine.dispose();}};
}
const detailed=(character:Character)=>character.parts.length===4&&character.parts.slice(1).every(mesh=>mesh.isVisible&&mesh.isEnabled());
function pelvis(character:Character){return character.parts[1].skeleton!.bones.find(bone=>bone.name.split('/').at(-1)==='Bip01_Pelvis')!.getTransformNode()!;}

test('civilian and player libraries load independently once and keep shared geometry with private rigs',async()=>{
 const f=fixture();try{
  const observers=f.scene.onBeforeActiveMeshesEvaluationObservable.observers.length;
  await Promise.all([prepareCharacterAssets(f.scene,playerBase,f.loader),prepareCivilianAssets(f.scene,civilianBase,f.loader),prepareCivilianAssets(f.scene,civilianBase,f.loader)]);
  assert.equal(f.requests.length,4);assert.equal(f.scene.onBeforeActiveMeshesEvaluationObservable.observers.length,observers+1);
  const baseline=f.counts();let settled:ReturnType<typeof f.counts>|undefined;
  for(let cycle=0;cycle<8;cycle++){
   const male=f.create('male-adult-03',`male-${cycle}`),twin=f.create('male-adult-03',`twin-${cycle}`),female=f.create('female-adult-06',`female-${cycle}`);
   const player=new Character(f.scene,f.shadows,'Jason','#fff',false,undefined,{licensedPlayerSkin:true});
   f.render();assert.equal(male.parts[1].getTotalVertices(),4427);assert.equal(female.parts[1].getTotalVertices(),4372);assert.equal(player.parts[1].getTotalVertices(),4688,'player remains the original Male Adult 01');
   assert.equal(male.parts[1].geometry,twin.parts[1].geometry);assert.notEqual(male.parts[1].skeleton,twin.parts[1].skeleton);assert.notEqual(pelvis(male),pelvis(twin));
   const before=pelvis(twin).computeWorldMatrix(true).getTranslation().clone();
   male.skeleton.bones[0].setPosition(male.skeleton.bones[0].getPosition().add(new Vector3(0,.3,0)));f.render();
   assert.ok(Vector3.Distance(before,pelvis(twin).computeWorldMatrix(true).getTranslation())<.001,'one civilian pose does not mutate a sibling rig');
   for(const character of [male,twin,female,player])character.dispose();
   const after=f.counts();
   // Babylon first registers each shared template geometry when its first clone
   // enters the scene; that fixed cache remains resident until scene disposal.
   assert.deepEqual({...after,geometries:baseline.geometries},baseline);
   if(settled)assert.deepEqual(after,settled);else settled=after;
  }
 }finally{f.dispose();}
});

test('partial civilian loading failure retains working players and retries without accumulating assets',async()=>{
 const f=fixture();try{
  await prepareCharacterAssets(f.scene,playerBase,f.loader);const baseline=f.counts();
  await assert.rejects(prepareCivilianAssets(f.scene,civilianBase,async url=>{if(url.endsWith('female-adult-06.glb'))throw new Error('offline civilian');return f.loader(url);}),/offline civilian/);
  assert.deepEqual(f.counts(),baseline,'partial civilian templates are released');
  const player=new Character(f.scene,f.shadows,'Jason','#fff',false,undefined,{licensedPlayerSkin:true}),fallback=f.create('male-adult-03');
  assert.equal(player.parts.length,4);assert.equal(fallback.parts.length,1);player.dispose();fallback.dispose();
  await prepareCivilianAssets(f.scene,civilianBase,f.loader);const retried=f.create('female-adult-06');assert.equal(retried.parts.length,4);retried.dispose();
 }finally{f.dispose();}
});

test('population civilian appearance is stable by ID and does not change police or player selection',async()=>{
 const f=fixture();const characters:Character[]=[];try{
  await prepareCivilianAssets(f.scene,civilianBase,f.loader);
  // Exercise the real spawn method without unrelated dispatch/vehicle fixtures.
  const population=Object.create(Population.prototype) as Population;
  Object.assign(population,{scene:f.scene,shadows:f.shadows,pedestrians:[],nextPedId:0});
  const first=population.spawnPed(Vector3.Zero(),0,false),second=population.spawnPed(new Vector3(2,0,0),1,false);characters.push(first.model,second.model);
  assert.equal(first.model.parts[1].getTotalVertices(),4372);assert.equal(second.model.parts[1].getTotalVertices(),4427);
  const stable=population.spawnPed(new Vector3(4,0,0),20,true,'custom-civilian');characters.push(stable.model);const vertices=stable.model.parts[1].getTotalVertices();
  stable.model.dispose();population.pedestrians=population.pedestrians.filter(ped=>ped!==stable);
  const restored=population.spawnPed(new Vector3(4,0,0),99,true,'custom-civilian');characters.push(restored.model);assert.equal(restored.model.parts[1].getTotalVertices(),vertices);
  const officer=new Character(f.scene,f.shadows,'officer','#455547');characters.push(officer);assert.equal(officer.parts.length,1,'uniforms require an explicit separate option');
  const player=new Character(f.scene,f.shadows,'Jason','#fff',false,undefined,{licensedPlayerSkin:true});characters.push(player);assert.equal(player.parts.length,1,'civilian templates cannot impersonate a failed/unloaded player library');
 }finally{characters.forEach(character=>character.dispose());f.dispose();}
});

test('nearby detailed civilian budget prioritizes settled casualties and changes only visibility',async()=>{
 const f=fixture();const characters:Character[]=[];try{
  await prepareCivilianAssets(f.scene,civilianBase,f.loader);
  for(let i=0;i<60;i++){const character=f.create(i%2?'male-adult-03':'female-adult-06',`crowd-${i}`);character.position(new Vector3(i*.25,0,6+i*.3));characters.push(character);}
  f.render();assert.equal(characters.filter(detailed).length,CIVILIAN_DETAIL_LIMIT);
  const casualty=characters.at(-1)!;casualty.dead=true;casualty.root.metadata={ragdollActive:true};casualty.skeleton.bones[0].setPosition(new Vector3(0,.25,0));
  const originalParts=[...casualty.parts],originalRig=casualty.parts[1].skeleton;f.render();assert.ok(detailed(casualty),'nearby corpse keeps detailed appearance as live pedestrians compete for slots');
  assert.equal(characters.filter(detailed).length,CIVILIAN_DETAIL_LIMIT);
  const corpsePosition=pelvis(casualty).computeWorldMatrix(true).getTranslation().clone(),baseline=f.counts();
  f.camera.position.set(500,1.5,500);f.render();assert.equal(characters.filter(detailed).length,0);assert.ok(characters.every(character=>character.torso.isVisible));
  f.camera.position.set(0,1.5,0);f.render();assert.ok(detailed(casualty));assert.equal(casualty.parts[1].skeleton,originalRig);assert.deepEqual(casualty.parts,originalParts);assert.deepEqual(f.counts(),baseline);
  assert.ok(Vector3.Distance(corpsePosition,pelvis(casualty).computeWorldMatrix(true).getTranslation())<.001,'near/far transitions cannot repose or respawn a casualty');
 }finally{characters.forEach(character=>character.dispose());f.dispose();}
});

test('civilian distance hysteresis avoids repeated visible mesh replacement at the detail threshold',async()=>{
 const f=fixture();let character:Character|undefined;try{
  await prepareCivilianAssets(f.scene,civilianBase,f.loader);character=f.create('male-adult-03');character.position(new Vector3(0,0,75));f.render();assert.equal(detailed(character),false,'first visibility uses the entry distance');
  character.position(new Vector3(0,0,69));f.render();assert.ok(detailed(character));
  const rig=character.parts[1].skeleton,parts=[...character.parts];character.position(new Vector3(0,0,75));f.render();assert.ok(detailed(character));
  character.position(new Vector3(0,0,81));f.render();assert.equal(detailed(character),false);
  character.position(new Vector3(0,0,75));f.render();assert.equal(detailed(character),false);
  character.position(new Vector3(0,0,69));f.render();assert.ok(detailed(character));assert.equal(character.parts[1].skeleton,rig);assert.deepEqual(character.parts,parts);
 }finally{character?.dispose();f.dispose();}
});

test('both civilian rigs follow the same-frame Havok pelvis and retain fatal poses after distant culling',async()=>{
 const [{default:HavokPhysics},{HavokPlugin,MeshBuilder,PhysicsAggregate,PhysicsShapeType},{RagdollReactions}]=await Promise.all([import('@babylonjs/havok'),import('@babylonjs/core'),import('../src/gameplay/combat/RagdollReactions')]);
 const f=fixture(),wasm=await readFile(new URL('../node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm',import.meta.url));
 const havok=await HavokPhysics({wasmBinary:wasm.buffer.slice(wasm.byteOffset,wasm.byteOffset+wasm.byteLength) as ArrayBuffer});f.scene.enablePhysics(new Vector3(0,-9.81,0),new HavokPlugin(false,havok));
 const ground=MeshBuilder.CreateBox('floor',{width:30,height:1,depth:30},f.scene);ground.position.y=-.5;const floor=new PhysicsAggregate(ground,PhysicsShapeType.BOX,{mass:0},f.scene);
 const reactions=new RagdollReactions(f.scene),characters:Character[]=[];
 try{
  await prepareCivilianAssets(f.scene,civilianBase,f.loader);
  for(const [index,variant] of (['male-adult-03','female-adult-06'] as const).entries()){const character=f.create(variant);character.position(new Vector3(index*4,1,4));characters.push(character);reactions.hit(character,new Vector3(60,0,0),true);}
  for(let frame=0;frame<550;frame++){
   reactions.update(1/60);(f.scene.getPhysicsEngine() as import('@babylonjs/core').PhysicsEngineV2)._step(1/60);f.render();
   if(frame<35)for(const reaction of reactions.active){const expected=reaction.ragdoll.getAggregate(0).transformNode.position;assert.ok(Vector3.Distance(expected,pelvis(reaction.model).computeWorldMatrix(true).getTranslation())<.001);}
  }
  assert.equal(reactions.active.length,0);const frozen=characters.map(character=>pelvis(character).computeWorldMatrix(true).getTranslation().clone());assert.ok(frozen.every(point=>point.y<.5));
  f.camera.position.set(300,1.5,300);f.render();assert.ok(characters.every(character=>!detailed(character)&&character.dead));
  f.camera.position.set(0,1.5,0);f.render();characters.forEach((character,index)=>{assert.ok(detailed(character));assert.ok(Vector3.Distance(frozen[index],pelvis(character).computeWorldMatrix(true).getTranslation())<.001);});
 }finally{reactions.dispose();characters.forEach(character=>character.dispose());floor.dispose();f.dispose();}
});
