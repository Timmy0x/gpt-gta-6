import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import HavokPhysics from '@babylonjs/havok';
import { DirectionalLight, HavokPlugin, Material, MeshBuilder, NullEngine, PhysicsAggregate, PhysicsShapeType, Scene, ShadowGenerator, Vector3 } from '@babylonjs/core';
import { World } from '../../src/world/World.ts';
const root=resolve(import.meta.dirname,'../..'),requests=[],snapshots=[];
let injectedFailure=false;
const server=createServer(async(req,res)=>{
 try{const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname);if(!path.startsWith('/world/')||path.includes('..'))throw new Error('bad path');if(path==='/world/chunks/-3_0_detail.babylon.gz'&&!injectedFailure){injectedFailure=true;requests.push({path,status:503,bytes:15});res.writeHead(503);res.end('temporary retry');return;}const bytes=await readFile(resolve(root,'public',path.slice(1)));requests.push({path,status:200,bytes:bytes.length});res.setHeader('Content-Type',path.endsWith('.gz')?'application/octet-stream':'application/json');res.end(bytes);}catch{res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(4183,'127.0.0.1',r));
const engine=new NullEngine(),scene=new Scene(engine);scene.defaultMaterial=new Material('verify/no-shader',scene);
const bytes=await readFile(resolve(root,'node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm'));
const havok=await HavokPhysics({wasmBinary:bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)});scene.enablePhysics(new Vector3(0,-9.81,0),new HavokPlugin(false,havok));
const shadows=new ShadowGenerator(16,new DirectionalLight('sun',Vector3.Down(),scene));
const world=new World({scene,shadows},{baseUrl:'http://127.0.0.1:4183/world/'});
const capture=name=>{const stat=world.getStreamingStats();snapshots.push({name,...stat,sceneMeshes:scene.meshes.length,sceneGeometries:scene.geometries.length});console.log(name,JSON.stringify(stat));};
try{
 await world.ready;capture('ready');
 assert.ok(snapshots[0].loadedPackages<snapshots[0].totalPackages/2,'initial ready downloads less than half the packages');
 const bodyMesh=MeshBuilder.CreateBox('active-car',{size:1},scene);bodyMesh.position.set(3.3,1.5,-28);const body=new PhysicsAggregate(bodyMesh,PhysicsShapeType.BOX,{mass:300},scene);world.setActiveAnchors([bodyMesh.position]);
 const west=new Vector3(-408.5,1.5,-63.5);await world.preparePosition(west);world.ensureCollision(west);
 for(let i=0;i<120;i++){world.update(1/60,west,15,'Clear');scene.getPhysicsEngine()._step(1/60);}
 assert.ok(bodyMesh.position.y>.45,'remote active body retains ground support during destination loading');assert.ok(injectedFailure&&world.getStreamingStats().retries>=1,'actual HTTP503 was retried successfully');capture('west');
 await world.preparePosition(world.spawn);for(let i=0;i<120;i++)world.update(1/60,world.spawn,15,'Clear');capture('return');
 assert.ok(snapshots.at(-1).packagesEvicted>0);assert.ok(snapshots.at(-1).cpuGeometryBytes<snapshots.at(-1).totalCpuGeometryBytes);
 body.dispose();bodyMesh.dispose();
 await writeFile(resolve(root,'docs/evidence/network-world.json'),JSON.stringify({renderer:'Babylon NullEngine; texture URLs are parsed but PNGs are not fetched/rendered by NullEngine',transport:'real local HTTP fetch with gzip decompression and SHA-256 verification',capturedAt:new Date().toISOString(),requests,snapshots},null,2));
}finally{world.dispose();shadows.dispose();scene.dispose();engine.dispose();server.closeAllConnections();await new Promise(r=>server.close(r));}
