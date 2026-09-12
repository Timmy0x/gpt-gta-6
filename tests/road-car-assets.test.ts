import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DirectionalLight, HavokPlugin, MeshBuilder, NullEngine, PhysicsAggregate, PhysicsMotionType, PhysicsShapeContainer, PhysicsShapeType, Scene, ShadowGenerator, Vector3, VertexBuffer, type PhysicsEngineV2 } from '@babylonjs/core';
import HavokPhysics from '@babylonjs/havok';
import { RoadCarAssets } from '../src/vehicles/RoadCarAssets';
import { ROAD_CARS, ROAD_CAR_KINDS, type RoadCarKind } from '../src/vehicles/RoadCarCatalog';
import { VehicleSystem } from '../src/vehicles/VehicleSystem';

async function fixture() {
  const engine=new NullEngine(),scene=new Scene(engine),shadows=new ShadowGenerator(128,new DirectionalLight('sun',new Vector3(0,-1,0),scene));
  const sources:Partial<Record<RoadCarKind,Uint8Array>>={};
  for(const kind of ROAD_CAR_KINDS)sources[kind]=new Uint8Array(await readFile(new URL(`../public/vehicles/carla/${ROAD_CARS[kind].file}`,import.meta.url)));
  const assets=new RoadCarAssets({scene,shadows},sources,true);
  return {engine,scene,assets,shadows,sources,dispose(){assets.dispose();scene.dispose();engine.dispose();}};
}

test('ten licensed bodies load with actual cabin geometry, four neutral wheel pivots and independently opening doors',async context=>{
  const f=await fixture();
  try {
    assert.equal(new Set(Object.values(ROAD_CARS).map(d=>d.hash)).size,10);
    for(const [i,kind]of ROAD_CAR_KINDS.entries()){
      await f.assets.prepare(kind);const model=f.assets.create(kind,i+1),definition=ROAD_CARS[kind];
      assert.equal(model.wheels.length,4,kind);assert.ok(model.doors.length>=2,kind);assert.ok(model.panels.length>0,`${kind}: deformable body surfaces`);assert.ok(model.windows.length>0,`${kind}: source glazing`);
      assert.ok(model.lights.some(lamp=>lamp.name.startsWith('headlight-')),`${kind}: actual front lamp geometry drives headlights`);
      if(kind==='police'){
        assert.ok(model.lights.some(lamp=>lamp.name.includes('police-red')));
        assert.ok(model.lights.some(lamp=>lamp.name.includes('police-blue')));
      }
      const bounds=model.root.getHierarchyBoundingVectors(true);assert.ok(bounds.max.z-bounds.min.z>3.5&&bounds.max.z-bounds.min.z<7,`${kind}: measured scale`);
      assert.ok(model.seat!.x<0&&model.seat!.y<bounds.max.y-1.2,`${kind}: driver pose fits below roof`);
      assert.equal(model.seatPose,definition.seatPose);
      for(const wheel of model.wheels){const b=wheel.pivot.getHierarchyBoundingVectors(true),size=b.max.subtract(b.min);assert.ok(size.x<.65&&size.y>.55&&size.z>.55,`${kind}: wheel axle frame ${size}`);}
      for(const door of model.doors){
        door.mesh.computeWorldMatrix(true);const before=door.mesh.getBoundingInfo().boundingBox.centerWorld.clone();door.mesh.rotation.y=-door.side*.7;door.mesh.computeWorldMatrix(true);const after=door.mesh.getBoundingInfo().boundingBox.centerWorld;
        assert.ok((after.x-before.x)*door.side>.12,`${kind}: source skin swings outward at its hinge`);door.mesh.rotation.y=0;
      }
      for(const pane of model.windows){pane.computeWorldMatrix(true);assert.ok(Vector3.Distance(pane.getAbsolutePosition(),pane.getBoundingInfo().boundingBox.centerWorld)<1e-5,`${kind}: window impact origin sits on the actual pane`);}
      context.diagnostic(`${kind}: ${definition.triangles} triangles, ${model.doors.length} working doors, ${model.windows.length} glazing components.`);
      model.root.dispose();for(const material of model.materials)material.dispose();
    }
  }finally{f.dispose();}
});

