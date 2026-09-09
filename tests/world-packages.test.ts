import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { DirectionalLight, Material, Mesh, MeshBuilder, NullEngine, PBRMaterial, Scene, SceneSerializer, ShadowGenerator, StandardMaterial, Vector3, VertexData } from '@babylonjs/core';
import { mergeAuthoredBatch } from '../src/world/authoring/mergeBatch';
import { PackageResidency } from '../src/world/PackageResidency';
import type { WorldManifest } from '../src/world/packages';

function fixture(receiverSensitive=false){
 const engine=new NullEngine(),scene=new Scene(engine);scene.defaultMaterial=new Material('no-shader',scene);
 const shadows=new ShadowGenerator(16,new DirectionalLight('sun',Vector3.Down(),scene));
 const files=new Map<string,Uint8Array>(),requests:string[]=[],receivers:unknown[]=[];
 const manifest:WorldManifest={version:1,build:'fixture',seed:1,format:'babylon-json+gzip',chunks:[],materials:[],colliders:[],lights:[],litMaterials:[],waterMaterial:'',asphaltMaterial:'',foam:[],totals:{meshes:3,cpuGeometryBytes:2520,compressedBytes:0,textureBytes:0}};
 const material=new StandardMaterial('shared',scene);material.id='shared';
 const materialUrl='materials/shared.json.gz';files.set(materialUrl,gzipSync(JSON.stringify(material.serialize())));manifest.materials.push({id:'shared',name:'shared',url:materialUrl,bytes:files.get(materialUrl)!.length});
 for(const [id,x] of [['near',0],['far',1400],['unused',-1400]] as const){
  const mesh=MeshBuilder.CreateBox(id,{size:2},scene);mesh.position.x=x;mesh.material=material;mesh.metadata={worldCasts:true};
  const data=SceneSerializer.SerializeMesh(mesh,false,false);delete data.materials;delete data.meshes[0].materialUniqueId;
  const url=`chunks/${id}.babylon.gz`,bytes=gzipSync(JSON.stringify(data));files.set(url,bytes);
  manifest.chunks.push({id,url,bounds:{minX:x-1,maxX:x+1,minZ:-1,maxZ:1},detail:'detail',meshes:1,vertices:24,cpuBytes:840,compressedBytes:bytes.length,materials:['shared'],sha256:createHash('sha256').update(bytes).digest('hex')});mesh.dispose();
 }
 material.dispose();
 let failed=0,failures=0;
 const fetcher:typeof fetch=async function(this:unknown,input){receivers.push(this);if(receiverSensitive&&this!==globalThis)throw new TypeError('Illegal invocation');const path=new URL(String(input)).pathname.slice(1);requests.push(path);if(path==='chunks/far.babylon.gz'&&failed++<failures)return new Response('retry',{status:503});const bytes=files.get(path);return bytes?new Response(bytes as BodyInit):new Response('missing',{status:404});};
 const residency=new PackageResidency(scene,shadows,manifest,'http://world.test/',fetcher);
 return {engine,scene,shadows,residency,requests,receivers,files,manifest,setFailures(n:number){failures=n;failed=0;},dispose(){residency.dispose();scene.dispose();engine.dispose();}};
}

test('material and chunk requests preserve the receiver required by native Window.fetch',async()=>{
 const f=fixture(true);try{
  await f.residency.preparePosition(Vector3.Zero());
  assert.ok(f.scene.getMeshByName('near'));
  assert.deepEqual(f.requests,['materials/shared.json.gz','chunks/near.babylon.gz']);
  assert.ok(f.receivers.every(receiver=>receiver===globalThis));
 }finally{f.dispose();}
});

test('merging a box and gable cannot corrupt shared boxes in later district batches',()=>{
 const engine=new NullEngine(),scene=new Scene(engine);
 try{
  const template=MeshBuilder.CreateBox('template',{size:1},scene),original=Array.from(template.getIndices()!);
  const clone=template.clone('bungalow')!,other=template.clone('later-road')!,gable=new Mesh('gable',scene);
  const data=new VertexData();data.positions=[0,0,0,1,0,0,0,1,0];data.normals=[0,0,1,0,0,1,0,0,1];data.uvs=[0,0,1,0,0,1];data.indices=[0,1,2];data.applyToMesh(gable);
  const house=mergeAuthoredBatch([clone,gable])!;
  assert.deepEqual(Array.from(template.getIndices()!),original);
  const road=mergeAuthoredBatch([other])!;
  for(const mesh of [house,road])assert.ok(Array.from(mesh.getIndices()!).every(i=>i<mesh.getTotalVertices()));
  assert.equal(road.getTotalVertices(),24);assert.equal(road.getTotalIndices(),36);
 }finally{scene.dispose();engine.dispose();}
});

