import test from "node:test";
import assert from "node:assert/strict";
import {
  driveForce,
  frictionCircle,
  impactDamage,
  liftCoefficient,
  suspensionForce,
  VEHICLE_TUNING,
} from "../src/vehicles/handling";
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
import { VehicleSystem } from "../src/vehicles/VehicleSystem";
import type { SerializableVehicle } from "../src/vehicles/serialization";

test("tire demand respects friction circle and loses braking when sliding hard", () => {
  const [lateral, longitudinal] = frictionCircle(12000, 8000, 3000, 1.1);
  assert.ok(Math.abs(Math.hypot(lateral, longitudinal) - 3300) < 1e-6);
  assert.ok(longitudinal < 3300);
  assert.deepEqual(frictionCircle(100, 200, 3000, 1), [100, 200]);
});
test("suspension equilibrium supports the actual car weight", () => {
  const t = VEHICLE_TUNING.sedan,
    force = suspensionForce(t.suspensionCompression, 0, t.mass, 4, t);
  assert.ok(Math.abs(force * 4 - t.mass * 9.81) < 1e-7);
  assert.ok(suspensionForce(t.suspensionCompression, 2, t.mass, 4, t) < force);
  assert.ok(suspensionForce(t.suspensionCompression, -2, t.mass, 4, t) > force);
});
test("engine respects top speed, reverse cap, and mechanical damage", () => {
  const t = VEHICLE_TUNING.coupe;
  assert.equal(driveForce(1, t.topSpeed, t, 100), 0);
  assert.equal(driveForce(-1, -10, t, 100), 0);
  assert.ok(driveForce(1, 0, t, 25) < driveForce(1, 0, t, 100));
  assert.ok(driveForce(-1, 5, t, 100) < 0);
});
test("parking contact is harmless, high-speed impact is damaging", () => {
  assert.equal(impactDamage(1.4), 0);
  assert.ok(impactDamage(12) > impactDamage(4));
  assert.ok(impactDamage(1000) <= 75);
});
test("wing stalls at high angle of attack", () => {
  assert.ok(liftCoefficient(0.18) > liftCoefficient(0.01));
  assert.equal(liftCoefficient(0.7), 0);
});

test("Havok car settles, accelerates, steers and stops against a solid wall", async (context) => {
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
  const engine = new NullEngine(),
    scene = new Scene(engine);
  scene.enablePhysics(new Vector3(0, -9.81, 0), new HavokPlugin(true, havok));
  const physics = scene.getPhysicsEngine() as PhysicsEngineV2;
  const light = new DirectionalLight("sun", new Vector3(0, -1, 0), scene),
    shadows = new ShadowGenerator(128, light);
  const ground = MeshBuilder.CreateBox(
    "ground",
    { width: 500, depth: 500, height: 1 },
    scene,
  );
  ground.position.y = -0.5;
  new PhysicsAggregate(
    ground,
    PhysicsShapeType.BOX,
    { mass: 0, friction: 0.7 },
    scene,
  );
  const system = new VehicleSystem({ scene, shadows }),
    car = system.spawn("coupe", new Vector3(0, 0.9, 0));
  const step = (count: number) => {
    for (let i = 0; i < count; i++) {
      system.update(1 / 60);
      physics._step(1 / 60);
    }
  };
  step(180);
  assert.ok(
    car.root.position.y > 0.4 && car.root.position.y < 0.95,
    `rest height ${car.root.position.y}`,
  );
  assert.equal(car.grounded, 4);
  system.control(car, {
    throttle: 1,
    steer: 0,
    brake: 0,
    handbrake: false,
    lift: 0,
  });
  step(180);
  assert.ok(car.speed > 12, `acceleration reached ${car.speed} m/s`);
  context.diagnostic(
    `Coupe reached ${car.speed.toFixed(2)} m/s after 3 seconds of throttle.`,
  );
  assert.ok(car.root.position.z > 15);
  system.control(car, {
    throttle: 0.3,
    steer: 0.5,
    brake: 0,
    handbrake: false,
    lift: 0,
  });
  step(75);
  assert.ok(
    car.heading > 0.08,
    `heading changed through tire torque: ${car.heading}`,
  );
  system.remove(car);
  const wall = MeshBuilder.CreateBox(
    "wall",
    { width: 15, height: 5, depth: 1 },
    scene,
  );
  wall.position.set(0, 2, 28);
  new PhysicsAggregate(
    wall,
    PhysicsShapeType.BOX,
    { mass: 0, restitution: 0.1 },
    scene,
  );
  const crashing = system.spawn("sedan", new Vector3(0, 0.9, 0));
  let crashes = 0;
  system.onCrash = (_v, severity) => {
    crashes++;
    context.diagnostic(`Impact Δv=${severity.toFixed(2)}`);
  };
  const before = crashing.model.panels.map((panel) =>
    Array.from(panel.getVerticesData("position")!),
  );
  system.control(crashing, {
    throttle: 1,
    steer: 0,
    brake: 0,
    handbrake: false,
    lift: 0,
  });
  step(420);
  assert.ok(
    crashing.root.position.z < 28,
    `solid wall stopped car at ${crashing.root.position.z}`,
  );
  assert.ok(
    crashing.health < 100,
    `collision caused damage: ${crashing.health}`,
  );
  assert.ok(crashes > 0);
  assert.ok(
    crashing.model.panels.some((panel, i) =>
      panel
        .getVerticesData("position")!
        .some((n, j) => Math.abs(n - before[i][j]) > 0.001),
    ),
    "impact changed body vertices",
  );
  context.diagnostic(
    `Sedan hit wall: health ${crashing.health.toFixed(1)}, ${crashes} collision callbacks, position z=${crashing.root.position.z.toFixed(2)}.`,
  );
  assert.ok(
    crashing.model.windows.some((window) => !window.isEnabled()),
    "impact broke glazing",
  );
  system.repair(crashing);
  assert.equal(crashing.health, 100);
  system.dispose();
  scene.dispose();
  engine.dispose();
});

