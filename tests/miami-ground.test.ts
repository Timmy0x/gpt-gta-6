import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import HavokPhysics from '@babylonjs/havok';
import { HavokPlugin, Mesh, NullEngine, PhysicsAggregate, PhysicsShapeType, Scene, Vector3, VertexData, type PhysicsEngineV2 } from '@babylonjs/core';
import { buildMiamiRoads, buildMiamiLaneGraph, createMiamiDryRouteFilter } from '../src/world/miami/MiamiRoads';
import { buildMiamiTerrain, createMiamiTerrainQueries, createMiamiDryCoverage } from '../src/world/miami/MiamiTerrain';
import { miamiPolygonGeometry, miamiRectangle } from '../src/world/miami/MiamiGeometry';
import type { MiamiAreaFeature, MiamiMeshRecord, MiamiRoadFeature } from '../src/world/miami/types';

const road = (id: string, centerline: MiamiRoadFeature['centerline'], extra: Partial<MiamiRoadFeature> = {}): MiamiRoadFeature => ({
  id, name: id, centerline, widthM: 8, sidewalkWidthM: 2, lanes: 2, oneway: false, layer: 0, bridge: false, tunnel: false, roadClass: 'residential',
  sourceIds: ['fixture/survey'], confidence: 'surveyed', widthConfidence: 'surveyed', gaps: [], ...extra,
});
const area = (id: string, polygons: MiamiAreaFeature['polygons'], elevationM: number): MiamiAreaFeature => ({ id, name: id, polygons, elevationM, sourceIds: ['fixture/survey'], confidence: 'surveyed', gaps: [] });
async function native(records: MiamiMeshRecord[]) {
  const bytes = await readFile(new URL('../node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm', import.meta.url));
  const havok = await HavokPhysics({ wasmBinary: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer });
  const engine = new NullEngine(), scene = new Scene(engine); scene.enablePhysics(new Vector3(0, -9.81, 0), new HavokPlugin(false, havok));
  const aggregates: PhysicsAggregate[] = [];
  for (const record of records) {
    const mesh = new Mesh(record.id, scene), data = new VertexData();
    data.positions = record.positions; data.indices = record.indices; data.normals = record.normals; data.uvs = record.uvs; data.applyToMesh(mesh);
    if (record.collision) aggregates.push(new PhysicsAggregate(mesh, PhysicsShapeType.MESH, { mass: 0, friction: record.friction, restitution: record.restitution }, scene));
  }
  const physics = scene.getPhysicsEngine() as PhysicsEngineV2; physics._step(1 / 60);
  return { scene, physics,
    height(x: number, z: number, fromY = 20): number | null { const hit = physics.raycast(new Vector3(x, fromY, z), new Vector3(x, -20, z)); return hit.hasHit ? hit.hitPointWorld.y : null; },
    dispose() { aggregates.forEach(aggregate => aggregate.dispose()); scene.dispose(); engine.dispose(); },
  };
}

test('polygon extrusion retains a real courtyard hole, metre UVs and upward surface normals', () => {
  const outline = miamiRectangle(0, 0, 20, 20), hole = miamiRectangle(5, 5, 15, 15)[0];
  const geometry = miamiPolygonGeometry([[outline[0], hole]], 3, 0);
  let topArea = 0;
  for (let n = 0; n < geometry.indices.length; n += 3) {
    const points = geometry.indices.slice(n, n + 3).map(index => geometry.positions.slice(index * 3, index * 3 + 3));
    if (!points.every(point => point[1] === 3)) continue;
    const [a, b, c] = points; topArea += Math.abs((b[0] - a[0]) * (c[2] - a[2]) - (c[0] - a[0]) * (b[2] - a[2])) / 2;
    for (const index of geometry.indices.slice(n, n + 3)) assert.ok(geometry.normals[index * 3 + 1] > .99);
  }
  assert.ok(Math.abs(topArea - 300) < 1e-8, 'the 100 square metre hole is not covered by triangles');
  assert.equal(geometry.uvs[2], 20, 'twenty geographic metres remain twenty UV metres');
});

