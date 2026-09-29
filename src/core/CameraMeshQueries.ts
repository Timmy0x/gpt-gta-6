import { BoundingInfo, InstancedMesh, Matrix, Mesh, Ray, SubMesh, Vector3, type AbstractMesh, type IndicesArray, type Scene } from '@babylonjs/core';

interface Part { native: SubMesh; bounds: BoundingInfo; start: number; count: number; }
interface Entry { positions: Vector3[]; indices: IndicesArray; parts: Part[]; signature: string; transient: boolean; positionBuffer: unknown; indexBuffer: unknown; }
interface CameraVolume { position: Vector3; right: Vector3; up: Vector3; backward: Vector3; horizontal: number; vertical: number; depth: number; }

/** Bounded presentation picking acceleration; original geometry, render submeshes and materials stay intact. */
export class CameraMeshQueries {
  private readonly entries = new Map<AbstractMesh, Entry>();
  private partCount = 0;
  private readonly localRay = new Ray(Vector3.Zero(), Vector3.Forward(), 0);
  private readonly inverse = Matrix.Identity();
  private readonly point = Vector3.Zero();
  private readonly vertices = [Vector3.Zero(), Vector3.Zero(), Vector3.Zero()];

  constructor(scene: Scene) { scene.onDisposeObservable.addOnce(() => this.clear()); }

  prune(): void {
    for (const [mesh, entry] of this.entries) if (mesh.isDisposed() || !mesh.isEnabled()) this.remove(mesh, entry);
  }

  closest(ray: Ray, mesh: AbstractMesh): number | null {
    // Damageable geometry changes its existing native point-cache array in place. Native picking
    // must read the current data; pointer equality is sufficient only for immutable tile geometry.
    if (this.mutable(mesh)) {
      const old = this.entries.get(mesh); if (old) this.remove(mesh, old);
      const hit = ray.intersectsMesh(mesh, false); return hit?.hit ? hit.distance : null;
    }
    const entry = this.entry(mesh);
    if (!entry || mesh.hasThinInstances) {
      const hit = ray.intersectsMesh(mesh, false);
      return hit?.hit ? hit.distance : null;
    }
    mesh.getWorldMatrix().invertToRef(this.inverse); Ray.TransformToRef(ray, this.inverse, this.localRay);
    let closest: number | null = null;
    for (const part of entry.parts) {
      if (!this.localRay.intersectsBox(part.bounds.boundingBox)) continue;
      const hit = part.native.intersects(this.localRay, entry.positions, entry.indices, false);
      if (!hit || hit.distance < 0 || hit.distance > this.localRay.length) continue;
      this.localRay.direction.scaleToRef(hit.distance, this.point); this.point.addInPlace(this.localRay.origin);
      Vector3.TransformCoordinatesToRef(this.point, mesh.getWorldMatrix(), this.point);
      const distance = Vector3.Distance(ray.origin, this.point);
      if (closest === null || distance < closest) closest = distance;
    }
    return closest;
  }

