import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import HavokPhysics from '@babylonjs/havok';
import { DirectionalLight, HavokPlugin, MeshBuilder, NullEngine, PhysicsAggregate, PhysicsShapeType, Scene, ShadowGenerator, Vector3, type PhysicsEngineV2 } from '@babylonjs/core';
import type { Input } from '../src/core/Input';
import type { WorldContract } from '../src/core/contracts';
import { Character } from '../src/gameplay/Character';
import { Player } from '../src/gameplay/Player';
import { Population } from '../src/gameplay/Population';
import { WantedSystem } from '../src/gameplay/Wanted';
import { parkedVehicleInput, vehicleSeatOffset } from '../src/gameplay/VehicleOccupancy';
import { VehicleSystem } from '../src/vehicles/VehicleSystem';

async function fixture() {
  const bytes = await readFile(new URL('../node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm', import.meta.url));
  const havok = await HavokPhysics({ wasmBinary: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer });
  const engine = new NullEngine(), scene = new Scene(engine);
  scene.enablePhysics(new Vector3(0, -9.81, 0), new HavokPlugin(false, havok));
  const physics = scene.getPhysicsEngine() as PhysicsEngineV2;
  const shadows = new ShadowGenerator(16, new DirectionalLight('sun', Vector3.Down(), scene));
  const input = { aim: false, down: () => false, take: () => false, axis: () => 0, dx: 0, dy: 0, gamepad: null } as unknown as Input;
  function box(name: string, position: Vector3, width: number, height: number, depth: number) {
    const mesh = MeshBuilder.CreateBox(name, { width, height, depth }, scene); mesh.position.copyFrom(position);
    const body = new PhysicsAggregate(mesh, PhysicsShapeType.BOX, { mass: 0 }, scene);
    return { dispose() { body.dispose(); mesh.dispose(); } };
  }
  box('ground', new Vector3(0, -.5, 0), 500, 1, 500);
  const player = new Player(scene, shadows, input, new Vector3(-2.5, .94, 0));
  const vehicles = new VehicleSystem({ scene, shadows });
  const car = vehicles.spawn('sedan', new Vector3(0, 1, 0));
  for (let frame = 0; frame < 120; frame++) { vehicles.update(1 / 60); physics._step(1 / 60); }
  player.model.position(new Vector3(-2.5, .04, 0));
  const step = (count: number) => { for (let frame = 0; frame < count; frame++) { player.update(1 / 60); player.occupancy.update(1 / 60); vehicles.update(1 / 60); physics._step(1 / 60); player.render(1 / 60, 1, false); } };
  return { scene, shadows, player, vehicles, car, physics, box, step, dispose() { player.controller.dispose(); player.queries.dispose(); vehicles.dispose(); scene.dispose(); engine.dispose(); } };
}

test('carjacking preserves the visible driver actor and locks held throttle until the player is seated', async t => {
  const f = await fixture(); t.after(() => f.dispose());
  const driver = new Character(f.scene, f.shadows, 'traffic-driver');
  let ejected = 0, destination: Vector3 | null = null;
  f.player.occupancy.register(f.car, driver, () => true, point => { ejected++; destination = point; });
  assert.ok(driver.root.position.equalsWithEpsilon(Vector3.TransformCoordinates(vehicleSeatOffset(f.car), f.car.root.getWorldMatrix()), .001));
  const start = driver.root.position.clone(), carStart = f.car.root.position.clone();
  assert.equal(f.player.enter(f.car), true);
  assert.equal(f.player.vehiclePhase, 'approaching');
  f.vehicles.control(f.car, { throttle: 1, steer: 1, lift: 1, brake: 0, handbrake: false });
  assert.deepEqual(f.car.input, parkedVehicleInput(f.car));
  f.step(22);
  assert.equal(f.player.vehiclePhase, 'ejecting-driver');
  f.step(20);
  assert.ok(Vector3.Distance(driver.root.position, start) > .1, 'former driver moves out visibly before the callback');
  assert.equal(ejected, 0);
  assert.equal(f.player.exit(), false, 'repeated interact cannot interrupt the handoff');
  f.step(80);
  assert.equal(ejected, 1); assert.ok(destination);
  assert.equal(driver.root.isDisposed(), false, 'the same hittable actor survives theft');
  assert.equal(f.player.occupancy.get(f.car), undefined);
  assert.equal(f.player.vehiclePhase, 'seated');
  assert.equal(f.player.model.root.parent, f.car.root);
  assert.equal(f.car.controlLocked, false);
  assert.ok(Vector3.Distance(f.car.root.position, carStart) < .2, 'held throttle did not drag the actors while entering');
  f.vehicles.control(f.car, { throttle: 1, steer: 0, lift: 0, brake: 0, handbrake: false });
  assert.equal(f.car.input.throttle, 1, 'driver control becomes available after seating');
  assert.equal(f.player.exit(), true); assert.equal(f.player.vehiclePhase, 'exiting');
  f.vehicles.control(f.car, { throttle: 1, steer: 1, lift: 1, brake: 0, handbrake: false });
  assert.deepEqual(f.car.input, parkedVehicleInput(f.car));
  f.step(45); assert.ok(f.player.vehicle === null, `dismount must complete: ${f.player.vehiclePhase}; ${f.player.interactionMessage}`); assert.equal(f.player.vehiclePhase, 'on-foot');
  assert.equal(f.player.model.root.parent, null); assert.deepEqual(f.car.input, parkedVehicleInput(f.car));
});