test('a thin source clipping triangle retains its exact world vertices without a false relative-area failure', () => {
  const ring: [number, number][] = [[-601.9038606335955, -185.63933894638285], [-601.9038524367285, -185.45925577194254], [-601.9037430155897, -183.05529995489212]];
  const geometry = miamiPolygonGeometry([[ring]], 1.5);
  assert.equal(geometry.indices.length, 3); assert.deepEqual(geometry.positions, ring.flatMap(([x, z]) => [x, 1.5, z])); assert.ok(geometry.normals.every(Number.isFinite));
  assert.throws(() => miamiPolygonGeometry([[[[0, 0], [1, 1], [2, 2]]]], 1.5), /triangulation failed/, 'a truly zero-area triangle remains invalid');
});

test('native crossing has unobstructed asphalt, physical curbs and sidewalks, and separate bridge levels', async t => {
  const features = [road('east-west', [[-60, 1.5, 0], [60, 1.5, 0]], { widthM: 12 }), road('north-south', [[0, 1.5, -60], [0, 1.5, 60]]),
    road('bridge', [[-60, 6, 30], [60, 6, 30]], { layer: 1, bridge: true, sidewalkWidthM: 0 })];
  const records = buildMiamiRoads(features, { tileM: 32 }), f = await native(records); t.after(() => f.dispose());
  for (let x = -16; x <= 16; x += .5) assert.ok(Math.abs(f.height(x, 0)! - 1.525) < .002, `intersection asphalt remains clear at x=${x}`);
  assert.ok(Math.abs(f.height(4.09, 20)! - 1.675) < .002, 'curb is a collidable 15 cm rise');
  assert.ok(Math.abs(f.height(5.3, 20)! - 1.675) < .002, 'sidewalk is an actual supported surface');
  assert.ok(Math.abs(f.height(0, 30)! - 6.025) < .002, 'bridge deck retains its mapped elevation');
  assert.ok(Math.abs(f.height(0, 30, 4)! - 1.525) < .002, 'lower road remains traversable beneath the bridge');
  assert.ok(records.every(record => record.sourceIds.includes('fixture/survey') && record.positions.every(Number.isFinite)));
  assert.ok(records.length > 3, 'large road networks are split into bounded residency records');
});

test('native river and island outlines agree with swimming floor queries, without a solid water surface', async t => {
  const waterPolygon = [miamiRectangle(-8, -100, 8, 100)[0], miamiRectangle(-2, -2, 2, 2)[0]];
  const dataset = { bounds: { minX: -80, maxX: 80, minZ: -80, maxZ: 80 }, land: [area('land', [miamiRectangle(-100, -100, 100, 100)], 1.5)], water: [area('river', [waterPolygon], 0)] };
  const records = buildMiamiTerrain(dataset, { tileM: 32 }), queries = createMiamiTerrainQueries(dataset), f = await native(records); t.after(() => f.dispose());
  for (const [x, z, expected] of [[20, 10, 1.5], [0, 10, -8], [0, 0, 1.5], [-7, -20, -8]] as const) {
    assert.ok(Math.abs(f.height(x, z)! - expected) < .002, `native floor at ${x},${z}`);
    assert.equal(queries.floorHeightAt(x, z), expected);
  }
  assert.equal(queries.waterLevelAt(0, 10), 0); assert.equal(queries.waterLevelAt(0, 0), null, 'an island inside a source water hole stays dry');
  assert.equal(f.height(90, 0), null, 'AOI clipping does not invent terrain outside the selected geography');
  assert.ok(records.filter(record => record.kind === 'waterbed').every(record => record.confidence === 'inferred' && record.gaps.some(gap => gap.includes('bathymetry'))));
});

