import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import HavokPhysics from "@babylonjs/havok";
import {
  DirectionalLight, HavokPlugin, Mesh, MeshBuilder, NullEngine, PhysicsAggregate,
  PhysicsCharacterController, PhysicsMotionType, PhysicsShapeContainer, PhysicsShapeType,
  Scene, ShadowGenerator, Vector3, type PhysicsEngineV2,
} from "@babylonjs/core";
import { VehicleSystem } from "../src/vehicles/VehicleSystem";
import { openVehicleDoor } from "../src/vehicles/VehicleEquipment";
import { MovementQueries } from "../src/gameplay/MovementQueries";
import type { VehicleExterior } from "../src/vehicles/VehicleExterior";
import { applyDoorPose } from '../src/vehicles/DoorPose';

async function fixture(concept = false) {
  const wasm = await readFile(new URL("../node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm", import.meta.url));
  const havok = await HavokPhysics({ wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer });
  const engine = new NullEngine(), scene = new Scene(engine);
  scene.enablePhysics(new Vector3(0, -9.81, 0), new HavokPlugin(true, havok));
  const physics = scene.getPhysicsEngine() as PhysicsEngineV2;
  const shadows = new ShadowGenerator(128, new DirectionalLight("sun", new Vector3(0, -1, 0), scene));
  const ground = MeshBuilder.CreateBox("ground", { width: 100, depth: 100, height: 1 }, scene);
  ground.position.y = -0.5;
  const floor = new PhysicsAggregate(ground, PhysicsShapeType.BOX, { mass: 0, friction: .7 }, scene);
  const asset = concept ? new Uint8Array(await readFile(new URL("../public/vehicles/concept/car-lod1-batched.glb", import.meta.url))) : undefined;
  const system = new VehicleSystem({ scene, shadows }, asset, true);
  if (concept) await system.prepareModel("concept");
  const car = system.spawn(concept ? "concept" : "sedan", new Vector3(0, .75, 0));
  const exterior = (system as unknown as { runtime: Map<string, { exterior: VehicleExterior }> }).runtime.get(car.id)!.exterior;
  const step = (n: number) => { for (let i = 0; i < n; i++) { system.update(1 / 60); physics._step(1 / 60); } };
  const sync = () => { exterior.update(); physics._step(1 / 60); };
  return { scene, physics, car, system, exterior, step, sync, dispose() { system.dispose(); floor.dispose(); scene.dispose(); engine.dispose(); } };
}

function center(mesh: Mesh) {
  mesh.computeWorldMatrix(true);
  return mesh.getBoundingInfo().boundingBox.centerWorld.clone();
}

test('an authored scissor hinge raises the physical door and stops against an overhead obstruction', async () => {
  const f = await fixture();
  try {
    const { car, system, scene, physics } = f;
    car.body.setMotionType(PhysicsMotionType.STATIC);
    const door = car.model.doors.find(d => d.front && d.side === -1)!;
    door.hingeAxis = Vector3.Right(); door.maxAngle = 1.15;
    const closed = center(door.mesh);
    openVehicleDoor(car, -1, 4);
    for (let i = 0; i < 30; i++) { system.equipment.update(1 / 60, [car], Vector3.Zero()); f.exterior.update(); }
    f.sync();
    const raised = center(door.mesh);
    assert.ok(raised.y > closed.y + .25, 'the complete source door rises about its authored front hinge');
    assert.ok(Math.abs(raised.x - closed.x) < .01, 'a scissor door does not use the conventional yaw swing');
    const normal = door.mesh.getDirection(Vector3.Right());
    assert.equal(physics.raycast(raised.subtract(normal.scale(.4)), raised.add(normal.scale(.04))).body, car.body);
    applyDoorPose(door, .75);
    const obstruction = MeshBuilder.CreateBox('scissor-door-overhang', { size: .22 }, scene);
    obstruction.position.copyFrom(center(door.mesh));
    door.angle = 0; applyDoorPose(door, 0);
    const beam = new PhysicsAggregate(obstruction, PhysicsShapeType.BOX, { mass: 0 }, scene);
    f.sync();
    for (let i = 0; i < 60; i++) { system.equipment.update(1 / 60, [car], Vector3.Zero()); f.exterior.update(); }
    assert.ok(door.angle < .75, `native obstruction blocks the rising panel at ${door.angle}`);
    beam.dispose(); obstruction.dispose();
    for (let i = 0; i < 30; i++) system.equipment.update(1 / 60, [car], Vector3.Zero());
    assert.ok(Math.abs(door.angle - door.maxAngle) < .001, 'removing the obstruction permits the authored opening');
    system.repair(car); f.sync();
    assert.equal(door.angle, 0); assert.ok(center(door.mesh).equalsWithEpsilon(closed, .001));
  } finally { f.dispose(); }
});

