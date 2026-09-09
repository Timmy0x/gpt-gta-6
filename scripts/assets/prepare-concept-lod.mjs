/** Offline LOD preparation; preserves component nodes, materials, texture bytes and vertex attributes. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MeshoptSimplifier } from './vendor/meshopt_simplifier-0.25.0.module.js';
import { batchConceptLOD } from './batch-concept-lod.mjs';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const directory = resolve(project, 'public/vehicles/concept');
const sourceHash = '6923a315ac3656ddab95c281a8113055f0a4051ced2c35b35706fc1095d860ab';
const simplifierHash = 'c1d23d1a1ead1251def1f98fa427b6e61d9e6f53ff32e69aaf7159d502cd77ca';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

function parseGLB(bytes) {
  assert.equal(bytes.readUInt32LE(0), 0x46546c67); assert.equal(bytes.readUInt32LE(4), 2);
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  const jsonEnd = 20 + bytes.readUInt32LE(12);
  assert.equal(bytes.readUInt32LE(16), 0x4e4f534a); assert.equal(bytes.readUInt32LE(jsonEnd + 4), 0x004e4942);
  return { gltf: JSON.parse(bytes.subarray(20, jsonEnd).toString()), bin: bytes.subarray(jsonEnd + 8, jsonEnd + 8 + bytes.readUInt32LE(jsonEnd)) };
}
function encodeGLB(gltf, bin) {
  const json = Buffer.from(JSON.stringify(gltf)), jsonPad = Buffer.alloc((4 - json.length % 4) % 4, 0x20);
  const binPad = Buffer.alloc((4 - bin.length % 4) % 4), header = Buffer.alloc(20), binaryHeader = Buffer.alloc(8);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
  header.writeUInt32LE(28 + json.length + jsonPad.length + bin.length + binPad.length, 8);
  header.writeUInt32LE(json.length + jsonPad.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
  binaryHeader.writeUInt32LE(bin.length + binPad.length, 0); binaryHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, json, jsonPad, binaryHeader, bin, binPad]);
}
function readAccessor(gltf, bin, index) {
  const accessor = gltf.accessors[index], view = gltf.bufferViews[accessor.bufferView];
  assert.ok(!accessor.sparse && !accessor.normalized); assert.equal(view.buffer, 0);
  assert.ok([5123, 5126].includes(accessor.componentType));
  const width = components[accessor.type], bytes = accessor.componentType === 5126 ? 4 : 2;
  const array = new (bytes === 4 ? Float32Array : Uint16Array)(accessor.count * width);
  for (let i = 0; i < accessor.count; i++) for (let j = 0; j < width; j++) {
    const offset = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0) + i * (view.byteStride ?? width * bytes) + j * bytes;
    array[i * width + j] = bytes === 4 ? bin.readFloatLE(offset) : bin.readUInt16LE(offset);
  }
  return array;
}
function bounds(array, width) {
  const min = Array(width).fill(Infinity), max = Array(width).fill(-Infinity);
  for (let i = 0; i < array.length; i++) { const axis = i % width; min[axis] = Math.min(min[axis], array[i]); max[axis] = Math.max(max[axis], array[i]); }
  return { min, max };
}
function quality(name) {
  // Dense small details can lose much more geometry than the broad reflective body.
  if (/Wiper/.test(name)) return { ratio: .08, error: .01 };
  if (/Rim|BrakePad/.test(name)) return { ratio: .15, error: .01 };
  if (/Tire/.test(name)) return { ratio: .75, error: .002 };
  if (/Window|Windshield|Mirror|light/i.test(name)) return { ratio: .25, error: .006 };
  if (/Interior/.test(name)) return { ratio: .18, error: .015 };
  return { ratio: .18, error: .006 };
}

const source = await readFile(resolve(directory, 'car.glb'));
assert.equal(sha256(source), sourceHash, 'pinned prepared source');
assert.equal(sha256(await readFile(resolve(project, 'scripts/assets/vendor/meshopt_simplifier-0.25.0.module.js'))), simplifierHash, 'pinned simplifier');
const { gltf: original, bin: originalBin } = parseGLB(source), gltf = structuredClone(original);
assert.ok(!original.skins?.length && !original.animations?.length, 'this pipeline is for the static component car asset');
await MeshoptSimplifier.ready;

const parts = [], views = [], accessors = [], viewCache = new Map(); let byteOffset = 0;
function appendView(bytes, target) {
  const key = `${target ?? ''}:${sha256(bytes)}`;
  if (viewCache.has(key)) return viewCache.get(key);
  const padding = Buffer.alloc((4 - byteOffset % 4) % 4); parts.push(padding); byteOffset += padding.length;
  const index = views.length; views.push({ buffer: 0, byteOffset, byteLength: bytes.length, ...(target ? { target } : {}) });
  parts.push(bytes); byteOffset += bytes.length; viewCache.set(key, index); return index;
}
function appendAccessor(array, type, target) {
  const width = components[type], componentType = array instanceof Float32Array ? 5126 : 5123;
  const index = accessors.length;
  accessors.push({ bufferView: appendView(Buffer.from(array.buffer, array.byteOffset, array.byteLength), target), componentType, count: array.length / width, type, ...bounds(array, width) });
  return index;
}

const primitiveReport = [];
for (const [meshIndex, mesh] of original.meshes.entries()) {
  const name = mesh.name ?? original.nodes.find(node => node.mesh === meshIndex)?.name ?? `mesh-${meshIndex}`;
  for (const [primitiveIndex, primitive] of mesh.primitives.entries()) {
    assert.equal(primitive.mode ?? 4, 4); assert.ok(!primitive.targets);
    const indices = new Uint32Array(readAccessor(original, originalBin, primitive.indices));
    const streams = Object.fromEntries(Object.entries(primitive.attributes).map(([semantic, accessor]) => [semantic, readAccessor(original, originalBin, accessor)]));
    const positions = streams.POSITION, count = positions.length / 3, originalBounds = bounds(positions, 3);
    const config = quality(name), attributeFields = ['NORMAL', 'TEXCOORD_0', 'TEXCOORD_1'].filter(key => streams[key]);
    const widths = attributeFields.map(key => components[original.accessors[primitive.attributes[key]].type]);
    const attributeStride = widths.reduce((sum, width) => sum + width, 0), attributes = new Float32Array(count * attributeStride);
    const weights = attributeFields.flatMap((key, field) => Array(widths[field]).fill(key === 'NORMAL' ? .5 : .1));
    for (let vertex = 0; vertex < count; vertex++) {
      let offset = 0;
      for (const [field, key] of attributeFields.entries()) {
        attributes.set(streams[key].subarray(vertex * widths[field], (vertex + 1) * widths[field]), vertex * attributeStride + offset);
        offset += widths[field];
      }
    }
    // Preserve each component's exact extents and border vertices, including moving panel seams.
    const lock = new Uint8Array(count);
    for (let vertex = 0; vertex < count; vertex++) for (let axis = 0; axis < 3; axis++)
      if (positions[vertex * 3 + axis] === originalBounds.min[axis] || positions[vertex * 3 + axis] === originalBounds.max[axis]) lock[vertex] = 1;
    const target = Math.min(indices.length, Math.max(48, Math.floor(indices.length / 3 * config.ratio) * 3));
    let simplified = indices, error = 0;
    if (indices.length >= 384) [simplified, error] = MeshoptSimplifier.simplifyWithAttributes(indices, positions, 3, attributes, attributeStride, weights, lock, target, config.error, ['LockBorder', 'ErrorAbsolute']);
    assert.ok(simplified.length > 0 && simplified.length <= indices.length);
    const [remap, unique] = MeshoptSimplifier.compactMesh(simplified);
    assert.ok(unique <= 65535);
    const destination = gltf.meshes[meshIndex].primitives[primitiveIndex];
    destination.indices = appendAccessor(new Uint16Array(simplified), 'SCALAR', 34963);
    for (const [semantic, array] of Object.entries(streams)) {
      const type = original.accessors[primitive.attributes[semantic]].type, width = components[type], compact = new Float32Array(unique * width);
      for (let old = 0; old < remap.length; old++) if (remap[old] !== 0xffffffff)
        compact.set(array.subarray(old * width, (old + 1) * width), remap[old] * width);
      destination.attributes[semantic] = appendAccessor(compact, type, 34962);
      if (semantic === 'POSITION') assert.deepEqual(bounds(compact, 3), originalBounds, `${name} exact component extents`);
    }
    primitiveReport.push({ meshIndex, primitiveIndex, name, beforeTriangles: indices.length / 3, afterTriangles: simplified.length / 3, beforeVertices: count, afterVertices: unique, targetRatio: config.ratio, weightedErrorLimit: config.error, measuredWeightedError: error });
  }
}
for (const image of gltf.images) {
  const view = original.bufferViews[image.bufferView];
  image.bufferView = appendView(originalBin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength));
}
gltf.bufferViews = views; gltf.accessors = accessors;
const bin = Buffer.concat(parts); gltf.buffers = [{ byteLength: bin.length }];
const modifications = 'LOD geometry simplified per component with meshoptimizer 0.25, retaining exact component extents and topological borders. Index selection and vertex compaction preserve retained positions, normals, tangents, both UV sets, all material definitions, embedded image bytes, and the complete node hierarchy. No texture resampling, quantization, component deletion, or runtime simplification.';
gltf.asset.extras.leonidaLOD = { sourceSha256: sourceHash, simplifier: 'meshoptimizer 0.25', simplifierSha256: simplifierHash, modifications };
gltf.asset.copyright += ' LOD geometry simplified with meshoptimizer 0.25.';
assert.deepEqual(gltf.nodes, original.nodes); assert.deepEqual(gltf.scenes, original.scenes); assert.deepEqual(gltf.materials, original.materials); assert.deepEqual(gltf.textures, original.textures);
for (const [i, image] of gltf.images.entries()) {
  const before = original.bufferViews[original.images[i].bufferView], after = gltf.bufferViews[image.bufferView];
  assert.deepEqual(bin.subarray(after.byteOffset, after.byteOffset + after.byteLength), originalBin.subarray(before.byteOffset, before.byteOffset + before.byteLength));
}
const output = encodeGLB(gltf, bin), parsed = parseGLB(output);
assert.equal(parsed.gltf.meshes.length, 97); assert.equal(primitiveReport.length, 109);
const total = key => primitiveReport.reduce((sum, entry) => sum + entry[key], 0);
const report = {
  source: { path: 'car.glb', sha256: sourceHash, bytes: source.length, triangles: total('beforeTriangles'), vertices: total('beforeVertices') },
  output: { path: 'car-lod1.glb', sha256: sha256(output), bytes: output.length, triangles: total('afterTriangles'), vertices: total('afterVertices') },
  tool: { name: 'meshoptimizer', version: '0.25', source: 'https://github.com/zeux/meshoptimizer/tree/v0.25', moduleSha256: simplifierHash, license: 'MIT' },
  license: 'CC-BY-4.0', author: 'Eric Chadwick', copyrightOwner: 'Darmstadt Graphics Group GmbH', modifications,
  verification: { hierarchyPreserved: true, componentBoundsExact: true, materialsAndTexturesPreserved: true, imagePayloadsExact: true, allAttributeValuesCopiedExactly: true, meshes: gltf.meshes.length, primitives: primitiveReport.length },
  qualityNote: 'Solver error includes normal/UV weights and is an approximate simplification metric, not a Hausdorff-distance guarantee. Visual inspection and in-game integration are separate checks.',
  primitives: primitiveReport,
};
await writeFile(resolve(directory, 'car-lod1.glb'), output);
await writeFile(resolve(directory, 'lod-provenance.json'), JSON.stringify(report, null, 2) + '\n');
const batched = batchConceptLOD(gltf, bin);
batched.gltf.asset.extras.leonidaLOD.batching = 'Compatible primitives merged only within the same parent, material, material-variant mapping and damage role. Door/cover anchors, each glazing part, paired lamps, and wheel caliper/disc/rim roles remain separate. Node transforms and hierarchy retained; empty original nodes retain their names.';
const batchedBytes = encodeGLB(batched.gltf, batched.bin);
const batching = { sourceSha256: sha256(output), output: { path: 'car-lod1-batched.glb', sha256: sha256(batchedBytes), bytes: batchedBytes.length, triangles: report.output.triangles, vertices: report.output.vertices }, ...batched.report };
await writeFile(resolve(directory, 'car-lod1-batched.glb'), batchedBytes);
await writeFile(resolve(directory, 'lod-batching.json'), JSON.stringify(batching, null, 2) + '\n');
console.log(JSON.stringify({ source: report.source, output: report.output, verification: report.verification, batched: { ...batching.output, meshes: batching.meshes, primitives: batching.primitives } }, null, 2));
