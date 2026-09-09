import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import HavokPhysics from '@babylonjs/havok';
import { DirectionalLight, HavokPlugin, NullEngine, Scene, ShadowGenerator, Vector3, type PhysicsEngineV2 } from '@babylonjs/core';
import { VehicleSystem } from '../src/vehicles/VehicleSystem';
import { openVehicleDoor } from '../src/vehicles/VehicleEquipment';
import { serviceAtGarage } from '../src/gameplay/Garage';

async function fixture() {
  const wasm = await readFile(new URL('../node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm', import.meta.url));
  const havok = await HavokPhysics({ wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer });
  const engine = new NullEngine(), scene = new Scene(engine);
  scene.enablePhysics(new Vector3(0, -9.81, 0), new HavokPlugin(true, havok));
  const physics = scene.getPhysicsEngine() as PhysicsEngineV2;
  const shadows = new ShadowGenerator(128, new DirectionalLight('sun', new Vector3(0, -1, 0), scene));
  const system = new VehicleSystem({ scene, shadows });
  return { scene, system, physics, dispose() { system.dispose(); scene.dispose(); engine.dispose(); } };
}

test('entry doors swing around their hinge, close, detach with real Havok motion and restore without leaks', async context => {
  const f = await fixture();
  try {
    const car = f.system.spawn('sedan', new Vector3(0, 2, 0));
    assert.equal(car.model.doors.length, 4);
    const door = car.model.doors.find(d => d.front && d.side === -1)!;
    const window = door.mesh.getChildMeshes().find(m => m.name.startsWith('side-window'))!;
    const closedWindow = window.getAbsolutePosition().clone();
    openVehicleDoor(car, -1);
    for (let i = 0; i < 20; i++) f.system.equipment.update(1 / 60, [car], Vector3.Zero());
    window.computeWorldMatrix(true);
    assert.ok(door.angle > 0.9, 'front driver door opens during entry');
    assert.ok(window.getAbsolutePosition().x < closedWindow.x - 0.1, 'glazing moves outward with the door');
    for (let i = 0; i < 100; i++) f.system.equipment.update(1 / 60, [car], Vector3.Zero());
    assert.equal(door.angle, 0);
    door.mesh.computeWorldMatrix(true);
    f.system.damage(car, 36, door.mesh.getBoundingInfo().boundingBox.centerWorld.clone());
    assert.equal(door.mesh.isEnabled(), false, 'severe local strike removes door');
    const fragment = f.scene.meshes.find(m => m.name.startsWith('debris-door-'))!;
    assert.ok(fragment?.physicsBody, 'detached door has an independent physical body');
    const initial = fragment.position.clone();
    for (let i = 0; i < 20; i++) { f.system.update(1 / 60); f.physics._step(1 / 60); }
    assert.ok(Vector3.Distance(initial, fragment.position) > 0.1, 'door moves under inertia and gravity');
    assert.ok(fragment.getChildMeshes().every(m => m.metadata?.debris && !m.metadata?.vehicleId));
    car.headlights = false;
    const saved = f.system.serialize(car);
    let restored = f.system.restore(JSON.parse(JSON.stringify(saved)));
    assert.equal(restored.headlights, false);
    assert.deepEqual(f.system.serialize(restored).damage, saved.damage);
    const resources = () => [f.scene.meshes.length, f.scene.geometries.length, f.scene.materials.length, f.scene.lights.length, f.physics.getBodies().length];
    const before = resources();
    for (let i = 0; i < 10; i++) restored = f.system.restore(saved);
    assert.deepEqual(resources(), before);
    f.system.repair(restored);
    assert.ok(restored.model.doors.every(d => d.mesh.isEnabled() && d.angle === 0));
    context.diagnostic('32 kg door fragment physically separated; 10 replacements retained damage with stable scene/body/light resources.');
  } finally { f.dispose(); }
});

