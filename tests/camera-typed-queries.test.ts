import assert from 'node:assert/strict';
import test from 'node:test';
import { Matrix, Mesh, MeshBuilder, MorphTargetManager, NullEngine, Ray, Scene, SubMesh, TransformNode, Vector3, VertexBuffer, VertexData } from '@babylonjs/core';
import { CameraMeshQueries } from '../src/core/CameraMeshQueries';

function fixture(t: test.TestContext) {
  const engine=new NullEngine(),scene=new Scene(engine),queries=new CameraMeshQueries(scene);
  t.after(()=>{scene.dispose();engine.dispose();});
  return{engine,scene,queries};
}
function oracle(queries: CameraMeshQueries, mesh: Mesh, ray: Ray) {
  const actual=queries.closest(ray,mesh),native=ray.intersectsMesh(mesh,false);
  assert.equal(actual!==null,native.hit,`hit ${ray.origin.asArray()} → ${ray.direction.asArray()}`);
  if(native.hit)assert.ok(Math.abs(actual!-native.distance)<1e-6,`${actual} vs ${native.distance}`);
}

test('cold static camera rays and endpoint clearance do not generate native per-vertex point arrays or copy buffers',t=>{
  const {scene,queries}=fixture(t),mesh=MeshBuilder.CreateBox('static-source',{size:2},scene);
  mesh.position.set(0,-20,-2);mesh.computeWorldMatrix(true);
  const positions=mesh.getVertexBuffer('position')!.getData(),indices=mesh.getIndices(),parts=mesh.subMeshes.slice(),material=mesh.material;
  let generations=0;const generate=mesh._generatePointsArray.bind(mesh);
  mesh._generatePointsArray=()=>{generations++;return generate();};
  assert.equal(mesh._positions,null);
  assert.equal(queries.closest(new Ray(new Vector3(0,-20,0),new Vector3(0,0,-1),6),mesh),1);
  assert.ok(queries.clearance({position:new Vector3(0,-20,-1.05),right:Vector3.Right(),up:Vector3.Up(),backward:new Vector3(0,0,-1),horizontal:.16,vertical:.16,depth:.22},new Set([mesh])));
  assert.equal(generations,0);assert.equal(mesh._positions,null);
  assert.equal(mesh.getVertexBuffer('position')!.getData(),positions);assert.equal(mesh.getIndices(),indices);assert.deepEqual(mesh.subMeshes,parts);assert.equal(mesh.material,material);assert.equal(scene.getPhysicsEngine(),null);
});

test('scratch native triangle rays match both sides and finite ranges under reflected affine transforms',t=>{
  const {scene,queries}=fixture(t),mesh=MeshBuilder.CreateBox('affine-box',{width:4,height:3,depth:.3},scene),parent=new TransformNode('affine-parent',scene);
  parent.setPreTransformMatrix(Matrix.FromArray([-1.8,.11,0,0, .15,.9,.03,0, .2,-.1,1.35,0, 7,-20,-3,1]));
  mesh.parent=parent;mesh.position.set(1,.7,-.4);mesh.computeWorldMatrix(true);
  const center=mesh.getAbsolutePosition();
  for(let i=0;i<48;i++) {
    const origin=center.add(new Vector3(Math.sin(i*1.13)*7,Math.cos(i*.9)*5,i%2?-8:8)),direction=center.subtract(origin).normalize();
    for(const length of [.2,12,30])oracle(queries,mesh,new Ray(origin,direction,length));
  }
});

test('interleaved FLOAT position buffers with a typed-array byteOffset match native picking without deinterleaving',t=>{
  const {engine,scene,queries}=fixture(t),mesh=new Mesh('interleaved-source',scene);
  const storage=new Float32Array(22);storage.set([900,901,-4,-4,-2,902, 900,901,4,-4,-2,902, 900,901,0,4,-2,902],2);
  const raw=new Uint8Array(storage.buffer,8,72),buffer=new VertexBuffer(engine,raw,'position',false,false,24,false,8,3,VertexBuffer.FLOAT,false,true);
  mesh.setVerticesBuffer(buffer,true,3);mesh.setIndices([0,1,2]);mesh.position.y=-20;mesh.computeWorldMatrix(true);
  const ray=new Ray(new Vector3(0,-20,0),new Vector3(0,0,-1),6);
  assert.equal(queries.closest(ray,mesh),2);assert.equal(mesh._positions,null);assert.equal(buffer.getData(),raw);
  oracle(queries,mesh,ray);
});

test('normalized SHORT position data uses native Float32 conversion semantics',t=>{
  const {engine,scene,queries}=fixture(t),mesh=new Mesh('quantized-source',scene);
  const raw=new Int16Array([-32767,-32767,-16384, 32767,-32767,-16384, 0,32767,-16384]);
  mesh.setVerticesBuffer(new VertexBuffer(engine,raw,'position',false,false,3,false,0,3,VertexBuffer.SHORT,true));
  mesh.setIndices([0,1,2]);mesh.scaling.set(4,4,4);mesh.position.y=-20;mesh.computeWorldMatrix(true);
  oracle(queries,mesh,new Ray(new Vector3(.17,-20,0),new Vector3(0,0,-1),6));
});

test('native nonindexed submesh vertex ranges and indexed material changes remain authoritative',t=>{
  const {scene,queries}=fixture(t),mesh=new Mesh('nonindexed-range',scene),data=new VertexData();
  data.positions=[-4,-24,-2,4,-24,-2,0,-16,-2, -4,-24,-4,4,-24,-4,0,-16,-4];data.applyToMesh(mesh);mesh.isUnIndexed=true;
  mesh.releaseSubMeshes();new SubMesh(0,3,3,0,0,mesh);mesh.computeWorldMatrix(true);
  const ray=new Ray(new Vector3(0,-20,0),new Vector3(0,0,-1),6);
  assert.equal(queries.closest(ray,mesh),4);oracle(queries,mesh,ray);
  const original=mesh.subMeshes.slice();mesh.subMeshes[0].verticesStart=0;mesh.subMeshes[0].verticesCount=3;mesh.subMeshes[0].refreshBoundingInfo();
  assert.equal(queries.closest(ray,mesh),2);assert.deepEqual(mesh.subMeshes,original);
});

test('unsupported morph geometry keeps the native picking fallback',t=>{
  const {scene,queries}=fixture(t),mesh=MeshBuilder.CreateBox('morph-source',{},scene);
  mesh.position.set(0,-20,-2);mesh.computeWorldMatrix(true);mesh.morphTargetManager=new MorphTargetManager(scene);
  oracle(queries,mesh,new Ray(new Vector3(0,-20,0),new Vector3(0,0,-1),6));assert.ok(mesh._positions?.length);
});
