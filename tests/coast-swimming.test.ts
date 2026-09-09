import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import HavokPhysics from '@babylonjs/havok';
import { DirectionalLight, HavokPlugin, NullEngine, Scene, ShadowGenerator, Vector3, type PhysicsEngineV2 } from '@babylonjs/core';
import { ChunkResidency } from '../src/world/ChunkResidency';
import { COAST, coastFloorHeight, seabedSlabs } from '../src/world/Coast';
import { Player } from '../src/gameplay/Player';
import { Swimming, type SwimWater } from '../src/gameplay/Swimming';
import { World } from '../src/world/World';
import { MovementQueries } from '../src/gameplay/MovementQueries';
import type { Input } from '../src/core/Input';

const water: SwimWater = {
  surfaceHeight: (x, z) => x >= COAST.shorelineX && Math.abs(z) <= 800 ? COAST.waterLevel : null,
  depthAt: (x, z) => x >= COAST.shorelineX && Math.abs(z) <= 800 ? Math.max(0, COAST.waterLevel - coastFloorHeight(x, z)) : 0,
};
async function fixture() {
  const bytes = await readFile(new URL('../node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm', import.meta.url));
  const havok = await HavokPhysics({ wasmBinary: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer });
  const engine = new NullEngine(), scene = new Scene(engine);
  scene.enablePhysics(new Vector3(0, -9.81, 0), new HavokPlugin(false, havok));
  const physics = scene.getPhysicsEngine() as PhysicsEngineV2;
  const shadows = new ShadowGenerator(128, new DirectionalLight('sun', new Vector3(0, -1, 0), scene));
  const ground = new ChunkResidency(scene, shadows, new Vector3(210, 1, 0));
  ground.registerCollider({ id: 'test/beach', x: 160, y: -.53, z: 0, w: 100, h: 1, d: 1600, global: true });
  seabedSlabs().forEach(slab => ground.registerCollider(slab));
  physics._step(1 / 60);
  return { scene, engine, physics, shadows, ground, dispose() { ground.dispose(); scene.dispose(); engine.dispose(); } };
}
test('authored slope collision matches water-depth queries across bank and offshore seabed', async t => {
  const f = await fixture(); t.after(() => f.dispose());
  for (const x of [210.1, 215, 228, 249.9, 250.1, 300, 399.9, 400.1, 2050]) {
    const hit = f.physics.raycast(new Vector3(x, 5, 0), new Vector3(x, -20, 0));
    assert.ok(hit.hasHit, `continuous physical bank at ${x}`);
    assert.ok(Math.abs(hit.hitPointWorld.y - coastFloorHeight(x, 0)) < .015, `visual/query and Havok floor agree at ${x}: ${hit.hitPointWorld.y}`);
  }
});
test('actual character walks down the bank, swims, dives without crossing the seabed, surfaces and walks ashore', async t => {
  const f = await fixture(); t.after(() => f.dispose());
  let horizontal = 1, descend = false, ascend = false;
  const input = { aim: false, mouseDown: false, dx: 0, dy: 0, down: (key: string) => key === 'crouch' ? descend : key === 'jump' ? ascend : false, axis: (key: string) => key === 'x' ? horizontal : 0, take: () => false } as unknown as Input;
  const p = new Player(f.scene, f.shadows, input, new Vector3(208, .94, 0)); p.water = water;
  f.physics._step(1 / 60);
  assert.equal(p.queries.clear(p.position), true, 'standing clearance excludes only the querying character capsule');
  assert.ok(Math.abs(p.queries.ground(p.position)!.y + .03) < .015, 'ground probe finds sand, not the top of the player capsule');
  assert.ok(p.controller.shape.filterMembershipMask !== 0, 'normal physical contacts are restored after each synchronous query');
  const steps = (count: number) => { for (let i = 0; i < count; i++) { p.update(1 / 60); f.physics._step(1 / 60); } };
  steps(1000);
  assert.ok(p.position.x > 239); assert.equal(p.swimming, true);
  horizontal = 0; steps(90);
  assert.ok(Math.abs(p.position.y - (COAST.waterLevel - .45)) < .08, 'body floats relative to the actual water datum');
  descend = true; steps(160); descend = false;
  assert.equal(p.swim.submerged, true); assert.ok(p.position.y > coastFloorHeight(p.position.x, 0) + .82, 'capsule remains above physical seabed');
  ascend = true; steps(65); ascend = false; steps(100);
  assert.equal(p.swim.submerged, false); assert.ok(p.swim.breath > 29);
  horizontal = -1; steps(1400);
  assert.ok(p.position.x < 209); assert.equal(p.swimming, false); assert.ok(p.position.y > .8, 'walks back onto supported dry sand');
  p.queries.dispose(); p.controller.dispose();
});
test('immersion ignores dry shallows, bridges and positions outside the ocean and tracks breath only below water', () => {
  const swim = new Swimming();
  for (const point of [new Vector3(205, 0, 0), new Vector3(211, .8, 0), new Vector3(240, 5, 0), new Vector3(240, -1, 900)]) { swim.update(point, water, 1); assert.equal(swim.active, false); }
  swim.update(new Vector3(250, -2, 0), water, 15); assert.equal(swim.submerged, true); assert.equal(swim.breath, 15);
  swim.update(new Vector3(250, -2, 0), water, 20); assert.equal(swim.breath, 0);
  swim.update(new Vector3(250, -.6, 0), water, 4); assert.equal(swim.submerged, false); assert.equal(swim.breath, 30);
});

test('fast travel restores destination colliders evicted while its visual packages are loading', async t => {
  const f = await fixture(); t.after(() => f.dispose());
  const destination = new Vector3(-700, 1.5, 0), origin = new Vector3(210, 1, 0);
  f.ground.registerCollider({ id: 'remote-sidewalk', x: -700, y: .055, z: 0, w: 58, h: .11, d: 58, global: false });
  const query = new MovementQueries(f.scene); t.after(() => query.dispose());
  const loadingWorld = {
    ready: Promise.resolve(), ensureCollision: (p: Vector3) => f.ground.ensureCollision(p),
    packages: { preparePosition: async () => {
      assert.ok(query.ground(destination), 'initial synchronous destination collision exists');
      await Promise.resolve(); f.ground.update(origin, 0);
      assert.equal(query.ground(destination), null, 'normal render residency can evict it during the load');
    } },
  };
  await World.prototype.preparePosition.call(loadingWorld as unknown as World, destination);
  assert.ok(Math.abs(query.ground(destination)!.y - .11) < .001, 'caller receives actual sidewalk support before resuming physics');
});
