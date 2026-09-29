import { cpus } from 'node:os';
import { Logger, Mesh, NullEngine, Ray, Scene, Vector3, VertexData } from '../miami-gameplay-r3-source/node_modules/@babylonjs/core/index.js';
import { CameraMeshQueries } from '../miami-gameplay-r3-source/src/core/CameraMeshQueries';

// Reproduce with node --expose-gc --import tsx <this-file>. Synthetic geometry only.
Logger.LogLevels=Logger.NoneLogLevel;
const gc=(globalThis as unknown as {gc?:()=>void}).gc;
if(!gc)throw new Error('Run with --expose-gc for retained-heap samples.');
const sample=()=>{gc();const {heapUsed,external,arrayBuffers}=process.memoryUsage();return{heapUsed,external,arrayBuffers};};
const records=[];
for(const size of [250,500]) {
  const engine=new NullEngine(),scene=new Scene(engine),queries=new CameraMeshQueries(scene);
  const before=sample();
  const vertices=(size+1)**2,positions=new Float32Array(vertices*3),indices=new Uint32Array(size*size*6);
  for(let row=0;row<=size;row++)for(let col=0;col<=size;col++){const n=(row*(size+1)+col)*3;positions[n]=col*100/size-50;positions[n+1]=-22;positions[n+2]=row*100/size-50;}
  let n=0;
  for(let row=0;row<size;row++)for(let col=0;col<size;col++){const a=row*(size+1)+col,b=a+1,c=a+size+1,d=c+1;indices.set([a,b,c,b,d,c],n);n+=6;}
  const mesh=new Mesh('synthetic-visual',scene),data=new VertexData();data.positions=positions;data.indices=indices;data.applyToMesh(mesh);mesh.computeWorldMatrix(true);
  const geometry=sample(),pointsStart=performance.now();mesh._generatePointsArray();const pointsMs=performance.now()-pointsStart,points=sample();
  const queryStart=performance.now();queries.closest(new Ray(new Vector3(0,-20,0),Vector3.Down(),6),mesh);const partitionMs=performance.now()-queryStart,partitions=sample();
  mesh.setEnabled(false);queries.prune();const disabled=sample();
  records.push({triangles:indices.length/3,vertices,typedSourceBytes:positions.byteLength+indices.byteLength,before,geometry,points,partitions,disabled,pointsMs,partitionMs,pointHeapIncreaseBytes:points.heapUsed-geometry.heapUsed,queryPartitionsHeapIncreaseBytes:partitions.heapUsed-points.heapUsed,nativePointCacheRetainedAfterDisable:mesh._positions?.length===vertices});
  scene.dispose();engine.dispose();
}
console.log(JSON.stringify({scope:'Synthetic Node/V8 retained heap and CPU costs; excludes browser, GPU, Havok and provider data. Local references retain mesh through disabled stage; this is not a leak claim.',node:process.version,cpu:cpus()[0]?.model,arch:process.arch,measuredAt:new Date().toISOString(),records},null,2));
