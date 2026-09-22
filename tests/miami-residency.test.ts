import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setImmediate as nextTurn } from 'node:timers/promises';
import HavokPhysics from '@babylonjs/havok';
import { DirectionalLight, HavokPlugin, NullEngine, Scene, ShadowGenerator, StandardMaterial, Vector3, VertexData, type PhysicsEngineV2 } from '@babylonjs/core';
import { MiamiResidency } from '../src/world/miami/MiamiResidency';
import { decodeMiamiChunk, validateMiamiManifest, type MiamiChunk, type MiamiPackageManifest, type MiamiPackedMesh } from '../src/world/miami/MiamiPackages';

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

test('packed Miami geometry is zero-copy and rejects incorrect residency bounds, duplicate IDs and malformed slices', () => {
  const p = pack('ground', [{ x: 30, collision: true }]), decoded = decodeMiamiChunk(p.chunk, p.bytes.buffer);
  for (const view of [decoded[0].positions, decoded[0].normals, decoded[0].uvs, decoded[0].indices]) assert.equal(view.buffer, p.bytes.buffer);
  validateMiamiManifest(manifest([p]));
  const wrongBounds = structuredClone(p.chunk); wrongBounds.meshes[0].bounds.minX += 1;
  assert.throws(() => decodeMiamiChunk(wrongBounds, p.bytes.buffer), /residency bounds/);
  const malformed = structuredClone(p.chunk); malformed.meshes[0].indices.offset++;
  assert.throws(() => decodeMiamiChunk(malformed, p.bytes.buffer), /geometry slice/);
  const duplicate = manifest([p, p]); assert.throws(() => validateMiamiManifest(duplicate), /Invalid Miami package/);
  const invalidTotal = manifest([p]); invalidTotal.totalBytes++; assert.throws(() => validateMiamiManifest(invalidTotal), /byte total/);
});

test('native fetch receives the global receiver, deduplicates preparation, limits concurrency and installs collision before resolving', async t => {
  const packs = [0, 80, 160].map((x, i) => pack(`ground-${i}`, [{ x, collision: true }]));
  const controls: (() => void)[] = []; let active = 0, maximum = 0;
  const fetcher = async function (this: unknown, input: RequestInfo | URL) {
    assert.equal(this, globalThis, 'calling the injected native-style fetch as a loader method causes Illegal invocation in browsers');
    active++; maximum = Math.max(maximum, active);
    const name = new URL(String(input)).pathname.slice(1).replace('.bin', ''), source = packs.find(p => p.chunk.id === name)!;
    try { await new Promise<void>(resolve => controls.push(resolve)); return new Response(source.bytes); } finally { active--; }
  } as typeof fetch;
  const f = await fixture(packs, fetcher); t.after(() => f.dispose());
  assert.equal(f.residency.getStats().ready, false);
  const first = f.residency.preparePosition(Vector3.Zero()), second = f.residency.preparePosition(Vector3.Zero());
  await until(() => controls.length === 2);
  const loading = f.residency.getStats(); assert.equal(loading.ready, false); assert.equal(loading.pendingPackages, 3); assert.equal(loading.pendingMeshes, 3);
  controls[0](); controls[1](); await until(() => controls.length === 3); controls[2]();
  await Promise.all([first, second]); assert.equal(maximum, 2);
  const stats = f.residency.getStats(); assert.equal(stats.requests, 3); assert.equal(stats.loadedPackages, 3); assert.equal(stats.ready, true); assert.equal(stats.pendingPackages, 0);
  assert.equal(stats.residentColliders, 3); assert.equal(stats.cpuGeometryBytes, manifest(packs).totalBytes); assert.equal(stats.residentMaterials, 1);
  f.physics._step(1 / 60);
  for (const x of [0, 80, 160]) { const ray = f.physics.raycast(new Vector3(x, 5, 0), new Vector3(x, -5, 0)); assert.ok(ray.hasHit); assert.ok(Math.abs(ray.hitPointWorld.y - 2) < .002); }
  for (let frame = 0; frame < 30; frame++) f.residency.update(Vector3.Zero());
  assert.equal(f.residency.getStats().requests, 3, 'resident frames do not request or decode loaded geometry again');
});

test('failed integrity cannot report ready or allocate geometry, and explicit retry clears its error', async t => {
  const p = pack('ground', [{ x: 0, collision: true }]); let corrupt = true;
  const f = await fixture([p], (async () => { const bytes = new Uint8Array(p.bytes); if (corrupt) bytes[0] ^= 1; return new Response(bytes); }) as typeof fetch); t.after(() => f.dispose());
  await assert.rejects(f.residency.preparePosition(Vector3.Zero()), /integrity mismatch/);
  const failed = f.residency.getStats(); assert.equal(failed.ready, false); assert.equal(failed.requests, 3); assert.equal(failed.retries, 2); assert.equal(failed.failedPackages, 1);
  assert.equal(failed.cpuGeometryBytes, 0); assert.equal(failed.residentMeshes, 0); assert.equal(failed.residentColliders, 0);
  corrupt = false; await f.residency.preparePosition(Vector3.Zero());
  const recovered = f.residency.getStats(); assert.equal(recovered.ready, true); assert.equal(recovered.failedPackages, 0); assert.equal(recovered.lastError, ''); assert.equal(recovered.requests, 4);
});