test('different front and rear tire radii drive suspension placement and native wheel contact', async () => {
  const f = await fixture();
  try {
    const { car, physics } = f;
    car.body.setMotionType(PhysicsMotionType.STATIC);
    for (const wheel of car.model.wheels) {
      wheel.radius = wheel.front ? .3305 : .35545;
      for (const mesh of [wheel.tire, wheel.rim]) mesh.scaling.set(wheel.radius / car.tuning.wheelRadius, 1, wheel.radius / car.tuning.wheelRadius);
    }
    f.step(2); f.sync();
    assert.equal(car.grounded, 4);
    for (const wheel of car.model.wheels) {
      const center = wheel.pivot.getAbsolutePosition();
      assert.ok(Math.abs(center.y - wheel.radius!) < .002, 'each tire rests at its own unloaded radius');
      const outside = center.add(new Vector3(Math.sign(wheel.local.x) * .12, 0, 0));
      const hit = physics.raycast(outside.add(new Vector3(0, -wheel.radius! + .002, 0)), outside);
      assert.equal(hit.body, car.body);
      assert.ok(Math.abs(hit.hitPointWorld.y - center.y + wheel.radius! - .025) < .004, `native cylinder uses each radius: center=${center.asArray()}, hit=${hit.hitPointWorld.asArray()}, radius=${wheel.radius}`);
    }
  } finally { f.dispose(); }
});

