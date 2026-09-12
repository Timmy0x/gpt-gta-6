import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { StructuralProfile, contentFormat, structuralProfilePlugin, EXTENSIONS } from '../src/structural-profile';
const matrix = (x: number, y: number, z: number) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];

test('structural summary only returns allowlisted counts and scalar magnitudes', () => {
  const profile = new StructuralProfile();
  const secret = 'NEVER_OUTPUT_THIS_SECRET';
  const tile = { transform: matrix(3, 4, 0), boundingVolume: { sphere: [6, 8, 0, 5] }, url: `https://example.org/?key=${secret}`, name: secret };
  profile.observeTile(tile); profile.observeTile(tile);
  profile.observeTileset({ asset: { gltfUpAxis: 'z', attribution: secret } });
  const plugin = structuralProfilePlugin(profile);
  assert.equal(plugin.parseTile(new TextEncoder().encode('glTF'), tile, secret), null);
  profile.observeLoaded(tile, {
    asset: { version: '2.0', generator: secret }, extensionsUsed: ['CESIUM_RTC', 'KHR_draco_mesh_compression', secret], extensionsRequired: ['KHR_mesh_quantization', secret],
    extensions: { CESIUM_RTC: { center: [0, 0, 6378137], secret } },
    nodes: [{ translation: [0, 12, 5], scale: [1, 2, 1], name: secret }, { matrix: matrix(0, 0, 20) }],
    buffers: [{ byteLength: 20 }, { uri: `https://example.org/${secret}` }, { uri: `data:application/octet-stream;base64,${secret}` }],
    images: [{ bufferView: 0 }, { uri: `https://example.org/${secret}` }, { uri: `data:image/png;base64,${secret}` }, {}],
    accessors: [{ componentType: 5123 }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }, { mode: 0, attributes: {} }] }],
  });
  const snapshot = profile.snapshot();
  assert.equal(snapshot.tilesObserved, 1); assert.equal(snapshot.loadedContent.glb, 1);
  assert.equal(snapshot.tileTransforms.maxTranslationMagnitudeM, 5); assert.equal(snapshot.maxSphereCenterMagnitudeM, 10);
  assert.equal(snapshot.maxNodeTranslationMagnitudeM, 20); assert.equal(snapshot.cesiumRtc.maxCenterMagnitudeM, 6378137);
  assert.equal(snapshot.nonUnitNodeScale, 1); assert.equal(snapshot.unknownExtensionsUsed, 1); assert.equal(snapshot.unknownExtensionsRequired, 1);
  assert.deepEqual(snapshot.buffers, { embedded: 2, external: 1 }); assert.deepEqual(snapshot.images, { embedded: 2, external: 1, unspecified: 1 });
  assert.equal(snapshot.primitiveModes.TRIANGLES, 1); assert.equal(snapshot.primitiveModes.POINTS, 1); assert.equal(snapshot.positionComponents.UNSIGNED_SHORT, 1);
  assert.ok(!JSON.stringify(snapshot).includes(secret)); assert.ok(!JSON.stringify(snapshot).includes('https:'));
  snapshot.loadedContent.glb = 123; assert.equal(profile.snapshot().loadedContent.glb, 1);
});

test('format sniffing and metadata inspection retain the existing synthetic source bytes', async () => {
  const profile = new StructuralProfile();
  for (const name of ['a', 'b']) {
    const bytes = await readFile(new URL(`../public/fixture/${name}.glb`, import.meta.url));
    const original = Buffer.from(bytes); const tile = {};
    const plugin = structuralProfilePlugin(profile);
    plugin.parseTile(bytes, tile, 'no-file-extension');
    const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
    profile.observeLoaded(tile, json); profile.observeLoaded(tile, json);
    assert.deepEqual(bytes, original);
  }
  assert.equal(profile.snapshot().loadedContent.glb, 2); assert.equal(profile.snapshot().gltfVersions['2.0'], 2);
  assert.equal(profile.snapshot().primitiveModes.TRIANGLES, 2); assert.equal(profile.snapshot().positionComponents.FLOAT, 2);
  for (const magic of ['b3dm', 'i3dm', 'pnts', 'cmpt']) assert.equal(contentFormat(new TextEncoder().encode(magic), ''), magic);
  assert.equal(contentFormat(new Uint8Array(), 'gltf'), 'gltf'); assert.equal(contentFormat(new Uint8Array(), 'arbitrary-secret'), 'unknown');
});

test('invalid, unexpected and oversized metadata cannot inject values or run getters', () => {
  const profile = new StructuralProfile();
  const tile = { transform: [NaN], boundingVolume: { box: [Infinity], region: [1, 2, 3, 4, 5, 6] } };
  profile.observeTile(tile);
  profile.observeTileset({ asset: { gltfUpAxis: 'SECRET' } });
  profile.observeTileset({ asset: {} });
  profile.observeLoaded(tile, { asset: { version: 'SECRET' }, extensionsUsed: new Array(10_001).fill('SECRET'), nodes: [{ translation: [Infinity, 0, 0] }, { get translation() { throw new Error('Getter executed'); } }], extensions: { CESIUM_RTC: { center: [NaN, 1, 2] } } });
  const snapshot = profile.snapshot();
  assert.equal(snapshot.gltfUpAxis.unknown, 1); assert.equal(snapshot.gltfUpAxis.defaultY, 1); assert.equal(snapshot.tileTransforms.invalid, 1);
  assert.equal(snapshot.cesiumRtc.invalidCenter, 1); assert.equal(snapshot.inspectionLimitReached, true); assert.equal(snapshot.unknownExtensionsUsed, 10_000);
  assert.ok(!JSON.stringify(snapshot).includes('SECRET')); assert.ok(!JSON.stringify(snapshot).includes('null'));
  assert.equal(new Set(EXTENSIONS).size, EXTENSIONS.length);
});
