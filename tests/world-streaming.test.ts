import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import HavokPhysics from "@babylonjs/havok";
import {
  DirectionalLight,
  HavokPlugin,
  Material,
  MeshBuilder,
  NullEngine,
  PhysicsAggregate,
  PhysicsShapeType,
  Scene,
  ShadowGenerator,
  Vector3,
  VertexBuffer,
  type PhysicsEngineV2,
} from "@babylonjs/core";
import {
  ChunkResidency,
  RESIDENCY_LIMITS,
  distanceToBounds,
} from "../src/world/ChunkResidency";
import {
  CITY_LAYOUT,
  createLaneGraph,
  RESTRICTED_COMPOUND,
} from "../src/world/layout";
import type { Obstacle } from "../src/core/contracts";

function fixture(context: TestContext) {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  scene.defaultMaterial = new Material("test/no-shaders", scene);
  const light = new DirectionalLight("test/sun", new Vector3(0, -1, 0), scene);
  const shadows = new ShadowGenerator(128, light);
  const streaming = new ChunkResidency(scene, shadows, Vector3.Zero());
  context.after(() => {
    streaming.dispose();
    shadows.dispose();
    scene.dispose();
    engine.dispose();
  });
  return { scene, shadows, streaming };
}

test("streamed mesh disposal releases scene geometry and reconstruction preserves transformed vertices/material", (context) => {
  const { scene, shadows, streaming } = fixture(context);
  const material = new Material("test/shared", scene);
  const near = MeshBuilder.CreateBox("chunk/near", { size: 3 }, scene);
  near.position.set(12, 3, 7);
  near.rotation.y = 0.41;
  near.material = material;
  near.receiveShadows = true;
  streaming.registerMesh(near, "detail", true);
  const original = Array.from(near.getVerticesData(VertexBuffer.PositionKind)!);
  const distant = MeshBuilder.CreateBox("chunk/far", { size: 4 }, scene);
  distant.position.set(1400, 2, 0);
  distant.material = material;
  streaming.registerMesh(distant, "detail", true);
  assert.ok(
    distant.isDisposed(),
    "far source mesh is disposed, not merely disabled",
  );
  assert.equal(scene.meshes.length, 1);
  assert.equal(scene.geometries.length, 1);
  const cpuBytes = streaming.getStats().cpuGeometryBytes;
  assert.ok(cpuBytes > 0);
  streaming.update(new Vector3(1400, 0, 0), 2);
  assert.ok(near.isDisposed());
  assert.equal(streaming.getResidentMesh("chunk/near"), null);
  assert.ok(streaming.getResidentMesh("chunk/far"));
  assert.equal(scene.meshes.length, 1);
  assert.equal(scene.geometries.length, 1);
  streaming.update(Vector3.Zero(), 2);
  const restored = streaming.getResidentMesh("chunk/near")!;
  assert.notEqual(restored, near);
  assert.equal(restored.material, material);
  const rebuilt = restored.getVerticesData(VertexBuffer.PositionKind)!;
  assert.equal(rebuilt.length, original.length);
  assert.ok(
    original.every((value, index) => Math.abs(value - rebuilt[index]) < 1e-5),
    "Float32 reconstruction preserves metre-scale vertices within 0.01 mm",
  );
  assert.equal(streaming.getStats().cpuGeometryBytes, cpuBytes);
  assert.equal(
    shadows.getShadowMap()!.renderList!.length,
    1,
    "shadow list does not retain disposed meshes",
  );
  for (let cycle = 0; cycle < 20; cycle++) {
    streaming.update(new Vector3(1400, 0, 0), 2);
    streaming.update(Vector3.Zero(), 2);
    assert.equal(scene.meshes.length, 1);
    assert.equal(scene.geometries.length, 1);
    assert.equal(shadows.getShadowMap()!.renderList!.length, 1);
  }
  assert.ok(
    scene.materials.includes(material),
    "streaming does not dispose shared materials",
  );
  context.diagnostic(
    `20 round trips: ${streaming.getStats().meshDisposals} actual mesh disposals; stable ${cpuBytes} CPU geometry bytes.`,
  );
});

test("visual work is budgeted and hysteresis avoids residency thrashing", (context) => {
  const { scene, streaming } = fixture(context);
  for (let i = 0; i < 30; i++) {
    const mesh = MeshBuilder.CreateBox(`chunk/${i}`, { size: 2 }, scene);
    mesh.position.set(1400 + i * 2, 1, 0);
    streaming.registerMesh(mesh, "detail");
  }
  streaming.update(new Vector3(1420, 0, 0), 3);
  assert.equal(streaming.getStats().residentMeshes, 3);
  assert.equal(streaming.getStats().lastMeshOperations, 3);
  assert.equal(streaming.getStats().pendingMeshes, 27);
  for (let i = 0; i < 10; i++) streaming.update(new Vector3(1420, 0, 0), 3);
  assert.equal(streaming.getStats().residentMeshes, 30);
  const before = streaming.getStats();
  const boundary = 1420 - RESIDENCY_LIMITS.detailLoad - 30;
  for (let i = 0; i < 20; i++)
    streaming.update(new Vector3(boundary + (i % 2 ? 4 : -4), 0, 0), 3);
  assert.equal(
    streaming.getStats().meshDisposals,
    before.meshDisposals,
    "small boundary motion stays inside unload hysteresis",
  );
  streaming.update(new Vector3(-2000, 0, 0), 3);
  assert.equal(streaming.getStats().residentMeshes, 27);
  assert.equal(streaming.getStats().lastMeshOperations, 3);
  assert.equal(
    distanceToBounds({ x: 2, z: 3 }, { minX: 0, maxX: 5, minZ: 0, maxZ: 5 }),
    0,
  );
});

