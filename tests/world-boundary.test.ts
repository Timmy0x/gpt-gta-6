import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import HavokPhysics from '@babylonjs/havok';
import {
  DirectionalLight, HavokPlugin, MeshBuilder, NullEngine, PhysicsAggregate, PhysicsCharacterController,
  PhysicsPrestepType, PhysicsShapeType, Quaternion, Scene, ShadowGenerator, Vector3, type PhysicsEngineV2,
} from '@babylonjs/core';
import { WorldBoundary } from '../src/world/WorldBoundary';
import { COAST } from '../src/world/Coast';
import { Player } from '../src/gameplay/Player';
import type { Input } from '../src/core/Input';

const bounds = { minX: -300, maxX: 300, minZ: -300, maxZ: 300 };
async function fixture(gravity = Vector3.Zero(), position = new Vector3(0, 100, 0)) {
  const bytes = await readFile(new URL('../node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm', import.meta.url));
  const havok = await HavokPhysics({ wasmBinary: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer });
  const engine = new NullEngine(), scene = new Scene(engine);
  // Use the actual requested step duration in the variable-step safety cases.
  scene.enablePhysics(gravity, new HavokPlugin(true, havok));
  const physics = scene.getPhysicsEngine() as PhysicsEngineV2;
  const boundary = new WorldBoundary({ bounds, floorHeight: () => 0 });
  const mesh = MeshBuilder.CreateBox('test vehicle', { width: 4, height: 2, depth: 6 }, scene);
  mesh.position.copyFrom(position);
  mesh.rotationQuaternion = Quaternion.RotationYawPitchRoll(.43, .12, -.07);
  const aggregate = new PhysicsAggregate(mesh, PhysicsShapeType.BOX, { mass: 1500, restitution: 0 }, scene);
  aggregate.body.disablePreStep = true;
  return { scene, engine, physics, boundary, mesh, body: aggregate.body, dispose() { aggregate.dispose(); mesh.dispose(); scene.dispose(); engine.dispose(); } };
}

test('boundary limits only outward motion and accounts for footprint, altitude and long steps', () => {
  const b = new WorldBoundary({ bounds, floorHeight: () => 0 });
  const inner = new Vector3(0, 1500, 0), velocity = new Vector3(10, 17, -12);
  assert.deepEqual(b.limitVelocity(inner, velocity, 1 / 60).asArray(), velocity.asArray());
  assert.deepEqual(velocity.asArray(), [10, 17, -12], 'input is not mutated');
  const edge = new Vector3(285, 1500, 0), approaching = b.limitVelocity(edge, new Vector3(200, 17, 7), .5, 12);
  assert.ok(approaching.x > 0 && approaching.x < 6);
  assert.equal(approaching.y, 17, 'no altitude ceiling'); assert.equal(approaching.z, 7, 'tangential motion preserved');
  assert.equal(b.limitVelocity(edge, new Vector3(-100, -4, 7), .5, 12).x, -100, 'inward movement is immediately available');
  assert.ok(edge.x + approaching.x * .5 + 12 <= bounds.maxX, 'entire aircraft footprint stays inside');
  assert.deepEqual(b.limitVelocity(edge, new Vector3(NaN, Infinity, 7), .1).asArray(), [0, 0, 7]);
  for (const dt of [1 / 120, 1 / 30, .25, 2]) {
    const position = new Vector3(280, 3, 280);
    for (let i = 0; i < 100; i++) {
      // Noclip's actual displacement velocity, not its pre-multiplier walk speed.
      position.addInPlace(b.limitVelocity(position, new Vector3(36, 12, 36), dt).scale(dt));
      assert.ok(position.x <= 299.5 && position.z <= 299.5);
    }
    assert.ok(position.y > 3, 'noclip vertical motion is preserved');
  }
});

test('recovery recognizes actual seabed, safe high-altitude flight and old or corrupt saves', () => {
  const b = new WorldBoundary();
  for (const p of [new Vector3(2050, -10, 0), new Vector3(240, -2, 0), new Vector3(0, 2500, 0), new Vector3(0, -7, 0)])
    assert.equal(b.recovery(p), null, `no false recovery at ${p.asArray()}`);
  const sunk = b.recovery(new Vector3(2050, -18, 0), 1.4);
  assert.equal(sunk?.reason, 'below-floor'); assert.ok(Math.abs(sunk!.position.y - (-9.23 + 1.4)) < 1e-8);
  const outside = b.recovery(new Vector3(9000, 600, -7000), 2, 12)!;
  assert.equal(outside.reason, 'outside'); assert.equal(outside.position.y, 600);
  assert.ok(outside.position.x + 12 < COAST.maxX && outside.position.z - 12 > COAST.minZ);
  const invalid = b.recovery(new Vector3(NaN, Infinity, 0))!;
  assert.equal(invalid.reason, 'nonfinite'); assert.deepEqual(invalid.position.asArray(), [6, 1.2, -28]);
});

