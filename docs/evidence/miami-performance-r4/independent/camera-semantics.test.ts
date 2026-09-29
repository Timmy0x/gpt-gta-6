import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Buffer, HavokPlugin, Material, Matrix, Mesh, MeshBuilder, MorphTargetManager, NullEngine, PhysicsAggregate, PhysicsEngineV2, PhysicsShapeType, Quaternion, Ray, Scene, Skeleton, StandardMaterial, SubMesh, TransformNode, Vector3, VertexBuffer, VertexData} from '@babylonjs/core';

// Only synthetic geometry. REVIEW_SOURCE selects an immutable accepted baseline for fixture preparation.
const source=process.env.REVIEW_SOURCE??'../miami-performance-r4-source';
const {CameraMeshQueries}=await import(`${source}/src/core/CameraMeshQueries.ts`);
const {CameraOcclusion}=await import(`${source}/src/core/CameraOcclusion.ts`);
const enforceTyped=process.env.R4_ENFORCE_TYPED==='1';
const cases: Record<string,unknown>[]=[];

function fixture(t:test.TestContext){
 const engine=new NullEngine(),scene=new Scene(engine),queries=new CameraMeshQueries(scene);
 t.after(()=>{scene.dispose();engine.dispose();});
 return{engine,scene,queries};
}
function quad(scene:Scene,name:string,indexed=true){
 const mesh=new Mesh(name,scene),data=new VertexData();
 if(indexed){data.positions=new Float32Array([-1,-1,0,1,-1,0,1,1,0,-1,1,0]);data.indices=new Uint16Array([0,1,2,0,2,3]);}
 else{data.positions=new Float32Array([-1,-1,0,1,-1,0,1,1,0,-1,-1,0,1,1,0,-1,1,0]);}
 data.applyToMesh(mesh);mesh.isUnIndexed=!indexed;mesh.metadata={cameraBlocker:true};return mesh;
}
function compare(name:string,queries:InstanceType<typeof CameraMeshQueries>,mesh:Mesh,ray:Ray,typed=true){
 mesh.computeWorldMatrix(true);
 const parts=mesh.subMeshes.slice(),indices=mesh.getIndices(),vertexBuffer=mesh.getVertexBuffer('position'),raw=vertexBuffer?.getData(),material=mesh.material;
 const actual=queries.closest(ray,mesh);
 if(enforceTyped&&typed)assert.equal(mesh._positions,null,`${name}: typed query must not materialize Babylon Vector3[] points`);
 const native=ray.intersectsMesh(mesh,false),expected=native.hit?native.distance:null;
 if(expected===null)assert.equal(actual,null,name);
 else{assert.notEqual(actual,null,name);assert.ok(Math.abs(actual!-expected)<Math.max(1e-5,expected*1e-5),`${name}: actual ${actual}, native ${expected}`);}
 assert.deepEqual(mesh.subMeshes,parts);assert.equal(mesh.getIndices(),indices);assert.equal(mesh.getVertexBuffer('position'),vertexBuffer);assert.equal(vertexBuffer?.getData(),raw);assert.equal(mesh.material,material);
 cases.push({name,actual,expected,renderInvariant:true});return actual;
}

test('finite rays preserve world distance under nonuniform reflection, rotation and affine shear',t=>{
 const {scene,queries}=fixture(t);
 const matrices=[
  Matrix.Compose(new Vector3(2,.4,3),Quaternion.RotationYawPitchRoll(.41,-.17,.23),new Vector3(21,-20,-8)),
  Matrix.Compose(new Vector3(-1.2,4,.3),Quaternion.RotationYawPitchRoll(-.38,.21,-.09),new Vector3(-50,-35,18)),
  Matrix.FromArray([1,.25,.1,0, .3,2,.2,0, -.2,.15,-3,0, 40,-22,-30,1]),
 ];
 for(const [n,matrix] of matrices.entries()){
  const parent=new TransformNode(`affine-parent-${n}`,scene);parent.setPreTransformMatrix(matrix);
  const mesh=quad(scene,`affine-quad-${n}`);mesh.parent=parent;mesh.computeWorldMatrix(true);
  for(const side of [1,-1]){
   const origin=Vector3.TransformCoordinates(new Vector3(.2,.3,3*side),mesh.getWorldMatrix());
   const plane=Vector3.TransformCoordinates(new Vector3(.2,.3,0),mesh.getWorldMatrix());
   const delta=plane.subtract(origin),distance=delta.length(),direction=delta.normalize();
   for(const extra of [-.01,.01,2])compare(`affine-${n}-side-${side}-length-${extra}`,queries,mesh,new Ray(origin,direction,distance+extra),false);
  }
 }
});