test("Havok boat floats, helicopter takes off and lands, trainer rotates from runway", async (context) => {
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
  const engine = new NullEngine(),
    scene = new Scene(engine);
  scene.enablePhysics(new Vector3(0, -9.81, 0), new HavokPlugin(true, havok));
  const physics = scene.getPhysicsEngine() as PhysicsEngineV2,
    light = new DirectionalLight("sun", new Vector3(0, -1, 0), scene),
    shadows = new ShadowGenerator(128, light);
  const system = new VehicleSystem({ scene, shadows });
  system.waterLevel = 0;
  const step = (count: number) => {
    for (let i = 0; i < count; i++) {
      system.update(1 / 60);
      physics._step(1 / 60);
    }
  };
  const boat = system.spawn("boat", new Vector3(0, 0.4, 0));
  step(360);
  assert.ok(
    boat.root.position.y > -0.2 && boat.root.position.y < 0.25,
    `floating height ${boat.root.position.y}`,
  );
  system.control(boat, {
    throttle: 1,
    steer: 0,
    brake: 0,
    handbrake: false,
    lift: 0,
  });
  step(240);
  assert.ok(boat.speed > 6, `boat speed ${boat.speed}`);
  assert.ok(boat.root.position.z > 10);
  context.diagnostic(
    `Boat floating height ${boat.root.position.y.toFixed(2)} m; propulsion reached ${boat.speed.toFixed(2)} m/s.`,
  );
  const shoreZ = boat.root.position.z + 18,
    shore = MeshBuilder.CreateBox(
      "shore",
      { width: 40, height: 6, depth: 4 },
      scene,
    );
  shore.position.set(0, 1, shoreZ);
  const shoreBody = new PhysicsAggregate(
    shore,
    PhysicsShapeType.BOX,
    { mass: 0 },
    scene,
  );
  step(300);
  assert.ok(
    boat.root.position.z < shoreZ - 2,
    "solid shoreline blocks a powered watercraft",
  );
  shoreBody.dispose();
  shore.dispose();
  system.remove(boat);
  const ground = MeshBuilder.CreateBox(
    "ground",
    { width: 500, depth: 2000, height: 1 },
    scene,
  );
  ground.position.y = -0.5;
  new PhysicsAggregate(ground, PhysicsShapeType.BOX, { mass: 0 }, scene);
  const helicopter = system.spawn("helicopter", new Vector3(0, 1, 0));
  helicopter.occupied = true;
  system.control(helicopter, {
    throttle: 0,
    steer: 0,
    brake: 0,
    handbrake: false,
    lift: 1,
  });
  step(480);
  assert.ok(
    helicopter.root.position.y > 10,
    `helicopter height ${helicopter.root.position.y}`,
  );
  system.control(helicopter, {
    throttle: 1,
    steer: 0.2,
    brake: 0,
    handbrake: false,
    lift: 0,
  });
  step(180);
  assert.ok(
    helicopter.speed > 3,
    `tilted helicopter speed ${helicopter.speed}`,
  );
  context.diagnostic(
    `Helicopter collective reached ${helicopter.root.position.y.toFixed(2)} m; rotor tilt produced ${helicopter.speed.toFixed(2)} m/s horizontal speed.`,
  );
  system.control(helicopter, {
    throttle: 0,
    steer: 0,
    brake: 0,
    handbrake: false,
    lift: -1,
  });
  step(720);
  assert.ok(
    helicopter.root.position.y > 0.6 && helicopter.root.position.y < 1.4,
    `helicopter landed at ${helicopter.root.position.y}`,
  );
  assert.ok(helicopter.health > 0, "controlled landing is survivable");
  system.remove(helicopter);
  const plane = system.spawn("plane", new Vector3(0, 0.95, -400));
  system.control(plane, {
    throttle: 1,
    steer: 0,
    brake: 0,
    handbrake: false,
    lift: 0,
  });
  step(600);
  context.diagnostic(
    `Trainer runway roll: ${plane.speed.toFixed(2)} m/s; y=${plane.root.position.y.toFixed(2)}.`,
  );
  assert.ok(plane.speed > 25, `trainer accelerated on runway: ${plane.speed}`);
  system.control(plane, {
    throttle: 1,
    steer: 0,
    brake: 0,
    handbrake: false,
    lift: 1,
  });
  step(480);
  context.diagnostic(
    `Trainer rotation: ${plane.speed.toFixed(2)} m/s; y=${plane.root.position.y.toFixed(2)}; forward=${plane.root.getDirection(new Vector3(0, 0, 1)).toString()}.`,
  );
  assert.ok(
    plane.root.position.y > 5,
    `trainer took off under aerodynamic lift: ${plane.root.position.y}`,
  );
  assert.equal(plane.grounded, 0);
  system.dispose();
  scene.dispose();
  engine.dispose();
});

