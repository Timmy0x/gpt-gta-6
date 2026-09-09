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
  UniversalCamera,
  Vector3,
  type PhysicsEngineV2,
} from "@babylonjs/core";
import { Population } from "../src/gameplay/Population";
import { Officer } from "../src/gameplay/police/Officer";
import {
  PoliceDirector,
  type Driver,
} from "../src/gameplay/police/PoliceDirector";
import {
  ARREST_SECONDS,
  clearSight,
  compliant,
  footRoute,
  laneNext,
  responseFor,
} from "../src/gameplay/police/rules";
import { WantedSystem } from "../src/gameplay/Wanted";
import { VehicleSystem } from "../src/vehicles/VehicleSystem";
import type { Player } from "../src/gameplay/Player";
import type { WorldContract } from "../src/core/contracts";

test("fallback escalation changes response roles within bounded five-level configuration", () => {
  assert.equal(responseFor(1).patrol, 1);
  assert.equal(responseFor(2).swat, 0);
  assert.equal(responseFor(3).swat, 1);
  assert.equal(responseFor(4).roadblocks, 1);
  assert.equal(responseFor(5).roadblocks, 2);
  assert.equal(responseFor(4).helicopter, true);
  assert.deepEqual(responseFor(99), responseFor(5));
  for (let level = 0; level < 6; level++) {
    const r = responseFor(level);
    assert.ok(r.patrol + r.swat + r.roadblocks + Number(r.helicopter) <= 8);
  }
});
test("compliance requires stopped movement, lowered weapon, no resistance and a living suspect", () => {
  assert.equal(compliant(0, false, false, false), true);
  for (const args of [
    [1, false, false, false],
    [0, true, false, false],
    [0, false, true, false],
    [0, false, false, true],
  ] as const)
    assert.equal(compliant(args[0], args[1], args[2], args[3]), false);
  assert.ok(ARREST_SECONDS > 2);
});
test("foot navigation routes around an opaque wall and never invents an unreachable shortcut", () => {
  const obstacle = { x: 0, z: 0, w: 8, d: 12, height: 8 };
  const roads = [
    { id: 0, x: -8, z: -9, next: [1] },
    { id: 1, x: 8, z: -9, next: [2] },
    { id: 2, x: 8, z: 9, next: [3] },
    { id: 3, x: -8, z: 9, next: [0] },
  ];
  const route = footRoute({ x: -10, z: 0 }, { x: 10, z: 0 }, roads, [obstacle]);
  assert.ok(route.length >= 3);
  let start = { x: -10, z: 0 };
  for (const end of route) {
    assert.equal(
      clearSight({ ...start, y: 1.6 }, { ...end, y: 1.6 }, [obstacle]),
      true,
    );
    start = end;
  }
  assert.deepEqual(
    footRoute({ x: -10, z: 0 }, { x: 0, z: 0 }, roads, [obstacle]),
    [],
  );
  assert.equal(
    clearSight({ x: -10, y: 2, z: 0 }, { x: 10, y: 2, z: 0 }, [obstacle]),
    false,
  );
  assert.equal(
    clearSight({ x: -10, y: 20, z: 0 }, { x: 10, y: 20, z: 0 }, [obstacle]),
    true,
  );
});
test("search remembers observed identities but a different car masks a face at range", () => {
  const wanted = new WantedSystem();
  wanted.setLevel(2, { x: 0, z: 0 });
  wanted.update(1, { x: 0, z: 0 }, true, "observed-car", "Jason");
  wanted.update(5, { x: 100, z: 0 }, false, "new-car", "Jason");
  assert.equal(
    wanted.recognizes({ x: 100, z: 0 }, "new-car", "Jason", 50),
    false,
  );
  assert.equal(
    wanted.recognizes({ x: 100, z: 0 }, "observed-car", "Lucia", 50),
    true,
  );
  assert.equal(
    wanted.recognizes({ x: 100, z: 0 }, "new-car", "Jason", 10),
    true,
  );
  assert.equal(wanted.recognizes({ x: 100, z: 0 }, null, "Lucia", 30), false);
  assert.deepEqual(wanted.lastKnown, { x: 0, z: 0 });
});
async function setup() {
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
  const floor = MeshBuilder.CreateBox(
    "floor",
    { width: 600, depth: 600, height: 1 },
    scene,
  );
  floor.position.y = -0.5;
  new PhysicsAggregate(
    floor,
    PhysicsShapeType.BOX,
    { mass: 0, friction: 0.7 },
    scene,
  );
  return { engine, scene, physics, shadows };
}
test("real Havok officer walks, collides with a wall, and disposes its controller and skin", async () => {
  const { engine, scene, physics, shadows } = await setup();
  try {
    const wall = MeshBuilder.CreateBox(
      "solid-wall",
      { width: 12, depth: 1, height: 4 },
      scene,
    );
    wall.position.set(0, 2, 6);
    new PhysicsAggregate(wall, PhysicsShapeType.BOX, { mass: 0 }, scene);
    const initialBodies = physics.getBodies().length;
    const officer = new Officer(
      "officer-test",
      "patrol",
      "car",
      scene,
      shadows,
    );
    officer.dismount(new Vector3(0, 1.2, 0));
    assert.equal(officer.model.skeleton.bones.length, 17);
    assert.equal(officer.model.torso.metadata.officer, officer);
    for (let i = 0; i < 240; i++) {
      officer.move(1 / 60, new Vector3(0, 0, 1), 4.4, true);
      physics._step(1 / 60);
    }
    assert.ok(officer.position.z > 3.5, `walked to ${officer.position.z}`);
    assert.ok(
      officer.position.z < 5.4,
      `wall blocked at ${officer.position.z}`,
    );
    assert.ok(officer.position.y > 0.75 && officer.position.y < 1.3);
    officer.dispose();
    assert.equal(physics.getBodies().length, initialBodies);
    assert.equal(scene.skeletons.length, 0);
  } finally {
    scene.dispose();
    engine.dispose();
  }
});
test("physical dispatch arrives, visible officer dismounts and compliant suspect is arrested; response resets cleanly", async (t) => {
  const { engine, scene, physics, shadows } = await setup();
  try {
    const roads = [-180, -120, -60, 0, 60, 120, 180].map((z, id) => ({
      id,
      x: 0,
      z,
      next: [id - 1, id + 1].filter((i) => i >= 0 && i < 7),
    }));
    const world = {
      spawn: new Vector3(0, 1, 0),
      obstacles: [],
      roads,
      locations: [],
      waterLevel: 0,
      update() {},
      dispose() {},
    } satisfies WorldContract;
    const player = {
      position: new Vector3(0, 1, 0),
      heading: 0,
      name: "Jason",
      vehicle: null,
      aim: false,
      deadTimer: 0,
      hurt() {},
    } as unknown as Player;
    const vehicles = new VehicleSystem({ scene, shadows }),
      wanted = new WantedSystem();
    const director = new PoliceDirector(
        scene,
        shadows,
        world,
        vehicles,
        player,
        wanted,
      ),
      drivers: Driver[] = [];
    let arrested = false,
      sawFoot = false;
    director.onArrest = () => {
      arrested = true;
    };
    wanted.setLevel(1, player.position);
    for (let i = 0; i < 2400 && !arrested; i++) {
      director.update(1 / 60, drivers, true);
      vehicles.update(1 / 60);
      physics._step(1 / 60);
      sawFoot ||= director.stats.activeFoot > 0;
    }
    t.diagnostic(
      JSON.stringify({
        arrested,
        sawFoot,
        wanted: wanted.phase,
        vehicles: drivers.map((d) => d.v.root.position.asArray()),
        officers: director.officers.map((o) => ({
          state: o.state,
          p: o.position.asArray(),
        })),
      }),
    );
    assert.ok(sawFoot, "rigged officer dismounted through physical approach");
    assert.ok(arrested, "compliant suspect arrested by nearby foot officer");
    director.reset(drivers);
    assert.equal(director.officers.length, 0);
    assert.equal(drivers.length, 0);
    assert.equal(vehicles.list.length, 0);
  } finally {
    scene.dispose();
    engine.dispose();
  }
});
test("high escalation creates bounded tactical crew, collidable roadblocks and a helicopter that gains altitude through forces", async (t) => {
  const { engine, scene, physics, shadows } = await setup();
  try {
    const roads = [-210, -140, -70, 0, 70, 140, 210].flatMap((z, row) =>
      [-140, 0, 140].map((x, column) => ({
        id: row * 3 + column,
        x,
        z,
        next: [
          row > 0 ? (row - 1) * 3 + column : -1,
          row < 6 ? (row + 1) * 3 + column : -1,
          column > 0 ? row * 3 + column - 1 : -1,
          column < 2 ? row * 3 + column + 1 : -1,
        ].filter((id) => id >= 0),
      })),
    );
    const world = {
      spawn: new Vector3(0, 1, 0),
      obstacles: [],
      roads,
      locations: [],
      waterLevel: 0,
      update() {},
      dispose() {},
    } satisfies WorldContract;
    const player = {
      position: new Vector3(0, 1, 0),
      heading: 0,
      name: "Jason",
      vehicle: null,
      aim: true,
      deadTimer: 0,
      hurt() {},
    } as unknown as Player;
    const vehicles = new VehicleSystem({ scene, shadows }),
      wanted = new WantedSystem();
    const director = new PoliceDirector(
        scene,
        shadows,
        world,
        vehicles,
        player,
        wanted,
      ),
      drivers: Driver[] = [];
    wanted.setLevel(5, player.position);
    let helicopterMax = 0,
      maxOfficers = 0,
      maxVehicles = 0;
    for (let i = 0; i < 2700; i++) {
      director.update(1 / 60, drivers, true);
      vehicles.update(1 / 60);
      physics._step(1 / 60);
      helicopterMax = Math.max(
        helicopterMax,
        drivers.find((d) => d.assignment === "air")?.v.root.position.y ?? 0,
      );
      maxOfficers = Math.max(maxOfficers, director.officers.length);
      maxVehicles = Math.max(maxVehicles, drivers.length);
    }
    assert.equal(drivers.filter((d) => d.assignment === "swat").length, 2);
    const roadblocks = drivers.filter((d) => d.assignment === "roadblock");
    assert.equal(roadblocks.length, 2);
    for (const d of roadblocks) {
      assert.ok(physics.getBodies().includes(d.v.body));
      assert.equal(d.v.input.handbrake, true);
    }
    assert.equal(drivers.filter((d) => d.assignment === "air").length, 1);
    assert.ok(
      helicopterMax > 18,
      `helicopter rose physically to ${helicopterMax}`,
    );
    assert.ok(maxOfficers <= 12 && maxVehicles <= 8);
    assert.equal(
      director.arrestProgress,
      0,
      "aiming suspect never accumulates compliant arrest",
    );
    t.diagnostic(
      JSON.stringify({
        helicopterMax,
        maxOfficers,
        maxVehicles,
        tacticalOfficers: director.stats.swat,
      }),
    );
    const meshesBeforeReset = scene.meshes.length;
    director.reset(drivers);
    assert.equal(vehicles.list.length, 0);
    assert.equal(director.officers.length, 0);
    assert.ok(scene.meshes.length < meshesBeforeReset - 100);
  } finally {
    scene.dispose();
    engine.dispose();
  }
});

