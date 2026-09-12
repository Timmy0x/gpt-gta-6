import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { AssetContainer, Mesh, NullEngine, PBRMaterial, RawTexture, Scene, UniversalCamera, Vector3 } from '@babylonjs/core';
import { TilesRenderer } from '3d-tiles-renderer/babylonjs';
import { ResourceLedger, resourceLedgerPlugin } from '../src/resource-ledger';
import { formatResourceBytes, resourcePanelLines } from '../src/resource-panel';
import './node-file-reader';

globalThis.window ??= { location: { href: 'https://fixture.invalid/' }, addEventListener() {}, removeEventListener() {} } as unknown as Window & typeof globalThis;
globalThis.requestAnimationFrame ??= callback => setTimeout(() => callback(performance.now()), 0) as unknown as number;
globalThis.cancelAnimationFrame ??= id => clearTimeout(id);
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const fixture = new Uint8Array(await readFile(new URL('../public/fixture/a.glb', import.meta.url)));
function native() {
  const engine = new NullEngine(), scene = new Scene(engine), container = new AssetContainer(scene);
  return { engine, scene, container, dispose() { container.dispose(); scene.dispose(); engine.dispose(); } };
}

test('passive ledger follows real renderer parse/load/visibility/disposal and includes hidden cached native GLB containers', async () => {
  const h = native(); h.scene.useRightHandedSystem = true;
  const camera = new UniversalCamera('native-resource-camera', new Vector3(0, -250, 150), h.scene); camera.setTarget(new Vector3(0, 0, 50));
  const renderer = new TilesRenderer('https://fixture.invalid/fixture/root.json', h.scene);
  const ledger = new ResourceLedger(); renderer.registerPlugin(resourceLedgerPlugin(ledger));
  const b = new Uint8Array(await readFile(new URL('../public/fixture/b.glb', import.meta.url)));
  const root = { asset: { version: '1.0', gltfUpAxis: 'Y' }, geometricError: 1000, root: {
    // Conservative enclosing spheres keep this lifetime test independent of the camera audit.
    boundingVolume: { sphere: [0, 0, 0, 1000] }, geometricError: 1000, refine: 'ADD', children: [
      { boundingVolume: { sphere: [0, 0, 0, 1000] }, geometricError: 0, content: { uri: 'a.glb' } },
      { boundingVolume: { sphere: [0, 0, 0, 1000] }, geometricError: 0, content: { uri: 'b.glb' } },
    ],
  } };
  const requests: string[] = [], errors: Error[] = [];
  renderer.addEventListener('load-error', event => errors.push(event.error));
  renderer.registerPlugin({ name: 'LOCAL_NATIVE_RESOURCE_FIXTURE', async fetchData(url: string) {
    requests.push(url);
    if (url === 'https://fixture.invalid/fixture/root.json') return new Response(JSON.stringify(root));
    if (url === 'https://fixture.invalid/fixture/a.glb') return new Response(fixture.slice());
    if (url === 'https://fixture.invalid/fixture/b.glb') return new Response(b.slice());
    throw new Error('Unexpected fixture request');
  } });
  try {
    for (let i = 0; i < 150 && renderer.visibleTiles.size < 2 && !errors.length; i++) { renderer.update(); await tick(); }
    assert.deepEqual(errors, []); assert.equal(renderer.visibleTiles.size, 2, JSON.stringify(ledger.snapshot(renderer.visibleTiles))); assert.equal(requests.length, 3);
    const tiles = [...renderer.visibleTiles];
    const first = ledger.snapshot(renderer.visibleTiles);
    assert.equal(first.residentTiles, 2); assert.equal(first.visibleResidentTiles, 2);
    assert.equal(first.encodedGlbBytes, fixture.byteLength + b.byteLength);
    assert.equal(first.encodedSizeUnknownTiles, 0); assert.ok(first.unknownResources > 0); // real NullEngine capacities are zero.
    const container = (tiles[0] as unknown as { engineData: { container: AssetContainer } }).engineData.container;
    assert.equal(container.meshes.filter(mesh => mesh.getTotalVertices() > 0).length, 1);
    const duplicateId = ledger.loaded(tiles[0], container);
    assert.ok(first.residentTileIds.includes(duplicateId!)); assert.deepEqual(ledger.snapshot().residentTileIds, first.residentTileIds);
    (renderer as unknown as { setTileVisible(tile: object, visible: boolean): void }).setTileVisible(tiles[0], false);
    const hidden = ledger.snapshot(renderer.visibleTiles);
    assert.equal(hidden.residentTiles, 2); assert.equal(hidden.visibleResidentTiles, 1); assert.equal(hidden.hiddenResidentTiles, 1);
    assert.equal(hidden.encodedGlbBytes, first.encodedGlbBytes); assert.equal(hidden.uniqueBuffers, first.uniqueBuffers);
    renderer.lruCache.remove(tiles[0]);
    const removed = ledger.snapshot(renderer.visibleTiles);
    assert.equal(removed.residentTiles, 1); assert.equal(removed.hiddenResidentTiles, 0);
    assert.ok(removed.encodedGlbBytes < first.encodedGlbBytes);
    renderer.dispose();
    const disposed = ledger.snapshot();
    assert.equal(disposed.state, 'disposed'); assert.equal(disposed.residentTiles, 0); assert.equal(disposed.encodedGlbBytes, 0);
    assert.equal(h.scene.meshes.length, 0);
  } finally { renderer.dispose(); h.dispose(); }
});

