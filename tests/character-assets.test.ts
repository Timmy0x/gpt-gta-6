import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {DirectionalLight, LoadAssetContainerAsync, Material, Matrix, NullEngine, Scene, ShadowGenerator, Vector3, VertexBuffer, type Mesh} from '@babylonjs/core';
import {Character} from '../src/gameplay/Character';
import {applyBodyImpact, bodyInjuryEffects} from '../src/gameplay/Injuries';
import {prepareCharacterAssets} from '../src/gameplay/characters/RocketboxSkin';
async function fixture(){
 const engine=new NullEngine(),scene=new Scene(engine);scene.defaultMaterial=new Material('test/no-shader',scene);
 const shadows=new ShadowGenerator(16,new DirectionalLight('light',Vector3.Down(),scene));
 const requests:string[]=[];
 const loader=async(url:string)=>{requests.push(url);const bytes=await readFile(new URL(`../public/characters/rocketbox/${new URL(url).pathname.split('/').at(-1)}`,import.meta.url));return LoadAssetContainerAsync(new Uint8Array(bytes),scene,{pluginExtension:'.glb',pluginOptions:{gltf:{skipMaterials:true}}});};
 return {scene,shadows,requests,loader,dispose(){shadows.dispose();scene.dispose();engine.dispose();}};
}
function skinPosition(mesh:Mesh,index:number){
 const skeleton=mesh.skeleton!;skeleton.prepare(true);const transforms=skeleton.getTransformMatrices(mesh),weights=mesh.getVerticesData(VertexBuffer.MatricesWeightsKind)!,joints=mesh.getVerticesData(VertexBuffer.MatricesIndicesKind)!,position=Vector3.FromArray(mesh.getVerticesData(VertexBuffer.PositionKind)!,index*3),result=Vector3.Zero();
 for(let i=0;i<4;i++)result.addInPlace(Vector3.TransformCoordinates(position,Matrix.FromArray(transforms,joints[index*4+i]*16)).scale(weights[index*4+i]));
 return Vector3.TransformCoordinates(result,mesh.computeWorldMatrix(true));
}
function skinnedVertices(mesh:Mesh):Vector3[]{
 const skeleton=mesh.skeleton!;skeleton.prepare(true);
 const matrices=skeleton.getTransformMatrices(mesh),world=mesh.computeWorldMatrix(true),positions=mesh.getVerticesData(VertexBuffer.PositionKind)!,weights=mesh.getVerticesData(VertexBuffer.MatricesWeightsKind)!,joints=mesh.getVerticesData(VertexBuffer.MatricesIndicesKind)!;
 const output:Vector3[]=[],transform=Matrix.Identity();
 for(let vertex=0;vertex<mesh.getTotalVertices();vertex++){
  const position=Vector3.FromArray(positions,vertex*3),result=Vector3.Zero();
  for(let influence=0;influence<4;influence++){
   const weight=weights[vertex*4+influence];if(!weight)continue;
   Matrix.FromArrayToRef(matrices,joints[vertex*4+influence]*16,transform);
   result.addInPlace(Vector3.TransformCoordinates(position,transform).scale(weight));
  }
  output.push(Vector3.TransformCoordinates(result,world));
 }
 return output;
}
test('licensed player skins load once, retarget direct bone changes, preserve NPC uniforms and release clones',async()=>{
 const f=await fixture();try{
  const before=f.scene.onBeforeActiveMeshesEvaluationObservable.observers.length;
  await Promise.all([prepareCharacterAssets(f.scene,'http://characters.test/',f.loader),prepareCharacterAssets(f.scene,'http://characters.test/',f.loader)]);
  assert.equal(f.requests.length,2);assert.equal(f.scene.onBeforeActiveMeshesEvaluationObservable.observers.length,before+1);
  const resources=()=>[f.scene.meshes.length,f.scene.geometries.length,f.scene.skeletons.length,f.scene.transformNodes.length,f.scene.materials.length,f.scene.textures.length,f.shadows.getShadowMap()!.renderList!.length];
  let settled:number[]|undefined;
  for(let n=0;n<6;n++){
   const male=new Character(f.scene,f.shadows,'Jason','#ffffff',false,undefined,{licensedPlayerSkin:true}),female=new Character(f.scene,f.shadows,'Lucia','#ffffff',true,undefined,{licensedPlayerSkin:true});
   assert.equal(male.parts.length,4);assert.equal(female.parts.length,4);assert.equal(male.torso.isVisible,false);assert.equal(male.skeleton.bones.length,17);
   assert.ok(male.parts.slice(1).every(m=>m.skeleton?.bones.length===80&&m.isVisible));
   assert.equal(new Set(male.parts.slice(1).map(m=>m.skeleton)).size,1);
   const visual=male.parts[1],beforePosition=skinPosition(visual,0);
   const pelvis=male.skeleton.bones[0];pelvis.setPosition(pelvis.getPosition().add(new Vector3(0,.4,0)));
   // No Character.animate call: this is the direct-bone path used by ragdolls and frozen corpses.
   f.scene.onBeforeActiveMeshesEvaluationObservable.notifyObservers(f.scene);
   const after=skinPosition(visual,0);assert.ok(Math.abs(after.y-beforePosition.y-.4)<.01,'imported skin follows direct driver translation before render');
   male.animate(1/60,0);male.pose('seated',1,'reclined');f.scene.onBeforeActiveMeshesEvaluationObservable.notifyObservers(f.scene);
   for(const mesh of male.parts.slice(1))for(let i=0;i<mesh.getTotalVertices();i+=73){const p=skinPosition(mesh,i);assert.ok([p.x,p.y,p.z].every(Number.isFinite));assert.ok(p.length()<4,'retargeted seating stays in metre scale');}
   male.dispose();female.dispose();
   const now=resources();if(settled)assert.deepEqual(now,settled,'repeated switching does not accumulate nodes, skins, geometry or shadow casters');else settled=now;
  }
  const officer=new Character(f.scene,f.shadows,'reserve-guard-1','#455547');assert.equal(officer.parts.length,1,'casual player assets do not replace police uniforms');officer.dispose();
 }finally{f.dispose();}
});
test('both licensed skins clear existing low and detailed concept car cabin floor and roof bounds',async context=>{
 const f=await fixture();try{
  await prepareCharacterAssets(f.scene,'http://characters.test/',f.loader);
  for(const female of [false,true])for(const profile of ['low','reclined'] as const){
   const character=new Character(f.scene,f.shadows,female?'Lucia':'Jason','#ffffff',female,undefined,{licensedPlayerSkin:true});
   try{
    character.animate(1/60,0);character.pose('seated',1,profile);f.scene.onBeforeActiveMeshesEvaluationObservable.notifyObservers(f.scene);
    const vertices=character.parts.slice(1).flatMap(skinnedVertices),seatY=profile==='low'?-.92:-1.30;
    assert.ok(vertices.every(p=>[p.x,p.y,p.z].every(Number.isFinite)),'all imported vertices remain finite after retargeting');
    const floor=Math.min(...vertices.map(p=>p.y))+seatY,roof=Math.max(...vertices.map(p=>p.y))+seatY;
    assert.ok(floor>=(profile==='low'?-.25:-.49),`${character.root.name} ${profile}: shoes/body penetrate cabin floor at ${floor}`);
    assert.ok(roof<=(profile==='low'?.94:.51),`${character.root.name} ${profile}: head/hair penetrate roof at ${roof}`);
    assert.ok(Math.max(...vertices.map(p=>p.z))<1.10,'shoes remain inside the forward pedal space');
    if(profile==='reclined')assert.ok(vertices.filter(p=>p.y>1.6).every(p=>p.z+.1>=-.44&&p.z+.1<=.20),'reclined head stays beneath the imported roof span');
    context.diagnostic(`${character.root.name} ${profile}: cabin-space floor=${floor.toFixed(4)}m, roof=${roof.toFixed(4)}m; all ${vertices.length} visible vertices evaluated.`);
   }finally{character.dispose();}
  }
 }finally{f.dispose();}
});
test('a failed licensed character load retains fallback and can retry cleanly',async()=>{
 const f=await fixture();try{
  await assert.rejects(prepareCharacterAssets(f.scene,'http://characters.test/',async()=>{throw new Error('offline');}),/offline/);
  const fallback=new Character(f.scene,f.shadows,'Jason','#ffffff',false,undefined,{licensedPlayerSkin:true});assert.equal(fallback.parts.length,1);fallback.dispose();
  await prepareCharacterAssets(f.scene,'http://characters.test/',f.loader);const loaded=new Character(f.scene,f.shadows,'Jason','#ffffff',false,undefined,{licensedPlayerSkin:true});assert.equal(loaded.parts.length,4);loaded.dispose();
 }finally{f.dispose();}
});
test('Rocketbox GLB packages retain licensed provenance and valid three-material skin data',async()=>{
 const manifest=JSON.parse(await readFile(new URL('../public/characters/rocketbox/manifest.json',import.meta.url),'utf8'));
 const license=await readFile(new URL('../data/characters/rocketbox/LICENSE.md',import.meta.url),'utf8');assert.match(license,/MIT License/);assert.match(license,/Copyright \(c\) 2020 Microsoft/);
 for(const asset of manifest.assets){const raw=await readFile(new URL(`../public/characters/rocketbox/${asset.file}`,import.meta.url));assert.equal(createHash('sha256').update(raw).digest('hex'),asset.sha256);assert.equal(raw.readUInt32LE(0),0x46546c67);const json=JSON.parse(raw.subarray(20,20+raw.readUInt32LE(12)).toString());assert.equal(json.materials.length,3);assert.equal(json.skins[0].joints.length,80);assert.equal(json.meshes[0].primitives.length,3);assert.ok(json.images.every((i:{uri:string})=>!i.uri.startsWith('http')));assert.equal(json.asset.extras.license,'MIT');}
});