test('blocked driver door rejects carjacking without deleting crew or stealing controls', async t => {
  const f = await fixture(); t.after(() => f.dispose());
  const driver = new Character(f.scene, f.shadows, 'blocked-driver');
  let removed = false;
  f.player.occupancy.register(f.car, driver, () => true, () => { removed = true; });
  f.box('driver-side-wall', new Vector3(-1.7, 1, 0), .25, 2, 8); f.physics._step(1 / 60);
  const mask = f.player.controller.shape.filterMembershipMask;
  assert.equal(f.player.enter(f.car), false); assert.match(f.player.interactionMessage, /blocked/);
  assert.equal(f.player.controller.shape.filterMembershipMask, mask, 'blocked queries also restore physical collisions');
  assert.equal(f.player.vehicle, null); assert.equal(f.car.occupied, false); assert.equal(removed, false);
  assert.equal(f.player.occupancy.canDrive(f.car), true);
});

test('nearby entrant capsule does not block the former driver exit query', async t => {
  const f = await fixture(); t.after(() => f.dispose());
  const driver = new Character(f.scene, f.shadows, 'nearby-driver');
  f.player.occupancy.register(f.car, driver, () => true, () => {});
  // Normal street repro: the entrant stands within one capsule diameter of the
  // ejection destination while still outside the closed vehicle body.
  const nearby = f.car.root.position.add(f.car.root.right.scale(-f.car.tuning.width / 2 - .85)).add(f.car.root.forward.scale(-.36));
  nearby.y = .94;
  f.player.teleport(nearby); f.physics._step(1 / 60);
  const mask = f.player.controller.shape.filterMembershipMask;
  assert.equal(f.player.enter(f.car), true, f.player.interactionMessage);
  assert.equal(f.player.controller.shape.filterMembershipMask, mask, 'self-query exclusion restores physical collisions immediately');
});

test('population traffic has visible drivers, drives away under physics and retains a fleeing victim after theft', async t => {
  const f = await fixture(); t.after(() => f.dispose());
  f.vehicles.remove(f.car);
  const roads = Array.from({ length: 12 }, (_, id) => ({ id, x: 80 * Math.sin(id * Math.PI / 6), z: 80 * Math.cos(id * Math.PI / 6), next: [(id + 1) % 12] }));
  const world: WorldContract = { spawn: Vector3.Zero(), roads, locations: [], obstacles: [], waterLevel: -.35, update() {}, dispose() {} };
  const population = new Population(f.scene, f.shadows, world, f.vehicles, f.player, new WantedSystem());
  population.policeEnabled = false;
  assert.equal(population.drivers.length, 12);
  assert.equal(population.pedestrians.filter(ped => ped.vehicleId).length, 12);
  const starts = population.drivers.map(driver => driver.v.root.position.clone());
  for (let frame = 0; frame < 420; frame++) { population.update(1 / 60); f.vehicles.update(1 / 60); f.physics._step(1 / 60); }
  const distances = population.drivers.map((driver, index) => Vector3.Distance(driver.v.root.position, starts[index]));
  assert.ok(distances.filter(value => value > 8).length >= 8, `traffic must travel under real forces: ${distances}`);
  const victim = population.drivers[0], ped = population.pedestrians.find(ped => ped.vehicleId === victim.v.id)!;
  victim.v.input = parkedVehicleInput(victim.v);
  for (let frame = 0; frame < 180; frame++) { f.vehicles.update(1 / 60); f.physics._step(1 / 60); }
  f.player.occupancy.update(1 / 60);
  const left = victim.v.root.position.add(victim.v.root.right.scale(-2.5)); left.y = .94;
  f.player.teleport(left); f.player.model.position(left.subtract(new Vector3(0, .9, 0)));
  assert.equal(f.player.enter(victim.v), true, f.player.interactionMessage);
  for (let frame = 0; frame < 130; frame++) { f.player.update(1 / 60); population.update(1 / 60); f.vehicles.update(1 / 60); f.physics._step(1 / 60); }
  assert.equal(population.drivers.some(driver => driver.v === victim.v), false);
  assert.equal(population.pedestrians.includes(ped), true);
  assert.equal(ped.vehicleId, undefined); assert.equal(ped.activity, 'fleeing'); assert.ok(ped.panic > 0);
  const fled = ped.model.root.position.clone();
  for (let frame = 0; frame < 120; frame++) population.update(1 / 60);
  assert.ok(Vector3.Distance(ped.model.root.position, fled) > 5, 'victim runs away instead of vanishing or returning to the seat');
});