test('shared native texture estimates cover all residents even when none are visible', () => {
  const h = native(); const ledger = new ResourceLedger();
  try {
    const texture = RawTexture.CreateRGBATexture(new Uint8Array(128), 8, 4, h.scene, true);
    h.container.textures.push(texture);
    const other = new AssetContainer(h.scene); other.textures.push(texture);
    ledger.loaded({}, h.container); ledger.loaded({}, other);
    const result = ledger.snapshot(new Set());
    assert.equal(result.residentTiles, 2); assert.equal(result.hiddenResidentTiles, 2);
    assert.equal(result.uniqueTextures, 1); assert.equal(result.estimatedTextureBytes, 16384);
    assert.equal(result.knownSubtotalBytes, 16384); assert.equal(result.completeStaticEstimateBytes, 16384);
    assert.equal(result.encodedSizeUnknownTiles, 2);
    assert.match(resourcePanelLines(result).join('\n'), /2 resident · 0 visible · 2 cached/);
    other.textures.length = 0; other.dispose();
  } finally { ledger.dispose(); h.dispose(); }
});

test('duplicate loads, unload, reset and late disposal completions never duplicate or reuse ledger IDs', () => {
  const h = native(); const ledger = new ResourceLedger(), tile = {};
  try {
    ledger.observeParse(tile, fixture); assert.equal(ledger.loaded(tile, h.container), 1);
    assert.equal(ledger.loaded(tile, h.container), 1); assert.equal(ledger.snapshot().residentTiles, 1);
    ledger.unloaded(tile); ledger.unloaded(tile); assert.equal(ledger.snapshot().encodedGlbBytes, 0);
    ledger.observeParse(tile, fixture); assert.equal(ledger.loaded(tile, h.container), 2);
    ledger.reset(); assert.equal(ledger.snapshot().residentTiles, 0); assert.equal(ledger.snapshot().encodedGlbBytes, 0);
    assert.equal(ledger.loaded(tile, h.container), 3); assert.equal(ledger.snapshot().encodedSizeUnknownTiles, 1);
    ledger.dispose(); ledger.reset(); ledger.observeParse(tile, fixture);
    assert.equal(ledger.loaded(tile, h.container), null); assert.equal(ledger.snapshot().residentTiles, 0);
  } finally { ledger.dispose(); h.dispose(); }
});