test("62 m/s impact cannot tunnel through an 8 cm wall; creative recovery restores upright motion", async (context) => {
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
  const engine = new NullEngine(),
    scene = new Scene(engine);
  scene.enablePhysics(new Vector3(0, -9.81, 0), new HavokPlugin(true, havok));
  const physics = scene.getPhysicsEngine() as PhysicsEngineV2;
  physics.setSubTimeStep(1000 / 60);
  const shadows = new ShadowGenerator(
      128,
      new DirectionalLight("sun", new Vector3(0, -1, 0), scene),
    ),
    system = new VehicleSystem({ scene, shadows });
  const ground = MeshBuilder.CreateBox(
    "ground",
    { width: 100, depth: 100, height: 1 },
    scene,
  );
  ground.position.y = -0.5;
  new PhysicsAggregate(ground, PhysicsShapeType.BOX, { mass: 0 }, scene);
  const wall = MeshBuilder.CreateBox(
    "thin-wall",
    { width: 30, height: 7, depth: 0.08 },
    scene,
  );
  wall.position.set(0, 3, 12);
  new PhysicsAggregate(wall, PhysicsShapeType.BOX, { mass: 0 }, scene);
  const car = system.spawn("coupe", new Vector3(0, 0.8, 0));
  scene.onBeforePhysicsObservable.add(() => system.update(1 / 60));
  for (let i = 0; i < 120; i++) scene._advancePhysicsEngineStep(1000 / 60);
  car.body.setLinearVelocity(new Vector3(0, 0, 62));
  let furthest = -Infinity;
  for (let i = 0; i < 120; i++) {
    scene._advancePhysicsEngineStep(1000 / 60);
    furthest = Math.max(furthest, car.root.position.z);
  }
  assert.ok(furthest < 12, `no tunneling: maximum center z ${furthest}`);
  assert.ok(car.health < 40, `major damage from 223 km/h crash: ${car.health}`);
  context.diagnostic(
    `223 km/h crash: max center z=${furthest.toFixed(3)} at wall z12, health=${car.health.toFixed(1)}.`,
  );
  system.recover(car, new Vector3(-10, 1.1, -10));
  for (let i = 0; i < 180; i++) scene._advancePhysicsEngineStep(1000 / 60);
  assert.ok(
    Vector3.Dot(
      car.root.getDirection(new Vector3(0, 1, 0)),
      new Vector3(0, 1, 0),
    ) > 0.99,
  );
  assert.ok(car.root.position.y > 0.4 && car.root.position.y < 1);
  assert.ok(
    Math.abs(car.root.position.x + 10) < 0.1 &&
      Math.abs(car.root.position.z + 10) < 0.1,
  );
  assert.equal(
    car.body.disablePreStep,
    true,
    "normal dynamic prestep restored",
  );
  assert.equal(car.health, 100);
  system.control(car, {
    throttle: 1,
    steer: 0,
    brake: 0,
    handbrake: false,
    lift: 0,
  });
  for (let i = 0; i < 90; i++) scene._advancePhysicsEngineStep(1000 / 60);
  assert.ok(car.speed > 6, "recovered car drives again");
  system.dispose();
  scene.dispose();
  engine.dispose();
});

