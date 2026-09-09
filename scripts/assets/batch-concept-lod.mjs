/** Merge compatible LOD meshes within one parent without changing interactive group boundaries. */
import assert from 'node:assert/strict';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.js';

const widths = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const anchors = new Set(['BodyDoorLColor1', 'BodyDoorRColor1', 'BodyHood', 'BodyRearPanelsColor1']);
const panelPattern = /^Body(?:Underside|RoofPanel|RearPanelsColor1|Pillars|PanelsColor2|Hood$|Door[LR]Color[12])/;
function role(node, index) {
  const name = node.name ?? '';
  // The near adapter identifies these components by their authored exact names.
  if (anchors.has(name) || /(?:Window|Windshield)$|BodyWindowsRearSides|Body(?:Headlights|Taillights)$/i.test(name)) return `independent-${index}`;
  if (/BrakePad/.test(name)) return 'caliper';
  if (/BrakeDisc/.test(name)) return 'disc';
  if (/Rim/.test(name)) return 'rim';
  return panelPattern.test(name) ? 'panel' : 'rigid';
}
function localMatrix(node) {
  return node.matrix ? Matrix.FromArray(node.matrix) : Matrix.Compose(Vector3.FromArray(node.scale ?? [1, 1, 1]), Quaternion.FromArray(node.rotation ?? [0, 0, 0, 1]), Vector3.FromArray(node.translation ?? [0, 0, 0]));
}
function read(gltf, bin, accessorIndex) {
  const accessor = gltf.accessors[accessorIndex], view = gltf.bufferViews[accessor.bufferView];
  const Type = accessor.componentType === 5126 ? Float32Array : Uint16Array;
  assert.ok([5126, 5123].includes(accessor.componentType) && !accessor.sparse && !view.byteStride);
  const bytes = bin.subarray((view.byteOffset ?? 0) + (accessor.byteOffset ?? 0), (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0) + accessor.count * widths[accessor.type] * Type.BYTES_PER_ELEMENT);
  return new Type(Uint8Array.from(bytes).buffer);
}
function range(array, width) {
  const min = Array(width).fill(Infinity), max = Array(width).fill(-Infinity);
  for (let i = 0; i < array.length; i++) { const axis = i % width; min[axis] = Math.min(min[axis], array[i]); max[axis] = Math.max(max[axis], array[i]); }
  return { min, max };
}

