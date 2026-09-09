import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {DirectionalLight,LoadAssetContainerAsync,Material,Matrix,NullEngine,Scene,ShadowGenerator,Vector3,VertexBuffer} from '@babylonjs/core';
import {Character} from '../../../src/gameplay/Character.ts';
import {prepareCharacterAssets} from '../../../src/gameplay/characters/RocketboxSkin.ts';
import {variants} from './config.mjs';

const root=resolve(import.meta.dirname,'../../..'),assetRoot=resolve(root,'public/characters/civilians');
const engine=new NullEngine(),scene=new Scene(engine);scene.defaultMaterial=new Material('cpu/no-shaders',scene);
const shadows=new ShadowGenerator(16,new DirectionalLight('cpu/sun',Vector3.Down(),scene));
const manifest=JSON.parse(await readFile(resolve(assetRoot,'manifest.json'),'utf8'));
const report={scope:'Actual Babylon GLB import and existing Character/RocketboxSkin retargeter in NullEngine; materials skipped; no gameplay integration or GPU performance claim.',variants:[],sharedResources:[]};
function poseVertices(character){
 const out=[];
 for(const mesh of character.parts.slice(1)){
  mesh.skeleton.prepare(true);const matrices=mesh.skeleton.getTransformMatrices(mesh),world=mesh.computeWorldMatrix(true);
  const positions=mesh.getVerticesData(VertexBuffer.PositionKind),weights=mesh.getVerticesData(VertexBuffer.MatricesWeightsKind),joints=mesh.getVerticesData(VertexBuffer.MatricesIndicesKind),matrix=Matrix.Identity();
  // Each material mesh shares the full source vertex buffer; only evaluate the
  // vertices actually referenced by this material draw.
  for(const vertex of new Set(mesh.getIndices())){
   const point=Vector3.FromArray(positions,vertex*3),skinned=Vector3.Zero();
   for(let influence=0;influence<4;influence++){
    const weight=weights[vertex*4+influence];if(!weight)continue;
    Matrix.FromArrayToRef(matrices,joints[vertex*4+influence]*16,matrix);
    skinned.addInPlace(Vector3.TransformCoordinates(point,matrix).scale(weight));
   }
   out.push(Vector3.TransformCoordinates(skinned,world));
  }
 }
 assert.ok(out.length>4000);assert.ok(out.every(point=>point.asArray().every(Number.isFinite)));
 return out;
}
function bounds(vertices){const min=new Vector3(Infinity,Infinity,Infinity),max=new Vector3(-Infinity,-Infinity,-Infinity);for(const point of vertices){min.minimizeInPlace(point);max.maximizeInPlace(point);}return {min:min.asArray(),max:max.asArray()};}
const counts=()=>({meshes:scene.meshes.length,geometries:scene.geometries.length,skeletons:scene.skeletons.length,transforms:scene.transformNodes.length,shadows:shadows.getShadowMap().renderList.length});
try{
 await prepareCharacterAssets(scene,'https://civilian-fixture.test/',async url=>{
  const variant=variants[new URL(url).pathname.endsWith('female.glb')?1:0];
  return LoadAssetContainerAsync(new Uint8Array(await readFile(resolve(assetRoot,`${variant.label}.glb`))),scene,{pluginExtension:'.glb',pluginOptions:{gltf:{skipMaterials:true}}});
 });
 for(const variant of variants){
  const raw=await readFile(resolve(assetRoot,`${variant.label}.glb`)),asset=manifest.assets.find(x=>x.label===variant.label);
  assert.equal(createHash('sha256').update(raw).digest('hex'),asset.sha256);
  const json=JSON.parse(raw.subarray(20,20+raw.readUInt32LE(12)).toString());
  assert.equal(json.skins.length,1);assert.equal(json.skins[0].joints.length,80);assert.equal(json.materials.length,3);assert.equal(json.asset.extras.license,'MIT');
  const parent=new Map();json.nodes.forEach((node,index)=>node.children?.forEach(child=>parent.set(child,index)));
  for(const joint of json.skins[0].joints){let node=joint;while(node!==undefined&&node!==json.skins[0].skeleton)node=parent.get(node);assert.equal(node,json.skins[0].skeleton,'skin.skeleton must be a common ancestor of every joint');}
  const textures=[];
  for(const image of json.images){assert.ok(!image.uri.includes('://')&&!image.uri.includes('..'));const bytes=await readFile(resolve(assetRoot,image.uri));textures.push({path:image.uri,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}
  const character=new Character(scene,shadows,variant.name,'#ffffff',variant.female,undefined,{licensedPlayerSkin:true});
  try{
   assert.equal(character.parts.length,4);assert.equal(character.torso.isVisible,false);
   assert.ok(character.parts.slice(1).every(mesh=>mesh.skeleton.bones.length===80));
   assert.ok(character.parts[1].skeleton.bones.every(bone=>bone.getTransformNode()),'all source bones retain their linked transform nodes');
   const states={},verticesByMode={};let walkDisplacement=0;
   for(const mode of ['idle','walk','run','crouch','aim','seated']){
    for(let frame=0;frame<120;frame++){
     character.animate(1/60,mode==='walk'?3.5:mode==='run'?7:0,mode==='aim',mode==='crouch');if(mode==='seated')character.pose('seated',1,'low');
     // Sample the stride, since a single final frame can happen to be close to
     // the neutral foot-crossing pose even while locomotion works correctly.
     if(mode==='walk'&&frame%12===0){scene.onBeforeActiveMeshesEvaluationObservable.notifyObservers(scene);walkDisplacement=Math.max(walkDisplacement,...poseVertices(character).map((point,index)=>Vector3.Distance(point,verticesByMode.idle[index])));}
    }
    scene.onBeforeActiveMeshesEvaluationObservable.notifyObservers(scene);verticesByMode[mode]=poseVertices(character);states[mode]=bounds(verticesByMode[mode]);
    assert.ok(states[mode].min.every(v=>v>-2.5)&&states[mode].max.every(v=>v<2.5),`${variant.name} ${mode} must stay in metre-scale pose bounds`);
   }
   assert.ok(walkDisplacement>.15,`${variant.name}: walking visibly deforms geometry (${walkDisplacement} m)`);
   const before=poseVertices(character),pelvis=character.skeleton.bones[0];pelvis.setPosition(pelvis.getPosition().add(new Vector3(0,.35,0)));scene.onBeforeActiveMeshesEvaluationObservable.notifyObservers(scene);
   const after=poseVertices(character);for(let n=0;n<before.length;n++)assert.ok(Math.abs(after[n].y-before[n].y-.35)<.001,'direct driver changes propagate without animate');
   report.variants.push({...asset,textures,actualImportedDraws:character.parts.length-1,actualImportedTriangles:character.parts.slice(1).reduce((sum,mesh)=>sum+mesh.getTotalIndices()/3,0),poses:states,walkDisplacement,driverTranslationVerified:true});
  }finally{character.dispose();}
 }
 const baseline=counts();
 for(let n=0;n<8;n++){const pair=variants.map(v=>new Character(scene,shadows,`${v.name}-${n}`,'#ffffff',v.female,undefined,{licensedPlayerSkin:true}));pair.forEach(c=>c.dispose());assert.deepEqual(counts(),baseline);report.sharedResources.push(counts());}
 report.pass=true;await writeFile(resolve(root,'data/characters/civilians/verification.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}finally{shadows.dispose();scene.dispose();engine.dispose();}