for (const concept of [false, true]) test(`${concept ? "imported concept" : "procedural sedan"} exterior follows real wheels, door geometry, mirrors and disabled parts on the same Havok body`, async context => {
  const f = await fixture(concept);
  try {
    const { car, physics, system } = f;
    car.body.setMotionType(PhysicsMotionType.STATIC);
    f.sync();
    const compound = car.body.shape as PhysicsShapeContainer;
    const children = compound.getNumChildren(), bodies = physics.getBodies().length;
    const mass = JSON.stringify(car.body.getMassProperties());
    assert.ok(children > 15, `separate narrow component instances: ${children}`);
    const wheel = car.model.wheels.find(w => w.front && w.local.x < 0)!;
    const wheelCenter = center(wheel.tire);
    const outerWheel = physics.raycast(wheelCenter.add(new Vector3(-1, 0, 0)), wheelCenter);
    assert.equal(outerWheel.body, car.body);
    assert.ok(outerWheel.hitPointWorld.x < wheelCenter.x - .09, `wheel side hit at ${outerWheel.hitPointWorld.x}`);
    wheel.tire.computeWorldMatrix(true);
    const visibleWheelMinimum = wheel.pivot.getHierarchyBoundingVectors(true).min.x;
    assert.ok(Math.abs(outerWheel.hitPointWorld.x - visibleWheelMinimum) < .025,
      `physical wheel side ${outerWheel.hitPointWorld.x} reaches visible tire/rim edge ${visibleWheelMinimum}`);
    const wheelPathX = outerWheel.hitPointWorld.x - .32 + .012;
    const wheelStart = new Vector3(wheelPathX, .94, wheelCenter.z - .45), wheelEnd = new Vector3(wheelPathX, .94, wheelCenter.z + .45);
    const wheelQuery = new MovementQueries(f.scene);
    assert.equal(wheelQuery.path(wheelStart, wheelEnd), false, "player capsule catches wheel beyond the chassis side");
    wheel.pivot.setEnabled(false); f.sync();
    if (!concept) assert.equal(wheelQuery.path(wheelStart, wheelEnd), true, "same capsule sweep is clear without that wheel");
    wheel.pivot.setEnabled(true); f.sync(); wheelQuery.dispose();
    assert.equal(physics.raycast(wheelCenter.add(new Vector3(-1, 0, 0)), wheelCenter, { ignoreBody: car.body }).hasHit, false);

    const door = car.model.doors.find(d => d.front && d.side === -1)!;
    const mirror = door.mesh.getChildMeshes().find(m => /mirror/i.test(m.name))! as Mesh;
    const closedMirror = center(mirror);
    assert.equal(physics.raycast(closedMirror.add(new Vector3(-.5, 0, 0)), closedMirror).body, car.body);
    openVehicleDoor(car, -1);
    for (let i = 0; i < 20; i++) { system.equipment.update(1 / 60, [car], Vector3.Zero()); f.exterior.update(); }
    f.sync();
    const openCenter = center(door.mesh), normal = door.mesh.getDirection(Vector3.Right()).normalize();
    assert.ok(openCenter.x < -car.tuning.width / 2 - .2);
    const from = openCenter.subtract(normal.scale(.4)), to = openCenter.add(normal.scale(.04));
    assert.equal(physics.raycast(from, to).body, car.body, "new door pose reaches native Havok collision");
    assert.equal(physics.raycast(from, to, { ignoreBody: car.body }).hasHit, false, "entry casts exclude all attached parts with the source body");
    assert.equal(physics.getBodies().length, bodies, "attached parts add no self-colliding bodies");
    assert.equal(JSON.stringify(car.body.getMassProperties()), mass, "animated membership preserves mass, COM and inertia");
    assert.equal(compound.getNumChildren(), children);

    const movedMirror = center(mirror), outward = door.mesh.getDirection(new Vector3(-1, 0, 0)).normalize();
    assert.equal(physics.raycast(movedMirror.add(outward.scale(.2)), movedMirror).body, car.body);
    door.mesh.setEnabled(false); f.sync();
    assert.equal(physics.raycast(from, to).hasHit, false, "removed door leaves its outboard space clear immediately");
    assert.ok(compound.getNumChildren() < children);
    assert.equal(JSON.stringify(car.body.getMassProperties()), mass);
    system.repair(car); f.sync();
    assert.equal(compound.getNumChildren(), children);
    assert.equal(door.angle, 0);
    assert.equal(physics.raycast(from, to).hasHit, false, "closing does not leave an invisible open-door barrier");
    context.diagnostic(`${children - 2} component instances share one chassis; outer wheel x=${outerWheel.hitPointWorld.x.toFixed(3)}m, open door x=${openCenter.x.toFixed(3)}m.`);
  } finally { f.dispose(); }
});

test("actual player-size Havok capsule is stopped by an open door beyond the chassis, then can walk through the released space", async context => {
  const f = await fixture();
  try {
    const { car } = f;
    car.body.setMotionType(PhysicsMotionType.STATIC);
    openVehicleDoor(car, -1);
    for (let i = 0; i < 20; i++) f.system.equipment.update(1 / 60, [car], Vector3.Zero());
    f.sync();
    const door = car.model.doors.find(d => d.front && d.side === -1)!;
    const bounds = door.mesh.getBoundingInfo().boundingBox;
    const point = Vector3.TransformCoordinates(new Vector3(bounds.center.x, bounds.center.y, bounds.minimum.z + .12), door.mesh.getWorldMatrix());
    const outward = door.mesh.getDirection(new Vector3(-1, 0, 0)).normalize();
    const start = point.add(outward.scale(1.1)); start.y = .94;
    const end = point.subtract(outward.scale(.65)); end.y = .94;
    const q = new MovementQueries(f.scene);
    assert.equal(q.path(start, end), false);
    assert.equal(q.path(start, end, car.body), true);
    q.dispose();
    const controller = new PhysicsCharacterController(start, { capsuleHeight: 1.8, capsuleRadius: .32 }, f.scene);
    controller.maxStepHeight = .36; controller.characterMass = 80; controller.characterStrength = 1600;
    const walk = () => {
      for (let i = 0; i < 35; i++) {
        const support = controller.checkSupport(1 / 60, new Vector3(0, -1, 0));
        controller.setVelocity(outward.scale(-3));
        controller.integrate(1 / 60, support, new Vector3(0, -9.81, 0));
        f.physics._step(1 / 60);
      }
      return Vector3.Dot(controller.getPosition().subtract(start), outward.scale(-1));
    };
    const blocked = walk();
    assert.ok(blocked < .95, `door stopped walking after ${blocked}m`);
    door.mesh.setEnabled(false); f.sync();
    controller.setPosition(start); controller.setVelocity(Vector3.Zero());
    const clear = walk();
    assert.ok(clear > blocked + .45 && clear > 1.5, `released opening permits ${clear}m`);
    controller.dispose();
    context.diagnostic(`Actual 1.8m/.32m controller traveled ${blocked.toFixed(3)}m into the attached door vs ${clear.toFixed(3)}m after removal.`);
  } finally { f.dispose(); }
});