test('actual Havok bodies remain inside under sustained thrust, 200 m/s motion, corners and varied requested steps', async t => {
  for (const dt of [1 / 120, 1 / 60, .1, .5]) {
    const f = await fixture(); t.after(() => f.dispose());
    f.physics.setTimeStep(dt);
    f.body.setLinearVelocity(new Vector3(200, 4, 180));
    const radius = 12, rotation = f.mesh.rotationQuaternion!.clone();
    let recoveries = 0;
    for (let i = 0; i < Math.ceil(16 / dt); i++) {
      // Babylon 9.25 Havok applyForce uses an immediate timestep-scaled impulse;
      // the guard is intentionally called after this control force.
      f.body.applyForce(new Vector3(60000, 0, 50000), f.mesh.position);
      if (f.boundary.beforePhysics(f.body, dt, { radius })) recoveries++;
      // PhysicsEngineV2 clamps requested steps above .1s. Keep .5 here as the
      // defensive caller case; it does not claim a .5s Havok solver step.
      f.physics._step(dt);
      if (f.boundary.afterPhysics(f.body, dt, { radius })) recoveries++;
      assert.ok(f.mesh.position.x + radius <= bounds.maxX + 1e-4 && f.mesh.position.z + radius <= bounds.maxZ + 1e-4,
        `actual body/footprint within boundary: dt=${dt} position=${f.mesh.position.asArray()}`);
      assert.ok(f.mesh.position.y > 99, 'aircraft altitude is not clamped');
    }
    assert.equal(recoveries, 0, 'ordinary sustained outward controls need no positional recovery');
    assert.ok(Math.abs(Quaternion.Dot(rotation, f.mesh.rotationQuaternion!)) > .9999, 'heading/rotation is untouched');
    f.body.setLinearVelocity(new Vector3(-40, 4, -30));
    const position = f.mesh.position.clone();
    f.boundary.beforePhysics(f.body, dt, { radius }); f.physics._step(dt); f.boundary.afterPhysics(f.body, dt, { radius });
    assert.ok(f.mesh.position.x < position.x && f.mesh.position.z < position.z, 'driver can turn back immediately');
    assert.ok(Math.abs(f.body.getLinearVelocity().y - 4) < .01, 'vertical flight velocity preserved');
  }
});

test('post-step impulse recovery is consumed by Havok before restoring exact prestep mode', async t => {
  const f = await fixture(Vector3.Zero(), new Vector3(290, 100, 0)); t.after(() => f.dispose());
  const dt = .1; f.physics.setTimeStep(dt);
  const rotation = f.mesh.rotationQuaternion!.clone();
  f.boundary.beforePhysics(f.body, dt, { radius: 4 });
  // A solver/collision impulse after the pre-step guard can still cross a boundary.
  f.body.applyImpulse(new Vector3(1500 * 5000, 0, 0), f.mesh.position);
  f.physics._step(dt);
  assert.ok(f.mesh.position.x > bounds.maxX, 'fixture actually crosses the edge');
  const recovery = f.boundary.afterPhysics(f.body, dt, { radius: 4 });
  assert.equal(recovery?.reason, 'outside');
  assert.equal(f.body.getPrestepType(), PhysicsPrestepType.TELEPORT, 'queued recovery must survive until next Havok step');
  assert.ok(f.mesh.position.x <= 296);
  const recovered = f.mesh.position.clone();
  f.boundary.beforePhysics(f.body, dt, { radius: 4 });
  assert.equal(f.body.getPrestepType(), PhysicsPrestepType.TELEPORT);
  f.physics._step(dt); f.boundary.afterPhysics(f.body, dt, { radius: 4 });
  assert.equal(f.body.getPrestepType(), PhysicsPrestepType.DISABLED, 'original physics-owned transform mode restored');
  assert.ok(f.mesh.position.x >= recovered.x && f.mesh.position.x < 296, 'Havok actually consumed the recovered transform');
  assert.ok(Math.abs(Quaternion.Dot(rotation, f.mesh.rotationQuaternion!)) > .9999);
});

