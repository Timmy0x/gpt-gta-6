import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import HavokPhysics from '@babylonjs/havok';
import { DirectionalLight, HavokPlugin, MeshBuilder, NullEngine, PhysicsAggregate, PhysicsShapeType, Scene, ShadowGenerator, SpotLight, Vector3, type PhysicsEngineV2 } from '@babylonjs/core';
import type { WorldContract } from '../src/core/contracts';
import type { Player } from '../src/gameplay/Player';
import { WantedSystem } from '../src/gameplay/Wanted';
import { Officer } from '../src/gameplay/police/Officer';
import { PoliceDirector, type Driver } from '../src/gameplay/police/PoliceDirector';
import { policeGroundHeight } from '../src/gameplay/police/groundSupport';
import { vehicleFootRoute } from '../src/gameplay/police/vehicleFootRoute';
import { VehicleSystem, type Vehicle } from '../src/vehicles/VehicleSystem';

async function fixture(groundY: number, sourced = false) {
  const wasm = await readFile(new URL('../node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm', import.meta.url));
  const havok = await HavokPhysics({ wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer });
  const engine = new NullEngine(), scene = new Scene(engine);
  scene.enablePhysics(new Vector3(0, -9.81, 0), new HavokPlugin(true, havok));
  const physics = scene.getPhysicsEngine() as PhysicsEngineV2;
  const shadows = new ShadowGenerator(16, new DirectionalLight('sun', Vector3.Down(), scene));
  const objects: PhysicsAggregate[] = [];
  const box = (name: string, x: number, y: number, z: number, width: number, height: number, depth: number) => {
    const mesh = MeshBuilder.CreateBox(name, { width, height, depth }, scene);
    mesh.position.set(x, y, z);
    const body = new PhysicsAggregate(mesh, PhysicsShapeType.BOX, { mass: 0 }, scene);
    objects.push(body);
    return { mesh, body };
  };
  const floor = box('floor', 0, groundY - .5, 0, 800, 1, 800);
  let available = true;
  const world: WorldContract & { floorHeightAt?: (x: number, z: number) => number | null } = {
    spawn: new Vector3(0, groundY + .94, 0), roads: [], obstacles: [], locations: [], waterLevel: groundY,
    update() {}, dispose() {},
    ...(sourced ? { hasGroundCoverage: () => available, floorHeightAt: () => available ? groundY : null } : {}),
  };
  const player = { position: world.spawn.clone(), heading: 0, name: 'Jason', vehicle: null, aim: false, deadTimer: 0, hurt() {} } as unknown as Player;
  const wanted = new WantedSystem(), vehicles = new VehicleSystem({ scene, shadows });
  const director = new PoliceDirector(scene, shadows, world, vehicles, player, wanted);
  const internal = director as unknown as { dismount: (o: Officer, v: Vehicle) => void; drive: (dt: number, d: Driver, drivers: Driver[]) => void; spawnTimer: number; searchlight: SpotLight };
  internal.spawnTimer = Infinity;
  const drivers: Driver[] = [];
  const step = (frames: number) => { for (let i = 0; i < frames; i++) { vehicles.update(1 / 60); physics._step(1 / 60); } };
  const responder = (kind: 'police' | 'helicopter' = 'police') => {
    const vehicle = vehicles.spawn(kind, new Vector3(0, groundY + (kind === 'helicopter' ? 1.8 : 1), 0));
    const officer = new Officer(`officer-${director.officers.length + 1}`, 'patrol', vehicle.id, scene, shadows);
    director.officers.push(officer);
    const driver: Driver = { v: vehicle, police: true, previous: -1, target: -1, stuck: 0, assignment: kind === 'helicopter' ? 'air' : 'patrol' };
    drivers.push(driver);
    return { vehicle, officer, driver };
  };
  return { groundY, scene, shadows, physics, box, floor, world, player, wanted, vehicles, director, internal, drivers, step, responder,
    supported(value: boolean) { available = value; },
    dispose() { director.removeResponse(drivers); vehicles.dispose(); objects.forEach(o => o.dispose()); scene.dispose(); engine.dispose(); },
  };
}

