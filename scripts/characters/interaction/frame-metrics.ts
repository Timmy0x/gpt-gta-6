import { Matrix, Vector3, VertexBuffer, type Mesh } from '@babylonjs/core';

/** Inspect all indexed skin vertices, excluding unused vertices repeated by glTF primitives. */
export function skinFrameMetrics(parts: Mesh[], doors: Mesh[]) {
  let vertices = 0, minimumY = Infinity, maximumY = -Infinity, doorVertices = 0, deepestDoor = 0, minimumBone = ''; 
  const doorParts: Record<string, number> = {}, bodyParts: Record<string, number> = {}, minimumByBone: Record<string, number> = {};
  const point = Vector3.Zero(), local = Vector3.Zero();
  const boxes = doors.flatMap(door => [door, ...door.getChildMeshes()]).filter(mesh => mesh.getTotalVertices() && mesh.isEnabled()).map(mesh => {
    const bounds = mesh.getBoundingInfo().boundingBox;
    return { name:mesh.name, inverse: Matrix.Invert(mesh.computeWorldMatrix(true)), min: bounds.minimum, max: bounds.maximum };
  });
  for (const mesh of parts) {
    if (!mesh.skeleton || !mesh.isEnabled()) continue;
    mesh.skeleton.prepare(true);
    const bonesByIndex = new Map(mesh.skeleton.bones.map((bone, index) => [bone.getIndex() ?? index, bone]));
    const positions = mesh.getPositionData(true, true)!;
    const weights = mesh.getVerticesData(VertexBuffer.MatricesWeightsKind)!, joints = mesh.getVerticesData(VertexBuffer.MatricesIndicesKind)!;
    const world = mesh.computeWorldMatrix(true), indices = new Set(mesh.getIndices()!);
    for (const index of indices) {
      Vector3.FromArrayToRef(positions, index * 3, point); Vector3.TransformCoordinatesToRef(point, world, point);
      let dominant = 0; for(let i=1;i<4;i++)if(weights[index*4+i]>weights[index*4+dominant])dominant=i;
      const dominantBone=bonesByIndex.get(joints[index*4+dominant])?.name.split('/').at(-1)??'unknown';
      minimumByBone[dominantBone]=Math.min(minimumByBone[dominantBone]??Infinity,point.y);
      vertices++; if(point.y<minimumY){minimumY=point.y;let influence=0;for(let i=1;i<4;i++)if(weights[index*4+i]>weights[index*4+influence])influence=i;minimumBone=bonesByIndex.get(joints[index*4+influence])?.name.split('/').at(-1)??'unknown';} maximumY = Math.max(maximumY, point.y);
      for (const box of boxes) {
        Vector3.TransformCoordinatesToRef(point, box.inverse, local);
        const depth = Math.min(local.x-box.min.x, box.max.x-local.x, local.y-box.min.y, box.max.y-local.y, local.z-box.min.z, box.max.z-local.z);
        if (depth > .004) {
          doorVertices++; deepestDoor = Math.max(deepestDoor, depth); doorParts[box.name] = (doorParts[box.name] ?? 0) + 1;
          let influence=0; for(let i=1;i<4;i++)if(weights[index*4+i]>weights[index*4+influence])influence=i;
          const bone=bonesByIndex.get(joints[index*4+influence])?.name.split('/').at(-1) ?? 'unknown'; bodyParts[bone]=(bodyParts[bone]??0)+1;
          break;
        }
      }
    }
  }
  return { vertices, minimumY, maximumY, doorVertices, deepestDoor, minimumBone, doorParts, bodyParts, minimumByBone };
}

/** Coarse torso clearance diagnostic; hands/arms are intentionally excluded from the contact test. */
export function torsoClearance(a: { jointPosition(name: string): Vector3 }, b: { jointPosition(name: string): Vector3 }) {
  const points = (c: typeof a) => ['pelvis','spine','chest','neck','head'].map(name => c.jointPosition(name));
  const left = points(a), right = points(b); let minimum = Infinity;
  for (const p of left) for (const q of right) minimum = Math.min(minimum, Vector3.Distance(p,q));
  return minimum;
}