test("fixed physics substeps preserve driving across 30, 60 and 144 Hz render cadence", async (context) => {
  const wasm = await readFile(
    new URL(
      "../node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm",
      import.meta.url,
    ),
  );
  const results: {
    fps: number;
    position: Vector3;
    speed: number;
    steps: number;
  }[] = [];
  for (const fps of [30, 60, 144]) {
    const havok = await HavokPhysics({
      wasmBinary: wasm.buffer.slice(
        wasm.byteOffset,
        wasm.byteOffset + wasm.byteLength,
      ) as ArrayBuffer,
    });
    const engine = new NullEngine(),
      scene = new Scene(engine);
    scene.enablePhysics(new Vector3(0, -9.81, 0), new HavokPlugin(true, havok));
    (scene.getPhysicsEngine() as PhysicsEngineV2).setSubTimeStep(1000 / 60);
    const shadows = new ShadowGenerator(
        128,
        new DirectionalLight("sun", new Vector3(0, -1, 0), scene),
      ),
      system = new VehicleSystem({ scene, shadows });
    const ground = MeshBuilder.CreateBox(
      "ground",
      { width: 200, depth: 200, height: 1 },
      scene,
    );
    ground.position.y = -0.5;
    new PhysicsAggregate(ground, PhysicsShapeType.BOX, { mass: 0 }, scene);
    const car = system.spawn("sedan", new Vector3(0, 0.9, 0));
    let steps = 0;
    scene.onBeforePhysicsObservable.add(() => {
      system.control(car, {
        throttle: steps > 60 ? 1 : 0,
        steer: steps > 150 ? 0.15 : 0,
        brake: 0,
        handbrake: false,
        lift: 0,
      });
      system.update(1 / 60);
      steps++;
    });
    for (let frame = 0; frame < fps * 5; frame++)
      scene._advancePhysicsEngineStep(1000 / fps);
    results.push({
      fps,
      position: car.root.position.clone(),
      speed: car.speed,
      steps,
    });
    system.dispose();
    scene.dispose();
    engine.dispose();
  }
  for (const result of results) {
    assert.ok(
      Vector3.Distance(result.position, results[0].position) < 0.5,
      `render cadence changed position: ${JSON.stringify(results)}`,
    );
    assert.ok(Math.abs(result.speed - results[0].speed) < 0.2);
    assert.ok(Math.abs(result.steps - results[0].steps) <= 1);
  }
  context.diagnostic(
    results
      .map(
        (r) =>
          `${r.fps} Hz: ${r.steps} steps, ${r.speed.toFixed(3)} m/s, z=${r.position.z.toFixed(3)}`,
      )
      .join("; "),
  );
});