for (const groundY of [-22, 0, 20]) test(`a police cabin dismount uses native ground at ${groundY}m and remains supported`, async t => {
  const f = await fixture(groundY, groundY < 0); t.after(() => f.dispose());
  const { vehicle, officer } = f.responder(); f.step(120);
  assert.ok(vehicle.grounded > 0);
  f.internal.dismount(officer, vehicle);
  assert.equal(officer.state, 'pursuit'); assert.ok(officer.controller);
  assert.ok(Math.abs(officer.position.y - groundY - .94) < .01);
  for (let i = 0; i < 180; i++) { officer.move(1 / 60, Vector3.Zero(), 0, false); f.physics._step(1 / 60); }
  assert.ok(officer.position.y > groundY + .85 && officer.position.y < groundY + 1.1, `supported center ${officer.position.y}`);
  assert.ok(Math.abs(officer.position.x) > vehicle.tuning.width / 2 + .34);
});

test('native capsule sweeps reject both door exits through an unlisted wall', async t => {
  const f = await fixture(-22, true); t.after(() => f.dispose());
  const { vehicle, officer } = f.responder(); f.step(120);
  for (const x of [-1.7, 1.7]) f.box('door-wall', x, -20.5, 0, .1, 3, 10);
  f.physics._step(1 / 60);
  assert.deepEqual(f.world.obstacles, [], 'walls deliberately absent from coarse route obstacles');
  f.internal.dismount(officer, vehicle);
  assert.equal(officer.state, 'riding'); assert.equal(officer.controller, null);
});

test('a blocked standing capsule, missing physical ground, shoreline and airborne cabin all retain the seated officer', async t => {
  const f = await fixture(-22, true); t.after(() => f.dispose());
  const { vehicle, officer } = f.responder(); f.step(120);
  f.supported(false); f.internal.dismount(officer, vehicle);
  assert.equal(officer.state, 'riding'); assert.equal(officer.controller, null);
  f.supported(true);
  const low = f.box('low-clearance', 0, -20.45, 0, 8, .2, 10); f.physics._step(1 / 60);
  f.internal.dismount(officer, vehicle); assert.equal(officer.state, 'riding'); low.body.dispose(); low.mesh.dispose();
  f.floor.body.dispose(); f.floor.mesh.dispose(); vehicle.grounded = 4;
  f.internal.dismount(officer, vehicle); assert.equal(officer.state, 'riding', 'source terrain alone never authorizes a dismount without native support');
  f.box('replacement-floor', 0, -22.5, 0, 800, 1, 800); f.physics._step(1 / 60);
  vehicle.grounded = 0; const before = officer.model.root.position.clone();
  f.internal.dismount(officer, vehicle);
  assert.equal(officer.state, 'riding'); assert.equal(officer.controller, null); assert.ok(before.equals(officer.model.root.position));
});

test('fatal fallback poses preserve the negative world height without a sea-level jump', async t => {
  const f = await fixture(-22, true); t.after(() => f.dispose());
  const { vehicle, officer } = f.responder(); f.step(120); f.internal.dismount(officer, vehicle);
  const before = officer.model.root.position.y;
  f.director.hurtOfficer(officer, 500);
  assert.equal(officer.health, 0); assert.equal(officer.controller, null);
  assert.ok(officer.model.root.position.y < -20);
  assert.ok(Math.abs(officer.model.root.position.y - before) < .5);
});

for (const groundY of [-22, 20]) test(`air contact altitude is measured above ${groundY}m terrain`, async t => {
  const f = await fixture(groundY, true); t.after(() => f.dispose());
  const { vehicle } = f.responder('helicopter');
  f.director.officers.forEach(o => o.dispose()); f.director.officers = [];
  f.wanted.setLevel(4, f.player.position);
  vehicle.root.position.y = groundY + 10; f.director.update(1 / 60, f.drivers, true);
  assert.equal(f.wanted.visibility, 0);
  vehicle.root.position.y = groundY + 16; f.director.update(1 / 60, f.drivers, true);
  assert.equal(f.wanted.visibility, 1, 'negative world Y does not suppress an airborne observer');
  f.supported(false); f.director.update(1 / 60, f.drivers, true);
  assert.equal(f.wanted.visibility, 0, 'unavailable terrain does not provide an invented altitude datum');
});