test("a dynamic prop contacts the open exterior and detached assemblies retain independent compound collision", async context => {
  const f = await fixture();
  try {
    const { car, physics, system } = f;
    car.body.setMotionType(PhysicsMotionType.STATIC);
    openVehicleDoor(car, -1);
    for (let i = 0; i < 20; i++) system.equipment.update(1 / 60, [car], Vector3.Zero());
    f.sync();
    const door = car.model.doors.find(d => d.front && d.side === -1)!;
    const point = center(door.mesh), outward = door.mesh.getDirection(new Vector3(-1, 0, 0)).normalize();
    const prop = MeshBuilder.CreateSphere("contact prop", { diameter: .2 }, f.scene);
    prop.position.copyFrom(point.add(outward.scale(.6)));
    const aggregate = new PhysicsAggregate(prop, PhysicsShapeType.SPHERE, { mass: 15, restitution: 0 }, f.scene);
    aggregate.body.setGravityFactor(0); aggregate.body.setCollisionCallbackEnabled(true);
    let contacts = 0;
    aggregate.body.getCollisionObservable().add(event => { if (event.collidedAgainst === car.body || event.collider === car.body) contacts++; });
    aggregate.body.setLinearVelocity(outward.scale(-3));
    for (let i = 0; i < 25; i++) physics._step(1 / 60);
    const penetration = Vector3.Dot(prop.position.subtract(point), outward);
    assert.ok(contacts > 0, "native rigid body contact with outboard door");
    assert.ok(penetration > -.03, `sphere did not cross the door: ${penetration}`);
    aggregate.dispose(); prop.dispose();
    system.damage(car, 36, point);
    const fragment = f.scene.meshes.find(m => m.name.startsWith("debris-door-"))!;
    assert.ok(fragment.physicsBody);
    assert.ok((fragment.physicsBody!.shape as PhysicsShapeContainer).getNumChildren() > 1, "detached door retains glazing and mirror colliders");
    assert.equal(door.mesh.isEnabled(), false);
    f.sync();
    assert.ok((car.body.shape as PhysicsShapeContainer).getNumChildren() > 2);
    const before = physics.getBodies().length;
    system.remove(car);
    assert.ok(physics.getBodies().length < before - 1, "vehicle removal releases chassis plus its detached debris");
    context.diagnostic(`${contacts} Havok contact events; sphere stayed ${penetration.toFixed(3)}m outside the opened door plane.`);
  } finally { f.dispose(); }
});

for (const concept of [false, true]) test(`${concept ? "imported concept" : "procedural sedan"} door stops against a real wall without shoving its chassis and resumes when cleared`, async context => {
  const f = await fixture(concept);
  try {
    const { car, system, scene } = f;
    f.step(120);
    const start = car.root.position.clone();
    const wall = MeshBuilder.CreateBox("door clearance wall", { width: .1, height: 2.4, depth: 4 }, scene);
    wall.position.set(-1.47, 1.2, 0);
    const aggregate = new PhysicsAggregate(wall, PhysicsShapeType.BOX, { mass: 0 }, scene);
    openVehicleDoor(car, -1, 10);
    f.step(70);
    const door = car.model.doors.find(d => d.front && d.side === -1)!;
    const stopped = door.angle;
    assert.ok(stopped > (concept ? .06 : .12) && stopped < 1, `limited at ${stopped} radians`);
    assert.ok(Vector3.Distance(start, car.root.position) < .035, "the animated component cannot displace its chassis through the wall");
    for (const mesh of [door.mesh, ...door.mesh.getChildMeshes()]) {
      if (!mesh.isEnabled() || !mesh.getTotalVertices()) continue;
      mesh.computeWorldMatrix(true);
      assert.ok(mesh.getBoundingInfo().boundingBox.minimumWorld.x > -1.421, `${mesh.name} remains outside the wall`);
    }
    aggregate.dispose(); wall.dispose();
    f.step(25);
    assert.ok(door.angle > 1.1, "released door finishes opening");
    context.diagnostic(`Door stopped at ${(stopped * 180 / Math.PI).toFixed(1)} degrees; chassis displaced ${Vector3.Distance(start, car.root.position).toFixed(4)}m.`);
  } finally { f.dispose(); }
});