test("directed pursuit routing avoids a closer dead end", () => {
  const roads = [
    { id: 0, x: 0, z: 0, next: [1, 2] },
    { id: 1, x: 0, z: 60, next: [1] },
    { id: 2, x: -50, z: 0, next: [3] },
    { id: 3, x: -50, z: 100, next: [4] },
    { id: 4, x: 0, z: 100, next: [] },
  ];
  assert.equal(laneNext(0, { x: 0, z: 100 }, roads), 2);
});
test("dispatch uses a lane behind the actual camera instead of popping into its visible approach", async () => {
  const { engine, scene, shadows } = await setup();
  try {
    const camera = new UniversalCamera(
      "player-view",
      new Vector3(0, 2, -8),
      scene,
    );
    camera.setTarget(new Vector3(0, 1, 100));
    scene.activeCamera = camera;
    camera.getViewMatrix(true);
    camera.getProjectionMatrix(true);
    const roads = [-180, -120, 120, 180].map((z, id) => ({
      id,
      x: 0,
      z,
      next: [(id + 1) % 4],
    }));
    const world = {
      spawn: new Vector3(0, 1, 0),
      obstacles: [],
      roads,
      locations: [],
      waterLevel: 0,
      update() {},
      dispose() {},
    } satisfies WorldContract;
    const player = {
      position: new Vector3(0, 1, 0),
      heading: 0,
      name: "Jason",
      vehicle: null,
      aim: false,
      deadTimer: 0,
      hurt() {},
    } as unknown as Player;
    const vehicles = new VehicleSystem({ scene, shadows }),
      wanted = new WantedSystem(),
      drivers: Driver[] = [];
    const director = new PoliceDirector(
      scene,
      shadows,
      world,
      vehicles,
      player,
      wanted,
    );
    wanted.setLevel(1, player.position);
    director.update(1 / 60, drivers, true);
    assert.equal(drivers.length, 1);
    assert.ok(
      drivers[0].v.root.position.z < -90,
      "response was spawned behind camera, beyond immediate view",
    );
    director.reset(drivers);
  } finally {
    scene.dispose();
    engine.dispose();
  }
});
test("civilian deletion/restoration retains unique stable IDs and disabled actors do not witness crimes", async () => {
  const { engine, scene, shadows } = await setup();
  try {
    const world = {
      spawn: new Vector3(0, 1, 0),
      obstacles: [],
      roads: [],
      locations: [],
      waterLevel: 0,
      update() {},
      dispose() {},
    } satisfies WorldContract;
    const player = {
      position: new Vector3(0, 1, 0),
      heading: 0,
      name: "Jason",
      vehicle: null,
      aim: false,
      deadTimer: 0,
      hurt() {},
    } as unknown as Player;
    const vehicles = new VehicleSystem({ scene, shadows }),
      wanted = new WantedSystem();
    const population = new Population(
      scene,
      shadows,
      world,
      vehicles,
      player,
      wanted,
    );
    const location = new Vector3(500, 0, 500),
      first = population.spawnPed(location),
      second = population.spawnPed(location);
    const removedId = first.id;
    first.model.dispose();
    population.pedestrians = population.pedestrians.filter((p) => p !== first);
    const third = population.spawnPed(location);
    assert.notEqual(third.id, second.id);
    const restored = population.spawnPed(location, undefined, true, removedId);
    assert.equal(restored.id, removedId);
    population.spawnPed(location, undefined, true, second.id);
    assert.equal(
      new Set(population.pedestrians.map((p) => p.id)).size,
      population.pedestrians.length,
    );
    assert.equal(population.witness(location), true);
    population.pedestrians.forEach((p) => p.model.root.setEnabled(false));
    assert.equal(population.witness(location), false);
    population.pedestrians.forEach((p) => p.model.dispose());
    population.reset();
  } finally {
    scene.dispose();
    engine.dispose();
  }
});