  /** Exact triangle/OBB separating-axis test, including tiny geometry between the boom rays. */
  clearance(volume: CameraVolume, meshes: ReadonlySet<AbstractMesh>): Vector3 | null {
    let best: { axis: Vector3; distance: number; forward: number } | null = null;
    const half = new Vector3(volume.horizontal, volume.vertical, volume.depth);
    for (const mesh of meshes) {
      const entry = this.entry(mesh);
      if (!entry) continue;
      const worlds = mesh instanceof Mesh && mesh.hasThinInstances
        ? mesh.thinInstanceGetWorldMatrices().map(local => local.multiply(mesh.getWorldMatrix()))
        : [mesh.getWorldMatrix()];
      for (const world of worlds) {
        world.invertToRef(this.inverse);
        let min = new Vector3(Infinity, Infinity, Infinity), max = new Vector3(-Infinity, -Infinity, -Infinity);
        for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
          this.point.copyFrom(volume.position).addInPlace(volume.right.scale(half.x * x)).addInPlace(volume.up.scale(half.y * y)).addInPlace(volume.backward.scale(half.z * z));
          Vector3.TransformCoordinatesToRef(this.point, this.inverse, this.point);
          min.minimizeInPlace(this.point); max.maximizeInPlace(this.point);
        }
        for (const part of entry.parts) {
          const box = part.bounds.boundingBox;
          if (box.maximum.x < min.x || box.minimum.x > max.x || box.maximum.y < min.y || box.minimum.y > max.y || box.maximum.z < min.z || box.minimum.z > max.z) continue;
          for (let index = part.start; index < part.start + part.count; index += 3) {
            let valid = true;
            for (let n = 0; n < 3; n++) {
              const vertex = entry.positions[entry.indices.length ? entry.indices[index + n] : index + n];
              if (!vertex || !Number.isFinite(vertex.x + vertex.y + vertex.z)) { valid = false; break; }
              Vector3.TransformCoordinatesToRef(vertex, world, this.point); this.point.subtractInPlace(volume.position);
              this.vertices[n].set(Vector3.Dot(this.point, volume.right), Vector3.Dot(this.point, volume.up), Vector3.Dot(this.point, volume.backward));
            }
            if (!valid) continue;
            const correction = triangleBoxCorrection(this.vertices, half);
            if (correction && (!best || Math.abs(correction.distance) > Math.abs(best.distance))) best = correction;
          }
        }
      }
      if (entry.transient) this.release(entry);
    }
    if (!best) return null;
    // Axial escape always moves toward the subject; lateral/up corrections use the shortest separation.
    if (Math.abs(best.axis.z) > .7) {
      return volume.backward.scale(-Math.min(.65, best.forward));
    }
    return volume.right.scale(best.axis.x * best.distance).add(volume.up.scale(best.axis.y * best.distance)).add(volume.backward.scale(best.axis.z * best.distance));
  }

  private entry(mesh: AbstractMesh): Entry | null {
    const rendering = mesh instanceof Mesh ? mesh : mesh instanceof InstancedMesh ? mesh.sourceMesh : null;
    if (!rendering || mesh.skeleton || mesh.morphTargetManager || !mesh._generatePointsArray() || !mesh._positions) return null;
    const indices = mesh.getIndices() ?? [], positions = mesh._positions;
    const transient = this.mutable(mesh);
    const positionBuffer = mesh.getVertexBuffer('position'), indexBuffer = rendering.geometry?.getIndexBuffer() ?? null;
    const signature = mesh.subMeshes.map(part => `${part.materialIndex}:${part.indexStart}:${part.indexCount}:${part.verticesStart}:${part.verticesCount}`).join('|');
    const cached = this.entries.get(mesh);
    if (!transient && cached && cached.positions === positions && cached.indices === indices && cached.signature === signature && cached.positionBuffer === positionBuffer && cached.indexBuffer === indexBuffer) {
      this.entries.delete(mesh); this.entries.set(mesh, cached); return cached;
    }
    if (cached) this.remove(mesh, cached);
    const parts: Part[] = [];
    for (const original of mesh.subMeshes) {
      const material = original.getMaterial();
      if (!material || ![0, 1, 2].includes(material.fillMode)) return null;
      const from = indices.length ? original.indexStart : original.verticesStart;
      const count = indices.length ? original.indexCount : original.verticesCount;
      if (from % 3 || count % 3) return null;
      for (let start = from; start < from + count; start += 1536) {
        const length = Math.min(1536, from + count - start);
        let min = new Vector3(Infinity, Infinity, Infinity), max = new Vector3(-Infinity, -Infinity, -Infinity);
        for (let i = start; i < start + length; i++) {
          const vertex = positions[indices.length ? indices[i] : i];
          if (!vertex) continue;
          min.minimizeInPlace(vertex); max.maximizeInPlace(vertex);
        }
        const bounds = new BoundingInfo(min, max);
        const native = new SubMesh(original.materialIndex, indices.length ? 0 : start, indices.length ? positions.length : length, indices.length ? start : 0, indices.length ? length : 0, mesh, rendering, false, false);
        native.setBoundingInfo(bounds); parts.push({ native, bounds, start, count: length });
      }
    }
    const entry = { positions, indices, parts, signature, transient, positionBuffer, indexBuffer };
    if (transient) return entry;
    this.entries.set(mesh, entry); this.partCount += parts.length;
    // Bounds/index ranges only: at most 128 meshes and 8192 native query partitions. No source buffer copy.
    while (this.entries.size > 128 || this.partCount > 8192) {
      const oldest = this.entries.entries().next().value as [AbstractMesh, Entry] | undefined;
      if (!oldest) break; this.remove(...oldest);
    }
    return entry;
  }

  private remove(mesh: AbstractMesh, entry: Entry) {
    // SubMesh.dispose() blindly splices index -1 for detached partitions in pinned Babylon 9.25.0.
    // They never allocate index buffers; release their empty draw caches without touching render subMeshes.
    this.release(entry);
    this.entries.delete(mesh); this.partCount -= entry.parts.length;
  }
  private mutable(mesh: AbstractMesh): boolean {
    const source = mesh instanceof InstancedMesh ? mesh.sourceMesh : mesh instanceof Mesh ? mesh : null;
    // Pinned Babylon 9.25.0 flag: updateIndices makes a non-updatable index buffer updatable first.
    const indexUpdatable = (source?.geometry as unknown as { _indexBufferIsUpdatable?: boolean } | null)?._indexBufferIsUpdatable === true;
    return mesh.getVertexBuffer('position')?.isUpdatable() === true || indexUpdatable;
  }
  private release(entry: Entry) { for (const part of entry.parts) part.native.resetDrawCache(undefined, true); }
  private clear() { for (const [mesh, entry] of this.entries) this.remove(mesh, entry); }
}