test('typed ordinary instance picking uses the instance affine transform rather than its source transform',t=>{
 const {scene,queries}=fixture(t),mesh=quad(scene,'source-quad');mesh.position.set(100,-20,100);mesh.computeWorldMatrix(true);
 const parent=new TransformNode('instance-parent',scene);parent.position.set(-10,-25,30);parent.rotation.set(.13,.37,-.2);parent.scaling.set(-2,.5,3);
 const instance=mesh.createInstance('transformed-instance');instance.parent=parent;instance.position.set(2,1,-4);instance.computeWorldMatrix(true);
 const point=Vector3.TransformCoordinates(new Vector3(.2,.3,0),instance.getWorldMatrix());
 const origin=Vector3.TransformCoordinates(new Vector3(.2,.3,3),instance.getWorldMatrix());
 const ray=new Ray(origin,point.subtract(origin).normalize(),Vector3.Distance(origin,point)+.01);
 const parts=instance.subMeshes.slice(),raw=mesh.getVertexBuffer('position')!.getData();
 const actual=queries.closest(ray,instance);
 if(enforceTyped)assert.equal(mesh._positions,null);
 const native=ray.intersectsMesh(instance,false);assert.equal(native.hit,true);assert.ok(Math.abs(actual!-native.distance)<1e-5);
 assert.deepEqual(instance.subMeshes,parts);assert.equal(mesh.getVertexBuffer('position')!.getData(),raw);
 cases.push({name:'ordinary-instance-affine',actual,native:native.distance,renderInvariant:true});
});

test('indexed and nonindexed native submesh selections exclude unrendered nearer triangles',t=>{
 for(const indexed of [true,false]){
  const {scene,queries}=fixture(t),mesh=new Mesh(`subset-${indexed}`,scene),data=new VertexData();
  data.positions=new Float32Array([-1,-1,1,1,-1,1,0,1,1, -1,-1,-1,1,-1,-1,0,1,-1]);
  if(indexed)data.indices=new Uint16Array([0,1,2,3,4,5]);
  data.applyToMesh(mesh);mesh.isUnIndexed=!indexed;mesh.releaseSubMeshes();
  new SubMesh(0,indexed?0:3,indexed?6:3,indexed?3:0,indexed?3:0,mesh);
  const value=compare(`selected-far-triangle-${indexed}`,queries,mesh,new Ray(new Vector3(0,0,3),new Vector3(0,0,-1),5));
  assert.equal(value,4);
 }
});

test('closest hit respects ordering across distinct native material submeshes',t=>{
 const {scene,queries}=fixture(t),mesh=new Mesh('multi-material-depth',scene),data=new VertexData();
 data.positions=new Float32Array([-1,-1,-1,1,-1,-1,0,1,-1, -1,-1,1,1,-1,1,0,1,1]);data.indices=new Uint16Array([0,1,2,3,4,5]);data.applyToMesh(mesh);
 mesh.releaseSubMeshes();new SubMesh(0,0,3,0,3,mesh);new SubMesh(0,3,3,3,3,mesh);
 assert.equal(compare('far-inserted-first-submeshes',queries,mesh,new Ray(new Vector3(0,0,3),new Vector3(0,0,-1),5)),2);
});

