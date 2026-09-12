import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import HavokPhysics from "@babylonjs/havok";
import { DirectionalLight, HavokPlugin, Mesh, MeshBuilder, NullEngine, PhysicsAggregate, PhysicsShapeType, Scene, ShadowGenerator, StandardMaterial, Vector3, VertexData, type PhysicsEngineV2 } from "@babylonjs/core";
import { StreetObjectAuthoring } from "../src/world/authoring/StreetObjectAuthoring";
import { batchStreetObjects } from "../src/world/authoring/batchStreetObjects";
import { StreetObjects } from "../src/world/StreetObjectSystem";
import { validateStreetObjects } from "../src/world/StreetObjectRecords";
import type { Obstacle, WorldContract } from "../src/core/contracts";
import { DamageSystem } from "../src/gameplay/Damage";
import { VehicleSystem } from "../src/vehicles/VehicleSystem";

async function fixture() {
  const bytes = await readFile(new URL("../node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm", import.meta.url));
  const havok = await HavokPhysics({ wasmBinary: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer });
  const engine = new NullEngine(), scene = new Scene(engine);
  scene.enablePhysics(new Vector3(0, -9.81, 0), new HavokPlugin(false, havok));
  const physics = scene.getPhysicsEngine() as PhysicsEngineV2;
  const shadows = new ShadowGenerator(16, new DirectionalLight("sun", Vector3.Down(), scene));
  const ground = MeshBuilder.CreateBox("ground", { width: 120, depth: 120, height: 1 }, scene); ground.position.y = -.5;
  const floor = new PhysicsAggregate(ground, PhysicsShapeType.BOX, { mass: 0, friction: .7 }, scene);
  const metal = new StandardMaterial("lamp-metal", scene), leaf = new StandardMaterial("palm-leaf", scene), light = new StandardMaterial("street-light", scene);
  const collected: Mesh[] = [];
  const author = new StreetObjectAuthoring({ registerMesh(mesh: Mesh) { collected.push(mesh); return mesh.id; } });
  const lights: Vector3[] = [];
  for (const [kind, x] of [["lamppost", 0], ["lamppost", 8], ["palm", 16]] as const) {
    author.begin(kind, x, 0);
    const trunk = MeshBuilder.CreateCylinder(kind === "palm" ? "palm-trunk" : "lamp-post", { height: 6, diameter: .3 }, scene);
    trunk.position.set(x, 3, 0); author.add(trunk, metal);
    if (kind === "lamppost") {
      const housing = MeshBuilder.CreateBox("lamp-housing", { width: 1, height: .2, depth: .4 }, scene); housing.position.set(x + .5, 6, 0); author.add(housing, metal);
      const emitter = MeshBuilder.CreateBox("lamp-emitter", { width: .7, height: .04, depth: .3 }, scene); emitter.position.set(x + .5, 5.9, 0); author.add(emitter, light); lights.push(emitter.position.clone());
    } else {
      const crown = MeshBuilder.CreateBox("palm-frond", { width: 4, height: .06, depth: 1 }, scene); crown.position.set(x, 6, 0); author.add(crown, leaf);
    }
    author.end();
  }
  const batches = batchStreetObjects(collected, author.records);
  const obstacles: Obstacle[] = [];
  const street = new StreetObjects(scene, obstacles, lights, shadows); street.register(author.records); street.mount(batches);
  const world: WorldContract = { spawn: Vector3.Zero(), roads: [], obstacles, locations: [], waterLevel: -.18, streetObjects: street, update() {}, dispose() {} };
  const damage = new DamageSystem(scene, shadows, world, false);
  const step = (count: number, vehicles?: VehicleSystem) => { for (let i = 0; i < count; i++) { vehicles?.update(1 / 60); damage.update(1 / 60, "Clear"); physics._step(1 / 60); scene.onAfterPhysicsObservable.notifyObservers(scene); } };
  return { scene, physics, shadows, floor, street, damage, batches, definitions: author.records, lights, obstacles, step,
    dispose() { damage.dispose(); street.dispose(); batches.forEach(m => m.dispose()); floor.dispose(); scene.dispose(); engine.dispose(); } };
}

