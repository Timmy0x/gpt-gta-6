import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import HavokPhysics from '@babylonjs/havok';
import { CharacterSupportedState, DirectionalLight, HavokPlugin, MeshBuilder, NullEngine, PhysicsAggregate, PhysicsCharacterController, PhysicsPrestepType, PhysicsShapeType, Quaternion, Scene, ShadowGenerator, Vector3, type PhysicsEngineV2 } from '@babylonjs/core';
import { WorldBoundary } from '../src/world/WorldBoundary';
import { PolygonGroundCoverage, type GroundPolygon } from '../src/world/PolygonGroundCoverage';
import { protectNpcController } from '../src/gameplay/NpcBoundary';
import { Player } from '../src/gameplay/Player';
import type { Input } from '../src/core/Input';
const outer = [[-100,-100],[100,-100],[100,100],[-100,100]] as const;
const hole = [[0,-30],[12,-30],[12,30],[0,30]] as const;
const polygons: readonly GroundPolygon[] = [[outer,hole]];
const bounds = { minX:-100,maxX:100,minZ:-100,maxZ:100 }, floor=-24;
const coverage = () => new PolygonGroundCoverage(polygons);
const boundary = (c = coverage()) => new WorldBoundary({bounds,floorHeight:()=>floor,fallback:new Vector3(-40,floor+1,0),supportedGround:c});
const bytes = await readFile(new URL('../node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm', import.meta.url));
const havok = await HavokPhysics({wasmBinary:bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer});
function native(gravity=Vector3.Zero(),position=new Vector3(-20,40,0)) {
  const engine=new NullEngine(),scene=new Scene(engine);scene.enablePhysics(gravity,new HavokPlugin(true,havok));
  const physics=scene.getPhysicsEngine() as PhysicsEngineV2;
  const mesh=MeshBuilder.CreateBox('native car footprint',{width:2,height:1,depth:3},scene);mesh.position.copyFrom(position);mesh.rotationQuaternion=Quaternion.RotationYawPitchRoll(.3,.1,-.05);
  const body=new PhysicsAggregate(mesh,PhysicsShapeType.BOX,{mass:1500,restitution:0},scene).body;body.disablePreStep=true;
  const c=coverage(),b=boundary(c);
  return {engine,scene,physics,mesh,body,c,b,dispose(){scene.dispose();engine.dispose();}};
}

test('disk sweep detects sub-centimetre holes, disconnected islands and rounded footprint contacts without path sampling',()=>{
  const c=new PolygonGroundCoverage([[outer,[[0,-50],[.001,-50],[.001,50],[0,50]]]]);
  assert.ok(c.containsDisk(-10,0,.5)&&c.containsDisk(20,0,.5));
  const hit=c.sweep(-10,0,30,0,.5)!;assert.ok(hit);assert.ok(Math.abs(hit.fraction-9.5/30)<1e-8);assert.ok(hit.normalX<-.999);
  assert.ok(Math.abs(c.sweep(-10,0,30,0,0)!.fraction-1/3)<1e-8,'even a zero-radius centre path cannot skip water');
  assert.equal(c.sweep(-10,0,0,20,.5),null,'tangent never approaches the hole');
  const islands=new PolygonGroundCoverage([[[[-20,-10],[-10,-10],[-10,10],[-20,10]]],[[[10,-10],[20,-10],[20,10],[10,10]]]]);
  assert.ok(islands.sweep(-15,0,30,0,1)!.fraction<.14,'another dry island cannot hide unsupported transit');
  const corner=coverage().sweep(-5,34,10,-8,2)!;assert.ok(corner&&corner.normalX<0&&corner.normalZ>0);
});

test('dry guard keeps tangent, vertical motion and immediate inward movement while limiting a whole vehicle footprint',()=>{
  const b=boundary(),p=new Vector3(-4,1500,0),v=new Vector3(200,17,7),limited=b.limitVelocity(p,v,.1,2);
  assert.ok(limited.x>0&&limited.x<3);assert.ok(Math.abs(limited.z-7)<1e-10);assert.equal(limited.y,17);assert.deepEqual(v.asArray(),[200,17,7]);
  assert.deepEqual(b.limitVelocity(p,new Vector3(-20,-4,7),.1,2).asArray(),[-20,-4,7]);
  assert.equal(b.recovery(new Vector3(-20,2500,0)),null);
});

