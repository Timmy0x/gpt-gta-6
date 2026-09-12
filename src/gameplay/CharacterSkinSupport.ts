import { Vector3, VertexBuffer, type Mesh } from '@babylonjs/core';

type SkinSupport = { positions: ArrayLike<number>; indices: number[]; trunkIndices: number[]; joints: ArrayLike<number>; weights: ArrayLike<number>; extraJoints: ArrayLike<number> | null; extraWeights: ArrayLike<number> | null; rows: Float64Array };
const supportCache = new WeakMap<Mesh, SkinSupport>();
/** Exact indexed skin support along world Y, using the same bone matrices as
 * the renderer. With a normal, returns the minimum world-space projection
 * along that normal. Cached bind data avoids allocating a full skinned mesh. */
export function skinSupportMinimum(model: { parts: readonly Mesh[] }, normal: { readonly x: number; readonly y: number; readonly z: number } = Vector3.UpReadOnly, surface: 'all' | 'trunk' = 'all'): number {
  let minimum = Infinity;
  for (const mesh of model.parts) {
    if (!mesh.skeleton || !mesh.isEnabled() || !mesh.isVisible) continue;
    let data = supportCache.get(mesh);
    if (!data) {
      const positions = mesh.getVerticesData(VertexBuffer.PositionKind), joints = mesh.getVerticesData(VertexBuffer.MatricesIndicesKind), weights = mesh.getVerticesData(VertexBuffer.MatricesWeightsKind);
      if (!positions || !joints || !weights) continue;
      const indices = [...new Set(mesh.getIndices() ?? [])], extraJoints = mesh.getVerticesData(VertexBuffer.MatricesIndicesExtraKind), extraWeights = mesh.getVerticesData(VertexBuffer.MatricesWeightsExtraKind);
      const trunkJoints = new Set(mesh.skeleton.bones.filter(bone => /(?:Bip01_(?:Pelvis|Spine\d*|[LR]_(?:Thigh|Calf))|\/(?:pelvis|spine|chest|(?:left|right)(?:Thigh|Calf)))$/.test(bone.name)).map(bone => bone.getIndex()));
      const trunkIndices = indices.filter(index => {
        let dominant = -1, strongest = -1;
        for (let influence = 0; influence < 4; influence++) {
          const at = index * 4 + influence;
          if (weights[at] > strongest) { strongest = weights[at]; dominant = joints[at]; }
          if (extraJoints && extraWeights && extraWeights[at] > strongest) { strongest = extraWeights[at]; dominant = extraJoints[at]; }
        }
        return trunkJoints.has(dominant);
      });
      data = { positions, joints, weights, indices, trunkIndices, extraJoints, extraWeights, rows: new Float64Array((mesh.skeleton.bones.length + 1) * 4) };
      supportCache.set(mesh, data);
    }
    mesh.skeleton.prepare(true);
    const matrices = mesh.skeleton.getTransformMatrices(mesh), world = mesh.computeWorldMatrix(true).m, rows = data.rows;
    const nx = normal.x * world[0] + normal.y * world[1] + normal.z * world[2],
      ny = normal.x * world[4] + normal.y * world[5] + normal.z * world[6],
      nz = normal.x * world[8] + normal.y * world[9] + normal.z * world[10],
      translation = normal.x * world[12] + normal.y * world[13] + normal.z * world[14];
    for (let joint = 0; joint < rows.length / 4; joint++) {
      const at = joint * 16;
      for (let column = 0; column < 4; column++) rows[joint * 4 + column] = matrices[at + column * 4] * nx + matrices[at + column * 4 + 1] * ny + matrices[at + column * 4 + 2] * nz + (column === 3 ? translation : 0);
    }
    for (const index of surface === 'trunk' ? data.trunkIndices : data.indices) {
      const x = data.positions[index * 3], y = data.positions[index * 3 + 1], z = data.positions[index * 3 + 2];
      let height = 0;
      for (let influence = 0; influence < 4; influence++) {
        const at = index * 4 + influence, joint = data.joints[at] * 4, weight = data.weights[at];
        height += weight * (rows[joint] * x + rows[joint + 1] * y + rows[joint + 2] * z + rows[joint + 3]);
        if (data.extraJoints && data.extraWeights) { const extra = data.extraJoints[at] * 4; height += data.extraWeights[at] * (rows[extra] * x + rows[extra + 1] * y + rows[extra + 2] * z + rows[extra + 3]); }
      }
      minimum = Math.min(minimum, height);
    }
  }
  return minimum;
}