test('visible player pelvis follows Havok ragdoll synchronization in the same render frame',async()=>{
 const [{default:HavokPhysics},{HavokPlugin,MeshBuilder,PhysicsAggregate,PhysicsShapeType},{RagdollReactions}]=await Promise.all([import('@babylonjs/havok'),import('@babylonjs/core'),import('../src/gameplay/combat/RagdollReactions')]);
 const f=await fixture();const wasm=await readFile(new URL('../node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm',import.meta.url));
 const havok=await HavokPhysics({wasmBinary:wasm.buffer.slice(wasm.byteOffset,wasm.byteOffset+wasm.byteLength) as ArrayBuffer});
 f.scene.enablePhysics(new Vector3(0,-9.81,0),new HavokPlugin(false,havok));
 const ground=MeshBuilder.CreateBox('floor',{width:20,height:1,depth:20},f.scene);ground.position.y=-.5;
 const floor=new PhysicsAggregate(ground,PhysicsShapeType.BOX,{mass:0},f.scene);
 const reactions=new RagdollReactions(f.scene);let character:Character|undefined;
 try{
  await prepareCharacterAssets(f.scene,'http://characters.test/',f.loader);
  character=new Character(f.scene,f.shadows,'Jason','#ffffff',false,undefined,{licensedPlayerSkin:true});character.position(new Vector3(0,1,0));
  reactions.hit(character,new Vector3(65,0,0),true);
  const importedPelvis=character.parts[1].skeleton!.bones.find(b=>b.name.split('/').at(-1)==='Bip01_Pelvis')?.getTransformNode();
  assert.ok(importedPelvis,'the cloned visual skeleton retains its linked pelvis node');
  let movement=0;
  for(let n=0;n<35;n++){
   reactions.update(1/60);(f.scene.getPhysicsEngine() as import('@babylonjs/core').PhysicsEngineV2)._step(1/60);
   f.scene.onBeforeRenderObservable.notifyObservers(f.scene);
   f.scene.onBeforeActiveMeshesEvaluationObservable.notifyObservers(f.scene);
   // The fitted outfit collider has a center offset from the anatomical pelvis.
   // Reconstruct the joint attachment from this native body's current transform,
   // independently of the driver and imported skeleton synchronization.
   const reaction=reactions.active[0],body=reaction.ragdoll.getAggregate(0).transformNode,binding=reaction.bones[0];
   const nativeFrame=Matrix.Compose(Vector3.One(),body.rotationQuaternion!.multiply(binding.initialWorldRotation),body.position);
   const expected=Vector3.TransformCoordinates(binding.offset.negate(),nativeFrame),actual=importedPelvis.computeWorldMatrix(true).getTranslation();
   assert.ok(Vector3.Distance(character.skeleton.bones[0].getAbsolutePosition(character.root),expected)<.001,'driver skeleton follows this physics step');
   assert.ok(Vector3.Distance(expected,actual)<.001,`visible pelvis lagged physics at frame ${n}: expected ${expected.asArray()}, actual ${actual.asArray()}`);movement=Math.max(movement,Math.abs(actual.x));
  }
  assert.ok(movement>.1,'the physical ragdoll actually moved');
  // Fatal bodies eventually release expensive physics, but their visible pose
  // must remain at the settled corpse rather than snapping upright or respawning.
  for(let n=0;n<520;n++){
   reactions.update(1/60);(f.scene.getPhysicsEngine() as import('@babylonjs/core').PhysicsEngineV2)._step(1/60);
   f.scene.onBeforeRenderObservable.notifyObservers(f.scene);f.scene.onBeforeActiveMeshesEvaluationObservable.notifyObservers(f.scene);
  }
  assert.equal(reactions.active.length,0,'fatal ragdoll physics expires after settling');
  assert.equal(character.dead,true);assert.equal(character.root.isDisposed(),false);
  const frozen=importedPelvis.computeWorldMatrix(true).getTranslation().clone();
  assert.ok(frozen.y<.5,'the visible pelvis settled near the floor instead of returning to a standing pose');
  for(let n=0;n<60;n++){reactions.update(1/60);f.scene.onBeforeRenderObservable.notifyObservers(f.scene);f.scene.onBeforeActiveMeshesEvaluationObservable.notifyObservers(f.scene);}
  assert.ok(Vector3.Distance(frozen,importedPelvis.computeWorldMatrix(true).getTranslation())<.001,'frozen corpse keeps its visible pose after physical bodies are released');
 }finally{reactions.dispose();character?.dispose();floor.dispose();f.dispose();}
});