test("intact street objects keep shared batches while native collision stops a body at the actual lamp", async t => {
  const f = await fixture(); t.after(() => f.dispose());
  assert.equal(f.definitions.length, 3); assert.equal(f.batches.length, 3, "three material batches, not one draw for every object part");
  assert.equal(f.street.getStats().extractedMeshes, 0);
  const lamp = [...f.street.objects.values()][0];
  const ray = f.physics.raycast(new Vector3(-1, 1, 0), new Vector3(1, 1, 0));
  assert.equal(ray.body, lamp.body);
  assert.ok(Math.abs(ray.hitPointWorld.x + .15) < .02, "narrow cylinder tracks visible pole width");
  const prop = MeshBuilder.CreateSphere("incoming prop", { diameter: .3 }, f.scene); prop.position.set(-1.2, 1, 0);
  const body = new PhysicsAggregate(prop, PhysicsShapeType.SPHERE, { mass: 12 }, f.scene); body.body.setGravityFactor(0); body.body.setLinearVelocity(new Vector3(3, 0, 0));
  f.step(30);
  assert.ok(prop.position.x < -.20, `sphere stopped before pole: ${prop.position.x}`);
  assert.equal(lamp.fallen, false, "minor contact cannot uproot a lamp");
  body.dispose(); prop.dispose(); t.diagnostic(JSON.stringify(f.street.getStats()));
});

test("projectile destruction extracts the same visible object, clears only its intact spans, and preserves fall/light/nav state through reload", async t => {
  const f = await fixture(); t.after(() => f.dispose());
  const lamp = [...f.street.objects.values()][0], sibling = [...f.street.objects.values()][1];
  const original = new Map(f.batches.map(mesh => [mesh.id, Array.from(mesh.getIndices()!)]));
  for (let i = 0; i < 15; i++) f.damage.hitStreetObject(lamp, 30, new Vector3(0, 1, -.1), "projectile", new Vector3(0, 0, 1));
  assert.equal(lamp.fallen, true); assert.equal(sibling.fallen, false); assert.equal(f.lights.length, 1);
  assert.equal(lamp.parts.size, 2, "same metal and emitter geometry extracted");
  for (const range of lamp.definition.visuals!) {
    const batch = f.batches.find(m => m.id === range.batch)!;
    assert.ok(Array.from(batch.getIndices()!.slice(range.indexStart, range.indexStart + range.indexCount)).every(i => i === range.vertexStart), "intact object is hidden, not duplicated");
    const siblingRange = sibling.definition.visuals!.find(r => r.batch === range.batch)!;
    assert.deepEqual(Array.from(batch.getIndices()!.slice(siblingRange.indexStart, siblingRange.indexStart + siblingRange.indexCount)), original.get(batch.id)!.slice(siblingRange.indexStart, siblingRange.indexStart + siblingRange.indexCount), "neighbor remains intact in shared batch");
  }
  f.step(360);
  assert.ok(Math.abs(lamp.rotation.x) + Math.abs(lamp.rotation.z) > .35, `pole physically falls: ${lamp.rotation.asArray()}`);
  assert.ok(lamp.obstacle.w > 1 || lamp.obstacle.d > 1, "navigation now sees the fallen pole footprint");
  const saved = f.street.serialize(); assert.ok(validateStreetObjects(saved));
  const pose = lamp.position.clone(), rotation = lamp.rotation.clone();
  f.street.updateResidency(new Vector3(2000, 0, 2000)); assert.equal(lamp.body, undefined);
  f.street.restore(JSON.parse(JSON.stringify(saved))); f.street.ensureCollision(Vector3.Zero());
  assert.ok(lamp.position.equalsWithEpsilon(pose, .001)); assert.ok(lamp.rotation.equalsWithEpsilon(rotation, .001));
  assert.equal(lamp.fallen, true); assert.equal(lamp.health, 0); assert.equal(f.lights.length, 1);
  f.street.restore([]); assert.equal(lamp.fallen, false); assert.equal(f.lights.length, 2); assert.equal(f.street.getStats().extractedMeshes, 0);
  for (const batch of f.batches) assert.deepEqual(Array.from(batch.getIndices()!), original.get(batch.id));
  t.diagnostic(`Physical fallen quaternion ${rotation.asArray()}; compact saved delta ${JSON.stringify(saved).length} bytes.`);
});