test('radius-valid recovery stays on a nearby supported shore and does not repeat or clamp to Y=0',()=>{
  const b=boundary(),c=coverage();
  for(const p of [new Vector3(1,-24,0),new Vector3(10,-50,0),new Vector3(0,500,29),new Vector3(NaN,NaN,0)]) {
    const recovered=b.recovery(p,1.3,3)!;assert.ok(recovered);assert.ok(c.containsDisk(recovered.position.x,recovered.position.z,3.02));
    assert.equal(b.recovery(recovered.position,1.3,3),null);assert.ok(recovered.position.y>=floor+1.3);
    if(Number.isFinite(p.y)&&p.y<0)assert.ok(recovered.position.y<0);
    if(p.y===500)assert.equal(recovered.position.y,500);
  }
  const left=b.recovery(new Vector3(1,0,0),1,2)!;assert.ok(left.position.x<0&&left.position.x>-3);
});

test('nonrectangular coast and concave holes remain safe under diagonal controls at varied steps',()=>{
  const c=new PolygonGroundCoverage([[[[-100,-100],[100,-100],[100,20],[30,20],[30,100],[-100,100]],[[0,-40],[40,-40],[0,0]]]]),b=boundary(c);
  for(const dt of [1/120,1/30,.1,.5,2]) {
    const p=new Vector3(-20,50,-10);
    for(let i=0;i<300;i++) {
      const old=p.clone(),v=b.limitVelocity(p,new Vector3(200,3,80),dt,2);p.addInPlace(v.scale(dt));
      assert.ok(c.containsDisk(p.x,p.z,2.019),`full disk safe dt=${dt} at ${p.asArray()}`);
      assert.equal(c.sweep(old.x,old.z,p.x-old.x,p.z-old.z,2),null,'whole path supported');assert.equal(b.recovery(p,1,2),null);
    }
    assert.ok(p.y>50);
  }
});

test('native rigid body stays on dry coverage during sustained thrust and high speed without recovery or rotation changes',()=>{
  for(const dt of [1/120,1/30,.1,.5]) {
    const f=native();try {
      f.physics.setTimeStep(dt);const q=f.mesh.rotationQuaternion!.clone();let recoveries=0;f.body.setLinearVelocity(new Vector3(200,4,0));
      for(let i=0;i<Math.ceil(8/dt);i++) {
        f.body.applyForce(new Vector3(60000,0,0),f.mesh.position);if(f.b.beforePhysics(f.body,dt,{radius:2}))recoveries++;f.physics._step(dt);
        if(f.b.afterPhysics(f.body,dt,{radius:2}))recoveries++;assert.ok(f.c.containsDisk(f.mesh.position.x,f.mesh.position.z,2.019));
      }
      assert.equal(recoveries,0);assert.ok(Math.abs(Quaternion.Dot(q,f.mesh.rotationQuaternion!))>.9999);assert.ok(f.mesh.position.y>40);
      const old=f.mesh.position.clone();f.body.setLinearVelocity(new Vector3(-20,4,5));f.b.beforePhysics(f.body,dt,{radius:2});f.physics._step(dt);f.b.afterPhysics(f.body,dt,{radius:2});
      assert.ok(f.mesh.position.x<old.x&&f.mesh.position.z>old.z);
    }finally{f.dispose();}
  }
});

test('solver impulse cannot jump unsupported water even when the end position lands on another dry patch',()=>{
  const f=native(Vector3.Zero(),new Vector3(-5,40,0));try {
    const dt=.1;f.physics.setTimeStep(dt);f.b.beforePhysics(f.body,dt,{radius:2});f.body.applyImpulse(new Vector3(1500*250,0,0),f.mesh.position);f.physics._step(dt);
    assert.ok(f.mesh.position.x>12&&f.c.containsDisk(f.mesh.position.x,f.mesh.position.z,2));
    const recovery=f.b.afterPhysics(f.body,dt,{radius:2});assert.equal(recovery?.reason,'unsupported-ground');assert.ok(f.mesh.position.x<0);
    assert.equal(f.body.getPrestepType(),PhysicsPrestepType.TELEPORT);const p=f.mesh.position.clone();f.b.beforePhysics(f.body,dt,{radius:2});f.physics._step(dt);f.b.afterPhysics(f.body,dt,{radius:2});
    assert.equal(f.body.getPrestepType(),PhysicsPrestepType.DISABLED);assert.ok(Vector3.Distance(f.mesh.position,p)<.001);assert.deepEqual(f.body.getLinearVelocity().asArray(),[0,0,0]);
  }finally{f.dispose();}
});