test("vehicle save round-trip retains deformed vertices, broken components, punctures and overturned pose", async (context) => {
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
  const engine = new NullEngine(),
    scene = new Scene(engine);
  scene.enablePhysics(new Vector3(0, -9.81, 0), new HavokPlugin(true, havok));
  const physics = scene.getPhysicsEngine() as PhysicsEngineV2;
  const shadows = new ShadowGenerator(
      128,
      new DirectionalLight("sun", new Vector3(0, -1, 0), scene),
    ),
    system = new VehicleSystem({ scene, shadows });
  const car = system.spawn(
      "coupe",
      new Vector3(15, 12, -4),
      0.35,
      "saved-coupe-42",
    ),
    original = system.serialize(car);
  car.body.setAngularVelocity(new Vector3(0, 0, 6));
  for (let i = 0; i < 35; i++) {
    system.update(1 / 60);
    physics._step(1 / 60);
  }
  assert.ok(
    car.root.getDirection(new Vector3(0, 1, 0)).y < -0.5,
    "test car physically rolled past its side",
  );
  for (const child of car.root.getChildMeshes()) child.computeWorldMatrix(true);
  system.damage(car, 55, car.model.lights[2].getAbsolutePosition());
  car.engineRunning = false;
  car.siren = true;
  car.body.setLinearVelocity(new Vector3(4, 1, -3));
  car.body.setAngularVelocity(new Vector3(0.4, -0.2, 0.7));
  const snapshot = JSON.parse(
    JSON.stringify(system.serialize(car)),
  ) as SerializableVehicle;
  assert.ok(
    snapshot.damage.panels.some((panel, i) =>
      panel.vertices.some(
        (n, j) => Math.abs(n - original.damage.panels[i].vertices[j]) > 0.001,
      ),
    ),
    "saved actual dents",
  );
  assert.ok(
    snapshot.damage.tiresDamaged.some(Boolean),
    "saved a punctured tire",
  );
  assert.ok(
    snapshot.damage.windowsEnabled.some((enabled) => !enabled),
    "saved broken glass",
  );
  assert.ok(
    snapshot.damage.lightsEnabled.some((enabled) => !enabled),
    "saved broken lights",
  );
  assert.ok(
    snapshot.damage.bumpersEnabled.some((enabled) => !enabled),
    "saved detached bumper",
  );
  const independent = system.serialize(car);
  independent.damage.panels[0].vertices[0] += 1;
  assert.notEqual(
    car.model.panels[0].getVerticesData("position")![0],
    independent.damage.panels[0].vertices[0],
    "save arrays do not alias live vertex buffers",
  );
  const restored = system.restore(snapshot),
    roundTrip = system.serialize(restored);
  assert.equal(restored.id, "saved-coupe-42");
  assert.equal(car.body.isDisposed, true);
  assert.equal(system.list.filter((v) => v.id === restored.id).length, 1);
  assert.deepEqual(
    roundTrip.damage,
    snapshot.damage,
    "all component geometry and state survived JSON save/restore",
  );
  assert.ok(
    roundTrip.linearVelocity.every(
      (n, i) => Math.abs(n - snapshot.linearVelocity[i]) < 1e-5,
    ),
  );
  assert.ok(
    roundTrip.angularVelocity.every(
      (n, i) => Math.abs(n - snapshot.angularVelocity[i]) < 1e-5,
    ),
    "Havok angular velocity retained within float precision",
  );
  assert.ok(
    roundTrip.rotationQuaternion.every(
      (n, i) => Math.abs(n - snapshot.rotationQuaternion[i]) < 1e-6,
    ),
    "full quaternion survived",
  );
  assert.equal(restored.engineRunning, false);
  assert.equal(restored.siren, true);
  assert.equal(roundTrip.appearanceSeed, snapshot.appearanceSeed);
  assert.ok(
    restored.root.getDirection(new Vector3(0, 1, 0)).y < -0.5,
    "restore preserved an overturned vehicle",
  );
  assert.ok(
    restored.root
      .getChildMeshes()
      .every((mesh) => mesh.metadata.vehicleId === restored.id),
    "every part resolves the restored stable ID",
  );
  assert.ok(
    restored.model.wheels.some((w) => w.damaged && w.tire.scaling.x < 1),
    "puncture remains visibly and functionally active",
  );
  system.remove(car);
  system.damage(car, 100);
  system.repair(car);
  assert.equal(
    restored.health,
    snapshot.health,
    "stale old references cannot affect the replacement",
  );
  const meshes = scene.meshes.length,
    bodies = physics.getBodies().length,
    materials = scene.materials.length;
  let latest = restored;
  for (let i = 0; i < 8; i++) latest = system.restore(snapshot);
  assert.equal(
    scene.meshes.length,
    meshes,
    "repeated restore does not leak vehicle meshes",
  );
  assert.equal(
    physics.getBodies().length,
    bodies,
    "repeated restore does not leak Havok bodies",
  );
  assert.equal(
    scene.materials.length,
    materials,
    "repeated restore does not leak materials",
  );
  assert.deepEqual(system.serialize(latest).damage, snapshot.damage);
  system.repair(latest);
  const repaired = system.serialize(latest);
  assert.equal(repaired.health, 100);
  assert.ok(repaired.damage.tiresDamaged.every((damaged) => !damaged));
  assert.ok(
    repaired.damage.windowsEnabled.every(Boolean) &&
      repaired.damage.bumpersEnabled.every(Boolean) &&
      repaired.damage.lightsEnabled.every(Boolean),
  );
  assert.deepEqual(
    repaired.damage.panels,
    original.damage.panels,
    "repair returns restored mesh to pristine authored geometry",
  );
  context.diagnostic(
    `Saved ${JSON.stringify(snapshot).length} bytes with dents, puncture, glass/light/bumper damage; 8 replacements preserved state with stable mesh/body/material counts.`,
  );
  system.dispose();
  scene.dispose();
  engine.dispose();
});

