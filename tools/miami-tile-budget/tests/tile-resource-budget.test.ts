import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import test from 'node:test';
import { AssetContainer, Constants, Geometry, Mesh, MeshBuilder, NullEngine, PBRMaterial, RawTexture, RenderTargetTexture, Scene, Texture, VertexBuffer } from '@babylonjs/core';
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader';
import '@babylonjs/loaders/glTF/2.0';
import { measureTileResources, type TileResourceInput } from '../src/TileResourceBudget';

const evidence: Record<string, unknown> = { engine: 'Babylon 9.25.0 NullEngine; no physical GPU or measured VRAM', mockedEngineMethods: false };
const save = () => writeFile(new URL('../evidence/result.json', import.meta.url), JSON.stringify(evidence, null, 2) + '\n');
function setup() {
  const engine = new NullEngine(), scene = new Scene(engine);
  const container = new AssetContainer(scene);
  return { engine, scene, container, dispose: () => { container.dispose(); scene.dispose(); engine.dispose(); } };
}
const input = (id: string, container: TileResourceInput['container'], size: number | null = 0): TileResourceInput => ({ id, container, encodedGlbByteLength: size });

test('real engine-created DataBuffers shared by interleaved attributes, geometry clones and distinct geometries count once', async () => {
  const h = setup();
  try {
    // NullEngine's vertex/index constructors report zero capacity. Its uniform constructor actually
    // fills capacity. Reuse that real DataBuffer through Babylon's public geometry interfaces:
    // this verifies capacity/identity accounting without pretending NullEngine allocated a GPU.
    const interleaved = h.engine.createUniformBuffer(new Float32Array(24));
    const indices = h.engine.createUniformBuffer(new Float32Array(6));
    const mesh = new Mesh('native-capacity-mesh', h.scene);
    const geometry = new Geometry('native-capacity-geometry', h.scene);
    geometry.setVerticesBuffer(new VertexBuffer(h.engine, interleaved, VertexBuffer.PositionKind, { stride: 6, offset: 0, size: 3 }), 3);
    geometry.setVerticesBuffer(new VertexBuffer(h.engine, interleaved, VertexBuffer.NormalKind, { stride: 6, offset: 3, size: 3 }), 3);
    geometry.setIndexBuffer(indices, 3, 3, true);
    geometry.applyToMesh(mesh);
    const clone = mesh.clone('shared-geometry-clone');
    const other = new Mesh('separate-geometry-shared-buffer', h.scene);
    other.setVerticesBuffer(new VertexBuffer(h.engine, interleaved, VertexBuffer.PositionKind, { stride: 6, size: 3 }), true, 3);
    const a = input('A', { meshes: [mesh, clone], textures: [] }, 1200);
    const b = input('B', { meshes: [other], textures: [] }, 2400);
    const report = measureTileResources([a, b]);
    assert.equal(interleaved.capacity, 96); assert.equal(indices.capacity, 24);
    assert.equal(report.uniqueBufferCount, 2);
    assert.equal(report.gpuBufferCapacityBytes, 120); // includes unused capacity, not 3*stride.
    assert.equal(report.budgetChargeBytes, 120);
    assert.equal(report.encodedGlbBytes, 3600); // downloads remain a separate metric.
    assert.deepEqual(report.buffers.find(row => row.capacityBytes === 96)?.tileIds, ['A', 'B']);
    assert.deepEqual(report.buffers.find(row => row.capacityBytes === 96)?.roles, ['vertex:position', 'vertex:normal']);
    assert.equal(measureTileResources([a]).gpuBufferCapacityBytes + measureTileResources([b]).gpuBufferCapacityBytes, 216);
    mesh.dispose();
    assert.equal(measureTileResources([a, b]).gpuBufferCapacityBytes, 120); // clone still owns shared geometry.
    clone.dispose();
    assert.equal(measureTileResources([a, b]).gpuBufferCapacityBytes, 96); // other geometry still references it.
    other.dispose();
    assert.equal(measureTileResources([a, b]).gpuBufferCapacityBytes, 0);
    evidence.sharedNativeBuffers = { globalUniqueBytes: 120, independentlyChargedBytes: 216, encodedGlbBytes: 3600, sharedInterleavedCapacity: 96 };
    await save();
  } finally { h.dispose(); }
});