test('lane graph follows source one-way direction and separates grade-crossing connections', () => {
  const roads = [road('inbound', [[-30, 0, 0], [0, 0, 0]], { oneway: true }), road('outbound', [[0, 0, 0], [30, 0, 0]], { oneway: true }), road('overpass', [[0, 6, 0], [0, 6, 30]], { layer: 1, oneway: true })];
  const nodes = buildMiamiLaneGraph(roads);
  const entry = nodes.find(node => node.x === -30)!, visited = new Set<number>(), pending = [entry.id];
  while (pending.length) { const id = pending.pop()!; if (visited.has(id)) continue; visited.add(id); pending.push(...nodes[id].next); }
  assert.ok([...visited].some(id => nodes[id].x === 30), 'connected mapped endpoints carry traffic across the junction');
  assert.ok([...visited].every(id => nodes[id].z === 0), 'a bridge sharing XY does not become a turning connection');
  for (const id of visited) for (const next of nodes[id].next) assert.ok(nodes[next].x >= nodes[id].x, 'one-way travel cannot reverse');
});

test('AOI lane graph removes routes ending outside the map and keeps a connected source loop', () => {
  const features = [road('south', [[-20, 0, -20], [20, 0, -20]], { oneway: true }), road('east', [[20, 0, -20], [20, 0, 20]], { oneway: true }),
    road('north', [[20, 0, 20], [-20, 0, 20]], { oneway: true }), road('west', [[-20, 0, 20], [-20, 0, -20]], { oneway: true }), road('off-edge', [[20, 0, 20], [200, 0, 20]], { oneway: true })];
  const graph = buildMiamiLaneGraph(features, { bounds: { minX: -40, maxX: 40, minZ: -40, maxZ: 40 } });
  assert.ok(graph.length > 8, 'the source loop remains available for traffic');
  assert.ok(graph.every(node => node.next.length > 0 && node.next.every(next => next >= 0 && next < graph.length)), 'no retained path ends at an unsupported map edge');
  assert.ok(graph.every(node => Math.abs(node.x) <= 20.001 && Math.abs(node.z) <= 20.001), 'the clipped dead-end branch is removed');
});

test('a reserved centre turning band offsets lanes but only mapped island polygons become raised obstacles', async t => {
  const feature = road('divided', [[0, 1.5, -40], [0, 1.5, 40]], { widthM: 20.7264, medianWidthM: 7.3152, sidewalkWidthM: 3.6576, raisedMedians: [miamiRectangle(-2, -20, 2, -10)] });
  const f = await native(buildMiamiRoads([feature])); t.after(() => f.dispose());
  assert.ok(Math.abs(f.height(0, 0)! - 1.525) < .002, 'turning pavement stays drivable');
  assert.ok(Math.abs(f.height(0, -15)! - 1.675) < .002, 'only the explicitly mapped island is raised');
  const graph = buildMiamiLaneGraph([feature]);
  assert.ok(graph.every(node => Math.abs(Math.abs(node.x) - 7.0104) < .001), 'lane centres account for the central band without changing the City centerline');
});

test('unsupported source water crossings are withheld until bridge elevation provenance exists', async () => {
  const { auditMiamiRoadWaterCrossings } = await import('../src/world/miami/MiamiTerrain');
  const data = { bounds: { minX: -40, maxX: 40, minZ: -40, maxZ: 40 }, land: [], water: [area('river', [miamiRectangle(-5, -40, 5, 40)], 0)], roads: [road('unresolved-deck', [[-30, 1.5, 0], [30, 1.5, 0]]), road('verified-deck', [[-30, 6, 10], [30, 6, 10]], { bridge: true, layer: 1, elevationConfidence: 'mapped' })] };
  const audit = auditMiamiRoadWaterCrossings(data);
  assert.deepEqual(audit.roads.map(road => road.id), ['verified-deck']); assert.deepEqual(audit.excluded.map(road => road.id), ['unresolved-deck']);
});