test("actual vehicle impact breaks an authored lamppost and blast/fire affect a palm through the shared damage path", async t => {
  const f = await fixture(); t.after(() => f.dispose());
  const lamp = [...f.street.objects.values()][0], palm = [...f.street.objects.values()][2];
  const vehicles = new VehicleSystem({ scene: f.scene, shadows: f.shadows }); t.after(() => vehicles.dispose());
  const car = vehicles.spawn("sedan", new Vector3(0, .8, -12));
  car.body.setLinearVelocity(new Vector3(0, 0, 19));
  for (let i = 0; i < 150 && !lamp.fallen; i++) f.step(1, vehicles);
  assert.ok(lamp.fallen, `real crash must break the pole, health ${lamp.health}, carz ${car.root.position.z}`);
  f.damage.explosion(new Vector3(16, .8, -1), 520); f.step(180, vehicles);
  assert.equal(palm.fallen, true); assert.ok(palm.burning > 0); assert.ok(palm.parts.size > 0);
  assert.ok(Math.abs(palm.rotation.x) + Math.abs(palm.rotation.z) > .2, "original crown/trunk geometry moves with Havok fall");
  assert.ok(f.street.serialize().some(s => s.id === palm.definition.id && s.fallen));
});

test("street-object save validation rejects malformed or duplicated authored deltas", () => {
  const valid = { id: "street-object/palm/0/0", health: 0, burning: 2, fallen: true, position: [0, 0, 0], rotation: [0, 0, 0, 1], velocity: [0, 0, 0], angularVelocity: [0, 0, 0] };
  assert.ok(validateStreetObjects([valid]));
  assert.equal(validateStreetObjects([valid, valid]), false);
  assert.equal(validateStreetObjects([{ ...valid, rotation: [0, 0, 0, 0] }]), false);
  assert.equal(validateStreetObjects([{ ...valid, position: [0, Infinity, 0] }]), false);
  assert.equal(validateStreetObjects([{ ...valid, burning: -1 }]), false);
});

test("solid cover blocks blast and fire exposure; a burning fallen palm keeps pose and heat across save/load, then rain extinguishes it", async t => {
  const f = await fixture(); t.after(() => f.dispose());
  const palm = [...f.street.objects.values()][2];
  const wall = MeshBuilder.CreateBox("blast-cover", { width: 8, height: 5, depth: .3 }, f.scene); wall.position.set(16, 2.5, -1.2);
  const cover = new PhysicsAggregate(wall, PhysicsShapeType.BOX, { mass: 0 }, f.scene);
  f.damage.explosion(new Vector3(16, .8, -2.5), 520);
  assert.equal(palm.health, palm.definition.health); assert.equal(palm.burning, 0);
  cover.dispose(); wall.dispose();
  f.damage.explosion(new Vector3(16, .8, -1), 520);
  assert.ok(palm.body!.getLinearVelocity().length() < 10, "authored blast impulse is applied once, without the generic debris impulse a second time");
  f.step(120);
  assert.ok(palm.fallen && palm.burning > 0);
  const saved = JSON.parse(JSON.stringify(f.street.serialize())), pose = palm.position.clone(), rotation = palm.rotation.clone();
  const obstacle = { ...palm.obstacle }, fire = palm.burning;
  f.street.updateResidency(new Vector3(2000, 0, 2000)); f.street.restore(saved); f.street.ensureCollision(pose);
  assert.ok(palm.position.equalsWithEpsilon(pose, .001) && palm.rotation.equalsWithEpsilon(rotation, .001));
  for (const key of ["x", "z", "w", "d", "height"] as const)
    assert.ok(Math.abs(palm.obstacle[key] - obstacle[key]) < .001, `saved navigation ${key} stays within 1 mm`);
  assert.equal(palm.burning, fire);
  const target = pose.add(new Vector3(0, .5, -1));
  assert.ok(f.damage.heatAt(target) > 0, "street fire participates in shared player heat damage");
  const barrier = MeshBuilder.CreateBox("heat-cover", { width: 4, height: 3, depth: .15 }, f.scene);
  barrier.position.copyFrom(pose.add(new Vector3(0, 1.5, -.5)));
  const heatCover = new PhysicsAggregate(barrier, PhysicsShapeType.BOX, { mass: 0 }, f.scene);
  assert.equal(f.damage.heatAt(target), 0, "solid cover blocks heat");
  heatCover.dispose(); barrier.dispose();
  f.damage.update(3, "Rain");
  assert.equal(palm.burning, 0); assert.equal(f.damage.heatAt(target), 0);
  assert.equal(palm.fallen, true, "extinguishing does not regrow the fallen palm");
});