test('disposal aborts active requests, rejects queued work and cannot resurrect meshes or counters', async t => {
  const packs = [0, 60, 120, 180].map((x, i) => pack(`ground-${i}`, [{ x, collision: true }])); let requests = 0;
  const fetcher = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    requests++; await new Promise<void>((_resolve, reject) => { if (init?.signal?.aborted) reject(new Error('aborted')); else init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true }); });
    throw new Error('unreachable');
  }) as typeof fetch;
  const f = await fixture(packs, fetcher); t.after(() => f.dispose());
  const prepared = assert.rejects(f.residency.preparePosition(Vector3.Zero()), /disposed|aborted/); await until(() => requests === 2);
  f.residency.dispose(); await prepared; await nextTurn();
  const stats = f.residency.getStats(); assert.equal(requests, 2); assert.equal(stats.pendingPackages, 0); assert.equal(stats.failedPackages, 0); assert.equal(stats.ready, false); assert.equal(stats.cpuGeometryBytes, 0);
  assert.equal(f.scene.meshes.length, 0); f.residency.update(Vector3.Zero()); f.residency.ensureCollision(Vector3.Zero()); f.residency.dispose();
  await assert.rejects(f.residency.preparePosition(Vector3.Zero()), /disposed/); assert.equal(requests, 2);
});

test('visual budget and residency stats count actual work, shared storage and only referenced materials', async t => {
  const p = pack('ground', [{ x: 0, collision: true }, ...Array.from({ length: 20 }, () => ({ x: 250, collision: false }))]);
  const f = await fixture([p]); t.after(() => f.dispose()); await f.residency.preparePosition(Vector3.Zero());
  assert.equal(f.residency.getStats().residentMeshes, 21); assert.equal(f.residency.getStats().lastMeshOperations, 21);
  f.residency.update(new Vector3(1200, 0, 0));
  const far = f.residency.getStats(); assert.equal(far.residentMeshes, 0); assert.equal(far.residentColliders, 0); assert.equal(far.residentMaterials, 0); assert.equal(far.cpuGeometryBytes, p.bytes.byteLength); assert.equal(far.ready, false);
  f.residency.update(Vector3.Zero());
  const first = f.residency.getStats(); assert.equal(first.residentMeshes, 13); assert.equal(first.lastMeshOperations, 13); assert.equal(first.pendingMeshes, 8); assert.equal(first.ready, true);
  f.residency.update(Vector3.Zero());
  const second = f.residency.getStats(); assert.equal(second.residentMeshes, 21); assert.equal(second.lastMeshOperations, 8); assert.equal(second.pendingMeshes, 0); assert.equal(second.requests, 1); assert.equal(second.residentMaterials, 1);
  f.residency.dispose(); const disposed = f.residency.getStats(); assert.equal(disposed.cpuGeometryBytes, 0); assert.equal(disposed.residentMaterials, 0); assert.equal(disposed.meshDisposals, disposed.meshLoads); assert.equal(disposed.colliderDisposals, disposed.colliderLoads);
  assert.ok(f.scene.materials.includes(f.material), 'the shared material library remains owned by MiamiWorld');
});

test('failed material creation disposes its partial mesh and cached source can retry without a download', async t => {
  const p = pack('ground', [{ x: 0, collision: true }]), f = await fixture([p]); let failure = true;
  const residency = new MiamiResidency(f.scene, f.shadows, manifest([p]), 'https://fixture.invalid/', () => { if (failure) throw new Error('material unavailable'); return f.material; }, (async () => new Response(p.bytes)) as typeof fetch);
  t.after(() => { residency.dispose(); f.dispose(); });
  await assert.rejects(residency.preparePosition(Vector3.Zero()), /material unavailable/); assert.equal(f.scene.meshes.length, 0); assert.equal(residency.getStats().ready, false);
  failure = false; await residency.preparePosition(Vector3.Zero()); assert.equal(residency.getStats().requests, 1); assert.equal(residency.getStats().ready, true);
});