export function batchConceptLOD(input, inputBin) {
  const gltf = structuredClone(input), parents = new Map(), groups = new Map();
  gltf.nodes.forEach((node, index) => node.children?.forEach(child => parents.set(child, index)));
  for (const [nodeIndex, node] of input.nodes.entries()) {
    if (node.mesh === undefined) continue;
    for (const [primitiveIndex, primitive] of input.meshes[node.mesh].primitives.entries()) {
      const key = JSON.stringify([parents.get(nodeIndex), role(node, nodeIndex), primitive.material, Object.keys(primitive.attributes).sort(), primitive.extensions ?? {}]);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ nodeIndex, primitiveIndex, primitive });
    }
  }
  const parts = [], views = [], accessors = [], meshes = [], mapping = []; let offset = 0;
  function view(bytes, target) {
    const pad = Buffer.alloc((4 - offset % 4) % 4); parts.push(pad); offset += pad.length;
    const index = views.length; views.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, ...(target ? { target } : {}) });
    parts.push(bytes); offset += bytes.length; return index;
  }
  function accessor(array, type, target) {
    const index = accessors.length;
    accessors.push({ bufferView: view(Buffer.from(array.buffer, array.byteOffset, array.byteLength), target), componentType: array instanceof Float32Array ? 5126 : 5123, count: array.length / widths[type], type, ...range(array, widths[type]) });
    return index;
  }
  for (const node of gltf.nodes) delete node.mesh;
  for (const entries of groups.values()) {
    const first = entries[0], destinationNode = gltf.nodes[first.nodeIndex], destination = structuredClone(first.primitive);
    const invertDestination = localMatrix(destinationNode).invert(), vertexStreams = {}, triangles = [];
    let vertexCount = 0, maxWorldPositionError = 0;
    for (const entry of entries) {
      const sourceNode = input.nodes[entry.nodeIndex], matrix = localMatrix(sourceNode).multiply(invertDestination), determinant = matrix.determinant();
      const normalMatrix = matrix.clone().invert().transpose(), indices = read(input, inputBin, entry.primitive.indices);
      const count = input.accessors[entry.primitive.attributes.POSITION].count;
      for (const [semantic, index] of Object.entries(entry.primitive.attributes)) {
        const array = read(input, inputBin, index), width = widths[input.accessors[index].type];
        if (!vertexStreams[semantic]) vertexStreams[semantic] = [];
        for (let vertex = 0; vertex < count; vertex++) {
          if (semantic === 'POSITION' || semantic === 'NORMAL' || semantic === 'TANGENT') {
            const original = Vector3.FromArray(array, vertex * width);
            const value = semantic === 'POSITION' ? Vector3.TransformCoordinates(original, matrix) : Vector3.TransformNormal(original, semantic === 'NORMAL' ? normalMatrix : matrix).normalize();
            vertexStreams[semantic].push(value.x, value.y, value.z);
            if (width === 4) vertexStreams[semantic].push(array[vertex * width + 3] * (determinant < 0 ? -1 : 1));
            if (semantic === 'POSITION') {
              const before = Vector3.TransformCoordinates(original, localMatrix(sourceNode)), after = Vector3.TransformCoordinates(value, localMatrix(destinationNode));
              maxWorldPositionError = Math.max(maxWorldPositionError, Vector3.Distance(before, after));
            }
          } else vertexStreams[semantic].push(...array.subarray(vertex * width, (vertex + 1) * width));
        }
      }
      for (let i = 0; i < indices.length; i += 3) {
        triangles.push(indices[i] + vertexCount, indices[i + (determinant < 0 ? 2 : 1)] + vertexCount, indices[i + (determinant < 0 ? 1 : 2)] + vertexCount);
      }
      vertexCount += count;
    }
    assert.ok(vertexCount <= 65535); assert.ok(maxWorldPositionError < 2e-6, 'merged vertex positions preserve common-parent space');
    for (const [semantic, values] of Object.entries(vertexStreams)) destination.attributes[semantic] = accessor(new Float32Array(values), input.accessors[first.primitive.attributes[semantic]].type, 34962);
    destination.indices = accessor(new Uint16Array(triangles), 'SCALAR', 34963);
    if (destinationNode.mesh === undefined) { destinationNode.mesh = meshes.length; meshes.push({ name: input.meshes[input.nodes[first.nodeIndex].mesh].name ?? destinationNode.name, primitives: [] }); }
    meshes[destinationNode.mesh].primitives.push(destination);
    mapping.push({ destinationNode: first.nodeIndex, destinationName: destinationNode.name ?? null, role: role(destinationNode, first.nodeIndex), material: destination.material, triangles: triangles.length / 3, vertices: vertexCount, maxCommonParentPositionError: maxWorldPositionError, sources: entries.map(entry => ({ node: entry.nodeIndex, name: input.nodes[entry.nodeIndex].name ?? null, mesh: input.nodes[entry.nodeIndex].mesh, primitive: entry.primitiveIndex })) });
  }
  for (const image of gltf.images) { const source = input.bufferViews[image.bufferView]; image.bufferView = view(inputBin.subarray(source.byteOffset, source.byteOffset + source.byteLength)); }
  gltf.meshes = meshes; gltf.bufferViews = views; gltf.accessors = accessors;
  const bin = Buffer.concat(parts); gltf.buffers = [{ byteLength: bin.length }];
  for (const name of anchors) {
    const node = gltf.nodes.find(node => node.name === name); assert.notEqual(node.mesh, undefined); assert.equal(gltf.meshes[node.mesh].primitives.length, 1);
  }
  assert.deepEqual(gltf.nodes.map(({ mesh, ...node }) => node), input.nodes.map(({ mesh, ...node }) => node), 'every node name, transform and parent link preserved');
  return { gltf, bin, report: { meshes: meshes.length, primitives: groups.size, nodeTransformsAndHierarchyPreserved: true, componentAnchorsPreserved: true, mapping } };
}