test('native GLB importer exposes zero-capacity NullEngine buffers as unknown and never substitutes encoded or CPU sizes', async () => {
  const h = setup();
  try {
    const bytes = new Uint8Array(await readFile(new URL('../fixtures/asymmetric.glb', import.meta.url)));
    const asset = await LoadAssetContainerAsync(bytes, h.scene, { pluginExtension: '.glb' });
    try {
      const report = measureTileResources([input('original-glb', asset, bytes.byteLength)]);
      assert.equal(asset.meshes.filter(mesh => mesh.getTotalVertices() > 0).length, 6);
      assert.ok(report.uniqueBufferCount > 0);
      assert.equal(report.gpuBufferCapacityBytes, 0);
      assert.equal(report.budgetChargeBytes, null);
      assert.equal(report.encodedGlbBytes, bytes.byteLength);
      assert.ok(report.unknownResources.every(row => row.kind === 'buffer' && row.reason.includes('capacity')));
      evidence.originalGlb = { meshes: 6, encodedBytes: bytes.byteLength, unknownBufferCount: report.uniqueBufferCount, estimatedCharge: null };
      asset.dispose();
      const released = measureTileResources([input('original-glb', asset, bytes.byteLength)]);
      assert.equal(released.uniqueBufferCount, 0); assert.equal(released.budgetChargeBytes, 0);
      assert.equal(released.encodedGlbBytes, bytes.byteLength);
      await save();
    } finally { asset.dispose(); }
  } finally { h.dispose(); }
});

test('native RawTexture clones and multiple material slots share one internal allocation, including all reserved mip levels', async () => {
  const h = setup();
  try {
    const texture = RawTexture.CreateRGBATexture(new Uint8Array(8 * 4 * 4), 8, 4, h.scene, true);
    const clone = texture.clone();
    const material = new PBRMaterial('two-slots', h.scene);
    material.albedoTexture = texture; material.bumpTexture = clone;
    const mesh = new Mesh('material-only', h.scene); mesh.material = material;
    h.container.meshes.push(mesh); h.container.textures.push(texture, clone); h.container.materials.push(material);
    assert.equal(texture.getInternalTexture(), clone.getInternalTexture());
    const report = measureTileResources([input('one', h.container), input('two', { meshes: [], textures: [clone] })]);
    assert.equal(report.uniqueTextureCount, 1);
    assert.equal(report.textures[0].reservedMipLevels, 4);
    assert.equal(report.decodedTextureTexelReserveBytes, (32 + 8 + 2 + 1) * 4);
    assert.equal(report.textureAllocationEstimateBytes, 4 * 4096);
    assert.equal(report.budgetChargeBytes, 16384);
    assert.equal(report.textures[0].textureIds.length, 2);
    assert.deepEqual(report.textures[0].tileIds, ['one', 'two']);
    // Public sampler state change does not free baked/generated mip storage.
    texture.getInternalTexture()!.useMipMaps = false;
    texture.updateSamplingMode(Texture.NEAREST_SAMPLINGMODE);
    const disabled = measureTileResources([input('one', h.container)]);
    assert.equal(disabled.textureAllocationEstimateBytes, report.textureAllocationEstimateBytes);
    assert.equal(disabled.textures[0].samplesMipMaps, false);
    evidence.sharedMipTexture = { uniqueInternalTextures: 1, wrappers: 2, dimensions: [8, 4], texelReserveBytes: 172, alignedEstimateBytes: 16384, disablingSamplingDoesNotReduceEstimate: true };
    h.container.dispose();
    const after = measureTileResources([input('one', h.container)]);
    assert.equal(after.budgetChargeBytes, 0); assert.equal(after.uniqueTextureCount, 0);
    await save();
  } finally { h.dispose(); }
});