test('hidden structural shells load only for collision, never render or cast shadows, and unload with physical residency', async t => {
  const ground = pack('ground', [{ x: 0, collision: true }]), shell = pack('shell', [{ x: 250, collision: true }]);
  shell.chunk.meshes[0].render = false; shell.chunk.meshes[0].kind = 'building';
  const f = await fixture([ground, shell]); t.after(() => f.dispose()); await f.residency.preparePosition(Vector3.Zero());
  await until(() => f.residency.getStats().pendingPackages === 0);
  assert.equal(f.residency.getStats().residentMeshes, 1); assert.equal(f.residency.getStats().pendingMeshes, 0, 'an invisible distant shell is not queued as visual work');
  f.residency.update(new Vector3(250, 0, 0)); const mesh = f.scene.getMeshByName('shell/0'); assert.ok(mesh); assert.equal(mesh.isVisible, false);
  assert.ok(!f.shadows.getShadowMap()!.renderList!.includes(mesh));
  f.physics._step(1 / 60); const ray = f.physics.raycast(new Vector3(250, 5, 0), new Vector3(250, -5, 0)); assert.ok(ray.hasHit, 'invisibility does not remove native support');
  f.residency.update(new Vector3(600, 0, 0)); assert.equal(f.scene.getMeshByName('shell/0'), null, 'the hidden render buffer is released when its collider leaves residency');
  f.residency.update(new Vector3(250, 0, 0)); assert.equal(f.scene.getMeshByName('shell/0')!.isVisible, false); assert.equal(f.residency.getStats().requests, 2);
});

test('late responses and a failing removal observer cannot retain or resurrect disposed native resources', async t => {
  const p = pack('ground', [{ x: 0, collision: true }, { x: 20, collision: true }]), f = await fixture([p]); t.after(() => f.dispose());
  await f.residency.preparePosition(Vector3.Zero()); let callbacks = 0;
  f.residency.onMeshDisposed = () => { callbacks++; throw new Error('fixture observer failure'); };
  f.residency.dispose(); assert.equal(callbacks, 2); assert.equal(f.scene.meshes.length, 0); assert.equal(f.residency.getStats().colliderDisposals, 2); assert.equal(f.residency.getStats().cpuGeometryBytes, 0);
  let release: ((response: Response) => void) | undefined;
  const late = new MiamiResidency(f.scene, f.shadows, manifest([p]), 'https://fixture.invalid/', () => f.material, (() => new Promise<Response>(resolve => { release = resolve; })) as typeof fetch);
  t.after(() => late.dispose());
  const prepared = assert.rejects(late.preparePosition(Vector3.Zero()), /disposed/); await until(() => !!release);
  late.dispose(); release!(new Response(p.bytes)); await prepared;
  assert.equal(late.getStats().packagesLoaded, 0); assert.equal(late.getStats().residentColliders, 0); assert.equal(f.scene.meshes.length, 0);
});

test('opaque browser fetch failures retain the exact chunk, stage and original cause', async t => {
  const p = pack('ground', [{ x: 0, collision: true }]), cause = new TypeError('Failed to fetch');
  const f = await fixture([p], (async () => { throw cause; }) as typeof fetch); t.after(() => f.dispose());
  await assert.rejects(f.residency.preparePosition(Vector3.Zero()), error => {
    assert.ok(error instanceof Error); assert.equal(error.message, 'Miami chunk ground (ground.bin) fetch: Failed to fetch'); assert.equal(error.cause, cause); return true;
  });
  assert.equal(f.residency.getStats().lastError, 'Miami chunk ground (ground.bin) fetch: Failed to fetch');
});


test('hiding public display preserves Havok support and missing arrivals fail the readiness gate', async t => {
  const near=pack('near',[{x:0,collision:true}]), far=pack('far',[{x:700,collision:true}]);
  let release: (()=>void)|undefined;
  const f=await fixture([near,far],(async input=>{
    if(String(input).includes('far'))await new Promise<void>(resolve=>{release=resolve;});
    return new Response(String(input).includes('far')?far.bytes:near.bytes);
  }) as typeof fetch);t.after(()=>f.dispose());
  await f.residency.preparePosition(Vector3.Zero());
  f.residency.setVisualVisibility(false);
  assert.ok(f.scene.meshes.every(mesh=>!mesh.isVisible));
  f.physics._step(1/60);
  assert.ok(f.physics.raycast(new Vector3(0,5,0),new Vector3(0,-5,0)).hasHit);
  const target=new Vector3(700,0,0);
  f.residency.setActiveAnchors([Vector3.Zero()]);
  f.residency.update(target);
  assert.equal(f.residency.collisionReady(target),false,'simulation must hold before missing Havok shapes arrive');
  await until(()=>!!release);release!();await until(()=>f.residency.getStats().pendingPackages===0);
  f.residency.update(target);
  assert.equal(f.residency.collisionReady(target),true);
  f.physics._step(1/60);
  assert.ok(f.physics.raycast(new Vector3(700,5,0),new Vector3(700,-5,0)).hasHit);
  assert.ok(f.physics.raycast(new Vector3(0,5,0),new Vector3(0,-5,0)).hasHit,'parked anchors retain their floor');
  assert.ok(f.scene.meshes.every(mesh=>!mesh.isVisible),'new collision arrivals remain hidden under the live basemap');
});