test("stable IDs reject collisions; invalid restoration leaves existing body intact; legacy saves load", async () => {
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
  const engine = new NullEngine(),
    scene = new Scene(engine);
  scene.enablePhysics(new Vector3(0, -9.81, 0), new HavokPlugin(true, havok));
  const physics = scene.getPhysicsEngine() as PhysicsEngineV2,
    shadows = new ShadowGenerator(
      128,
      new DirectionalLight("sun", new Vector3(0, -1, 0), scene),
    ),
    system = new VehicleSystem({ scene, shadows });
  const original = system.spawn("sedan", new Vector3(0, 2, 0), 0, "vehicle-2"),
    other = system.spawn("suv", new Vector3(5, 2, 0));
  assert.notEqual(original.id, other.id, "generated IDs skip explicit IDs");
  const bodyCount = physics.getBodies().length,
    meshCount = scene.meshes.length;
  assert.throws(
    () => system.spawn("coupe", Vector3.Zero(), 0, original.id),
    /already exists/,
  );
  assert.throws(
    () => system.spawn("coupe", Vector3.Zero(), 0, "../invalid id"),
    /Invalid vehicle ID/,
  );
  assert.equal(physics.getBodies().length, bodyCount);
  assert.equal(scene.meshes.length, meshCount);
  const saved = system.serialize(original),
    malformed = JSON.parse(JSON.stringify(saved)) as SerializableVehicle;
  malformed.damage.panels[0].vertices.splice(0, 3);
  assert.throws(() => system.restore(malformed), /topology/);
  assert.equal(original.body.isDisposed, false);
  assert.equal(
    system.list.find((v) => v.id === original.id),
    original,
  );
  assert.equal(physics.getBodies().length, bodyCount);
  assert.equal(scene.meshes.length, meshCount);
  assert.throws(
    () => system.restore({ ...saved, rotationQuaternion: [0, 0, 0, 0] }),
    /quaternion/,
  );
  assert.throws(
    () => system.restore({ ...saved, x: Number.NaN }),
    /Invalid vehicle x/,
  );
  assert.equal(original.body.isDisposed, false);
  const legacy = system.restore({
    kind: "truck",
    x: 20,
    y: 2,
    z: -30,
    heading: 0.7,
    health: 38,
  });
  assert.equal(legacy.kind, "truck");
  assert.equal(legacy.health, 38);
  assert.ok(Math.abs(legacy.heading - 0.7) < 1e-6);
  assert.equal(legacy.root.position.x, 20);
  assert.equal(legacy.root.position.z, -30);
  assert.equal(legacy.engineRunning, true);
  // Legacy saves did not contain damage geometry. Migration does not fabricate random dents.
  assert.ok(legacy.model.wheels.every((w) => !w.damaged));
  assert.ok(legacy.model.windows.every((w) => w.isEnabled()));
  for (const kind of Object.keys(
    VEHICLE_TUNING,
  ) as (keyof typeof VEHICLE_TUNING)[]) {
    const sample = system.spawn(
      kind,
      new Vector3(100, 10, 100),
      0.4,
      `roundtrip-${kind}`,
    );
    system.damage(sample, 65);
    const snapshot = JSON.parse(
      JSON.stringify(system.serialize(sample)),
    ) as SerializableVehicle;
    const loaded = system.restore(snapshot);
    assert.deepEqual(
      system.serialize(loaded).damage,
      snapshot.damage,
      `${kind} damage layout survives restoration`,
    );
    system.remove(loaded);
  }
  system.update(1 / 60);
  physics._step(1 / 60);
  system.dispose();
  scene.dispose();
  engine.dispose();
});