test("another moving vehicle makes real contact with the outboard open door", async context => {
  const f = await fixture();
  try {
    const { car, system, physics } = f;
    car.body.setMotionType(PhysicsMotionType.STATIC);
    openVehicleDoor(car, -1, 10);
    for (let i = 0; i < 20; i++) system.equipment.update(1 / 60, [car], Vector3.Zero());
    f.sync();
    const door = car.model.doors.find(d => d.front && d.side === -1)!;
    const bounds = door.mesh.getBoundingInfo().boundingBox;
    const point = Vector3.TransformCoordinates(new Vector3(bounds.center.x, bounds.center.y, bounds.minimum.z + .13), door.mesh.getWorldMatrix());
    const outward = door.mesh.getDirection(new Vector3(-1, 0, 0)).normalize();
    const other = system.spawn("coupe", point.add(outward.scale(3.15)), Math.atan2(-outward.x, -outward.z));
    other.root.position.y = .75;
    other.body.disablePreStep = false;
    other.body.setGravityFactor(0);
    other.body.setLinearVelocity(outward.scale(-2));
    const contacts: Vector3[] = [];
    other.body.getCollisionObservable().add(event => {
      if ((event.collider === car.body || event.collidedAgainst === car.body) && event.point) contacts.push(event.point.clone());
    });
    for (let i = 0; i < 75; i++) physics._step(1 / 60);
    assert.ok(contacts.some(p => p.x < -car.tuning.width / 2 - .15), `outboard contact points ${JSON.stringify(contacts.map(p => p.asArray()))}`);
    assert.ok(Vector3.Dot(other.root.position.subtract(point), outward) > other.tuning.length / 2 - .45, "moving car stopped outside open door");
    context.diagnostic(`${contacts.length} native car contacts, minimum contact x=${Math.min(...contacts.map(p => p.x)).toFixed(3)}m.`);
  } finally { f.dispose(); }
});

test("broken door glazing leaves a physical opening and repeated restored exteriors release Havok shapes", async context => {
  const f = await fixture();
  try {
    const { car, system, physics } = f;
    car.body.setMotionType(PhysicsMotionType.STATIC);
    openVehicleDoor(car, -1, 10);
    for (let i = 0; i < 20; i++) system.equipment.update(1 / 60, [car], Vector3.Zero());
    f.sync();
    const door = car.model.doors.find(d => d.front && d.side === -1)!;
    const window = door.mesh.getChildMeshes().find(m => m.name.startsWith("side-window"))! as Mesh;
    const point = center(window), normal = window.getDirection(Vector3.Right()).normalize();
    const from = point.subtract(normal.scale(.12)), to = point.add(normal.scale(.03));
    assert.equal(physics.raycast(from, to).body, car.body, "intact outboard glazing has collision");
    system.damage(car, 12, point);
    assert.equal(window.isEnabled(), false, "a local strike breaks the requested glass");
    for (let i = 0; i < 20; i++) physics._step(1 / 60);
    assert.notEqual(physics.raycast(from, to).body, car.body, "broken glass removes its attached collider");
    const saved = system.serialize(car);
    let restored = system.restore(saved);
    const shapeCount = () => (physics.getPhysicsPlugin() as unknown as { _shapes: Map<unknown, unknown> })._shapes.size;
    const before = shapeCount();
    for (let i = 0; i < 12; i++) {
      restored = system.restore(saved);
      assert.equal(shapeCount(), before, `replacement ${i} retains the native shape registry size`);
      assert.equal(restored.model.windows.filter(m => !m.isEnabled()).length, 1);
    }
    system.remove(restored);
    assert.equal(shapeCount(), 1, "all chassis, exterior, door query and fragment shapes released; only ground remains");
    context.diagnostic(`12 save replacements retained ${before} registered Havok shapes; vehicle removal left only the ground shape.`);
  } finally { f.dispose(); }
});
