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

test('hierarchy counts distinguish active-scene roots from nested large local translations without exposing source data', () => {
  const profile = new StructuralProfile();
  const metadata = {
    asset: { version: '2.0' }, scene: 1,
    scenes: [{ nodes: [3], name: 'DO_NOT_EXPORT_INACTIVE_SCENE' }, { nodes: [0] }],
    nodes: [
      { translation: [3000, 4000, 0], children: [1], name: 'DO_NOT_EXPORT_ROOT' },
      { matrix: matrix(0, 0, 7_000_000), children: [2] },
      { translation: [4096, 0, 0] },
      { translation: [9_000_000, 0, 0] },
    ],
  };
  const original = structuredClone(metadata), tile = {};
  profile.observeLoaded(tile, metadata); profile.observeLoaded(tile, metadata);
  const snapshot = profile.snapshot(), hierarchy = snapshot.hierarchy;
  assert.equal(hierarchy.translationThresholdM, 4096);
  assert.equal(hierarchy.inspectedModels, 1); assert.equal(hierarchy.multiSceneModels, 1);
  assert.equal(hierarchy.defaultSceneModels, 0); assert.equal(hierarchy.activeRoots, 1);
  assert.equal(hierarchy.activeNodes, 3); assert.equal(hierarchy.nestedNodes, 2);
  assert.equal(hierarchy.largeTranslationRoots, 1); assert.equal(hierarchy.largeTranslationNested, 1);
  assert.equal(hierarchy.maxDepth, 2); assert.equal(hierarchy.limitReachedModels, 0);
  assert.equal(snapshot.nodesObserved, 4); // General format inventory still includes inactive nodes.
  assert.equal(snapshot.maxNodeTranslationMagnitudeM, 9_000_000);
  assert.deepEqual(metadata, original);
  assert.ok(!JSON.stringify(snapshot).includes('DO_NOT_EXPORT'));
  assert.ok(Object.values(hierarchy).every(value => typeof value === 'number' && Number.isFinite(value)));
});

test('scene fallback, missing scenes and malformed cyclic or shared hierarchies are reported explicitly', () => {
  const profile = new StructuralProfile();
  profile.observeLoaded({}, { asset: { version: '2.0' }, scenes: [{ nodes: [0] }, { nodes: [1] }], nodes: [{ translation: [5000, 0, 0] }, { translation: [6000, 0, 0] }] });
  profile.observeLoaded({}, { asset: { version: '2.0' }, nodes: [{ translation: [7000, 0, 0] }] });
  profile.observeLoaded({}, { asset: { version: '2.0' }, scene: 5, scenes: [{ nodes: [0] }], nodes: [{}] });
  const sceneSummary = profile.snapshot().hierarchy;
  assert.equal(sceneSummary.inspectedModels, 3); assert.equal(sceneSummary.multiSceneModels, 1);
  assert.equal(sceneSummary.defaultSceneModels, 1); assert.equal(sceneSummary.missingSceneModels, 1);
  assert.equal(sceneSummary.invalidSceneModels, 1); assert.equal(sceneSummary.largeTranslationRoots, 1);
  const malformed = new StructuralProfile();
  malformed.observeLoaded({}, {
    asset: { version: '2.0' }, scenes: [{ nodes: [0] }],
    nodes: [{ children: [1, 1, 99] }, { children: [0, 2] }, { children: 'INVALID_CHILDREN' }],
  });
  const hierarchy = malformed.snapshot().hierarchy;
  assert.equal(hierarchy.cycleEdges, 1); assert.equal(hierarchy.repeatedNodeReferences, 1);
  assert.equal(hierarchy.invalidNodeReferences, 1); assert.equal(hierarchy.invalidChildren, 1);
  assert.equal(hierarchy.activeNodes, 3); assert.equal(hierarchy.maxDepth, 2);
  assert.ok(!JSON.stringify(malformed.snapshot()).includes('INVALID_CHILDREN'));
});

test('hierarchy inspection has a shared finite traversal budget and does not invoke array or property getters', () => {
  const profile = new StructuralProfile();
  profile.observeLoaded({}, {
    asset: { version: '2.0' }, scenes: [{ nodes: [0] }],
    nodes: Array.from({ length: 12_000 }, (_, i) => ({ children: i === 11_999 ? [] : [i + 1] })),
  });
  const hierarchy = profile.snapshot().hierarchy;
  assert.equal(hierarchy.activeNodes, 10_000); assert.equal(hierarchy.maxDepth, 9999);
  assert.equal(hierarchy.limitReachedModels, 1); assert.equal(profile.snapshot().inspectionLimitReached, true);
  const trap = () => { throw new Error('Metadata getter executed'); };
  const rootSlots = new Array(1), childSlots = new Array(1), nodeSlots = new Array(1), translationSlots = new Array(3);
  for (const value of [rootSlots, childSlots, nodeSlots, translationSlots]) Object.defineProperty(value, '0', { get: trap });
  const safe = new StructuralProfile();
  safe.observeLoaded({}, { asset: { version: '2.0' }, scenes: [{ nodes: rootSlots }], nodes: [{}] });
  safe.observeLoaded({}, { asset: { version: '2.0' }, scenes: [{ nodes: [0] }], nodes: [{ children: childSlots, translation: translationSlots }] });
  safe.observeLoaded({}, { asset: { version: '2.0' }, scenes: [{ nodes: [0] }], nodes: nodeSlots });
  safe.observeLoaded({}, { asset: { version: '2.0' }, scenes: [{ nodes: [0] }], nodes: [{ get children() { return trap(); } }] });
  assert.equal(safe.snapshot().hierarchy.invalidNodeReferences, 3);
  assert.equal(safe.snapshot().hierarchy.activeNodes, 2);
});