test('interleaved FLOAT typed data honors byte stride, attribute offset and typed-view buffer offset',t=>{
 const {engine,scene,queries}=fixture(t),mesh=new Mesh('interleaved-position',scene);
 const storage=new ArrayBuffer(32+3*11*4),raw=new Float32Array(storage,32,3*11);
 const vertices=[[-1,-1,0],[1,-1,0],[0,1,0]];
 for(let n=0;n<3;n++){raw.fill(999,n*11,(n+1)*11);raw.set(vertices[n],n*11+3);}
 const buffer=new Buffer(engine,raw,false,11),position=new VertexBuffer(engine,buffer,'position',{stride:44,offset:12,size:3,type:VertexBuffer.FLOAT,useBytes:true});
 mesh.setVerticesBuffer(position,false,3);mesh.setIndices(new Uint16Array([0,1,2]));mesh.position.set(0,-22,-2);
 assert.ok(Math.abs(compare('interleaved-float-view',queries,mesh,new Ray(new Vector3(0,-22,0),new Vector3(0,0,-1),3))!-2)<1e-6);
});

test('normalized integer accessors retain native conversion and finite ray semantics',t=>{
 const {engine,scene,queries}=fixture(t),mesh=new Mesh('normalized-position',scene),storage=new ArrayBuffer(16+3*6*2),raw=new Int16Array(storage,16,3*6);
 const vertices=[[-32767,-32767,0],[32767,-32767,0],[0,32767,0]];
 for(let n=0;n<3;n++){raw.fill(30000,n*6,(n+1)*6);raw.set(vertices[n],n*6+1);}
 const buffer=new Buffer(engine,raw,false,12,false,false,true),position=new VertexBuffer(engine,buffer,'position',{stride:12,offset:2,size:3,type:VertexBuffer.SHORT,useBytes:true,normalized:true});
 mesh.setVerticesBuffer(position,false,3);mesh.setIndices(new Uint16Array([0,1,2]));mesh.position.set(0,-22,-2);
 assert.ok(Math.abs(compare('normalized-int16-view',queries,mesh,new Ray(new Vector3(0,-22,0),new Vector3(0,0,-1),3),false)!-2)<1e-6);
});

test('active position mutation, index updates and immutable buffer replacements cannot retain stale bounds',t=>{
 const {scene,queries}=fixture(t),mesh=quad(scene,'updatable-position');mesh.position.set(100,-20,-2);mesh.markVerticesDataAsUpdatable('position',true);
 compare('mutable-before',queries,mesh,new Ray(new Vector3(100,-20,0),new Vector3(0,0,-1),3),false);
 const positions=mesh.getVerticesData('position')!;for(let n=0;n<positions.length;n+=3)positions[n]-=100;mesh.updateVerticesData('position',positions,true);
 compare('mutable-after-in-place',queries,mesh,new Ray(new Vector3(0,-20,0),new Vector3(0,0,-1),3),false);
 const indexed=new Mesh('index-update',scene),data=new VertexData();
 data.positions=new Float32Array([99,-1,0,101,-1,0,100,1,0, -1,-1,0,1,-1,0,0,1,0]);data.indices=new Uint16Array([0,1,2]);data.applyToMesh(indexed);indexed.position.set(0,-20,-2);
 compare('index-before',queries,indexed,new Ray(new Vector3(100,-20,0),new Vector3(0,0,-1),3),false);
 indexed.updateIndices(new Uint16Array([3,4,5]));
 compare('index-after',queries,indexed,new Ray(new Vector3(0,-20,0),new Vector3(0,0,-1),3),false);
 const immutable=quad(scene,'immutable-buffer');immutable.position.set(100,-20,-2);
 compare('immutable-before',queries,immutable,new Ray(new Vector3(100,-20,0),new Vector3(0,0,-1),3),false);
 const next=immutable.getVerticesData('position')!.slice();for(let n=0;n<next.length;n+=3)next[n]-=100;immutable.setVerticesData('position',next,false);
 compare('immutable-replaced',queries,immutable,new Ray(new Vector3(0,-20,0),new Vector3(0,0,-1),3),false);
});