test('native Babylon packages fetch only required cells and evict CPU geometry, GPU meshes, and unused materials',async()=>{
 const f=fixture();try{
  await f.residency.preparePosition(Vector3.Zero());
  assert.ok(f.requests.includes('chunks/near.babylon.gz'));assert.ok(!f.requests.some(r=>r.includes('far')||r.includes('unused')));
  const original=f.scene.getMeshByName('near')!;assert.ok(original);assert.equal(original.material?.id,'shared');
  const shared=original.material;
  for(let cycle=0;cycle<10;cycle++){
   await f.residency.preparePosition(new Vector3(1400,0,0));f.residency.update(new Vector3(1400,0,0));
   assert.equal(f.scene.getMeshByName('near'),null);assert.equal(f.scene.geometries.length,1);
   assert.equal(f.residency.getStats().cpuGeometryBytes,840);
   assert.equal(f.scene.getMeshByName('far')!.material,shared,'overlapping residency reuses the shared material');
   await f.residency.preparePosition(Vector3.Zero());f.residency.update(Vector3.Zero());
   assert.equal(f.scene.meshes.length,1);assert.equal(f.scene.geometries.length,1);assert.equal(f.shadows.getShadowMap()!.renderList!.length,1);
  }
  assert.ok(original.isDisposed());assert.equal(f.requests.filter(r=>r==='materials/shared.json.gz').length,1);
  assert.equal(f.requests.filter(r=>r==='chunks/unused.babylon.gz').length,0);
  f.residency.update(new Vector3(5000,0,0));assert.equal(f.scene.meshes.length,0);assert.equal(f.scene.geometries.length,0);assert.equal(f.residency.getStats().residentMaterials,0);assert.equal(f.residency.getStats().cpuGeometryBytes,0);
 }finally{f.dispose();}
});

test('transient package failures retry and preserve the current neighborhood until destination preparation succeeds',async()=>{
 const f=fixture();try{
  await f.residency.preparePosition(Vector3.Zero());f.setFailures(1);
  await f.residency.preparePosition(new Vector3(1400,0,0));
  assert.ok(f.scene.getMeshByName('near'));assert.ok(f.scene.getMeshByName('far'));
  assert.equal(f.residency.getStats().retries,1);assert.equal(f.residency.getStats().failedPackages,0);
  f.residency.update(new Vector3(1400,0,0));assert.equal(f.scene.getMeshByName('near'),null);
 }finally{f.dispose();}
});

test('production manifest preserves authored collision metadata and asset references',async()=>{
 const manifest=JSON.parse(await readFile(new URL('../public/world/manifest.json',import.meta.url),'utf8')) as WorldManifest;
 assert.equal(manifest.chunks.length,84);assert.equal(manifest.colliders.length,249);
 assert.ok(manifest.colliders.some(c=>c.global&&c.id.includes('urban-ground')));
 assert.ok(manifest.colliders.some(c=>c.obstacle&&c.x<-450));
 const ids=new Set(manifest.materials.map(m=>m.id));
 for(const material of manifest.materials.filter(m=>m.name.startsWith('sign-material/'))){
   const data=JSON.parse(gunzipSync(await readFile(new URL(`../public/world/${material.url}`,import.meta.url))).toString());
   const png=await readFile(new URL(`../public/world/${data.albedoTexture.name}`,import.meta.url));
   assert.equal(png.readUInt32BE(16),1024,'authored sign text must not be clipped by NullEngine caps');assert.equal(png.readUInt32BE(20),128);
 }
 const meshIds=new Set<string>(),geometryIds=new Set<string>();
 for(const chunk of manifest.chunks){assert.ok(chunk.materials.every(id=>ids.has(id)));const raw=await readFile(new URL(`../public/world/${chunk.url}`,import.meta.url));assert.equal(raw.length,chunk.compressedBytes);assert.equal(createHash('sha256').update(raw).digest('hex'),chunk.sha256);
 const data=JSON.parse(gunzipSync(raw).toString());
 for(const mesh of data.meshes){assert.ok(!meshIds.has(mesh.id),`duplicate mesh ${mesh.id}`);meshIds.add(mesh.id);}
 for(const geometry of data.geometries.vertexData){assert.ok(!geometryIds.has(geometry.id),`duplicate geometry ${geometry.id}`);geometryIds.add(geometry.id);assert.ok(geometry.indices.every((i:number)=>Number.isInteger(i)&&i>=0&&i<geometry.positions.length/3),`out-of-range triangle index in ${geometry.id}`);}
 }
});