test('old save outside or below terrain is recovered before Havok without repairing or rotating it', async t => {
  const f = await fixture(); t.after(() => f.dispose());
  const rotation = f.mesh.rotationQuaternion!.clone();
  for (const position of [new Vector3(800, 100, 0), new Vector3(12, -40, 0), new Vector3(NaN, NaN, 0)]) {
    f.mesh.position.copyFrom(position);
    f.body.setLinearVelocity(new Vector3(3, -5, 7));
    assert.ok(f.boundary.beforePhysics(f.body, 1 / 60));
    f.physics._step(1 / 60); f.boundary.afterPhysics(f.body, 1 / 60);
    assert.ok(Number.isFinite(f.mesh.position.y) && f.mesh.position.y >= .99);
    assert.ok(Math.abs(f.mesh.position.x) < 300 && Math.abs(f.mesh.position.z) < 300);
    assert.equal(f.body.getPrestepType(), PhysicsPrestepType.DISABLED);
    assert.ok(Math.abs(Quaternion.Dot(rotation, f.mesh.rotationQuaternion!)) > .9999);
  }
});

test('actual Havok walking capsule cannot be driven beyond an edge and can walk back', async t => {
  const f = await fixture(new Vector3(0, -9.81, 0));
  const ground = MeshBuilder.CreateBox('ground', { width: 700, height: 1, depth: 700 }, f.scene); ground.position.y = -.5;
  const groundPhysics = new PhysicsAggregate(ground, PhysicsShapeType.BOX, { mass: 0 }, f.scene);
  const controller = new PhysicsCharacterController(new Vector3(280, .94, 0), { capsuleHeight: 1.2, capsuleRadius: .3 }, f.scene);
  t.after(() => { controller.dispose(); groundPhysics.dispose(); ground.dispose(); f.dispose(); });
  const dt = 1 / 60;
  for (let i = 0; i < 1200; i++) {
    const support = controller.checkSupport(dt, new Vector3(0, -1, 0));
    controller.setVelocity(f.boundary.limitVelocity(controller.getPosition(), new Vector3(8, -1, 0), dt, .3));
    controller.integrate(dt, support, new Vector3(0, -9.81, 0)); f.physics._step(dt);
    assert.ok(controller.getPosition().x + .3 <= 300 + .001, `capsule position ${controller.getPosition().asArray()}`);
  }
  assert.ok(controller.getPosition().x > 299, 'walk reaches edge rather than being stopped far away');
  for (let i = 0; i < 120; i++) {
    const support = controller.checkSupport(dt, new Vector3(0, -1, 0));
    controller.setVelocity(f.boundary.limitVelocity(controller.getPosition(), new Vector3(-8, -1, 0), dt, .3));
    controller.integrate(dt, support, new Vector3(0, -9.81, 0)); f.physics._step(dt);
  }
  assert.ok(controller.getPosition().x < 285, 'walking inward remains responsive');
});

test('integrated Player update keeps walking and noclip inside default coast bounds and permits returning', async t => {
  const f = await fixture(new Vector3(0, -9.81, 0));
  const ground = MeshBuilder.CreateBox('supported playable land', { width: 3500, height: 1, depth: 1800 }, f.scene); ground.position.y = -.5;
  const groundPhysics = new PhysicsAggregate(ground, PhysicsShapeType.BOX, { mass: 0 }, f.scene);
  const shadows = new ShadowGenerator(128, new DirectionalLight('sun', new Vector3(0, -1, 0), f.scene));
  let horizontal = -1, ascend = false;
  const input = { aim: false, mouseDown: false, dx: 0, dy: 0, gamepad: null, take: () => false,
    down: (key: string) => key === 'sprint' || (key === 'jump' && ascend), axis: (key: string) => key === 'x' ? horizontal : 0 } as unknown as Input;
  const player = new Player(f.scene, shadows, input, new Vector3(COAST.minX + 15, .94, 0));
  t.after(() => { player.controller.dispose(); player.queries.dispose(); player.model.dispose(); shadows.dispose(); groundPhysics.dispose(); ground.dispose(); f.dispose(); });
  const steps = (count: number) => {
    for (let i = 0; i < count; i++) {
      player.update(1 / 60); f.physics._step(1 / 60);
      assert.ok(player.position.x >= COAST.minX + .34 - .001, `integrated position ${player.position.asArray()}`);
    }
  };
  steps(600);
  assert.ok(player.position.x < COAST.minX + 1, 'walking approaches supported edge');
  assert.ok(player.position.y > .8, 'walker remains supported');
  player.noclip = true; ascend = true; steps(300);
  assert.ok(player.position.y > 150, 'noclip ascent remains available while outward displacement is limited');
  horizontal = 1; ascend = false; steps(90);
  assert.ok(player.position.x > COAST.minX + 20, 'noclip can return inward immediately');
  player.teleport(new Vector3(COAST.minX - 500, 50, 0)); horizontal = 0; steps(1);
  assert.ok(player.position.x >= COAST.minX + 12, 'old outside player save is recovered before movement queries');
  assert.ok(player.position.y >= 49, 'valid altitude retained on outside recovery');
});
