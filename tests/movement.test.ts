import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import HavokPhysics from "@babylonjs/havok";
import {
  DirectionalLight,
  HavokPlugin,
  MeshBuilder,
  NullEngine,
  PhysicsAggregate,
  PhysicsShapeType,
  Scene,
  ShadowGenerator,
  Vector3,
  type PhysicsEngineV2,
} from "@babylonjs/core";
import { MovementQueries } from "../src/gameplay/MovementQueries";
import { Player } from "../src/gameplay/Player";
import { VehicleSystem } from "../src/vehicles/VehicleSystem";
import type { Input } from "../src/core/Input";

async function fixture() {
  const wasm = await readFile(
    new URL(
      "../node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm",
      import.meta.url,
    ),
  );
  const havok = await HavokPhysics({
    wasmBinary: wasm.buffer.slice(
      wasm.byteOffset,
      wasm.byteOffset + wasm.byteLength,
    ) as ArrayBuffer,
  });
  const engine = new NullEngine();
  const scene = new Scene(engine);
  scene.enablePhysics(new Vector3(0, -9.81, 0), new HavokPlugin(false, havok));
  const physics = scene.getPhysicsEngine() as PhysicsEngineV2;
  const shadows = new ShadowGenerator(
    128,
    new DirectionalLight("sun", new Vector3(0, -1, 0), scene),
  );
  function box(
    name: string,
    position: Vector3,
    width: number,
    height: number,
    depth: number,
  ) {
    const mesh = MeshBuilder.CreateBox(name, { width, height, depth }, scene);
    mesh.position.copyFrom(position);
    const aggregate = new PhysicsAggregate(
      mesh,
      PhysicsShapeType.BOX,
      { mass: 0 },
      scene,
    );
    return {
      mesh,
      dispose() {
        aggregate.dispose();
        mesh.dispose();
      },
    };
  }
  box("ground", new Vector3(0, -0.5, 0), 100, 1, 100);
  physics._step(1 / 60);
  return { engine, scene, physics, shadows, box };
}

test("Havok standing capsule rejects overlap, low ceilings, and swept wall crossings", async (t) => {
  const f = await fixture();
  t.after(() => {
    f.scene.dispose();
    f.engine.dispose();
  });
  const q = new MovementQueries(f.scene);
  const wall = f.box("thin wall", new Vector3(1, 1, 0), 0.1, 2, 5);
  f.physics._step(1 / 60);
  assert.ok(q.clear(new Vector3(0, 0.94, 0)));
  assert.equal(q.clear(new Vector3(1, 0.94, 0)), false);
  assert.equal(q.path(new Vector3(0, 0.94, 0), new Vector3(2, 0.94, 0)), false);
  wall.dispose();
  f.box("ceiling", new Vector3(0, 1.55, 0), 4, 0.1, 4);
  f.physics._step(1 / 60);
  assert.equal(q.clear(new Vector3(0, 0.94, 0)), false);
  q.dispose();
});

test("Havok ledge query accepts a reachable low ledge and rejects an obstructed landing", async (t) => {
  const f = await fixture();
  t.after(() => {
    f.scene.dispose();
    f.engine.dispose();
  });
  const q = new MovementQueries(f.scene);
  f.box("ledge", new Vector3(0, 0.45, 1.6), 3, 0.9, 1.6);
  f.physics._step(1 / 60);
  const path = q.mantle(new Vector3(0, 0.94, 0), 0);
  assert.ok(
    path,
    "0.9 m ledge must have a supported and capsule-clear landing",
  );
  assert.ok(Math.abs(path.end.y - 1.84) < 0.05);
  f.box("low overhang", new Vector3(0, 2.2, 1.5), 3, 0.2, 2);
  f.physics._step(1 / 60);
  assert.equal(q.mantle(new Vector3(0, 0.94, 0), 0), null);
  q.dispose();
});

test("character controller actually climbs the queried ledge and settles on top", async (t) => {
  const f = await fixture();
  t.after(() => {
    f.scene.dispose();
    f.engine.dispose();
  });
  f.box("ledge", new Vector3(0, 0.45, 1.6), 3, 0.9, 1.6);
  f.physics._step(1 / 60);
  let jump = false;
  const input = {
    aim: false,
    down: () => false,
    take: () => {
      const pressed = jump;
      jump = false;
      return pressed;
    },
    axis: () => 0,
    dx: 0,
    dy: 0,
    gamepad: null,
  } as unknown as Input;
  const player = new Player(f.scene, f.shadows, input, new Vector3(0, 0.94, 0));
  for (let n = 0; n < 12; n++) {
    player.update(1 / 60);
    f.physics._step(1 / 60);
  }
  jump = true;
  for (let n = 0; n < 120; n++) {
    player.update(1 / 60);
    f.physics._step(1 / 60);
  }
  assert.ok(
    player.position.z > 0.8,
    `advanced onto ledge: ${player.position.asArray()}`,
  );
  assert.ok(
    player.position.y > 1.74 && player.position.y < 1.96,
    `supported on ledge: ${player.position.asArray()}`,
  );
  assert.equal(player.climbing, false, `position ${player.position.asArray()}`);
  player.controller.dispose();
  player.queries.dispose();
});