for (const groundY of [-22, 0, 20]) test(`police helicopter control targets and searchlight follow ${groundY}m terrain`, async t => {
  const f = await fixture(groundY, true); t.after(() => f.dispose());
  const { vehicle, driver } = f.responder('helicopter');
  f.wanted.setLevel(4, { x: 0, z: 100 });
  f.internal.searchlight = new SpotLight('fixture-searchlight', Vector3.Zero(), Vector3.Down(), .75, 2, f.scene);
  vehicle.root.position.set(0, groundY + 58, 0); f.internal.drive(1 / 60, driver, f.drivers);
  assert.equal(vehicle.input.lift, 0);
  assert.equal(vehicle.input.throttle, .5);
  const target = new Vector3(0, groundY + .6, 100), expected = target.subtract(vehicle.root.position).normalize();
  assert.ok(f.internal.searchlight.direction.equalsWithEpsilon(expected, .00001));
  vehicle.root.position.y = groundY + 20; f.internal.drive(1 / 60, driver, f.drivers);
  assert.equal(vehicle.input.throttle, 0, 'translation waits for terrain clearance'); assert.equal(vehicle.input.lift, 1);
  f.supported(false); f.internal.drive(1 / 60, driver, f.drivers);
  assert.equal(vehicle.input.throttle, 0); assert.equal(vehicle.input.lift, 0); assert.equal(f.internal.searchlight.isEnabled(), false);
});

test('air support climbs toward higher sourced terrain and holds before an unsupported search destination', async t => {
  const f = await fixture(-22, true); t.after(() => f.dispose());
  const { vehicle, driver } = f.responder('helicopter');
  f.wanted.setLevel(4, { x: 0, z: 100 }); vehicle.root.position.set(0, 36, 0);
  f.world.floorHeightAt = (_x, z) => -22 + Math.min(10, Math.max(0, z / 10));
  f.internal.drive(1 / 60, driver, f.drivers);
  assert.equal(vehicle.input.lift, 1, 'pilot climbs above rising terrain before translating');
  f.world.hasGroundCoverage = (_x, z) => z < 50;
  f.internal.drive(1 / 60, driver, f.drivers);
  assert.equal(vehicle.input.lift, 0); assert.equal(vehicle.input.throttle, 0);
});

test('a negative-height police helicopter reaches its terrain-relative hover using Havok forces', async t => {
  const f = await fixture(-22, true); t.after(() => f.dispose());
  const { vehicle, driver } = f.responder('helicopter'); vehicle.occupied = true;
  f.wanted.setLevel(4, f.player.position);
  let highest = 0;
  for (let frame = 0; frame < 60 * 45; frame++) {
    f.internal.drive(1 / 60, driver, f.drivers); f.step(1);
    highest = Math.max(highest, vehicle.root.position.y - f.groundY);
  }
  const altitude = vehicle.root.position.y - f.groundY;
  t.diagnostic(JSON.stringify({ altitude, highest, position: vehicle.root.position.asArray() }));
  assert.ok(altitude > 54 && altitude < 62, 'pilot stabilizes near 58m over local terrain');
  assert.ok(highest < 65, 'the sea-level target would incorrectly climb another 22m');
});

test('source holes and unavailable native terrain never become an implicit zero-height floor', async t => {
  const f = await fixture(-22, true); t.after(() => f.dispose());
  assert.equal(policeGroundHeight(f.scene, f.world, new Vector3(0, 36, 0)), -22);
  f.supported(false); assert.equal(policeGroundHeight(f.scene, f.world, new Vector3(0, 36, 0)), null);
  f.floor.body.dispose(); f.floor.mesh.dispose();
  delete f.world.floorHeightAt; delete f.world.hasGroundCoverage;
  assert.equal(policeGroundHeight(f.scene, f.world, new Vector3(0, 36, 0)), null);
});

test('legacy positive-height worlds use native terrain for aircraft rather than a zero floor', async t => {
  const f = await fixture(20); t.after(() => f.dispose());
  assert.ok(Math.abs(policeGroundHeight(f.scene, f.world, new Vector3(0, 80, 0))! - 20) < .001);
});

for (const groundY of [-22, 20]) test(`vehicle foot routes consider only overlapping vertical bodies at ${groundY}m`, async t => {
  const f = await fixture(groundY); t.after(() => f.dispose());
  const vehicle = f.vehicles.spawn('police', new Vector3(0, groundY + 1, 0)); f.step(120);
  const start = new Vector3(-8, groundY + .94, 0), goal = { x: 8, z: 0 };
  const path = vehicleFootRoute(start, goal, [], [], [vehicle]);
  assert.ok(path.length > 1, 'parked cars block the direct walking line at every elevation');
  vehicle.root.position.y = groundY + 15;
  assert.deepEqual(vehicleFootRoute(start, goal, [], [], [vehicle]), [goal], 'overhead bodies do not block the ground route');
  const roads = [{ id: 0, x: -8, y: groundY, z: 0, next: [] }];
  assert.deepEqual(vehicleFootRoute({ x: -8, z: 0 }, goal, roads, [], [vehicle]), [goal], '2D callers can use supplied lane elevation');
});
