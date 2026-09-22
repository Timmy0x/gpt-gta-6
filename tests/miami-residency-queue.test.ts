import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setImmediate as nextTurn } from 'node:timers/promises';
import HavokPhysics from '@babylonjs/havok';
import { DirectionalLight, HavokPlugin, NullEngine, Scene, ShadowGenerator, StandardMaterial, Vector3, VertexData, type PhysicsEngineV2 } from '@babylonjs/core';
import { MiamiResidency } from '../src/world/miami/MiamiResidency';
import { type MiamiChunk, type MiamiPackageManifest, type MiamiPackedMesh } from '../src/world/miami/MiamiPackages';

type Pack = { chunk: MiamiChunk; bytes: Uint8Array<ArrayBuffer> };
function pack(id: string, locations: { x: number; collision: boolean }[]): Pack {
  const ground = VertexData.CreateGround({ width: 10, height: 10 }), pieces: Buffer[] = [], meshes: MiamiPackedMesh[] = []; let offset = 0;
  const add = (values: ArrayLike<number>, integer = false) => {
    const bytes = Buffer.alloc(values.length * 4);
    for (let i = 0; i < values.length; i++) if (integer) bytes.writeUInt32LE(values[i], i * 4); else bytes.writeFloatLE(values[i], i * 4);
    pieces.push(bytes); const slice = { offset, count: values.length }; offset += bytes.length; return slice;
  };
  for (const [i, location] of locations.entries()) meshes.push({
    id: `${id}/${i}`, kind: 'terrain', material: 'fixture', collision: location.collision, friction: .8, restitution: 0,
    origin: [location.x, 2, 0], bounds: { minX: location.x - 5, maxX: location.x + 5, minZ: -5, maxZ: 5 },
    positions: add(ground.positions!), normals: add(ground.normals!), uvs: add(ground.uvs!), indices: add(ground.indices!, true),
    sourceIds: ['native-fixture'], confidence: 'mapped', gaps: [],
  });
  const bytes = new Uint8Array(Buffer.concat(pieces));
  return { bytes, chunk: { id, url: `${id}.bin`, bytes: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex'), meshes,
    bounds: { minX: Math.min(...meshes.map(m => m.bounds.minX)), maxX: Math.max(...meshes.map(m => m.bounds.maxX)), minZ: -5, maxZ: 5 } } };
}
function manifest(packs: Pack[]): MiamiPackageManifest { return { version: 1, worldId: 'fixture', chunks: packs.map(p => p.chunk), totalBytes: packs.reduce((n, p) => n + p.bytes.byteLength, 0) }; }
async function fixture(packs: Pack[], fetcher?: typeof fetch, cpuBudget?: number) {
  const bytes = await readFile(new URL('../node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm', import.meta.url));
  const havok = await HavokPhysics({ wasmBinary: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer });
  const engine = new NullEngine(), scene = new Scene(engine); scene.enablePhysics(new Vector3(0, -9.81, 0), new HavokPlugin(false, havok));
  const light = new DirectionalLight('fixture', new Vector3(-1, -1, 0), scene), shadows = new ShadowGenerator(64, light), material = new StandardMaterial('shared', scene);
  new StandardMaterial('unrelated-scene-material', scene);
  const source = fetcher ?? (async input => { const id = new URL(String(input)).pathname.slice(1).replace('.bin', ''); return new Response(packs.find(p => p.chunk.id === id)!.bytes); }) as typeof fetch;
  const residency = new MiamiResidency(scene, shadows, manifest(packs), 'https://fixture.invalid/', () => material, source, cpuBudget);
  return { residency, scene, shadows, material, physics: scene.getPhysicsEngine() as PhysicsEngineV2,
    dispose() { residency.dispose(); shadows.dispose(); scene.dispose(); engine.dispose(); } };
}
async function until(predicate: () => boolean) { for (let i = 0; i < 100 && !predicate(); i++) await nextTurn(); assert.ok(predicate(), 'asynchronous loader reached its expected state'); }

