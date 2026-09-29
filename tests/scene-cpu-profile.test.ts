import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import HavokPhysics from '@babylonjs/havok';
import {HavokPlugin,MeshBuilder,NullEngine,PhysicsAggregate,PhysicsShapeType,Scene,Vector3,type PhysicsEngineV2} from '@babylonjs/core';
import {SceneCpuProfile} from '../src/core/SceneCpuProfile';

test('native CPU sampling includes every fixed physics substep and keeps held frames at zero',async t=>{
  const wasm=await readFile(new URL('../node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm',import.meta.url));
  const havok=await HavokPhysics({wasmBinary:wasm.buffer.slice(wasm.byteOffset,wasm.byteOffset+wasm.byteLength) as ArrayBuffer});
  const engine=new NullEngine(),scene=new Scene(engine);
  scene.enablePhysics(new Vector3(0,-9.81,0),new HavokPlugin(false,havok));
  (scene.getPhysicsEngine() as PhysicsEngineV2).setSubTimeStep(1000/60);
  const mesh=MeshBuilder.CreateSphere('falling-body',{diameter:1},scene);mesh.position.y=5;
  const body=new PhysicsAggregate(mesh,PhysicsShapeType.SPHERE,{mass:1},scene);
  const observerCount=scene.onAfterPhysicsObservable.observers.length;
  const profile=new SceneCpuProfile(scene);
  let steps=0;
  // Real fixed-step callback work makes individual native counter durations
  // measurable on fast devices. No clock or Babylon counter is mocked.
  const workload=scene.onBeforePhysicsObservable.add(()=>{
    steps++;const until=performance.now()+2;while(performance.now()<until) {}
  });
  t.after(()=>{scene.onBeforePhysicsObservable.remove(workload);profile.dispose();body.dispose();scene.dispose();engine.dispose();});
  profile.beginFrame();scene._advancePhysicsEngineStep(50.001);profile.endFrame(true);
  assert.equal(steps,3,'one rendered interval executes three real native fixed steps');
  const first=profile.snapshot().stages.physicsCpu;
  assert.equal(first.samples,1);assert.ok(first.maxMs!>=5,'profile sums substeps instead of reporting only the final one');
  assert.ok(mesh.position.y<5,'instrumentation leaves the native simulation running');
  profile.beginFrame();profile.endFrame(true);
  const held=profile.snapshot().stages.physicsCpu;
  assert.equal(held.samples,2);assert.equal(held.meanMs,first.maxMs!/2,'no-step held frame has zero CPU rather than stale native time');
  profile.clear();profile.beginFrame();profile.endFrame(true);
  assert.deepEqual(profile.snapshot().stages.physicsCpu,{samples:1,meanMs:0,medianMs:0,p95Ms:0,maxMs:0});
  profile.dispose();
  await new Promise(resolve=>setTimeout(resolve,0)); // Babylon removes observers on the next task.
  assert.equal(scene.onAfterPhysicsObservable.observers.length,observerCount,'profile releases all native and application observers');
});