test('headlight budget stays fixed, broken lenses extinguish beams and brake/siren controls change lamps', async () => {
  const f = await fixture();
  try {
    const cars = Array.from({ length: 12 }, (_, i) => f.system.spawn(i === 0 ? 'police' : 'coupe', new Vector3(i * 6, 1, 0)));
    const car = cars[0];
    f.system.equipment.update(0.05, cars, Vector3.Zero());
    assert.equal(f.system.equipment.beams.length, 4);
    assert.equal(f.system.equipment.beams.filter(l => l.isEnabled()).length, 4);
    cars[11].occupied = true;
    f.system.equipment.update(0.05, cars, Vector3.Zero());
    assert.ok(f.system.equipment.beams[0].position.x > 60, 'occupied vehicle keeps its beams when other cars are nearer the camera');
    cars[11].root.setEnabled(false);
    f.system.equipment.update(0.05, cars, Vector3.Zero());
    assert.ok(f.system.equipment.beams[0].position.x < 10, 'hidden vehicles cannot occupy the beam pool');
    cars[11].occupied = false; cars[11].root.setEnabled(true);
    f.system.equipment.update(0.05, [car], Vector3.Zero());
    assert.equal(f.system.equipment.beams.filter(l => l.isEnabled()).length, 2);
    const front = car.model.lights.find(m => m.name.startsWith('headlight'))!;
    f.system.damage(car, 8, front.getAbsolutePosition());
    f.system.equipment.update(0.05, [car], Vector3.Zero());
    assert.ok(f.system.equipment.beams.filter(l => l.isEnabled()).length < 2);
    const tail = car.model.materials.find(m => m.name.startsWith('taillight'))!;
    const idle = tail.emissiveColor.r;
    car.input.brake = 1;
    car.siren = true;
    f.system.equipment.update(0.05, [car], Vector3.Zero());
    assert.ok(tail.emissiveColor.r > idle * 4);
    const red = car.model.materials.find(m => m.name.startsWith('police-red'))!;
    const blue = car.model.materials.find(m => m.name.startsWith('police-blue'))!;
    assert.notEqual(red.emissiveColor.r > 1, blue.emissiveColor.b > 1);
    car.headlights = false;
    f.system.equipment.update(0.05, [car], Vector3.Zero());
    assert.ok(f.system.equipment.beams.every(l => !l.isEnabled()));
  } finally { f.dispose(); }
});

test('garage charges only valid stopped-car services and paint persists through damage, repair and restore', async () => {
  const f = await fixture();
  try {
    const car = f.system.spawn('coupe', new Vector3(0, 1, 0));
    const garages = [{ id: 'garage', name: 'Sunset Customs', type: 'garage', x: 0, z: 0 }];
    const oldColor = car.model.materials.find(m => m.name.startsWith('paint-'))!.albedoColor.toHexString();
    assert.equal(serviceAtGarage(f.system, car, garages, 74, 'paint', '#BA283B').applied, false);
    assert.equal(car.model.materials.find(m => m.name.startsWith('paint-'))!.albedoColor.toHexString(), oldColor);
    car.speed = 3;
    assert.equal(serviceAtGarage(f.system, car, garages, 1000, 'repair').applied, false);
    car.speed = 0;
    assert.equal(serviceAtGarage(f.system, car, [], 1000, 'paint', '#BA283B').applied, false);
    const transaction = serviceAtGarage(f.system, car, garages, 1000, 'paint', '#ba283b');
    assert.equal(transaction.cash, 925); assert.equal(transaction.applied, true);
    f.system.damage(car, 45);
    const repair = serviceAtGarage(f.system, car, garages, transaction.cash, 'repair');
    assert.equal(repair.cash, 775); assert.equal(car.health, 100);
    const saved = f.system.serialize(car), restored = f.system.restore(saved);
    assert.equal(saved.paint, '#BA283B');
    assert.equal(restored.model.materials.find(m => m.name.startsWith('paint-'))!.albedoColor.toHexString(), '#BA283B');
    assert.throws(() => f.system.restore({ ...saved, paint: 'not-a-color' }), /paint/);
    assert.ok(f.system.list.includes(restored), 'bad paint cannot replace a live saved ID');
  } finally { f.dispose(); }
});
