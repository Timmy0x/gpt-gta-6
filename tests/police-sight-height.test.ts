import test from 'node:test';
import assert from 'node:assert/strict';
import {clearSight} from '../src/gameplay/police/rules';
import type {Obstacle} from '../src/core/contracts';

test('building sight occlusion is invariant under negative and elevated world frames',()=>{
  const wall:Obstacle={x:0,z:0,w:6,d:10,height:12};
  for(const offset of [0,-24.5,82]){
    const obstacle={...wall,baseY:offset};
    assert.equal(clearSight({x:-10,y:offset+1.6,z:0},{x:10,y:offset+1.6,z:0},[obstacle]),false);
    assert.equal(clearSight({x:-10,y:offset+14,z:0},{x:10,y:offset+14,z:0},[obstacle]),true);
    assert.equal(clearSight({x:-10,y:offset-2,z:0},{x:10,y:offset-2,z:0},[obstacle]),true);
    assert.equal(clearSight({x:-10,y:offset+1.6,z:8},{x:10,y:offset+1.6,z:8},[obstacle]),true);
    assert.equal(clearSight({x:-10,y:offset+2,z:0},{x:10,y:offset+18,z:0},[obstacle]),false);
  }
  assert.equal(clearSight({x:-10,y:1.6,z:0},{x:10,y:1.6,z:0},[wall]),false,'legacy obstacles retain zero base');
});

import {readFile} from 'node:fs/promises';
import HavokPhysics from '@babylonjs/havok';
import {HavokPlugin,MeshBuilder,NullEngine,PhysicsAggregate,PhysicsRaycastResult,PhysicsShapeType,Scene,Vector3,type PhysicsEngineV2} from '@babylonjs/core';

test('translated building visibility agrees with real Havok ray obstruction',async t=>{
  const wasm=await readFile(new URL('../node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm',import.meta.url));
  const havok=await HavokPhysics({wasmBinary:wasm.buffer.slice(wasm.byteOffset,wasm.byteOffset+wasm.byteLength) as ArrayBuffer});
  const engine=new NullEngine(),scene=new Scene(engine);
  scene.enablePhysics(new Vector3(0,-9.81,0),new HavokPlugin(false,havok));
  t.after(()=>{scene.dispose();engine.dispose();});
  const physics=scene.getPhysicsEngine() as PhysicsEngineV2,result=new PhysicsRaycastResult();
  for(const baseY of [-24.5,0,82]){
    const mesh=MeshBuilder.CreateBox('source-building',{width:6,depth:10,height:12},scene);
    mesh.position.y=baseY+6;mesh.computeWorldMatrix(true);
    const aggregate=new PhysicsAggregate(mesh,PhysicsShapeType.BOX,{mass:0},scene);
    const obstacle:Obstacle={x:0,z:0,w:6,d:10,height:12,baseY};
    for(const [from,to] of [
      [[-10,1.6,0],[10,1.6,0]],
      [[-10,14,0],[10,14,0]],
      [[-10,-2,0],[10,-2,0]],
      [[-10,1.6,8],[10,1.6,8]],
      [[-10,2,0],[10,18,0]],
      [[-10,18,0],[10,2,0]],
    ]){
      const a=new Vector3(from[0],baseY+from[1],from[2]),b=new Vector3(to[0],baseY+to[1],to[2]);
      physics.raycastToRef(a,b,result,{shouldHitTriggers:false});
      assert.equal(clearSight(a,b,[obstacle]),!result.hasHit,`native sight at base ${baseY}: ${a.asArray()} → ${b.asArray()}`);
    }
    aggregate.dispose();mesh.dispose();
  }
});