test("eight real geometry eviction/reload cycles retain damage without duplicate meshes or leaking native shapes", async t => {
  const f = await fixture(); t.after(() => f.dispose());
  const files = f.batches.map(mesh => ({ id: mesh.id, data: VertexData.ExtractFromMesh(mesh, true, true), material: mesh.material, metadata: { ...mesh.metadata } }));
  const lamp = [...f.street.objects.values()][0];
  f.damage.hitStreetObject(lamp, 450, new Vector3(0, 1, 0), "impact", new Vector3(0, 0, 1)); f.step(240);
  const saved = f.street.serialize(), position = lamp.position.clone();
  const counts = () => ({ meshes: f.scene.meshes.length, geometry: f.scene.geometries.length, bodies: f.physics.getBodies().length,
    shapes: (f.physics.getPhysicsPlugin() as unknown as { _shapes: Map<unknown, unknown> })._shapes.size });
  const baseline = counts();
  for (let cycle = 0; cycle < 8; cycle++) {
    if (cycle % 2) f.street.updateResidency(new Vector3(2000, 0, 2000));
    f.street.unmount(f.batches); f.batches.splice(0).forEach(mesh => mesh.dispose(false, false));
    f.street.updateResidency(new Vector3(2000, 0, 2000));
    assert.equal(f.street.getStats().extractedMeshes, 0);
    assert.equal(f.physics.getBodies().length, 1, "only ground body stays resident");
    assert.equal(counts().shapes, 3, "ground plus two reusable street primitives remain");
    assert.equal(f.scene.meshes.length, 1, "physics-first or geometry-first eviction leaves no detached object roots");
    f.street.restore(saved);
    assert.ok(lamp.obstacle.w > 1 || lamp.obstacle.d > 1, "remote restored fallen geometry retains its navigation footprint without resident meshes");
    f.street.ensureCollision(Vector3.Zero());
    for (const file of files) {
      const mesh = new Mesh(file.id, f.scene); file.data.applyToMesh(mesh, false); mesh.material = file.material; mesh.metadata = { ...file.metadata }; f.batches.push(mesh);
    }
    f.street.mount(f.batches);
    assert.deepEqual(counts(), baseline, `cycle ${cycle} resource counts`);
    assert.ok(lamp.fallen && lamp.position.equalsWithEpsilon(position, .001));
    assert.equal(lamp.parts.size, 2); assert.equal(f.lights.length, 1);
  }
  t.diagnostic(JSON.stringify({ cycles: 8, ...baseline, ...f.street.getStats() }));
});

test("fallen bodies unload before the static cleanup queue can drop their streamed support", async t => {
  const f = await fixture(); t.after(() => f.dispose());
  const lamp = [...f.street.objects.values()][0];
  f.damage.hitStreetObject(lamp, 450, new Vector3(0, 1, 0), "impact", new Vector3(0, 0, 1)); f.step(360);
  const pose = lamp.position.clone();
  f.street.register(Array.from({ length: 40 }, (_, index) => ({ ...lamp.definition, id: `street-object/lamppost/queue-${index}`, position: [20 + index, 0, 20] as [number, number, number], meshes: [], visuals: [] })));
  // Authoring order must not decide which fallen objects lose their support.
  f.street.objects.delete(lamp.definition.id); f.street.objects.set(lamp.definition.id, lamp);
  f.floor.dispose(); f.street.updateResidency(new Vector3(2000, 0, 2000));
  assert.ok(!lamp.body, "dynamic fallen object has priority over the24 static-body eviction budget");
  f.step(12); assert.ok(lamp.position.equalsWithEpsilon(pose, .001), "remote snapshot cannot fall while awaiting static cleanup");
});