test('critical licensed occupants slump and guard while preserving seated pelvis, legs and cabin clearance', async context => {
 const f=await fixture();try {
  await prepareCharacterAssets(f.scene,'http://characters.test/',f.loader);
  for (const female of [false,true]) for (const profile of ['low','reclined'] as const) {
   const character=new Character(f.scene,f.shadows,female?'Lucia':'Jason','#fff',female,undefined,{licensedPlayerSkin:true});
   try {
    character.animate(1/60,0); character.pose('seated',1,profile);
    const legs=character.skeleton.bones.filter(b=>/pelvis|Thigh|Calf|Foot/.test(b.name));
    const before=legs.map(b=>[...b.getLocalMatrix().m]);
    const head=character.jointPosition('head').clone();
    character.bodyInjuries=applyBodyImpact(null,{region:'torso',kind:'projectile',damage:55,health:18});
    character.applySeatedInjuryPose(bodyInjuryEffects(character.bodyInjuries));
    assert.deepEqual(legs.map(b=>[...b.getLocalMatrix().m]),before,'critical injury must not crawl inside a vehicle');
    assert.ok(character.jointPosition('head').y<head.y-.025,'critical occupant visibly slumps');
    f.scene.onBeforeActiveMeshesEvaluationObservable.notifyObservers(f.scene);
    const vertices=character.parts.slice(1).flatMap(skinnedVertices), seatY=profile==='low'?-.92:-1.30;
    const floor=Math.min(...vertices.map(v=>v.y))+seatY,roof=Math.max(...vertices.map(v=>v.y))+seatY;
    assert.ok(floor>=(profile==='low'?-.25:-.49),'slump keeps all shoes and body above cabin floor');
    assert.ok(roof<=(profile==='low'?.94:.51),'slump keeps head beneath cabin roof');
    assert.ok(Math.max(...vertices.map(v=>v.z))<1.10,'guarding arms stay inside cabin length');
    context.diagnostic(`${character.root.name} ${profile}: critical slump floor ${floor.toFixed(4)} m / roof ${roof.toFixed(4)} m.`);
   } finally { character.dispose(); }
  }
 } finally { f.dispose(); }
});
