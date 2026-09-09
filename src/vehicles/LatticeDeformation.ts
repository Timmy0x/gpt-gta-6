import { Matrix, Mesh, Vector3, VertexBuffer, VertexData } from "@babylonjs/core";

const NX = 5, NY = 3, NZ = 9;
export const DEFORMATION_COORDINATES = NX * NY * NZ * 3;
const MIN = new Vector3(-1.4, -0.65, -2.4);
const MAX = new Vector3(1.4, 0.85, 2.6);
const bounded = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

/** Authored body deformation driven by a small chassis-space lattice, not soft-body physics. */
export class LatticeDeformation {
  private offsets = new Float32Array(DEFORMATION_COORDINATES);
  private panels: { mesh: Mesh; original: Float32Array; toChassis: Matrix; fromChassis: Matrix }[];

  constructor(meshes: readonly Mesh[], root: Mesh) {
    const inverse = Matrix.Invert(root.computeWorldMatrix(true));
    this.panels = meshes.map(mesh => {
      mesh.makeGeometryUnique();
      const original = Float32Array.from(mesh.getVerticesData(VertexBuffer.PositionKind)!);
      mesh.setVerticesData(VertexBuffer.PositionKind, original, true);
      const toChassis = mesh.computeWorldMatrix(true).multiply(inverse);
      return { mesh, original, toChassis, fromChassis: Matrix.Invert(toChassis) };
    });
  }

  damage(amount: number, point: Vector3): void {
    const vertex = new Vector3();
    for (let z = 0; z < NZ; z++) for (let y = 0; y < NY; y++) for (let x = 0; x < NX; x++) {
      vertex.set(MIN.x + x / (NX - 1) * (MAX.x - MIN.x), MIN.y + y / (NY - 1) * (MAX.y - MIN.y), MIN.z + z / (NZ - 1) * (MAX.z - MIN.z));
      const distance = Vector3.Distance(vertex, point);
      if (distance >= 1.7) continue;
      const direction = vertex.subtract(point).add(new Vector3(-point.x * 0.7, -0.18, -point.z * 0.25)).normalize();
      const displacement = Math.min(amount * 0.012, 0.42) * (1 - distance / 1.7);
      const i = ((z * NY + y) * NX + x) * 3;
      this.offsets[i] = bounded(this.offsets[i] + direction.x * displacement, -0.65, 0.65);
      this.offsets[i + 1] = bounded(this.offsets[i + 1] + direction.y * displacement, -0.65, 0.65);
      this.offsets[i + 2] = bounded(this.offsets[i + 2] + direction.z * displacement, -0.65, 0.65);
    }
    this.apply();
  }

  serialize(): number[] { return Array.from(this.offsets); }
  restore(offsets: readonly number[]): void {
    if (offsets.length !== DEFORMATION_COORDINATES || offsets.some(n => !Number.isFinite(n) || Math.abs(n) > 0.651)) throw new TypeError("Invalid vehicle deformation lattice");
    this.offsets.set(offsets);
    this.apply();
  }
  reset(): void { this.offsets.fill(0); this.apply(); }

  private apply(): void {
    const vertex = new Vector3(), local = new Vector3();
    for (const { mesh, original, toChassis, fromChassis } of this.panels) {
      const positions = new Float32Array(original.length);
      for (let i = 0; i < original.length; i += 3) {
        vertex.set(original[i], original[i + 1], original[i + 2]);
        Vector3.TransformCoordinatesToRef(vertex, toChassis, vertex);
        const gx = bounded((vertex.x - MIN.x) / (MAX.x - MIN.x) * (NX - 1), 0, NX - 1.00001);
        const gy = bounded((vertex.y - MIN.y) / (MAX.y - MIN.y) * (NY - 1), 0, NY - 1.00001);
        const gz = bounded((vertex.z - MIN.z) / (MAX.z - MIN.z) * (NZ - 1), 0, NZ - 1.00001);
        const ix = Math.floor(gx), iy = Math.floor(gy), iz = Math.floor(gz);
        let dx = 0, dy = 0, dz = 0;
        for (let z = 0; z < 2; z++) for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
          const weight = (x ? gx - ix : 1 - gx + ix) * (y ? gy - iy : 1 - gy + iy) * (z ? gz - iz : 1 - gz + iz);
          const k = (((iz + z) * NY + iy + y) * NX + ix + x) * 3;
          dx += this.offsets[k] * weight; dy += this.offsets[k + 1] * weight; dz += this.offsets[k + 2] * weight;
        }
        vertex.addInPlaceFromFloats(dx, dy, dz);
        Vector3.TransformCoordinatesToRef(vertex, fromChassis, local);
        positions[i] = local.x; positions[i + 1] = local.y; positions[i + 2] = local.z;
      }
      const normals: number[] = [];
      VertexData.ComputeNormals(positions, mesh.getIndices()!, normals);
      mesh.updateVerticesData(VertexBuffer.PositionKind, positions);
      mesh.setVerticesData(VertexBuffer.NormalKind, normals, true);
      mesh.refreshBoundingInfo();
    }
  }
}
