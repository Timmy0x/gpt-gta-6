import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import HavokPhysics from '@babylonjs/havok';
import { DirectionalLight, HavokPlugin, MeshBuilder, NullEngine, PhysicsAggregate, PhysicsShapeType, Scene, ShadowGenerator, Vector3, type PhysicsEngineV2 } from '@babylonjs/core';
import { VehicleSystem } from '../src/vehicles/VehicleSystem';

const bytes=await readFile(new URL('../node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm',import.meta.url));
const havok=await HavokPhysics({wasmBinary:bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer});

for(const direction of [-1,1] as const)test(`Havok trainer ${direction>0?'right':'left'} turn banks lift into the commanded turn after physical takeoff`,context=>{
  const engine=new NullEngine(),scene=new Scene(engine);scene.enablePhysics(new Vector3(0,-9.81,0),new HavokPlugin(true,havok));
  const physics=scene.getPhysicsEngine() as PhysicsEngineV2,shadows=new ShadowGenerator(64,new DirectionalLight('sun',new Vector3(0,-1,0),scene));
  const ground=MeshBuilder.CreateBox('unbroken-runway',{width:5000,depth:5000,height:1},scene);ground.position.y=-.5;new PhysicsAggregate(ground,PhysicsShapeType.BOX,{mass:0},scene);
  const system=new VehicleSystem({scene,shadows}),plane=system.spawn('plane',new Vector3(0,.95,-700));plane.occupied=true;
  const step=(count:number)=>{for(let i=0;i<count;i++){system.update(1/60);physics._step(1/60);}};
  try {
    step(90);system.control(plane,{throttle:1,steer:0,brake:0,handbrake:false,lift:0});step(600);
    assert.ok(plane.speed>25,`physical runway acceleration: ${plane.speed}`);
    system.control(plane,{throttle:1,steer:0,brake:0,handbrake:false,lift:1});step(480);
    assert.equal(plane.grounded,0);assert.ok(plane.root.position.y>8,'aerodynamic takeoff completed without teleport/velocity seeding');
    const startAltitude=plane.root.position.y,startHeading=plane.heading,startVelocity=plane.body.getLinearVelocity(),startRight=plane.root.right.clone();
    system.control(plane,{throttle:1,steer:direction,brake:0,handbrake:false,lift:1});
    let signedBankSum=0,signedAccelerationSum=0,minAltitude=startAltitude,previousVelocity=startVelocity;
    for(let frame=0;frame<240;frame++){
      step(1);const currentVelocity=plane.body.getLinearVelocity();minAltitude=Math.min(minAltitude,plane.root.position.y);
      // Ignore the first second of roll/yaw response, then observe world lift direction relative to the current horizontal right vector.
      if(frame>=60){const headingRight=new Vector3(Math.cos(plane.heading),0,-Math.sin(plane.heading));signedBankSum+=direction*Vector3.Dot(plane.root.up,headingRight);signedAccelerationSum+=direction*Vector3.Dot(currentVelocity.subtract(previousVelocity).scale(60),headingRight);}
      previousVelocity=currentVelocity;
    }
    const headingChange=Math.atan2(Math.sin(plane.heading-startHeading),Math.cos(plane.heading-startHeading)),meanSignedBank=signedBankSum/180,meanSignedLateralAcceleration=signedAccelerationSum/180;
    context.diagnostic(JSON.stringify({direction,runwayTakeoffAltitude:startAltitude,endAltitude:plane.root.position.y,minAltitude,headingChange,meanSignedBank,meanSignedLateralAcceleration,startRight:startRight.asArray(),endVelocity:plane.body.getLinearVelocity().asArray(),health:plane.health}));
    assert.ok(direction*headingChange>.1,'heading responds in the requested direction');
    assert.ok(meanSignedBank>.03,`lift vector must bank toward turn, not away: ${meanSignedBank}`);
    assert.ok(meanSignedLateralAcceleration>.1,`lateral acceleration must follow commanded turn: ${meanSignedLateralAcceleration}`);
    assert.ok(minAltitude>startAltitude*.45,'a four-second commanded turn must not erase more than55% of the established flight altitude');
    assert.equal(plane.health,100,'turn over continuous clear ground does not collide');
  }finally{system.dispose();scene.dispose();engine.dispose();}
});
