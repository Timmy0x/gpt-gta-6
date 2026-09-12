import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import HavokPhysics from '@babylonjs/havok';
import { DirectionalLight, HavokPlugin, MeshBuilder, NullEngine, PhysicsAggregate, PhysicsShapeType, Scene, ShadowGenerator, Vector3, type PhysicsEngineV2 } from '@babylonjs/core';
import { VehicleSystem } from '../src/vehicles/VehicleSystem';
import { Character } from '../src/gameplay/Character';
import { RagdollReactions } from '../src/gameplay/combat/RagdollReactions';
import { restoreCorpse, snapshotCasualty } from '../src/gameplay/police/casualties';

const bytes = await readFile(new URL('../node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm', import.meta.url));
const havok = await HavokPhysics({ wasmBinary: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer });
function native() {
  const engine = new NullEngine(), scene = new Scene(engine);
  scene.enablePhysics(new Vector3(0, -9.81, 0), new HavokPlugin(false, havok));
  const physics = scene.getPhysicsEngine() as PhysicsEngineV2;
  const shadows = new ShadowGenerator(128, new DirectionalLight('negative-height-light', Vector3.Down(), scene));
  const vehicles = new VehicleSystem({ scene, shadows }), reactions = new RagdollReactions(scene);
  function ground(y: number) {
    const mesh = MeshBuilder.CreateBox('native-negative-ground', { width: 60, height: 1, depth: 60 }, scene);
    mesh.position.y = y - .5;
    return new PhysicsAggregate(mesh, PhysicsShapeType.BOX, { mass: 0, friction: .8 }, scene);
  }
  return { scene, physics, shadows, vehicles, reactions, ground, dispose() { reactions.dispose(); scene.dispose(); engine.dispose(); } };
}

test('native vehicle recovery uses negative support and returns a settled car without jumping to Y=0', () => {
  const h = native();
  try {
    h.ground(-40);
    const car = h.vehicles.spawn('coupe', new Vector3(0, -38.5, 0));
    car.health = 30;
    assert.equal(h.vehicles.recover(car), true);
    assert.ok(Math.abs(car.root.position.y - (-38.95)) < .002);
    assert.equal(car.health, 100);
    for (let i = 0; i < 180; i++) { h.vehicles.update(1 / 60); h.physics._step(1 / 60); }
    assert.equal(car.grounded, 4);
    assert.ok(car.root.position.y > -39.6 && car.root.position.y < -39.0, `actual settled height ${car.root.position.y}`);
    const saved = h.vehicles.serialize(car);
    assert.ok(saved.y < -39); assert.equal(saved.health, 100);
    const position = car.root.position.clone(); h.vehicles.remove(car);
    const restored = h.vehicles.restore(saved);
    assert.ok(Vector3.Distance(restored.root.position, position) < 1e-5);
  } finally { h.dispose(); }
});

test('missing native vehicle support repairs damage but preserves pose/motion, then allows recovery after support arrives', () => {
  const h = native();
  try {
    const car = h.vehicles.spawn('coupe', new Vector3(0, -39, 0));
    car.health = 22; car.body.setLinearVelocity(new Vector3(1, -2, 3)); car.body.setAngularVelocity(new Vector3(.1, .2, .3));
    const position = car.root.position.clone(), rotation = car.root.rotationQuaternion!.clone();
    const velocity = car.body.getLinearVelocity(), angular = car.body.getAngularVelocity();
    assert.equal(h.vehicles.recover(car), false);
    assert.equal(car.health, 100); assert.ok(car.root.position.equals(position)); assert.ok(car.root.rotationQuaternion!.equals(rotation));
    assert.ok(Vector3.Distance(car.body.getLinearVelocity(), velocity) < 1e-6); assert.ok(Vector3.Distance(car.body.getAngularVelocity(), angular) < 1e-6);
    h.ground(-40); assert.equal(h.vehicles.recover(car), true); assert.ok(car.root.position.y < -38);
    assert.ok(car.body.getLinearVelocity().length() < 1e-6);
  } finally { h.dispose(); }
});

test('legacy fatal and nonfatal casualties preserve saved negative roots and native ground-relative recovery', () => {
  const h = native();
  try {
    h.ground(-40);
    const dead = new Character(h.scene, h.shadows, 'negative-dead');
    restoreCorpse(dead, { id: 'negative-dead', x: 5, y: -39.65, z: 0, yaw: .3 });
    assert.equal(dead.root.position.y, -39.65); assert.equal(dead.dead, true);
    const saved = snapshotCasualty('negative-dead', dead, 0);
    const restored = new Character(h.scene, h.shadows, 'negative-dead-restored'); restoreCorpse(restored, saved);
    assert.equal(restored.dead, true); assert.equal(restored.root.position.y, saved.y);
    const alive = new Character(h.scene, h.shadows, 'negative-survivor');
    restoreCorpse(alive, { id: 'negative-survivor', x: 0, y: -39.65, z: 0, yaw: 0, health: 75, kind: 'melee', recoverySeconds: 0 });
    assert.equal(alive.root.position.y, -39.65); assert.equal(alive.dead, false);
    h.reactions.restore(alive); h.reactions.update(1 / 60);
    assert.equal(alive.root.metadata.ragdollRecovering, true);
    assert.ok(Math.abs(alive.root.position.y - (-39.985)) < .002);
    for (let i = 0; i < 150; i++) { h.physics._step(1 / 60); h.reactions.update(1 / 60); }
    assert.equal(alive.injury, null); assert.equal(alive.dead, false); assert.ok(alive.root.position.y < -39);
    assert.equal(dead.dead, true); assert.equal(dead.root.position.y, -39.65);
  } finally { h.dispose(); }
});

test('saved survivor waits in its negative-height down pose when native support is missing', () => {
  const h = native();
  try {
    const actor = new Character(h.scene, h.shadows, 'unsupported-survivor');
    restoreCorpse(actor, { id: 'unsupported-survivor', x: 0, y: -39.65, z: 0, yaw: 0, health: 75, kind: 'melee', recoverySeconds: 0 });
    h.reactions.restore(actor);
    const position = actor.root.position.clone(), pose = snapshotCasualty('unsupported-survivor', actor, 75).pose;
    for (let i = 0; i < 60; i++) h.reactions.update(1 / 60);
    assert.ok(actor.root.position.equals(position)); assert.equal(actor.root.metadata.ragdollRecovering, false);
    assert.deepEqual(snapshotCasualty('unsupported-survivor', actor, 75).pose, pose);
    assert.ok(actor.injury); assert.equal(actor.dead, false);
    h.ground(-40); h.reactions.update(1 / 60);
    assert.equal(actor.root.metadata.ragdollRecovering, true); assert.ok(actor.root.position.y < -39);
  } finally { h.dispose(); }
});