test('an unavailable destination rejects preparation without evicting the playable origin',async()=>{
 const f=fixture();try{
  await f.residency.preparePosition(Vector3.Zero());const origin=f.scene.getMeshByName('near')!;f.setFailures(10);
  const pending=f.residency.preparePosition(new Vector3(1400,0,0));
  const interval=setInterval(()=>f.residency.update(Vector3.Zero()),20);
  try{await assert.rejects(pending,/HTTP 503/);}finally{clearInterval(interval);}
  assert.equal(f.scene.getMeshByName('near'),origin);assert.ok(!origin.isDisposed());assert.equal(f.scene.getMeshByName('far'),null);
  assert.equal(f.scene.geometries.length,1);assert.equal(f.residency.getStats().residentMaterials,1);
  f.setFailures(0);await f.residency.preparePosition(new Vector3(1400,0,0));assert.ok(f.scene.getMeshByName('far'),'explicit user retry can recover a failed destination');
 }finally{f.dispose();}
});

test('disposing residency does not remove unrelated gameplay geometry or materials',async()=>{
 const f=fixture();try{
  await f.residency.preparePosition(Vector3.Zero());
  const unrelated=MeshBuilder.CreateBox('persistent-damaged-prop',{size:2},f.scene);const material=new StandardMaterial('gameplay-owned',f.scene);unrelated.material=material;
  f.residency.dispose();assert.ok(!unrelated.isDisposed());assert.equal(unrelated.material,material);assert.ok(f.scene.materials.includes(material));
 }finally{f.dispose();}
});

test('production World awaits native packages, preserves global wave identities and releases loaded CPU geometry',async()=>{
 const [{World}, {default:HavokPhysics}, {HavokPlugin}]=await Promise.all([import('../src/world/World'),import('@babylonjs/havok'),import('@babylonjs/core')]);
 const bytes=await readFile(new URL('../node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm',import.meta.url));
 const havok=await HavokPhysics({wasmBinary:bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer});
 const engine=new NullEngine(),scene=new Scene(engine);scene.defaultMaterial=new Material('production/no-shader',scene);scene.enablePhysics(new Vector3(0,-9.81,0),new HavokPlugin(false,havok));
 const shadows=new ShadowGenerator(16,new DirectionalLight('sun',Vector3.Down(),scene));
 const requests:string[]=[];
 const fileFetch:typeof fetch=async input=>{const path=new URL(String(input)).pathname;requests.push(path);const bytes=await readFile(new URL(`../public${path}`,import.meta.url));return new Response(bytes as BodyInit);};
 const world=new World({scene,shadows},{baseUrl:'http://world.test/world/',fetch:fileFetch});
 try{
  await world.ready;const stat=world.getStreamingStats();assert.equal(stat.loadedPackages,12);assert.equal(stat.totalPackages,84);assert.ok(stat.cpuGeometryBytes<stat.totalCpuGeometryBytes/2);assert.ok(world.obstacles.length>100);
  const foam=Array.from({length:8},(_,i)=>scene.getMeshById(`shore-break/${i}`));assert.ok(foam.every(Boolean));assert.equal(new Set(foam.map(m=>m!.geometry)).size,8);
  world.update(1,world.spawn,15,'Rain');assert.equal(new Set(foam.map(m=>m!.position.x)).size,8,'every shore wave animates independently');
  for(const mesh of scene.meshes.filter(m=>m.metadata?.worldDetail)){
    assert.ok(mesh.material,'native meshes retain their lazily shared material');
    if(mesh.material instanceof PBRMaterial)assert.equal(mesh.material.imageProcessingConfiguration,scene.imageProcessingConfiguration,'streamed materials follow live tone mapping and exposure');
    const data=mesh.getVerticesData('position');assert.ok(data instanceof Float32Array,'resident geometry retains typed CPU arrays');
    const bounds=mesh.getBoundingInfo().boundingBox;assert.ok(Number.isFinite(bounds.minimumWorld.x)&&Number.isFinite(bounds.maximumWorld.z));
  }
  assert.ok(!requests.some(path=>path.includes('/chunks/-4_')),'the remote annex is not downloaded during initial readiness');
  world.dispose();assert.equal(scene.geometries.length,0);assert.equal(scene.meshes.length,0);assert.equal(shadows.getShadowMap()!.renderList!.length,0);
 }finally{world.dispose();shadows.dispose();scene.dispose();engine.dispose();}
});
