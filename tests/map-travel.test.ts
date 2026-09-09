import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import HavokPhysics from '@babylonjs/havok';
import { HavokPlugin, MeshBuilder, NullEngine, PhysicsAggregate, PhysicsEngineV2, PhysicsShapeType, Scene, Vector3 } from '@babylonjs/core';
import { MapViewport, playableMapPoint } from '../src/ui/MapViewport';
import { MovementQueries } from '../src/gameplay/MovementQueries';
import { parseMapDestination, resolveTravelDestination } from '../src/gameplay/TravelDestination';

test('map projections round-trip at different zooms, preserve zoom focus and expose the complete bounded world', () => {
  const map = new MapViewport(); map.fit(1000, 620, [{x: -1100, z: 600}, {x: 155, z: -565}]);
  for (const point of [{x: -1050, z: 560}, {x: 3.3, z: -28}, {x: 250, z: -30}]) {
    const [x, y] = map.screen(point, 1000, 620), actual = map.world(x, y, 1000, 620);
    assert.ok(Math.hypot(actual.x - point.x, actual.z - point.z) < 1e-8);
  }
  const pin = map.world(230, 170, 1000, 620); map.zoomAt(2, 230, 170, 1000, 620);
  assert.ok(Math.hypot(...map.screen(pin, 1000, 620).map((v, i) => v - [230, 170][i])) < 1e-8);
  map.fit(1000, 620, [], true);
  for (const p of [{x: -1198, z: -798}, {x: 2098, z: 798}]) { const [x, y] = map.screen(p, 1000, 620); assert.ok(x >= 0 && x <= 1000 && y >= 0 && y <= 620); }
  assert.equal(playableMapPoint({x: 2500, z: 0}), false);
  assert.equal(parseMapDestination('{"x":"10","z":0}'), null);
  assert.equal(parseMapDestination('broken'), null);
  assert.equal(parseMapDestination('{"x":1e309,"z":0}'), null);
});

test('teleport selection uses actual Havok support and head clearance on street, roof, shore and water', async context => {
  const bytes = await readFile(new URL('../node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm', import.meta.url));
  const havok = await HavokPhysics({wasmBinary: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer});
  const engine = new NullEngine(), scene = new Scene(engine);
  scene.enablePhysics(new Vector3(0, -9.81, 0), new HavokPlugin(false, havok));
  const bodies: PhysicsAggregate[] = [];
  const box = (name: string, x: number, y: number, z: number, w: number, h: number, d: number) => { const mesh = MeshBuilder.CreateBox(name, {width: w, height: h, depth: d}, scene); mesh.position.set(x, y, z); bodies.push(new PhysicsAggregate(mesh, PhysicsShapeType.BOX, {mass: 0}, scene)); };
  box('street', 0, -.5, 0, 100, 1, 100);
  box('building', 12, 5, 0, 8, 10, 8);
  box('low canopy', -12, 1.2, 0, 3, .3, 3);
  box('seabed', 250, -5.5, 0, 100, 1, 100);
  box('pier', 270, 1, 0, 6, 1, 10);
  const queries = new MovementQueries(scene);
  context.after(() => { queries.dispose(); bodies.forEach(b => b.dispose()); scene.dispose(); engine.dispose(); });
  (scene.getPhysicsEngine() as PhysicsEngineV2)._step(1 / 60);
  const water = {surfaceHeight: (x: number) => x > 200 ? -.18 : null, depthAt: (x: number) => x > 200 ? 4.82 : 0};
  const street = resolveTravelDestination({x: 0, z: 0}, queries, water)!;
  assert.ok(Math.abs(street.y - .94) < .01 && queries.clear(street));
  const roof = resolveTravelDestination({x: 12, z: 0}, queries, water)!;
  assert.ok(Math.abs(roof.y - 10.94) < .01, 'rooftop has real support');
  const canopy = resolveTravelDestination({x: -12, z: 0}, queries, water, true)!;
  assert.ok(queries.clear(canopy), 'never leaves the standing capsule embedded in a canopy');
  const sea = resolveTravelDestination({x: 250, z: 0}, queries, water)!;
  assert.ok(Math.abs(sea.y + .63) < .001, 'ocean arrival floats at the surface rather than seabed');
  const pier = resolveTravelDestination({x: 270, z: 0}, queries, water)!;
  assert.ok(Math.abs(pier.y - 2.44) < .01, 'pier above water remains walkable');
  assert.equal(resolveTravelDestination({x: 600, z: 500}, queries, water), null, 'unloaded/unsupported destination cannot teleport into empty space');
  assert.equal(resolveTravelDestination({x: 2200, z: 0}, queries, water), null);
});