test('passive parse records only complete GLB view byte lengths, retains no pending content in the resident summary and leaves bytes unchanged', () => {
  const h = native(); const ledger = new ResourceLedger(), plugin = resourceLedgerPlugin(ledger);
  try {
    const envelope = new Uint8Array(fixture.length + 31); envelope.set(fixture, 17);
    const view = envelope.subarray(17, 17 + fixture.length); const copy = envelope.slice();
    const pending = {};
    assert.equal(plugin.parseTile(view, pending), null); assert.equal(ledger.snapshot().residentTiles, 0);
    assert.equal(ledger.snapshot().encodedGlbBytes, 0);
    ledger.loaded(pending, h.container); assert.equal(ledger.snapshot().encodedGlbBytes, fixture.length);
    const notGlb = {}; plugin.parseTile(new TextEncoder().encode('b3dm unsupported content'), notGlb); ledger.loaded(notGlb, h.container);
    const malformed = {}; plugin.parseTile(fixture.subarray(0, 20), malformed); ledger.loaded(malformed, h.container);
    assert.equal(ledger.snapshot().encodedSizeUnknownTiles, 2); assert.deepEqual(envelope, copy);
  } finally { plugin.dispose(); h.dispose(); }
});

test('inspection is bounded to one sample per second and a reset starts a fresh sampling interval', () => {
  const ledger = new ResourceLedger(), visible = new Set<object>();
  assert.ok(ledger.sample(0, visible)); assert.equal(ledger.sample(999, visible), null);
  assert.ok(ledger.sample(1000, visible)); assert.equal(ledger.sample(1000, visible), null);
  assert.ok(ledger.sample(9000, visible)); assert.equal(ledger.sample(9001, visible), null);
  assert.equal(ledger.sample(NaN, visible), null); ledger.reset(); assert.ok(ledger.sample(9002, visible));
  ledger.dispose(); assert.equal(ledger.snapshot().state, 'disposed');
});

test('summary and panel never expose native source names, attribute names, tile URLs, metadata, getters or inspection errors', () => {
  const h = native(); const ledger = new ResourceLedger(), secret = 'SECRET-NO-DIAGNOSTICS'; let getters = 0;
  try {
    const mesh = new Mesh(secret, h.scene);
    mesh.setVerticesData(`https://example.invalid/${secret}?key=${secret}`, new Float32Array(9));
    Object.defineProperty(mesh, 'metadata', { configurable: true, get() { getters++; throw new Error(secret); } });
    const material = new PBRMaterial(secret, h.scene); mesh.material = material;
    const texture = RawTexture.CreateRGBATexture(new Uint8Array(16), 2, 2, h.scene, true); texture.name = secret; material.albedoTexture = texture;
    h.container.meshes.push(mesh); h.container.textures.push(texture); h.container.materials.push(material);
    const tile = { engineData: { container: h.container }, get content() { getters++; throw new Error(secret); }, get metadata() { getters++; throw new Error(secret); } };
    ledger.loaded(tile, h.container); ledger.loaded({}, null);
    const summary = ledger.snapshot(new Set([tile]));
    assert.equal(summary.unknownContainers, 1); assert.equal(summary.completeStaticEstimateBytes, null);
    const output = JSON.stringify({ summary, lines: resourcePanelLines(summary) });
    assert.ok(!output.includes(secret)); assert.ok(!output.includes('https:')); assert.equal(getters, 0);
    // The real internal metadata API can contain dimensions too large for safe integer accounting.
    // The helper rejects the total; diagnostics report unavailable, never the thrown error object.
    texture.getInternalTexture()!.updateSize(2 ** 40, 2 ** 40);
    const unavailable = ledger.snapshot(); assert.equal(unavailable.state, 'unavailable');
    assert.equal(unavailable.knownSubtotalBytes, null); assert.match(resourcePanelLines(unavailable).join('\n'), /inspection unavailable/);
    assert.ok(!JSON.stringify(unavailable).includes(secret)); assert.equal(getters, 0);
    assert.equal(formatResourceBytes(null), 'Unavailable'); assert.equal(formatResourceBytes(1024), '1.0 KiB');
    Object.defineProperty(mesh, 'metadata', { configurable: true, value: null, writable: true });
  } finally { ledger.dispose(); h.dispose(); }
});