test('morphology, skeletons and native triangle-strip layout retain fallback delegation',t=>{
 const {scene,queries}=fixture(t);
 for(const kind of ['morph','skeleton','strip']){
  const mesh=quad(scene,`fallback-${kind}`);mesh.position.z=-2;
  if(kind==='morph')mesh.morphTargetManager=new MorphTargetManager(scene);
  if(kind==='skeleton')mesh.skeleton=new Skeleton('unsupported-rig','unsupported-rig',scene);
  if(kind==='strip'){mesh.material=new StandardMaterial('triangle-strip',scene);mesh.material.fillMode=Material.TriangleStripDrawMode;mesh.setIndices(new Uint16Array([0,1,3,2]));}
  mesh.computeWorldMatrix(true);
  let calls=0;const original=mesh.intersects.bind(mesh);mesh.intersects=(...args:Parameters<Mesh['intersects']>)=>{calls++;return original(...args);};
  const ray=new Ray(new Vector3(0,0,0),new Vector3(0,0,-1),3),actual=queries.closest(ray,mesh);
  assert.ok(calls>=1,`${kind} must retain native fallback`);
  const expected=ray.intersectsMesh(mesh,false);assert.equal(actual,expected.hit?expected.distance:null);
  cases.push({name:`fallback-${kind}`,calls,nativeDistance:actual});
 }
});

test('thin-instance camera clearance preserves matrices and all native render instances',t=>{
 const {scene}=fixture(t),mesh=MeshBuilder.CreateBox('thin-instance-wall',{width:8,height:8,depth:.2},scene);
 mesh.position.set(0,-20,-2);mesh.metadata={cameraBlocker:true};
 const matrices=new Float32Array([...Matrix.Identity().asArray(),...Matrix.Translation(0,0,-2).asArray()]);
 mesh.thinInstanceSetBuffer('matrix',matrices,16,true);mesh.thinInstanceEnablePicking=true;mesh.computeWorldMatrix(true);
 const original=Array.from(matrices),parts=mesh.subMeshes.slice(),resolver=new CameraOcclusion(scene),target=new Vector3(0,-20,0),desired=new Vector3(0,-20,-5);
 const resolved=resolver.resolve(target,desired,desired,1/60);assert.ok(resolved.z>=-1.69);assert.deepEqual(Array.from(matrices),original);assert.deepEqual(mesh.subMeshes,parts);assert.equal(mesh.thinInstanceCount,2);
 cases.push({name:'thin-instance-clearance',resolved:resolved.asArray(),renderInvariant:true});
});

test('cold and warm camera queries preserve native physical bodies and tiny endpoint clearance',async t=>{
 const {scene}=fixture(t),bytes=await readFile(new URL('./node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm',import.meta.url));
 const {default:HavokPhysics}=await import('@babylonjs/havok');
 const havok=await HavokPhysics({wasmBinary:bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer});
 scene.enablePhysics(new Vector3(0,-9.81,0),new HavokPlugin(false,havok));
 const physics=scene.getPhysicsEngine() as PhysicsEngineV2,floor=MeshBuilder.CreateBox('physical-floor',{width:20,height:1,depth:20},scene);floor.position.y=-23;new PhysicsAggregate(floor,PhysicsShapeType.BOX,{mass:0},scene);
 const bodyCount=physics.getBodies().length,body=physics.getBodies()[0],before=floor.computeWorldMatrix(true).clone();
 const blocker=MeshBuilder.CreateBox('tiny-near-plane',{width:.02,height:.02,depth:.015},scene);blocker.position.set(.07,-20,-4.88);blocker.metadata={cameraBlocker:true};blocker.computeWorldMatrix(true);
 const resolver=new CameraOcclusion(scene),target=new Vector3(0,-20,0),desired=new Vector3(0,-20,-5);
 for(let run=0;run<8;run++){
  const resolved=resolver.resolve(target,desired,desired,1/60),backward=resolved.subtract(target).normalize(),right=Vector3.Cross(Vector3.Up(),backward).normalize(),up=Vector3.Cross(backward,right).normalize();
  for(let x=-10;x<=10;x++)for(let y=-10;y<=10;y++)assert.equal(blocker.getBoundingInfo().boundingBox.intersectsPoint(resolved.subtract(backward.scale(.12)).add(right.scale(.12*Math.tan(.44)*1.8*x/10)).add(up.scale(.12*Math.tan(.44)*y/10))),false);
 }
 assert.equal(physics.getBodies().length,bodyCount);assert.equal(physics.getBodies()[0],body);assert.deepEqual(floor.getWorldMatrix().asArray(),before.asArray());
 cases.push({name:'physics-preserved-near-plane',bodyCount});
});

test.after(()=>console.log(JSON.stringify({scope:'Independent synthetic native Babylon oracle cases; no provider data or browser FPS claim',cases})));