test("vehicle exit finds the opposite door and refuses when every exit is blocked", async (t) => {
  const f = await fixture();
  t.after(() => {
    f.scene.dispose();
    f.engine.dispose();
  });
  const input = {
    aim: false,
    down: () => false,
    take: () => false,
    axis: () => 0,
    dx: 0,
    dy: 0,
    gamepad: null,
  } as unknown as Input;
  const player = new Player(
    f.scene,
    f.shadows,
    input,
    new Vector3(-2, 0.94, 0),
  );
  const vehicles = new VehicleSystem({ scene: f.scene, shadows: f.shadows });
  const car = vehicles.spawn("coupe", new Vector3(0, 1, 0));
  for (let n = 0; n < 120; n++) {
    vehicles.update(1 / 60);
    f.physics._step(1 / 60);
  }
  assert.equal(player.enter(car), true);
  player.switchCharacter();
  assert.equal(
    player.model.root.parent,
    null,
    "switching during mount must keep world-space interpolation unparented",
  );
  for (let n = 0; n < 45; n++) player.update(1 / 60);
  assert.equal(player.model.root.isEnabled(), true);
  assert.equal(player.model.root.parent, car.root);
  f.box("left wall", new Vector3(-1.5, 1, 0), 0.3, 2, 8);
  f.physics._step(1 / 60);
  vehicles.control(car, { throttle: -1, steer: .5, brake: 0, handbrake: false, lift: 1 });
  assert.equal(player.exit(), true);
  assert.ok(player.position.x > 1, "other door chosen");
  const parked = car.root.position.clone();
  for (let n = 0; n < 180; n++) { vehicles.update(1 / 60); f.physics._step(1 / 60); }
  assert.ok(Vector3.Distance(car.root.position, parked) < .1, "an exited vehicle cannot retain powered reverse/throttle");
  assert.deepEqual(car.input, { throttle: 0, steer: 0, brake: 1, handbrake: true, lift: 0 });
  assert.equal(player.enter(car), true);
  f.box("right wall", new Vector3(1.5, 1, 0), 0.3, 2, 8);
  f.box("back wall", new Vector3(0, 1, -2.85), 5, 2, 0.3);
  f.physics._step(1 / 60);
  vehicles.control(car, { throttle: .25, steer: .1, brake: 0, handbrake: false, lift: 0 });
  assert.equal(player.exit(), false);
  assert.equal(car.input.throttle, .25, "a rejected exit retains driver control");
  assert.equal(player.vehicle, car);
  assert.match(player.interactionMessage, /No safe exit/);
  player.exit(true);
  player.controller.dispose();
  player.queries.dispose();
  vehicles.dispose();
});

test("WASTED rejects vehicle entry and jumping; paused controller look stays fixed", async (t) => {
  const f = await fixture();
  t.after(() => {
    f.scene.dispose();
    f.engine.dispose();
  });
  const input = {
    aim: true,
    down: () => false,
    take: () => true,
    axis: () => 0,
    dx: 12,
    dy: 9,
    gamepad: { axes: [0, 0, 1, 1] },
  } as unknown as Input;
  const player = new Player(f.scene, f.shadows, input, new Vector3(0, 1.02, 0));
  const vehicles = new VehicleSystem({ scene: f.scene, shadows: f.shadows });
  const car = vehicles.spawn("coupe", new Vector3(3, 1, 0));
  player.deadTimer = 2;
  assert.equal(player.enter(car), false);
  for (let n = 0; n < 30; n++) {
    player.update(1 / 60);
    f.physics._step(1 / 60);
  }
  assert.ok(player.position.y < 1.2);
  assert.equal(player.aim, false);
  const yaw = player.yaw,
    pitch = player.pitch;
  player.render(1 / 60, 1, false);
  assert.equal(player.yaw, yaw);
  assert.equal(player.pitch, pitch);
  player.controller.dispose();
  player.queries.dispose();
  vehicles.dispose();
});