test("active vehicle anchors retain Havok walls, global ground remains, and collider reloads do not leak bodies", async (context) => {
  const { scene, streaming } = fixture(context);
  const bytes = await readFile(
    new URL(
      "../node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm",
      import.meta.url,
    ),
  );
  const havok = await HavokPhysics({
    wasmBinary: bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer,
  });
  scene.enablePhysics(new Vector3(0, -9.81, 0), new HavokPlugin(false, havok));
  const physics = scene.getPhysicsEngine() as PhysicsEngineV2;
  streaming.registerCollider({
    id: "ground",
    x: 0,
    y: -0.5,
    z: 0,
    w: 5000,
    h: 1,
    d: 5000,
    global: true,
  });
  const obstacle: Obstacle = { x: 0, z: 7, w: 20, d: 0.5, height: 5 };
  streaming.registerCollider({
    id: "wall",
    x: 0,
    y: 2.5,
    z: 7,
    w: 20,
    h: 5,
    d: 0.5,
    obstacle,
  });
  const firstWall = obstacle.mesh!;
  const vehicle = MeshBuilder.CreateBox("test/active-body", { size: 1 }, scene);
  vehicle.position.set(0, 1.5, 0);
  const body = new PhysicsAggregate(
    vehicle,
    PhysicsShapeType.BOX,
    { mass: 300, friction: 0.5, restitution: 0 },
    scene,
  );
  context.after(() => {
    body.dispose();
    vehicle.dispose();
  });
  streaming.setActiveAnchors([vehicle.position]);
  streaming.update(new Vector3(1900, 0, 0));
  assert.equal(
    streaming.getColliderMesh("wall"),
    firstWall,
    "the distant active vehicle keeps local collision",
  );
  body.body.setLinearVelocity(new Vector3(0, 0, 12));
  for (let frame = 0; frame < 120; frame++) physics._step(1 / 60);
  assert.ok(
    vehicle.position.z < 6.7,
    "the active vehicle stops at its retained wall",
  );
  assert.ok(
    vehicle.position.y > 0.45,
    "global terrain continues to support the vehicle",
  );
  streaming.setActiveAnchors([]);
  streaming.update(new Vector3(1900, 0, 0));
  assert.ok(firstWall.isDisposed());
  assert.equal(obstacle.mesh, undefined);
  assert.ok(streaming.getColliderMesh("ground"));
  const unloadedBodies = physics.getBodies().length;
  for (let cycle = 0; cycle < 20; cycle++) {
    streaming.ensureCollision(Vector3.Zero());
    const restoredWall = streaming.getColliderMesh("wall");
    assert.ok(
      restoredWall && !restoredWall.isDisposed(),
      "collision is synchronously restored before simulation",
    );
    assert.equal(obstacle.mesh, restoredWall);
    assert.equal(physics.getBodies().length, unloadedBodies + 1);
    streaming.update(new Vector3(1900, 0, 0));
    assert.equal(physics.getBodies().length, unloadedBodies);
  }
  streaming.ensureCollision(Vector3.Zero());
  assert.notEqual(obstacle.mesh, firstWall);
  assert.equal(obstacle.x, 0);
  assert.equal(obstacle.z, 7);
  assert.equal(
    obstacle.w,
    20,
    "navigation metadata survives collider eviction",
  );
  context.diagnostic(
    `20 Havok unload/reload cycles: ${physics.getBodies().length} bodies including restored wall, unchanged navigation box.`,
  );
  streaming.registerCollider({id: "outside-vehicle-range", x: 165, y: 2, z: 0, w: 2, h: 4, d: 2});
  assert.ok(streaming.getColliderMesh("outside-vehicle-range"), "the player retains longer sight-line collision");
  streaming.setActiveAnchors([Vector3.Zero()]);
  streaming.update(new Vector3(1900, 0, 0));
  assert.ok(streaming.getColliderMesh("wall"), "a nearby moving body retains its wall");
  assert.equal(streaming.getColliderMesh("outside-vehicle-range"), null, "remote vehicle anchors do not retain an entire district");
});

test("west and south expansion preserves a strongly connected paved lane network", () => {
  const nodes = createLaneGraph();
  assert.ok(
    nodes.length > 284,
    "the graph extends beyond the original district",
  );
  assert.ok(nodes.some((n) => n.x < -400));
  assert.ok(nodes.some((n) => n.z < -275));
  for (const start of nodes) {
    const visited = new Set<number>(),
      queue = [start.id];
    while (queue.length) {
      const id = queue.pop()!;
      if (visited.has(id)) continue;
      visited.add(id);
      assert.ok(nodes[id].next.length > 0);
      queue.push(...nodes[id].next);
    }
    assert.equal(visited.size, nodes.length);
  }
  for (const node of nodes)
    for (const next of node.next) {
      const target = nodes[next];
      assert.ok(target);
      for (let step = 0; step <= 10; step++) {
        const t = step / 10,
          x = node.x + (target.x - node.x) * t,
          z = node.z + (target.z - node.z) * t;
        assert.ok(
          CITY_LAYOUT.xStreets.some((street) => Math.abs(x - street) <= 7.01) ||
            CITY_LAYOUT.zStreets.some((street) => Math.abs(z - street) <= 7.01),
          "lane segments stay inside road/intersection pavement",
        );
      }
    }
  assert.equal(RESTRICTED_COMPOUND.classification, "creative-mode addition");
  assert.ok(RESTRICTED_COMPOUND.entrance.x > RESTRICTED_COMPOUND.maxX);
});