test('ten source cars support their weight, drive on native suspension and retain damage through save/load',async context=>{
  const f=await fixture();
  const wasm=await readFile(new URL('../node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm',import.meta.url));
  const havok=await HavokPhysics({wasmBinary:wasm.buffer.slice(wasm.byteOffset,wasm.byteOffset+wasm.byteLength) as ArrayBuffer});
  f.scene.enablePhysics(new Vector3(0,-9.81,0),new HavokPlugin(true,havok));
  const physics=f.scene.getPhysicsEngine() as PhysicsEngineV2;
  const ground=MeshBuilder.CreateBox('ground',{width:400,depth:400,height:1},f.scene);ground.position.y=-.5;
  const floor=new PhysicsAggregate(ground,PhysicsShapeType.BOX,{mass:0,friction:.7},f.scene);
  const system=new VehicleSystem({scene:f.scene,shadows:f.shadows},undefined,true,f.sources);
  const step=(count:number)=>{for(let i=0;i<count;i++){system.update(1/60);physics._step(1/60);}};
  try{
    const legacy=system.spawn('sedan',new Vector3(60,1,0));
    system.damage(legacy,35,new Vector3(60,1,2));
    legacy.model.wheels.find(w=>w.front&&w.local.x<0)!.damaged=true;
    legacy.model.doors.find(d=>d.front&&d.side===-1)!.mesh.setEnabled(false);
    const legacySave=system.serialize(legacy);system.remove(legacy);
    for(const kind of ROAD_CAR_KINDS){
      await system.prepareModel(kind);
      if(kind==='hatchback'){
        // Captured from the shipped 4cf3e2e030e5 source before its paint repair.
        const saved=JSON.parse(await readFile(new URL('./fixtures/mini-before-fender-repair.json',import.meta.url),'utf8'));
        assert.notEqual(ROAD_CARS.hatchback.hash.slice(0,12),'4cf3e2e030e5','fixture exercises the earlier source body');
        const migrated=system.restore(saved);
        assert.deepEqual(system.serialize(migrated).damage,saved.damage,'source paint repair preserves existing dents, punctures, glazing, lamps and missing door');
        system.remove(migrated);
      }
      if(kind==='sedan'){
        const migrated=system.restore(legacySave);
        assert.equal(migrated.health,legacySave.health);
        assert.equal(migrated.model.wheels.find(w=>w.front&&w.local.x<0)!.damaged,true,'legacy tire maps by physical side and axle, not incompatible component index');
        assert.equal(migrated.model.doors.find(d=>d.front&&d.side===-1)!.mesh.isEnabled(),false,'legacy driver door stays missing');
        assert.ok(migrated.model.windows.some(m=>!m.isEnabled()),'legacy broken glazing stays broken');
        assert.ok(migrated.model.deformation!.serialize().some(n=>n!==0),'old vertex dents transfer to a local source-body deformation');
        const invalid=structuredClone(legacySave);invalid.damage.panels[0].vertices.splice(-3);
        assert.throws(()=>system.restore(invalid),/topology|layout/,'invalid legacy geometry cannot replace an existing car');
        assert.equal(system.list.find(c=>c.id===migrated.id),migrated);
        system.remove(migrated);
      }
      const car=system.spawn(kind,new Vector3(0,1.4,0));
      assert.equal(car.root.metadata.sourceModel,ROAD_CARS[kind].source);
      step(180);
      assert.equal(car.grounded,4,`${kind}: four supported tires`);
      assert.ok(car.root.position.y>.3&&car.root.position.y<1.5,`${kind}: chassis settles at ${car.root.position.y}`);
      const atRest=car.root.position.clone();
      car.input.throttle=1;step(150);
      assert.ok(car.root.position.z-atRest.z>5,`${kind}: sustained tire propulsion ${car.root.position.z-atRest.z}`);
      assert.ok(Math.abs(car.root.position.x)<.35,`${kind}: no axle asymmetry ${car.root.position.x}`);
      car.input.throttle=0;car.input.brake=1;step(120);
      assert.ok(car.speed<1,`${kind}: brakes stop the actual body ${car.speed}`);
      car.body.setMotionType(PhysicsMotionType.STATIC);
      const door=car.model.doors.find(d=>d.front&&d.side===-1)!;
      door.hold=1;for(let i=0;i<20;i++)system.equipment.update(1/60,[car],car.root.position);
      step(1);
      assert.ok(door.angle>.65,`${kind}: unblocked entry door opens ${door.angle}`);
      const point=door.mesh.getBoundingInfo().boundingBox.centerWorld.clone();
      const normal=door.mesh.getDirection(Vector3.Right());
      assert.equal(physics.raycast(point.subtract(normal.scale(.4)),point.add(normal.scale(.05))).body,car.body,`${kind}: open panel has native collision`);
      const members=(car.body.shape as PhysicsShapeContainer).getNumChildren();
      const healthBefore=car.health;
      system.damage(car,40,point);
      assert.equal(door.mesh.isEnabled(),false,`${kind}: struck door detaches`);
      assert.ok((car.body.shape as PhysicsShapeContainer).getNumChildren()<members,`${kind}: detached door removes attached collision`);
      const saved=system.serialize(car), restored=system.restore(saved);
      assert.equal(restored.health,healthBefore-40);assert.deepEqual(system.serialize(restored).damage,saved.damage,`${kind}: component damage round trip`);
      context.diagnostic(`${kind}: settle ${atRest.y.toFixed(3)}m, moved ${(car.root.position.z-atRest.z).toFixed(2)}m, native shape children ${members}.`);
      system.remove(restored);
      assert.equal(physics.getBodies().length,1,`${kind}: removing the car and its debris releases all bodies`);
    }
  }finally{system.dispose();floor.dispose();f.dispose();}
});