test('expanded-world prefetch reserves its byte budget and evicts old nearby buffers without dropping anchored Havok support', async t => {
  const packs = [0, 300, 600, 900].map((x, i) => pack(`budget-${i}`, [{ x, collision: true }]));
  const one = packs[0].bytes.byteLength, f = await fixture(packs, undefined, one * 2); t.after(() => f.dispose());
  await f.residency.preparePosition(Vector3.Zero());
  await until(() => f.residency.getStats().pendingPackages === 0);
  assert.equal(f.residency.getStats().loadedPackages, 2, 'nearby prefetch fits the source buffer target');
  f.residency.setActiveAnchors([Vector3.Zero()]);
  await f.residency.preparePosition(new Vector3(600, 0, 0));
  await until(() => f.residency.getStats().pendingPackages === 0); f.residency.update(new Vector3(600, 0, 0));
  let stats = f.residency.getStats();
  assert.equal(stats.cpuGeometryBytes, one * 2);
  assert.equal(stats.requiredSourceBufferBytes, one * 2);
  assert.equal(stats.packagesEvicted, 1, 'an optional old chunk inside the old 820m hysteresis is reclaimed');
  f.physics._step(1 / 60);
  for (const x of [0, 600]) assert.ok(f.physics.raycast(new Vector3(x, 5, 0), new Vector3(x, -5, 0)).hasHit, 'primary and anchored support remain native');
  assert.equal(f.physics.raycast(new Vector3(300, 5, 0), new Vector3(300, -5, 0)).hasHit, false);
  const requests = stats.requests;
  for (let i = 0; i < 20; i++) f.residency.update(new Vector3(600, 0, 0));
  await nextTurn();
  stats = f.residency.getStats(); assert.equal(stats.requests, requests, 'over-budget optional prefetch cannot churn every frame');
  assert.equal(stats.ready, true);
});

test('required active-body support is retained and explicitly reported when it exceeds the optional cache target', async t => {
  const packs = [0, 300, 600, 900].map((x, i) => pack(`protected-${i}`, [{ x, collision: true }]));
  const one = packs[0].bytes.byteLength, f = await fixture(packs, undefined, one * 2); t.after(() => f.dispose());
  f.residency.setActiveAnchors([Vector3.Zero(), new Vector3(300, 0, 0)]);
  await f.residency.preparePosition(new Vector3(600, 0, 0));
  await until(() => f.residency.getStats().pendingPackages === 0); f.residency.update(new Vector3(600, 0, 0));
  let stats = f.residency.getStats();
  assert.equal(stats.cpuGeometryBytes, one * 3); assert.equal(stats.requiredSourceBufferBytes, one * 3);
  assert.equal(stats.sourceBufferBudgetBytes, one * 2); assert.equal(stats.ready, true);
  f.physics._step(1 / 60);
  for (const x of [0, 300, 600]) assert.ok(f.physics.raycast(new Vector3(x, 5, 0), new Vector3(x, -5, 0)).hasHit);
  f.residency.setActiveAnchors([]); f.residency.update(new Vector3(600, 0, 0));
  await until(() => f.residency.getStats().pendingPackages === 0); f.residency.update(new Vector3(600, 0, 0));
  stats = f.residency.getStats(); assert.ok(stats.cpuGeometryBytes <= one * 2); assert.equal(stats.ready, true);
});

test('an unavailable optional preload cannot block a destination whose required native support is ready', async t => {
  const near = pack('required', [{ x: 0, collision: true }]), far = pack('optional', [{ x: 300, collision: true }]);
  let release: (() => void) | undefined;
  const f = await fixture([near, far], (async input => {
    if (String(input).includes('optional')) { await new Promise<void>(resolve => { release = resolve; }); return new Response('', { status: 503 }); }
    return new Response(near.bytes);
  }) as typeof fetch); t.after(() => f.dispose());
  await f.residency.preparePosition(Vector3.Zero());
  assert.equal(f.residency.getStats().ready, true);
  assert.equal(f.residency.getStats().pendingPackages, 1);
  f.physics._step(1 / 60);
  assert.ok(f.physics.raycast(new Vector3(0, 5, 0), new Vector3(0, -5, 0)).hasHit);
  for (let attempt=0;attempt<3;attempt++) { await until(()=>!!release); const finish=release!; release=undefined; finish(); await nextTurn(); }
  await until(()=>f.residency.getStats().pendingPackages===0);
  assert.equal(f.residency.getStats().failedPackages, 1);
  assert.equal(f.residency.getStats().ready, true, 'optional detail failure does not mislabel collision safety');
});
