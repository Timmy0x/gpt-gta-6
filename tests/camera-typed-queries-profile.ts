import assert from 'node:assert/strict';
import { cpus } from 'node:os';
import { Logger, Mesh, NullEngine, Ray, Scene, Vector3, VertexData } from '@babylonjs/core';
import { CameraMeshQueries as BeforeQueries } from '../docs/evidence/miami-performance-r4/camera/before-CameraMeshQueries';
import { CameraMeshQueries as AfterQueries } from '../src/core/CameraMeshQueries';

// Sequential synthetic CPU/V8 evidence. Run node --expose-gc --import tsx tests/camera-typed-queries-profile.ts.
// Never load source/provider geometry; measurements are native queries, not browser FPS or total GPU/process memory.
Logger.LogLevels=Logger.NoneLogLevel;
const gc=(globalThis as unknown as {gc?:()=>void}).gc;
if(!gc)throw new Error('Run with --expose-gc.');
const sample=()=>{gc();const {heapUsed,arrayBuffers,external}=process.memoryUsage();return{heapUsed,arrayBuffers,external};};
function fixture(size:number) {
  const engine=new NullEngine(),scene=new Scene(engine),vertices=(size+1)**2,positions=new Float32Array(vertices*3),indices=new Uint32Array(size*size*6);
  for(let row=0;row<=size;row++)for(let col=0;col<=size;col++){const n=(row*(size+1)+col)*3;positions[n]=col*100/size-50;positions[n+1]=row*100/size-70;positions[n+2]=-2;}
  let n=0;for(let row=0;row<size;row++)for(let col=0;col<size;col++){const a=row*(size+1)+col,b=a+1,c=a+size+1,d=c+1;indices.set([a,b,c,b,d,c],n);n+=6;}
  const mesh=new Mesh('synthetic-vertical-wall',scene),data=new VertexData();data.positions=positions;data.indices=indices;data.applyToMesh(mesh);mesh.computeWorldMatrix(true);
  return{engine,scene,mesh,positions,indices};
}
function run(size:number,kind:'before'|'after') {
  const f=fixture(size),queries=kind==='before'?new BeforeQueries(f.scene):new AfterQueries(f.scene),ray=new Ray(new Vector3(.07,-20,0),new Vector3(0,0,-1),6);
  const parts=f.mesh.subMeshes.slice(),source=f.mesh.getVertexBuffer('position')!.getData(),before=sample(),start=performance.now();
  const coldHit=queries.closest(ray,f.mesh),coldMs=performance.now()-start,after=sample();assert.equal(coldHit,2);
  const samples=[];
  for(let i=0;i<34;i++){const start=performance.now();assert.equal(queries.closest(ray,f.mesh),2);if(i>=4)samples.push(performance.now()-start);}
  samples.sort((a,b)=>a-b);
  const nativePointCount=f.mesh._positions?.length??0;
  const correction=queries.clearance({position:new Vector3(.07,-20,-1.95),right:Vector3.Right(),up:Vector3.Up(),backward:new Vector3(0,0,-1),horizontal:.16,vertical:.16,depth:.22},new Set([f.mesh]));
  assert.ok(correction);assert.deepEqual(f.mesh.subMeshes,parts);assert.equal(f.mesh.getIndices(),f.indices);assert.equal(f.mesh.getVertexBuffer('position')!.getData(),source);assert.equal(f.scene.getPhysicsEngine(),null);
  if(kind==='after')assert.equal(f.mesh._positions,null,'optimized eligible queries never populate native point arrays');
  const result={kind,triangles:f.indices.length/3,vertices:f.positions.length/3,typedSourceBytes:f.indices.byteLength+f.positions.byteLength,coldMs,retainedHeapDeltaBytes:after.heapUsed-before.heapUsed,before,after,nativePointCount,warmFrames:samples.length,warmMedianMs:samples[15],warmP95Ms:samples[28],warmMaxMs:samples.at(-1),originalRenderSubmeshes:f.mesh.subMeshes.length,nativeBodies:0};
  f.mesh.setEnabled(false);queries.prune();f.scene.dispose();f.engine.dispose();return result;
}
const records=[];for(const size of [250,500])for(const kind of ['before','after'] as const)records.push(run(size,kind));
console.log(JSON.stringify({scope:'Sequential synthetic vertical-wall CPU/native-query and retained V8 heap comparison; no source/provider data, live browser FPS, GPU, Havok or total process memory claim',node:process.version,cpu:cpus()[0]?.model,arch:process.arch,measuredAt:new Date().toISOString(),records},null,2));
