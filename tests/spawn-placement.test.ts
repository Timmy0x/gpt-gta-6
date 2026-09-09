import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import HavokPhysics from '@babylonjs/havok';
import { DirectionalLight, HavokPlugin, MeshBuilder, NullEngine, PhysicsAggregate, PhysicsShapeType, Scene, ShadowGenerator, Vector3, type PhysicsEngineV2 } from '@babylonjs/core';
import { findGroundVehicleSpawn, footprintsOverlap } from '../src/vehicles/spawnPlacement';
import { VehicleSystem } from '../src/vehicles/VehicleSystem';
const bytes=await readFile(new URL('../node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm',import.meta.url));
const havok=await HavokPhysics({wasmBinary:bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer});
function fixture(width=70,depth=70){const engine=new NullEngine(),scene=new Scene(engine);scene.enablePhysics(new Vector3(0,-9.81,0),new HavokPlugin(true,havok));const floor=MeshBuilder.CreateBox('floor',{width,depth,height:1},scene);floor.position.y=-.5;new PhysicsAggregate(floor,PhysicsShapeType.BOX,{mass:0},scene);const shadows=new ShadowGenerator(64,new DirectionalLight('sun',new Vector3(0,-1,0),scene)),vehicles=new VehicleSystem({scene,shadows}),physics=scene.getPhysicsEngine() as PhysicsEngineV2;return{scene,vehicles,physics,close(){vehicles.dispose();scene.dispose();engine.dispose();}};}

test('oriented footprint checks include diagonal bumpers and avoid rejecting separated parallel cars',()=>{
 const first={x:0,z:0,width:2,length:5,heading:Math.PI/4};
 assert.equal(footprintsOverlap(first,{...first,x:3,z:3}),true);
 assert.equal(footprintsOverlap(first,{...first,x:3,z:-3}),false);
});

test('real Havok spawn search avoids starter car, a rotated truck, and collidable props without moving existing entities',()=>{
 const f=fixture();try{
  const origin=new Vector3(3,1.2,-8),starter=f.vehicles.spawn('coupe',new Vector3(3,.95,0)),truck=f.vehicles.spawn('truck',new Vector3(7,.95,-2),Math.PI/3);
  const prop=MeshBuilder.CreateBox('large-blocking-prop',{width:4,height:2,depth:5},f.scene);prop.position.set(-1,1,-2);new PhysicsAggregate(prop,PhysicsShapeType.BOX,{mass:50},f.scene);
  f.physics._step(1/60);
  const initial=f.vehicles.list.map(v=>v.root.position.clone()),bodies=f.physics.getBodies().length,meshes=f.scene.meshes.length;
  const result=findGroundVehicleSpawn({scene:f.scene,kind:'concept',origin,heading:0,obstacles:[],vehicles:f.vehicles.list});
  assert.ok(result,'a nearby unoccupied supported footprint exists');
  for(const v of [starter,truck])assert.equal(footprintsOverlap({x:result.x,z:result.z,width:2.23,length:4.61,heading:0},{x:v.root.position.x,z:v.root.position.z,width:v.tuning.width,length:v.tuning.length,heading:v.heading},.6),false);
  assert.equal(footprintsOverlap({x:result.x,z:result.z,width:2.23,length:4.61,heading:0},{x:prop.position.x,z:prop.position.z,width:4,length:5,heading:0},0),false,'actual unlisted Havok prop obstructs query');
  assert.equal(f.physics.getBodies().length,bodies);assert.equal(f.scene.meshes.length,meshes);
  assert.deepEqual(f.vehicles.list.map(v=>v.root.position.asArray()),initial.map(v=>v.asArray()));
 }finally{f.close();}
});

test('unsupported edges and fully blocked world footprints reject spawn without adding bodies or vehicles',()=>{
 const f=fixture(4,4);try{
  const options={scene:f.scene,kind:'truck' as const,origin:new Vector3(0,1.2,0),heading:0,obstacles:[],vehicles:f.vehicles.list};
  const bodies=f.physics.getBodies().length;
  assert.equal(findGroundVehicleSpawn(options),null,'every wheel footprint must have static supporting ground');
  assert.equal(f.physics.getBodies().length,bodies);assert.equal(f.vehicles.list.length,0);
 }finally{f.close();}
 const g=fixture();try{
  const options={scene:g.scene,kind:'coupe' as const,origin:new Vector3(0,1.2,0),heading:0,obstacles:[{x:0,z:0,w:70,d:70,height:10}],vehicles:g.vehicles.list};
  const bodies=g.physics.getBodies().length;assert.equal(findGroundVehicleSpawn(options),null);assert.equal(g.physics.getBodies().length,bodies);
 }finally{g.close();}
});
