import { Mesh, Vector3, VertexBuffer } from "@babylonjs/core";

/** Box surface coordinates measured in metres, with continuous phase on parallel faces. */
export function applyMetreUVs(mesh: Mesh, tileMetres: number): void {
  if (!Number.isFinite(tileMetres) || tileMetres <= 0) throw new RangeError("Invalid material tile size");
  const positions = mesh.getVerticesData(VertexBuffer.PositionKind), normals = mesh.getVerticesData(VertexBuffer.NormalKind);
  if (!positions || !normals || positions.length !== normals.length) throw new Error("Box surface geometry is missing");
  const matrix = mesh.computeWorldMatrix(true);
  const right = Vector3.TransformNormal(Vector3.Right(), matrix).normalize();
  const up = Vector3.TransformNormal(Vector3.Up(), matrix).normalize();
  const forward = Vector3.TransformNormal(Vector3.Forward(), matrix).normalize();
  const point = Vector3.Zero(), world = Vector3.Zero(), uvs = new Float32Array(positions.length / 3 * 2);
  for (let i = 0; i < positions.length; i += 3) {
    point.copyFromFloats(positions[i], positions[i + 1], positions[i + 2]);
    Vector3.TransformCoordinatesToRef(point, matrix, world);
    const horizontal = Math.abs(normals[i + 1]) > .9;
    const u = Math.abs(normals[i]) > .9 ? forward : right;
    const v = horizontal ? forward : up;
    uvs[i / 3 * 2] = Vector3.Dot(world, u) / tileMetres;
    uvs[i / 3 * 2 + 1] = Vector3.Dot(world, v) / tileMetres;
  }
  // Authoring boxes share one template. A material-specific mapping must not alter siblings.
  mesh.makeGeometryUnique();
  mesh.setVerticesData(VertexBuffer.UVKind, uvs);
}
