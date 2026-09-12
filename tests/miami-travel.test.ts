import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import HavokPhysics from '@babylonjs/havok';
import { DirectionalLight, HavokPlugin, NullEngine, RawTexture, Scene, ShadowGenerator, Vector3, type PhysicsEngineV2 } from '@babylonjs/core';
import { MiamiWorld } from '../src/world/miami/MiamiWorld';
import { MovementQueries } from '../src/gameplay/MovementQueries';
import { parseMapDestination, resolveTravelDestination } from '../src/gameplay/TravelDestination';
import { Swimming } from '../src/gameplay/Swimming';
import { playableMapPoint } from '../src/ui/MapViewport';
import { WorldBoundary } from '../src/world/WorldBoundary';

type Point = { x: number; z: number };
type Landing = { id: string; kind: string; requested: number[]; destination?: number[]; movedM?: number; nativeGroundM?: number; footSupportRays?: number; swimming?: boolean; ready?: boolean; error?: string };

test('every named common-frame Brickell destination and inset map corner resolves to loaded native support', async t => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'name'); Object.defineProperty(globalThis, 'name', { value: '', configurable: true });
  t.after(() => { if (descriptor) Object.defineProperty(globalThis, 'name', descriptor); else Reflect.deleteProperty(globalThis, 'name'); });
  const bytes = await readFile(new URL('../node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm', import.meta.url));
  const havok = await HavokPhysics({ wasmBinary: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer });
  const engine = new NullEngine(), scene = new Scene(engine); scene.enablePhysics(new Vector3(0, -9.81, 0), new HavokPlugin(false, havok));
  const physics = scene.getPhysicsEngine() as PhysicsEngineV2, light = new DirectionalLight('travel-fixture', new Vector3(-1, -1, 0), scene), shadows = new ShadowGenerator(64, light);
  const publicRoot = new URL('../public/', import.meta.url);
  const fetcher = (async (input: RequestInfo | URL) => { const url = new URL(String(input)), path = url.pathname.replace(/^\//, ''); if (path.includes('..')) throw new Error('Unexpected source path'); return new Response(await readFile(new URL(path, publicRoot))); }) as typeof fetch;
  const world = new MiamiWorld({ scene, shadows }, { baseUrl: 'https://fixture.invalid/world/miami/', fetch: fetcher, loadTexture: () => RawTexture.CreateRGBATexture(new Uint8Array([128, 128, 255, 255]), 1, 1, scene) });
  const queries = new MovementQueries(scene); t.after(() => { queries.dispose(); world.dispose(); shadows.dispose(); scene.dispose(); engine.dispose(); });
  await world.ready;
  const boundary = new WorldBoundary({ bounds: world.bounds, floorHeight: (x, z) => world.floorHeightAt(x, z), fallback: world.spawn });
  const landings: Landing[] = [], failures: string[] = [];
  const check = async (id: string, kind: string, point: Point, expected: 'dry' | 'wet' | 'either', preferStreet: boolean) => {
    const row: Landing = { id, kind, requested: [point.x, point.z] }; landings.push(row);
    try {
      assert.ok(playableMapPoint(point, world.bounds), 'point is inside the map control inset');
      await world.preparePosition(new Vector3(point.x, 1.5, point.z)); physics._step(1 / 60);
      const destination = resolveTravelDestination(point, queries, world.ocean, preferStreet, world.bounds, (x, z) => world.floorHeightAt(x, z));
      assert.ok(destination, 'travel resolver found a clear destination'); row.destination = destination.asArray(); row.movedM = Math.hypot(destination.x - point.x, destination.z - point.z);
      assert.ok(row.movedM <= 12.001, 'resolver stays within its documented local search');
      assert.ok(playableMapPoint(destination, world.bounds)); assert.ok(queries.clear(destination), 'the complete standing capsule has no native overlap');
      row.ready = world.getStreamingStats().ready; assert.equal(row.ready, true, 'destination collision is ready when preparation resolves');
      assert.equal(boundary.recovery(destination), null, 'ordinary landing needs no emergency edge/floor recovery');
      const swim = new Swimming(); swim.update(destination, world.ocean, 1 / 60); row.swimming = swim.active;
      if (expected === 'dry') assert.equal(swim.active, false, 'a named street must not silently send the character into water');
      if (expected === 'wet') assert.equal(swim.active, true, 'an unavailable water-crossing deck resolves as swimming, not an invented road');
      if (swim.active) {
        assert.ok(Math.abs(destination.y - (world.ocean.surfaceHeight(destination.x, destination.z)! - .45)) < .001);
        const bed = queries.ground(new Vector3(destination.x, .5, destination.z), 0, 32); assert.ok(bed, 'swimming still has a real loaded waterbed'); row.nativeGroundM = bed.y;
        assert.ok(bed.y < destination.y - 1.3);
      } else {
        const ground = queries.ground(destination, .05, 2); assert.ok(ground, 'the chosen dry landing has native walkable support directly below it'); row.nativeGroundM = ground.y;
        assert.ok(Math.abs(destination.y - ground.y - .94) < .025, 'standing center rests at its controller offset above the native surface');
        if (preferStreet) assert.ok(ground.y - world.floorHeightAt(destination.x, destination.z) < 3, 'named street travel stays near ground level rather than choosing a tower roof');
        let supported = 0;
        for (const [dx, dz] of [[0, 0], [.2, 0], [-.2, 0], [0, .2], [0, -.2]]) {
          const foot = queries.ground(new Vector3(destination.x + dx, ground.y + .25, destination.z + dz), 0, .6);
          if (foot && Math.abs(foot.y - ground.y) < .3) supported++;
        }
        row.footSupportRays = supported; assert.ok(supported >= 3, 'support extends under the capsule footprint, not only an isolated center ray');
      }
    } catch (error) { row.error = error instanceof Error ? error.message : String(error); failures.push(`${kind}/${id}: ${row.error}`); }
    return row;
  };
  assert.ok(world.locations.length >= 5, 'audit includes each named street in the current physical AOI');
  assert.equal(world.mapData.water.length, 0, 'initial surveyed collision AOI contains dry streets only');
  assert.equal(new Set(world.locations.map(location => location.id)).size, world.locations.length);
  for (const location of world.locations) await check(location.id + ':' + location.name, 'named', location, 'dry', true);

  const b = world.bounds, inset = 2.01, middleX = (b.minX + b.maxX) / 2, middleZ = (b.minZ + b.maxZ) / 2;
  const edgePoints = [
    ['south-west', b.minX + inset, b.minZ + inset], ['south-east', b.maxX - inset, b.minZ + inset],
    ['north-west', b.minX + inset, b.maxZ - inset], ['north-east', b.maxX - inset, b.maxZ - inset],
    ['west', b.minX + inset, middleZ], ['east', b.maxX - inset, middleZ], ['south', middleX, b.minZ + inset], ['north', middleX, b.maxZ - inset],
  ] as const;
  for (const [id, x, z] of edgePoints) {
    await check(id, 'inset-edge', { x, z }, 'either', false);
    const p = new Vector3(x, world.floorHeightAt(x, z) + 1.5, z), velocity = new Vector3(Math.sign(x - middleX) * 80, 0, Math.sign(z - middleZ) * 80);
    const limited = boundary.limitVelocity(p, velocity, 1 / 60, .32), next = p.add(limited.scale(1 / 60));
    assert.ok(next.x > b.minX + .32 && next.x < b.maxX - .32 && next.z > b.minZ + .32 && next.z < b.maxZ - .32, 'outward boundary motion remains on supported geography');
  }
  let rejectedEdges = 0;
  for (const point of [{ x: b.minX, z: b.minZ }, { x: b.maxX, z: b.minZ }, { x: b.minX, z: b.maxZ }, { x: b.maxX, z: b.maxZ }, { x: b.minX - 1, z: middleZ }, { x: b.maxX + 1, z: middleZ }, { x: middleX, z: b.minZ - 1 }, { x: middleX, z: b.maxZ + 1 }]) {
    assert.equal(parseMapDestination(JSON.stringify(point), b), null); assert.equal(resolveTravelDestination(point, queries, world.ocean, false, b), null); rejectedEdges++;
  }
  for (const point of [{ x: b.minX - 1, z: middleZ }, { x: b.maxX + 1, z: middleZ }, { x: middleX, z: b.minZ - 1 }, { x: middleX, z: b.maxZ + 1 }]) await assert.rejects(world.preparePosition(new Vector3(point.x, 1.5, point.z)), /outside/);

  const excluded = world.mapData.roads.filter(road => road.unavailableReason); assert.equal(excluded.length, 0);
  const bridgeAudits: { id: string; name: string; wetSamples: number; deepestSample?: number[]; nativeSurfaceM?: number; error?: string }[] = [];
  for (const road of excluded) {
    const wet: Point[] = [];
    for (let i = 1; i < road.centerline.length; i++) {
      const a = road.centerline[i - 1], c = road.centerline[i], steps = Math.max(1, Math.ceil(Math.hypot(c[0] - a[0], c[2] - a[2]) / 2));
      for (let n = 0; n <= steps; n++) { const fraction = n / steps, point = { x: a[0] + (c[0] - a[0]) * fraction, z: a[2] + (c[2] - a[2]) * fraction }; if (playableMapPoint(point, b) && world.ocean.contains(point.x, point.z)) wet.push(point); }
    }
    const audit = { id: road.id, name: road.name, wetSamples: wet.length } as typeof bridgeAudits[number]; bridgeAudits.push(audit);
    if (!wet.length) { failures.push(`excluded/${road.id}: no mapped-water sample to verify`); continue; }
    const point = wet[Math.floor(wet.length / 2)]; audit.deepestSample = [point.x, point.z];
    const landing = await check(road.id + ':' + road.name, 'excluded-water-crossing', point, 'wet', false);
    audit.nativeSurfaceM = landing.nativeGroundM; audit.error = landing.error;
  }
  const wetTraffic: { id: number; next?: number; x: number; z: number; nativeHeightM?: number; nativeKind?: string; sourceRoad?: string; sourceName?: string; sourceDistanceM?: number; waterBoundaryDistanceM?: number }[] = []; let trafficChecks = 0;
  for (const node of world.roads) for (const nextId of node.next) {
    const next = world.roads[nextId]; assert.ok(next); const steps = Math.max(1, Math.ceil(Math.hypot(next.x - node.x, next.z - node.z) / 4));
    for (let n = 0; n <= steps; n++) { const fraction = n / steps, x = node.x + (next.x - node.x) * fraction, z = node.z + (next.z - node.z) * fraction; trafficChecks++; if (world.ocean.contains(x, z)) wetTraffic.push({ id: node.id, next: nextId, x, z }); }
  }
  for (const sample of wetTraffic) {
    await world.preparePosition(new Vector3(sample.x, 1.5, sample.z)); physics._step(1 / 60);
    const ray = physics.raycast(new Vector3(sample.x, 30, sample.z), new Vector3(sample.x, -30, sample.z));
    if (ray.hasHit) { sample.nativeHeightM = ray.hitPointWorld.y; sample.nativeKind = ray.body?.transformNode.metadata?.miamiKind; }
    const segmentDistance = (ax: number, az: number, cx: number, cz: number) => {
      const dx = cx - ax, dz = cz - az, length = dx * dx + dz * dz, fraction = length > 0 ? Math.max(0, Math.min(1, ((sample.x - ax) * dx + (sample.z - az) * dz) / length)) : 0;
      return Math.hypot(sample.x - ax - dx * fraction, sample.z - az - dz * fraction);
    };
    sample.sourceDistanceM = Infinity;
    for (const road of world.mapData.roads.filter(road => !road.unavailableReason)) for (let i = 1; i < road.centerline.length; i++) {
      const a = road.centerline[i - 1], c = road.centerline[i], distance = segmentDistance(a[0], a[2], c[0], c[2]);
      if (distance < sample.sourceDistanceM) { sample.sourceDistanceM = distance; sample.sourceRoad = road.id; sample.sourceName = road.name; }
    }
    sample.waterBoundaryDistanceM = Infinity;
    for (const area of world.mapData.water) for (const polygon of area.polygons) for (const ring of polygon) for (let i = 1; i < ring.length; i++) sample.waterBoundaryDistanceM = Math.min(sample.waterBoundaryDistanceM, segmentDistance(ring[i - 1][0], ring[i - 1][1], ring[i][0], ring[i][1]));
  }
  if (wetTraffic.length) failures.push(`traffic: ${wetTraffic.length} supported-graph samples cross mapped water without a verified deck`);
  const sourceHashes: Record<string, string> = {};
  for (const name of ['src/world/miami/MiamiWorld.ts', 'src/world/miami/MiamiResidency.ts', 'src/gameplay/TravelDestination.ts', 'public/world/miami/dataset.json', 'public/world/miami/packages.json']) sourceHashes[name] = createHash('sha256').update(await readFile(new URL('../' + name, import.meta.url))).digest('hex');
  const report = { sourceHashes, namedDestinations: world.locations.length, landings, rejectedEdges, excludedBridges: bridgeAudits, trafficChecks, wetTraffic, failures, stats: world.getStreamingStats() };
  if (process.env.MIAMI_TRAVEL_EVIDENCE) { await mkdir(dirname(process.env.MIAMI_TRAVEL_EVIDENCE), { recursive: true }); await writeFile(process.env.MIAMI_TRAVEL_EVIDENCE, JSON.stringify(report, null, 2) + '\n'); }
  t.diagnostic(JSON.stringify({ named: world.locations.length, landings: landings.length, rejectedEdges, excludedBridges: excluded.length, trafficChecks, wetTraffic: wetTraffic.length, failures, stats: report.stats }));
  assert.deepEqual(failures, [], 'all destinations need supported, clear landings; failures are retained in the evidence report');
});
