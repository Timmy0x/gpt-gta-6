import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { HavokPlugin, NullEngine, Scene, Vector3, type PhysicsEngineV2 } from '@babylonjs/core';
import HavokPhysics from '@babylonjs/havok';
import { createProofPhysics, PROOF } from '../src/ProofPhysics';

test('original Havok floor supports capsule and ball, obstacle stops walking, reset is physical', async () => {
  const bytes = await readFile(new URL('../node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm', import.meta.url));
  const havok = await HavokPhysics({ wasmBinary: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer });
  const engine = new NullEngine();
  const scene = new Scene(engine);
  scene.enablePhysics(new Vector3(0, -9.81, 0), new HavokPlugin(false, havok));
  const physics = scene.getPhysicsEngine() as PhysicsEngineV2;
  const proof = createProofPhysics(scene);
  const step = (frames: number) => {
    for (let i = 0; i < frames; i++) {
      scene.onBeforePhysicsObservable.notifyObservers(scene);
      physics._step(1 / 60);
      scene.onAfterPhysicsObservable.notifyObservers(scene);
    }
  };
  try {
    step(240);
    assert.ok(Math.abs(proof.walker.position.y - (PROOF.floorTop + .9)) < .04);
    assert.ok(Math.abs(proof.ball.position.y - (PROOF.floorTop + .325)) < .04);
    proof.setWalking(true);
    proof.setInput(0, 1);
    step(150);
    assert.ok(proof.walker.position.z > 4 && proof.walker.position.z < 4.23, `wall stop z=${proof.walker.position.z}`);
    assert.ok(proof.walker.position.y > PROOF.floorTop + .85, 'supported at obstacle');
    proof.setWalking(false);
    proof.resetWalker();
    proof.dropBall();
    step(1);
    assert.ok(Vector3.Distance(proof.walker.position, PROOF.walkerStart) < .03);
    assert.ok(proof.ball.position.y > 11.9);
    step(180);
    assert.ok(Math.abs(proof.ball.position.y - (PROOF.floorTop + .325)) < .04);
    proof.setWalking(true);
    proof.setInput(-1, 0);
    const before = proof.walker.position.clone();
    step(60);
    assert.ok(Math.abs(before.x - proof.walker.position.x - 2.7) < .06, 'walking speed remains metres per second');
  } finally { proof.dispose(); scene.dispose(); engine.dispose(); }
});