test('a long van uses measured deformation bounds and independent source window panes',async()=>{
  const f=await fixture();
  try{
    await f.assets.prepare('van');const car=f.assets.create('van',1);
    const surfaces=car.panels.map(mesh=>({mesh,before:Array.from(mesh.getVerticesData(VertexBuffer.PositionKind)!)}));
    car.deformation!.damage(32,new Vector3(0,0,ROAD_CARS.van.bounds.max[2]));
    assert.ok(surfaces.some(({mesh,before})=>Array.from(mesh.getVerticesData(VertexBuffer.PositionKind)!).some((n,i)=>Math.abs(n-before[i])>.01)),'front beyond the old fixed concept grid takes visible damage');
    assert.ok(car.windows.length>=4,'windshield and driver/passenger panes are separate');
    const first=car.windows[0];first.setEnabled(false);assert.ok(car.windows.slice(1).some(m=>m.isEnabled()),'one pane can break independently');
  }finally{f.dispose();}
});

test('imported body dents are independent of another car and reset to original authored geometry',async()=>{
  const f=await fixture();
  try{
    await f.assets.prepare('hatchback');const a=f.assets.create('hatchback',1),b=f.assets.create('hatchback',2);
    const before=Array.from(a.panels[0].getVerticesData(VertexBuffer.PositionKind)!),normals=Array.from(a.panels[0].getVerticesData(VertexBuffer.NormalKind)!);a.deformation!.damage(24,new Vector3(0,0,1.5));
    assert.notDeepEqual(Array.from(a.panels[0].getVerticesData(VertexBuffer.PositionKind)!),before);assert.deepEqual(Array.from(b.panels[0].getVerticesData(VertexBuffer.PositionKind)!),before);
    a.deformation!.reset();const reset=Array.from(a.panels[0].getVerticesData(VertexBuffer.PositionKind)!);assert.ok(reset.every((n,i)=>Math.abs(n-before[i])<1e-5));
    assert.deepEqual(Array.from(a.panels[0].getVerticesData(VertexBuffer.NormalKind)!),normals,'repair restores the original smooth paint normals exactly');
  }finally{f.dispose();}
});
