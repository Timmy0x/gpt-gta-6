import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {MeshBuilder,NullEngine,Scene,Vector3} from '@babylonjs/core';
const implementations={
 acceptedR3:(await import('../miami-gameplay-r3-source/src/core/CameraOcclusion.ts')).CameraOcclusion,
 frozenR4:(await import('../miami-performance-r4-source/src/core/CameraOcclusion.ts')).CameraOcclusion,
};
const results:Record<string,unknown>[]=[];
for(const [round,order] of [['acceptedR3','frozenR4'],['frozenR4','acceptedR3']].entries())for(const name of order){
 const Constructor=implementations[name as keyof typeof implementations],engine=new NullEngine(),scene=new Scene(engine),resolver=new Constructor(scene);
 const tile=MeshBuilder.CreateGround('synthetic-500k-vertical-wall',{width:10,height:10,subdivisions:500},scene);tile.rotation.x=Math.PI/2;tile.position.set(0,-20,-2);tile.metadata={cameraBlocker:true};tile.computeWorldMatrix(true);
 const originalParts=tile.subMeshes.slice(),originalIndices=tile.getIndices(),originalBuffer=tile.getVertexBuffer('position'),raw=originalBuffer!.getData(),material=tile.material;
 const target=new Vector3(0,-20,0),desired=new Vector3(0,-20,-5),options={nearPlane:.12,fov:.88,aspect:1.8};
 let start=performance.now();const cold=resolver.resolve(target,desired,desired,1/60,options),coldMs=performance.now()-start;
 assert.ok(cold.z>=-1.79&&cold.z<=-1.77);
 const points=(tile as any)._positions;
 if(name==='frozenR4')assert.equal(points,null,'optimized eligible dense source never generates native point cache');
 else assert.equal(points.length,tile.getTotalVertices());
 const samples:number[]=[];
 for(let i=0;i<80;i++){start=performance.now();const resolved=resolver.resolve(target,desired,desired,1/60,options);samples.push(performance.now()-start);assert.ok(resolved.equalsWithEpsilon(cold,1e-7));}
 samples.sort((a,b)=>a-b);
 assert.deepEqual(tile.subMeshes,originalParts);assert.equal(tile.getIndices(),originalIndices);assert.equal(tile.getVertexBuffer('position'),originalBuffer);assert.equal(originalBuffer!.getData(),raw);assert.equal(tile.material,material);
 results.push({round,name,triangles:tile.getTotalIndices()/3,vertices:tile.getTotalVertices(),coldMs,warmMedianMs:samples[Math.floor(samples.length*.5)],warmP95Ms:samples[Math.floor(samples.length*.95)],warmMaxMs:samples.at(-1),nativePointObjects:points?.length??0,renderBuffersAndPartsPreserved:true,resolved:cold.asArray(),samples:80});
 scene.dispose();engine.dispose();
}
const evidence={scope:'Matched independent synthetic full CameraOcclusion.resolve workload, five boom rays plus exact endpoint clearance; sequential/reversed order; Node22 NullEngine CPU measurements, not browser FPS or provider meshes',results};
await writeFile(new URL('./dense-resolver-profile.json',import.meta.url),JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify(evidence));