function triangleBoxCorrection(vertices: readonly Vector3[], half: Vector3): { axis: Vector3; distance: number; forward: number } | null {
  // Most triangles in a nearby partition still lie outside the tiny camera box; reject before SAT allocations.
  for (const axis of ['x', 'y', 'z'] as const) {
    if (Math.min(vertices[0][axis], vertices[1][axis], vertices[2][axis]) > half[axis] + 1e-7 || Math.max(vertices[0][axis], vertices[1][axis], vertices[2][axis]) < -half[axis] - 1e-7) return null;
  }
  const edges = [vertices[1].subtract(vertices[0]), vertices[2].subtract(vertices[1]), vertices[0].subtract(vertices[2])];
  const normal = Vector3.Cross(edges[0], edges[1]);
  if (normal.lengthSquared() < 1e-16) return null;
  const axes = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1), normal];
  for (const edge of edges) axes.push(new Vector3(0, edge.z, -edge.y), new Vector3(-edge.z, 0, edge.x), new Vector3(edge.y, -edge.x, 0));
  let best: { axis: Vector3; distance: number; forward: number } | null = null;
  for (const axis of axes) {
    if (axis.lengthSquared() < 1e-16) continue;
    axis.normalize();
    const a = Vector3.Dot(vertices[0], axis), b = Vector3.Dot(vertices[1], axis), c = Vector3.Dot(vertices[2], axis);
    const min = Math.min(a, b, c), max = Math.max(a, b, c), radius = half.x * Math.abs(axis.x) + half.y * Math.abs(axis.y) + half.z * Math.abs(axis.z);
    if (min > radius + 1e-7 || max < -radius - 1e-7) return null;
    const negative = min - radius - .01, positive = max + radius + .01;
    const distance = Math.abs(negative) < Math.abs(positive) ? negative : positive;
    const forward = Math.abs(axis.z) < 1e-8 ? Infinity : axis.z > 0 ? (radius + .01 - min) / axis.z : (radius + .01 + max) / -axis.z;
    if (!best || Math.abs(distance) < Math.abs(best.distance)) best = { axis, distance, forward };
  }
  return best;
}