test('dry coverage clips road, sidewalk and curb buffers around mapped water holes while preserving islands and sourced decks', async t => {
  const water = area('lake', [[miamiRectangle(-2, -20, 2, 20)[0], miamiRectangle(-.5, 8, .5, 10)[0]]], 0); water.sourceIds = ['fixture/water'];
  const dataset = { bounds: { minX: -40, maxX: 40, minZ: -40, maxZ: 40 }, land: [area('land', [miamiRectangle(-40, -40, 40, 40)], 1.5)], water: [water] };
  const dryCoverage = createMiamiDryCoverage(dataset), dry = createMiamiDryRouteFilter(dryCoverage);
  const features = [road('ground', [[-30, 1.5, 0], [30, 1.5, 0]]), road('island', [[-.3, 1.5, 9], [.3, 1.5, 9]], { widthM: .8, sidewalkWidthM: 0 }),
    road('verified', [[-30, 6, 12], [30, 6, 12]], { bridge: true, layer: 1, elevationConfidence: 'mapped' }),
    road('unknown', [[-30, 4, -12], [30, 4, -12]], { bridge: true, layer: 2, elevationConfidence: 'inferred' })];
  const original = structuredClone(features), records = buildMiamiRoads(features, { dryCoverage }), f = await native(records); t.after(() => f.dispose());
  assert.equal(f.height(0, 0), null, 'an inferred pavement width cannot create a deck inside mapped water');
  assert.equal(f.height(0, 4.09), null, 'the curb buffer cannot create a water crossing');
  assert.equal(f.height(0, 5.3), null, 'the sidewalk buffer cannot create a water crossing');
  assert.ok(Math.abs(f.height(3, 0)! - 1.525) < .002, 'the retained dry approach remains native asphalt');
  assert.ok(Math.abs(f.height(0, 9, 4)! - 1.525) < .002, 'mapped islands inside water holes stay dry below the verified deck');
  assert.ok(Math.abs(f.height(0, 12)! - 6.025) < .002, 'a bridge with sourced deck elevation remains available');
  assert.equal(f.height(0, -12), null, 'a bridge flag alone is not sourced deck evidence');
  assert.equal(dry.point({ x: 0, z: 0 }), false); assert.equal(dry.point({ x: 0, z: 9 }), true);
  assert.equal(dry.segment({ x: -3, z: 9 }, { x: 0, z: 9 }), false, 'separate dry islands do not become a straight traffic connection');
  assert.ok(records.filter(record => !record.id.includes('/1/')).every(record => record.sourceIds.includes('fixture/water') && record.gaps.some(gap => gap.includes('clipped to mapped dry coverage'))));
  const graph = buildMiamiLaneGraph([features[2]], { dryCoverage, pruneDeadEnds: false });
  assert.ok(graph.some(node => !dry.point(node) && node.next.length), 'verified bridge traffic retains its sourced deck crossing');
  assert.deepEqual(features, original, 'clipping derived geometry never mutates the original City roads');
});

test('lane segments cannot skip sub-metre water holes even when both graph nodes are on dry ground', () => {
  const dataset = { bounds: { minX: -20, maxX: 20, minZ: -20, maxZ: 20 }, land: [area('land', [miamiRectangle(-20, -20, 20, 20)], 1.5)], water: [area('narrow-hole', [miamiRectangle(.11, -1, .12, 1)], 0)] };
  const dryCoverage = createMiamiDryCoverage(dataset), features = [road('crossing', [[-6, 1.5, 0], [6, 1.5, 0]], { oneway: true })];
  const graph = buildMiamiLaneGraph(features, { dryCoverage, pruneDeadEnds: false });
  assert.equal(graph.length, 2); assert.ok(graph.every(node => !node.next.length), 'exact boundary intervals detect the one-centimetre hole between dry endpoints');
  assert.deepEqual(buildMiamiLaneGraph(features, { dryCoverage }), [], 'newly unsupported dead-end routes are pruned');
});