test('native capsule remains supported beside an actual missing floor and can move along or away from it',()=>{
  const f=native(new Vector3(0,-9.81,0)),ground=MeshBuilder.CreateBox('dry shore only',{width:100,depth:200,height:1},f.scene);ground.position.set(-50,floor-.5,0);
  const groundBody=new PhysicsAggregate(ground,PhysicsShapeType.BOX,{mass:0},f.scene),controller=new PhysicsCharacterController(new Vector3(-4,floor+.94,0),{capsuleHeight:1.2,capsuleRadius:.3},f.scene),dt=1/60;
  try {
    for(let i=0;i<900;i++) {
      const support=controller.checkSupport(dt,Vector3.Down());controller.setVelocity(new Vector3(8,-1,.5));protectNpcController(controller,f.b,dt);
      controller.integrate(dt,support,new Vector3(0,-9.81,0));f.physics._step(dt);protectNpcController(controller,f.b,dt);
      assert.ok(f.c.containsDisk(controller.getPosition().x,controller.getPosition().z,.919));assert.ok(controller.getPosition().y>floor+.2);
    }
    assert.ok(controller.getPosition().z>7);assert.equal(controller.checkSupport(dt,Vector3.Down()).supportedState,CharacterSupportedState.SUPPORTED);
    const p=controller.getPosition().clone();controller.setVelocity(new Vector3(-8,-1,0));protectNpcController(controller,f.b,dt);controller.integrate(dt,controller.checkSupport(dt,Vector3.Down()),new Vector3(0,-9.81,0));f.physics._step(dt);assert.ok(controller.getPosition().x<p.x);
  }finally{controller.dispose();groundBody.dispose();ground.dispose();f.dispose();}
});

test('optional dry guard does not change legacy coast swimming or offshore flight',()=>{
  const b=new WorldBoundary();assert.equal(b.recovery(new Vector3(2050,-10,0)),null);assert.equal(b.recovery(new Vector3(2050,2500,0)),null);
  const v=new Vector3(-20,4,8);assert.deepEqual(b.limitVelocity(new Vector3(2050,2500,0),v,1/60,12).asArray(),v.asArray());
});

test('integrated Player walking and noclip respect source holes and retain a way back inland',()=>{
  const f=native(new Vector3(0,-9.81,0)),ground=MeshBuilder.CreateBox('physical dry side',{width:100,depth:200,height:1},f.scene);ground.position.set(-50,floor-.5,0);
  const groundBody=new PhysicsAggregate(ground,PhysicsShapeType.BOX,{mass:0},f.scene),shadows=new ShadowGenerator(128,new DirectionalLight('sun',Vector3.Down(),f.scene));
  let horizontal=1,ascend=false;
  const input={aim:false,mouseDown:false,dx:0,dy:0,gamepad:null,take:()=>false,down:(key:string)=>key==='sprint'||(ascend&&key==='jump'),axis:(key:string)=>key==='x'?horizontal:0} as unknown as Input;
  const player=new Player(f.scene,shadows,input,new Vector3(-10,floor+.94,0),f.b),dt=1/60;
  try {
    const advance=(count:number)=>{for(let i=0;i<count;i++){player.update(dt);f.physics._step(dt);assert.ok(f.c.containsDisk(player.position.x,player.position.z,.359));}};
    advance(600);assert.ok(player.position.x>-.5&&player.position.x<-.35);assert.ok(player.position.y>floor+.5);
    player.noclip=true;ascend=true;advance(180);assert.ok(player.position.y>floor+50);
    horizontal=-1;ascend=false;advance(90);assert.ok(player.position.x<-20,'normal input returns inland');
    player.teleport(new Vector3(2,floor+.94,0));horizontal=0;advance(1);assert.ok(player.position.x<0,'unsupported save recovers to dry source coverage');
  }finally{player.controller.dispose();player.queries.dispose();player.model.dispose();shadows.dispose();groundBody.dispose();ground.dispose();f.dispose();}
});