test('decoded size, type, non-power-of-two dimensions and alignment drive the estimate rather than upload bytes', async () => {
  const h = setup();
  try {
    const rgb = new RawTexture(new Float32Array(9 * 5 * 3), 9, 5, Constants.TEXTUREFORMAT_RGB, h.scene, false, false, Texture.NEAREST_SAMPLINGMODE, Constants.TEXTURETYPE_FLOAT);
    h.container.textures.push(rgb);
    const report = measureTileResources([input('float-rgb', h.container, 37)]);
    assert.equal(report.textures[0].generatesMipMaps, false);
    assert.equal(report.textures[0].reservedMipLevels, 4); // 9x5, 4x2, 2x1, 1x1.
    assert.equal(report.decodedTextureTexelReserveBytes, (45 + 8 + 2 + 1) * 16); // RGB can expand to RGBA32F.
    assert.equal(report.textureAllocationEstimateBytes, 16384);
    assert.equal(report.encodedGlbBytes, 37);
    const unaligned = measureTileResources([input('float-rgb', h.container)], { rowAlignmentBytes: 1, mipAllocationAlignmentBytes: 1 });
    assert.equal(unaligned.textureAllocationEstimateBytes, 896);
    const half = new RawTexture(new Uint16Array(4 * 4), 4, 4, Constants.TEXTUREFORMAT_RED, h.scene, true, false, Texture.NEAREST_SAMPLINGMODE, Constants.TEXTURETYPE_HALF_FLOAT);
    h.container.textures.push(half);
    const two = measureTileResources([input('float-and-half', h.container)]);
    assert.equal(two.decodedTextureTexelReserveBytes, 896 + (16 + 4 + 1) * 8);
    assert.equal(two.textureAllocationEstimateBytes, 16384 + 12288);
    evidence.texturePolicy = { npotDimensions: [9, 5], floatRgbRGBAExpansionBytes: 896, alignedBytes: 16384, halfRedRGBAExpansionBytes: 168, fullChainWithoutGenerationReserved: true };
    await save();
  } finally { h.dispose(); }
});

test('native pending textures, render targets and ordinary headless mesh buffers block a complete charge', async () => {
  const h = setup();
  try {
    const pending = new Texture(null, h.scene);
    const target = new RenderTargetTexture('actual-null-render-target', 16, h.scene);
    const depth = new RawTexture(new Float32Array(16), 4, 4, Constants.TEXTUREFORMAT_DEPTH32_FLOAT, h.scene, false, false, Texture.NEAREST_SAMPLINGMODE, Constants.TEXTURETYPE_FLOAT);
    const mesh = MeshBuilder.CreateBox('unknown-headless-capacities', {}, h.scene);
    mesh.createInstance('native-instance');
    mesh.subMeshes[0]._getLinesIndexBuffer(mesh.getIndices()!, h.engine);
    h.container.textures.push(pending, target, depth); h.container.meshes.push(mesh);
    const report = measureTileResources([input('unknowns', h.container, null)]);
    assert.equal(report.budgetChargeBytes, null);
    assert.deepEqual(report.encodedSizeUnknownTileIds, ['unknowns']);
    assert.ok(report.unknownResources.some(row => row.reason.includes('no internal allocation')));
    assert.ok(report.unknownResources.some(row => row.reason.includes('attachment/depth')));
    assert.ok(report.unknownResources.some(row => row.reason.includes('Compressed, depth')));
    assert.ok(report.unknownResources.some(row => row.reason.includes('capacity')));
    assert.ok(report.unknownResources.some(row => row.reason.includes('Source mesh owns instance')));
    assert.ok(report.unknownResources.some(row => row.reason.includes('Wireframe/edge')));
    assert.equal(report.encodedGlbBytes, 0);
    evidence.unknowns = report.unknownResources.map(row => ({ kind: row.kind, reason: row.reason }));
    h.container.dispose();
    const released = measureTileResources([input('unknowns', h.container)]);
    assert.equal(released.budgetChargeBytes, 0); assert.deepEqual(released.unknownResources, []);
    await save();
  } finally { h.dispose(); }
});

test('invalid accounting IDs, unsafe encoded sizes and invalid alignment policies fail explicitly', () => {
  const empty = { meshes: [], textures: [] };
  assert.throws(() => measureTileResources([input('x', empty), input('x', empty)]), /unique/);
  assert.throws(() => measureTileResources([input('x', empty, -1)]), /byte count/);
  assert.throws(() => measureTileResources([], { rowAlignmentBytes: 3, mipAllocationAlignmentBytes: 4096 }), /power-of-two/);
  assert.equal(measureTileResources([input('encoded-unknown', empty, null)]).budgetChargeBytes, 0);
});
