import { Mesh, Ray, Vector3, type AbstractMesh, type Node, type Scene } from '@babylonjs/core';
import { CameraMeshQueries } from './CameraMeshQueries';

export interface CameraOcclusionOptions {
  ignoredRoots?: readonly Node[];
  nearPlane?: number;
  fov?: number;
  aspect?: number;
}

/** Presentation-only camera queries with bounded in-memory acceleration; no persistent source export or physics conversion. */
export class CameraOcclusion {
  private previousTarget: Vector3 | null = null;
  private readonly ray = new Ray(Vector3.Zero(), Vector3.Forward(), 0);
  private readonly queries: CameraMeshQueries;

  constructor(private readonly scene: Scene) { this.queries = new CameraMeshQueries(scene); }

  resolve(target: Vector3, desired: Vector3, current: Vector3, dt: number, options: CameraOcclusionOptions = {}): Vector3 {
    this.queries.prune();
    const desiredRange = Vector3.Distance(target, desired);
    const relocated = !this.previousTarget || Vector3.DistanceSquared(this.previousTarget, target) > Math.max(12, desiredRange * 2) ** 2;
    this.previousTarget = target.clone();
    const smoothing = 1 - Math.exp(-Math.max(0, Math.min(.25, Number.isFinite(dt) ? dt : 0)) * 12);
    // Validate the interpolated position, rather than interpolating back through a wall after validation.
    let position = relocated || !current.asArray().every(Number.isFinite) ? desired.clone() : Vector3.Lerp(current, desired, smoothing);
    const delta = position.subtract(target), distance = delta.length();
    if (distance < 1e-5) return target.clone();
    const direction = delta.scale(1 / distance);
    const right = Vector3.Cross(Vector3.Up(), direction).normalize();
    if (right.lengthSquared() < .5) right.copyFromFloats(1, 0, 0);
    const up = Vector3.Cross(direction, right).normalize();
    const near = Math.max(.01, options.nearPlane ?? .12);
    const halfHeight = near * Math.tan((options.fov ?? .88) * .5);
    // Bound the near-plane corners, with an 8 cm margin; a large viewport must not clip through a wall.
    const horizontal = Math.max(.16, Math.min(.65, halfHeight * Math.max(.2, options.aspect ?? 1.8) + .08));
    const vertical = Math.max(.16, Math.min(.65, halfHeight + .08));
    const radius = Math.hypot(horizontal, vertical);
    const padding = near + .1;
    const candidates = this.candidates(target, position, radius * 2 + padding, options.ignoredRoots ?? []);
    if (!candidates.size) return position;
    const offsets = [Vector3.Zero()];
    for (const x of [-1, 1]) for (const y of [-1, 1]) offsets.push(right.scale(horizontal * x).add(up.scale(vertical * y)));
    let allowed = distance;
    for (const offset of offsets) {
      const hit = this.cast(target.add(offset), direction, distance + padding, candidates);
      if (hit !== null) allowed = Math.min(allowed, Math.max(0, hit - padding));
    }
    position = target.add(direction.scale(allowed));

    // Exact near-camera triangle clearance covers small blockers between finite boom rays too.
    // Corrections are presentation-only; they never move the subject or create a physical body.
    for (let iteration = 0; iteration < 3; iteration++) {
      const currentBackward = position.subtract(target).normalize();
      if (currentBackward.lengthSquared() < .5) break;
      const currentRight = Vector3.Cross(Vector3.Up(), currentBackward).normalize();
      if (currentRight.lengthSquared() < .5) currentRight.copyFromFloats(1, 0, 0);
      const currentUp = Vector3.Cross(currentBackward, currentRight).normalize();
      const correction = this.queries.clearance({ position, right: currentRight, up: currentUp, backward: currentBackward, horizontal, vertical, depth: padding }, iteration ? this.candidates(target, position, radius * 2 + padding, options.ignoredRoots ?? []) : candidates);
      if (!correction) break;
      position.addInPlace(correction);
      // Re-query after side clearance: the new boom can meet a surface beyond the old shortlist.
      const corrected = position.subtract(target), correctedRange = corrected.length();
      if (correctedRange > 1e-5) {
        corrected.scaleInPlace(1 / correctedRange);
        const hit = this.cast(target, corrected, correctedRange + padding, this.candidates(target, position, radius * 2 + padding, options.ignoredRoots ?? []));
        if (hit !== null) position = target.add(corrected.scale(Math.max(0, Math.min(correctedRange, hit - padding))));
      }
    }
    // Malformed/intersecting source surfaces can surround the subject itself. Keep a finite look direction;
    // camera probes cannot repair the source mesh or establish physical clearance for that situation.
    if (Vector3.DistanceSquared(position, target) < 1e-8) position = target.add(direction.scale(.01));
    return position;
  }

  private cast(origin: Vector3, direction: Vector3, length: number, candidates: ReadonlySet<AbstractMesh>): number | null {
    this.ray.origin.copyFrom(origin); this.ray.direction.copyFrom(direction); this.ray.length = length;
    let closest: number | null = null;
    for (const mesh of candidates) {
      // Query the local shortlist, rather than rescanning every scene mesh for each camera probe.
      // Preserve Babylon's own thin-instance picking path when a public blocker uses it.
      const hit = mesh instanceof Mesh && mesh.hasThinInstances && mesh.thinInstanceEnablePicking
        ? this.scene.pickWithRay(this.ray, candidate => candidate === mesh, false)
        : null;
      const distance = hit?.hit ? hit.distance : mesh.hasThinInstances ? null : this.queries.closest(this.ray, mesh);
      if (distance !== null && Number.isFinite(distance) && distance >= 0 && distance <= length && (closest === null || distance < closest)) closest = distance;
    }
    return closest;
  }

  private candidates(from: Vector3, to: Vector3, margin: number, ignoredRoots: readonly Node[]): Set<AbstractMesh> {
    const result = new Set<AbstractMesh>();
    const min = Vector3.Minimize(from, to).subtractFromFloats(margin, margin, margin);
    const max = Vector3.Maximize(from, to).add(new Vector3(margin, margin, margin));
    for (const mesh of this.scene.meshes) {
      if (!mesh.isEnabled() || mesh.isDisposed() || !mesh.getTotalVertices()) continue;
      let sourceVisual = false, ignored = false;
      for (let node: Node | null = mesh; node; node = node.parent) {
        if (ignoredRoots.includes(node)) { ignored = true; break; }
        // Existing local placement node, not provider metadata or an address. Disabled LODs are excluded above.
        if (node.name === 'lh-tile-placement') sourceVisual = true;
      }
      if (ignored || !mesh.metadata?.cameraBlocker && !(sourceVisual && mesh.isVisible && mesh.visibility > 0)) continue;
      mesh.computeWorldMatrix(false);
      const box = mesh.getBoundingInfo().boundingBox;
      if (box.maximumWorld.x < min.x || box.minimumWorld.x > max.x || box.maximumWorld.y < min.y || box.minimumWorld.y > max.y || box.maximumWorld.z < min.z || box.minimumWorld.z > max.z) continue;
      result.add(mesh);
    }
    return result;
  }
}
