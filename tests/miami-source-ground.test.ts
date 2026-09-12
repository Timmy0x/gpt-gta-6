import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import HavokPhysics from '@babylonjs/havok';
import {HavokPlugin,Mesh,MeshBuilder,NullEngine,PhysicsAggregate,PhysicsShapeType,Scene,Vector3,VertexData,type PhysicsEngineV2} from '@babylonjs/core';
import {decodeMiamiChunk,validateMiamiManifest} from '../src/world/miami/MiamiPackages';
import {createPublicCollisionQueries} from '../src/world/miami/frame/PublicCollisionQueries';
const root=new URL('../public/world/miami/',import.meta.url),json=async(n:string)=>JSON.parse(await readFile(new URL(n,root),'utf8'));
test('compiled common-frame Brickell payload supports native negative ground, roads and source building faces without invented waterbeds or bridge decks',async t=>{
 const [manifest,dataset,config]=await Promise.all(['packages.json','dataset.json','runtime-query.json'].map(json));validateMiamiManifest(manifest);assert.equal(dataset.id,manifest.worldId);assert.equal(config.worldId,manifest.worldId);
 assert.equal(manifest.worldId,'brickell-public-common-frame-r1');
 assert.deepEqual(manifest.frame.origin,{latitudeDegrees:25.7662,longitudeDegrees:-80.1907,ellipsoidHeightM:0});
 assert.equal(manifest.frame.policy.status,'provisional','numeric datum operation is not a surveyed renderer correspondence');
 assert.equal(manifest.exclusions.inventedWaterbeds,0);assert.ok(manifest.exclusions.roads.length>=4);
 for(const excluded of manifest.exclusions.roads)assert.ok(dataset.roads.every((r:{id:string})=>r.id!==excluded.id&&!r.id.startsWith(excluded.id+'/')),'excluded deck cannot reappear as a traffic road');
 assert.ok(dataset.roads.every((r:{bridge:boolean;tunnel:boolean;layer:number;unavailableReason?:string})=>!r.bridge&&!r.tunnel&&r.layer===0&&!r.unavailableReason));
 const h=await readFile(new URL(config.heightsUrl,root)),m=await readFile(new URL(config.maskUrl,root)),queries=createPublicCollisionQueries(config,new Float32Array(h.buffer.slice(h.byteOffset,h.byteOffset+h.byteLength)),m);
 const wasm=await readFile(new URL('../node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm',import.meta.url)),havok=await HavokPhysics({wasmBinary:wasm.buffer.slice(wasm.byteOffset,wasm.byteOffset+wasm.byteLength) as ArrayBuffer});
 const engine=new NullEngine(),scene=new Scene(engine);scene.enablePhysics(new Vector3(0,-9.81,0),new HavokPlugin(false,havok));t.after(()=>{scene.dispose();engine.dispose();});const physics=scene.getPhysicsEngine() as PhysicsEngineV2;
 let meshes=0,triangles=0,buildingMeshes=0;const buildingFaces:{point:Vector3;normal:Vector3;id:string;mask:number;wall:boolean}[]=[];
 for(const chunk of manifest.chunks){const bytes=await readFile(new URL(chunk.url,root));assert.equal(createHash('sha256').update(bytes).digest('hex'),chunk.sha256);const decoded=decodeMiamiChunk(chunk,bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
  for(const d of decoded){assert.notEqual(d.record.kind,'waterbed');assert.notEqual(d.record.material,'waterbed');assert.equal(d.record.collision,true);const mesh=new Mesh(d.record.id,scene),data=new VertexData();data.positions=d.positions;data.normals=d.normals;data.indices=d.indices;data.uvs=d.uvs;data.applyToMesh(mesh);mesh.position=Vector3.FromArray(d.record.origin);mesh.computeWorldMatrix(true);const body=new PhysicsAggregate(mesh,PhysicsShapeType.MESH,{mass:0,friction:d.record.friction,restitution:0},scene);body.shape.filterMembershipMask=d.record.kind==='building'?4:d.record.kind==='road'?1:d.record.kind==='terrain'?2:8;meshes++;triangles+=d.indices.length/3;if(d.record.kind==='building'){buildingMeshes++;body.shape.filterMembershipMask=4|(1<<(buildingMeshes+3));for(const wall of [false,true])for(let i=0;i<d.indices.length;i+=3){const ids=Array.from(d.indices.slice(i,i+3)),normal=ids.reduce((n,id)=>n.add(Vector3.FromArray(d.normals,id*3)),Vector3.Zero()).normalize();if(wall?Math.abs(normal.y)>.2:normal.y<.9)continue;const point=ids.reduce((p,id)=>p.add(Vector3.FromArray(d.positions,id*3)),Vector3.Zero()).scale(1/3).add(mesh.position);buildingFaces.push({point,normal,id:d.record.id,mask:1<<(buildingMeshes+3),wall});}}}
 }
 physics._step(1/60);let groundChecks=0,roadChecks=0,maxGroundError=0,maxRoadError=0;
 let buildingFaceChecks=0,nonExposedCandidates=0;
 const faceGroups=new Map<string,typeof buildingFaces>();for(const f of buildingFaces){const key=f.id+':'+f.wall;const group=faceGroups.get(key)??[];group.push(f);faceGroups.set(key,group);}
 for(const [key,faces] of faceGroups){let exposed=false;faces.sort((a,b)=>a.wall?b.point.x-a.point.x:b.point.y-a.point.y);for(const {point,normal,mask} of faces){const hit=physics.raycast(point.add(normal.scale(.02)),point.subtract(normal.scale(.02)),{collideWith:mask});if(hit.hasHit&&Vector3.Distance(hit.hitPointWorld,point)<.001){exposed=true;buildingFaceChecks++;break;}nonExposedCandidates++;}assert.ok(exposed,'no verified exposed source face in '+key);}

 const ray=(x:number,z:number,expected:number,mask:number)=>{const hit=physics.raycast(new Vector3(x,expected+3,z),new Vector3(x,expected-3,z),{collideWith:mask});assert.ok(hit.hasHit,`missing real support at ${x},${z}`);assert.ok(hit.hitNormalWorld.y>.65);return hit.hitPointWorld.y;};
 for(let x=dataset.bounds.minX+8;x<dataset.bounds.maxX-8;x+=19)for(let z=dataset.bounds.minZ+8;z<dataset.bounds.maxZ-8;z+=19){const q=queries.surfaceAt(x,z);if(!q)continue;assert.ok(q.point[1]<0,'this compiled surface is below the ellipsoid-origin tangent plane');const actual=ray(x,z,q.point[1],2);maxGroundError=Math.max(maxGroundError,Math.abs(actual-q.point[1]));groundChecks++;}
 for(const road of dataset.roads)for(let i=1;i<road.centerline.length;i++){const a=road.centerline[i-1],b=road.centerline[i],steps=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[2]-a[2])/15));for(let n=0;n<=steps;n++){const u=n/steps,x=a[0]+(b[0]-a[0])*u,z=a[2]+(b[2]-a[2])*u;if(x<dataset.bounds.minX+2||x>dataset.bounds.maxX-2||z<dataset.bounds.minZ+2||z>dataset.bounds.maxZ-2)continue;const q=queries.surfaceAt(x,z);if(!q)continue;const expected=q.point[1]+.025,actual=ray(x,z,expected,1);maxRoadError=Math.max(maxRoadError,Math.abs(actual-expected));roadChecks++;}}
 // The compiled surface AOI has finite dry coverage. It does not add an ocean
 // floor or an unsupported road just beyond any of its four sides.
 const b=dataset.bounds;for(const [x,z] of [[b.minX-5,0],[b.maxX+5,0],[0,b.minZ-5],[0,b.maxZ+5]]){assert.equal(queries.surfaceAt(x,z),null);assert.equal(physics.raycast(new Vector3(x,10,z),new Vector3(x,-80,z),{collideWith:3}).hasHit,false,'no invented external ground/road support');}
 const junction=dataset.locations[0],q=queries.surfaceAt(junction.point[0],junction.point[2])!;assert.ok(q);assert.ok(q.point[1]<-20&&q.point[1]>-25,'the real junction retains its converted negative local Up');const roadY=ray(q.point[0],q.point[2],q.point[1]+.025,1);
 const ball=MeshBuilder.CreateSphere('native-resting-body',{diameter:.6},scene);ball.position=new Vector3(q.point[0],roadY+2,q.point[2]);const dynamic=new PhysicsAggregate(ball,PhysicsShapeType.SPHERE,{mass:75,friction:.8,restitution:0},scene);dynamic.shape.filterCollideMask=3;
 for(let i=0;i<240;i++)physics._step(1/60);
 const restingError=Math.abs(ball.position.y-(roadY+.3));
 const report={scope:'Actual public Brickell geometry under explicitly provisional common-frame policy; native Havok, no GPU/provider geometry',meshes,buildingMeshes,buildingFaceChecks,nonExposedCandidates,triangles,groundChecks,roadChecks,maxGroundErrorM:maxGroundError,maxRoadErrorM:maxRoadError,restingErrorM:restingError,excludedRoads:manifest.exclusions.roads.length,waterbedMeshes:0};
 t.diagnostic(JSON.stringify(report));
 assert.equal(buildingMeshes,20);assert.ok(groundChecks>200);assert.ok(roadChecks>30);assert.ok(maxGroundError<.06,'converted source DEM tessellation approximation');assert.ok(maxRoadError<.06,'converted DEM road surface tessellation');assert.ok(restingError<.08);
});