async function heldFixture(points: number[]) {
  const packs = points.map((x, i) => pack(`queue-${i}`, [{ x, collision: true }]));
  const started: string[] = [], releases = new Map<string, () => void>();
  let active = 0, maximum = 0;
  const f = await fixture(packs, (async (input, init) => {
    const id = new URL(String(input)).pathname.slice(1).replace('.bin', ''); started.push(id);
    active++; maximum = Math.max(maximum, active);
    try {
      await new Promise<void>((resolve, reject) => {
        releases.set(id, resolve);
        if (init?.signal?.aborted) reject(new Error('aborted'));
        else init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
      return new Response(packs.find(p => p.chunk.id === id)!.bytes);
    } finally { active--; }
  }) as typeof fetch, packs[0].bytes.byteLength * packs.length);
  return { ...f, started, releases, maximum: () => maximum,
    async drain() { for (let i = 0; i < 100 && f.residency.getStats().pendingPackages; i++) { for (const release of releases.values()) release(); await nextTurn(); } assert.equal(f.residency.getStats().pendingPackages, 0); },
  };
}

test('new required collision takes the next slot before still-useful optional prefetch', async t => {
  const f = await heldFixture([0, 230, 300, 360, 600]); t.after(() => f.dispose());
  f.residency.update(Vector3.Zero()); await until(() => f.started.length === 2);
  f.residency.update(new Vector3(600, 0, 0));
  f.releases.get('queue-0')!(); await until(() => f.started.length === 3);
  assert.equal(f.started[2], 'queue-4', 'new required floor must precede queued 300m/360m prefetch');
  await f.drain(); f.residency.update(new Vector3(600, 0, 0));
  assert.equal(f.residency.collisionReady(new Vector3(600, 0, 0)), true);
  assert.equal(f.residency.getStats().failedPackages, 0); assert.equal(f.maximum(), 2);
  f.physics._step(1 / 60);
  assert.ok(f.physics.raycast(new Vector3(600, 5, 0), new Vector3(600, -5, 0)).hasHit);
});

test('obsolete queued jobs never issue fetches or become failed packages', async t => {
  const f = await heldFixture([0, 230, 300, 360, 900]); t.after(() => f.dispose());
  f.residency.update(Vector3.Zero()); await until(() => f.started.length === 2);
  f.residency.update(new Vector3(900, 0, 0));
  await f.drain(); f.residency.update(new Vector3(900, 0, 0));
  assert.deepEqual(f.started, ['queue-0', 'queue-1', 'queue-4']);
  assert.equal(f.residency.getStats().requests, 3); assert.equal(f.residency.getStats().retries, 0);
  assert.equal(f.residency.getStats().failedPackages, 0); assert.equal(f.residency.getStats().lastError, '');
  assert.equal(f.residency.collisionReady(new Vector3(900, 0, 0)), true); assert.equal(f.maximum(), 2);
});

test('preparation pins retain destination priority while ordinary frames still update the origin', async t => {
  const f = await heldFixture([0, 230, 300, 360, 900]); t.after(() => f.dispose());
  f.residency.update(Vector3.Zero()); await until(() => f.started.length === 2);
  const prepared = f.residency.preparePosition(new Vector3(900, 0, 0));
  f.residency.update(Vector3.Zero());
  f.releases.get('queue-0')!(); await until(() => f.started.length === 3);
  assert.equal(f.started[2], 'queue-4', 'the pinned destination must remain required while the old view is rendered');
  await f.drain(); await prepared;
  assert.equal(f.residency.collisionReady(new Vector3(900, 0, 0)), true);
  assert.equal(f.residency.getStats().failedPackages, 0);
});

test('a cancelled chunk can be pinned again in the same turn without inheriting its rejected promise', async t => {
  const f = await heldFixture([0, 230, 300, 360, 900]); t.after(() => f.dispose());
  f.residency.update(Vector3.Zero()); await until(() => f.started.length === 2);
  f.residency.update(new Vector3(900, 0, 0));
  const prepared = f.residency.preparePosition(new Vector3(300, 0, 0));
  // The old cancellations settle while their replacements are already queued.
  await nextTurn(); assert.ok(f.residency.getStats().pendingPackages >= 4);
  await f.drain(); await prepared;
  assert.equal(f.started.filter(id => id === 'queue-2').length, 1);
  assert.equal(f.residency.getStats().failedPackages, 0);
  assert.equal(f.residency.collisionReady(new Vector3(300, 0, 0)), true);
});

test('disposal cancels reprioritized queued jobs and cannot resurrect native resources', async t => {
  const f = await heldFixture([0, 230, 300, 360, 900]); t.after(() => f.dispose());
  f.residency.update(Vector3.Zero()); await until(() => f.started.length === 2);
  const prepared = f.residency.preparePosition(new Vector3(900, 0, 0));
  const rejected = assert.rejects(prepared, /disposed/);
  f.residency.dispose(); await rejected; await nextTurn();
  assert.equal(f.residency.getStats().pendingPackages, 0);
  assert.equal(f.residency.getStats().failedPackages, 0);
  assert.equal(f.residency.getStats().cpuGeometryBytes, 0);
  assert.equal(f.scene.meshes.length, 0); assert.equal(f.started.length, 2);
});
