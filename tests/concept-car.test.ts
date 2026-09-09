import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import HavokPhysics from "@babylonjs/havok";
import { DirectionalLight, HavokPlugin, MeshBuilder, NullEngine, PhysicsAggregate, PhysicsShapeType, Scene, ShadowGenerator, Vector3, VertexBuffer, type PhysicsEngineV2 } from "@babylonjs/core";
import { VehicleSystem } from "../src/vehicles/VehicleSystem";
import { openVehicleDoor } from "../src/vehicles/VehicleEquipment";

async function fixture() {
  const wasm = await readFile(new URL("../node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm", import.meta.url));
  const havok = await HavokPhysics({ wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer });
  const engine = new NullEngine(), scene = new Scene(engine);
  scene.enablePhysics(new Vector3(0, -9.81, 0), new HavokPlugin(true, havok));
  const physics = scene.getPhysicsEngine() as PhysicsEngineV2;
  const shadows = new ShadowGenerator(128, new DirectionalLight("sun", new Vector3(0, -1, 0), scene));
  const ground = MeshBuilder.CreateBox("ground", { width: 500, depth: 500, height: 1 }, scene); ground.position.y = -0.5;
  const aggregate = new PhysicsAggregate(ground, PhysicsShapeType.BOX, { mass: 0 }, scene);
  const asset = await readFile(new URL("../public/vehicles/concept/car.glb", import.meta.url));
  const system = new VehicleSystem({ scene, shadows }, new Uint8Array(asset), true);
  await system.prepareModel("concept");
  return { scene, system, physics, step(n: number) { for (let i = 0; i < n; i++) { system.update(1 / 60); physics._step(1 / 60); } }, dispose() { system.dispose(); aggregate.dispose(); scene.dispose(); engine.dispose(); } };
}

test("licensed concept car has neutral wheel axles and real suspension, acceleration, steering and attached doors", async context => {
  const f = await fixture();
  try {
    const car = f.system.spawn("concept", new Vector3(0, 0.9, 0));
    assert.equal(car.model.wheels.length, 4);
    assert.equal(car.model.doors.length, 2);
    assert.ok(car.model.windows.length >= 5);
    assert.ok(car.model.panels.length >= 10);
    for (const wheel of car.model.wheels) {
      const bounds = wheel.tire.getHierarchyBoundingVectors(true), size = bounds.max.subtract(bounds.min);
      assert.ok(size.x < 0.4 && size.y > 0.7 && size.z > 0.7, `neutral wheel extents ${size.asArray()}`);
    }
    const door = car.model.doors[0], window = door.mesh.getChildMeshes().find(mesh => /BodyDoorLWindow$/.test(mesh.name))!;
    const before = window.getBoundingInfo().boundingBox.centerWorld.clone();
    openVehicleDoor(car, -1);
    for (let i = 0; i < 20; i++) f.system.equipment.update(1 / 60, [car], Vector3.Zero());
    window.computeWorldMatrix(true);
    assert.ok(window.getBoundingInfo().boundingBox.centerWorld.x < before.x - 0.1);
    f.step(120);
    assert.equal(car.grounded, 4);
    assert.ok(car.root.position.y > 0.45 && car.root.position.y < 0.85, `ride height ${car.root.position.y}`);
    f.system.control(car, { throttle: 1, steer: 0, brake: 0, handbrake: false, lift: 0 });
    f.step(240);
    assert.ok(car.forwardSpeed > 17, `forward speed ${car.forwardSpeed}`);
    assert.ok(Math.abs(car.model.wheels[0].rolling!.rotation.x) > 5);
    const heading = car.heading;
    f.system.control(car, { throttle: 0.5, steer: 0.6, brake: 0, handbrake: false, lift: 0 });
    f.step(60);
    assert.ok(car.heading > heading + 0.1, `right turn ${car.heading - heading}`);
    context.diagnostic(`Havok driving: ${car.forwardSpeed.toFixed(2)} m/s, heading ${car.heading.toFixed(3)}, body height ${car.root.position.y.toFixed(3)} m.`);
  } finally { f.dispose(); }
});

test("dense body dents are isolated, compact, restorable and repairable, and removed doors have independent collision", async context => {
  const f = await fixture();
  try {
    let car = f.system.spawn("concept", new Vector3(0, 0.7, 0));
    const neighbor = f.system.spawn("concept", new Vector3(8, 0.7, 0));
    const hood = (v: typeof car) => v.model.panels.find(mesh => /BodyHood$/.test(mesh.name))!;
    const vertices = (v: typeof car) => Array.from(hood(v).getVerticesData(VertexBuffer.PositionKind)!);
    const pristine = vertices(car);
    f.system.damage(car, 22, car.root.position.add(new Vector3(0, 0.05, 1.9)));
    assert.notDeepEqual(vertices(car), pristine);
    assert.deepEqual(vertices(neighbor), pristine, "damage cannot mutate another instance or cached geometry");
    const door = car.model.doors[0]; door.mesh.computeWorldMatrix(true);
    f.system.damage(car, 36, door.mesh.getBoundingInfo().boundingBox.centerWorld.clone());
    assert.equal(door.mesh.isEnabled(), false);
    const debris = f.scene.meshes.find(mesh => mesh.metadata?.debris && /BodyDoorLColor1/.test(mesh.name))!;
    assert.ok(debris?.physicsBody);
    const initial = debris.position.clone(); f.step(10);
    assert.ok(Vector3.Distance(initial, debris.position) > 0.05);
    const saved = f.system.serialize(car);
    assert.equal(saved.damage.deformation!.length, 405);
    assert.equal(saved.damage.panels.length, 0);
    assert.ok(JSON.stringify(saved).length < 15000, "save contains the bounded lattice, not all dense body vertices");
    car = f.system.restore(saved);
    assert.deepEqual(f.system.serialize(car).damage, saved.damage);
    const resources = () => [f.scene.meshes.length, f.scene.geometries.length, f.scene.materials.length, f.scene.transformNodes.length, f.physics.getBodies().length];
    const baseline = resources();
    for (let i = 0; i < 5; i++) car = f.system.restore(saved);
    assert.deepEqual(resources(), baseline);
    const invalid = structuredClone(saved); invalid.damage.deformation!.pop();
    assert.throws(() => f.system.restore(invalid));
    assert.ok(f.system.list.includes(car), "invalid save preserves the living vehicle");
    f.system.repair(car);
    const repaired = vertices(car);
    assert.ok(repaired.every((n, i) => Math.abs(n - pristine[i]) < 0.00001));
    assert.ok(car.model.doors.every(door => door.mesh.isEnabled()));
    f.system.remove(neighbor);
    const fresh = f.system.spawn("concept", new Vector3(8, 0.7, 0));
    assert.deepEqual(vertices(fresh), pristine);
    context.diagnostic(`405-coordinate lattice; damaged vehicle save ${JSON.stringify(saved).length} bytes; five replacements have stable scene/physics resources.`);
  } finally { f.dispose(); }
});
