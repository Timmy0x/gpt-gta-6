import { PhysicsPrestepType, Quaternion, Vector3, type PhysicsBody } from '@babylonjs/core';
import { COAST, coastFloorHeight } from './Coast';

export interface WorldBounds { minX: number; maxX: number; minZ: number; maxZ: number }
export interface BoundaryBodyOptions {
  /** Conservative horizontal footprint, including wings and attached components. */
  radius?: number;
  /** Centre height above the terrain when recovering from below it. */
  clearance?: number;
}
export interface BoundaryRecovery {
  position: Vector3;
  reason: 'outside' | 'below-floor' | 'nonfinite';
}
export interface WorldBoundaryOptions {
  bounds?: WorldBounds;
  floorHeight?: (x: number, z: number) => number;
  fallback?: Vector3;
  /** Project boundary braking, m/s²; does not alter the vehicle's normal brakes. */
  braking?: number;
  settlingTime?: number;
}

const finite = (p: Vector3) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);
const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));

/** Temporary protection around the currently supported terrain, not a map-completion claim.
 * Normal travel only loses its outward velocity component. There is no wall, turn/heading
 * override, terrain-height clamp, or altitude ceiling. Recovery is reserved for bad saves,
 * exceptional impulses that cross the boundary during Havok, or falling below the real floor.
 */
export class WorldBoundary {
  readonly bounds: Readonly<WorldBounds>;
  private floorHeight: (x: number, z: number) => number;
  private fallback: Vector3;
  private braking: number;
  private settlingTime: number;
  private pending = new WeakMap<PhysicsBody, { previous: PhysicsPrestepType; submitted: boolean }>();

  constructor(options: WorldBoundaryOptions = {}) {
    this.bounds = Object.freeze({ ...(options.bounds ?? COAST) });
    if (![this.bounds.minX, this.bounds.maxX, this.bounds.minZ, this.bounds.maxZ].every(Number.isFinite)
      || this.bounds.minX >= this.bounds.maxX || this.bounds.minZ >= this.bounds.maxZ)
      throw new RangeError('Invalid playable world bounds');
    this.floorHeight = options.floorHeight ?? coastFloorHeight;
    this.fallback = options.fallback?.clone() ?? new Vector3(6, 1.2, -28);
    this.braking = options.braking ?? 12;
    this.settlingTime = options.settlingTime ?? .75;
    if (!finite(this.fallback) || !(this.braking > 0) || !Number.isFinite(this.braking)
      || !(this.settlingTime > 0) || !Number.isFinite(this.settlingTime))
      throw new RangeError('Invalid world boundary settings');
  }

  private extents(radius: number) {
    const b = this.bounds;
    const r = clamp(Number.isFinite(radius) ? radius : .5, 0, Math.min(b.maxX - b.minX, b.maxZ - b.minZ) / 4);
    return { minX: b.minX + r, maxX: b.maxX - r, minZ: b.minZ + r, maxZ: b.maxZ - r };
  }

  /** Pass the velocity that will actually move the entity (including noclip's multiplier).
   * Call after thrust/impulses and before integration. dt is the imminent physics step.
   * The stopping-distance envelope handles fast aircraft; the time envelope approaches
   * zero smoothly and prevents a single long step from crossing the edge.
   */
  limitVelocity(position: Vector3, velocity: Vector3, dt: number, radius = .5): Vector3 {
    const result = new Vector3(
      Number.isFinite(velocity.x) ? velocity.x : 0,
      Number.isFinite(velocity.y) ? velocity.y : 0,
      Number.isFinite(velocity.z) ? velocity.z : 0,
    );
    if (!finite(position)) return Vector3.Zero();
    const b = this.extents(radius), step = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    const limit = (coordinate: number, speed: number, low: number, high: number) => {
      const distance = Math.max(0, speed > 0 ? high - coordinate : coordinate - low);
      const allowed = Math.min(Math.sqrt(2 * this.braking * distance), distance / (step + this.settlingTime));
      return Math.sign(speed) * Math.min(Math.abs(speed), allowed);
    };
    result.x = limit(position.x, result.x, b.minX, b.maxX);
    result.z = limit(position.z, result.z, b.minZ, b.maxZ);
    return result;
  }

  /** Does not modify the input or normal grounded/underwater/airborne positions. */
  recovery(position: Vector3, clearance = 1, radius = .5): BoundaryRecovery | null {
    const b = this.extents(radius), valid = finite(position);
    const outside = valid && (position.x < b.minX || position.x > b.maxX || position.z < b.minZ || position.z > b.maxZ);
    // Eight metres below the real floor is deliberately beyond normal suspension,
    // swimming, bank transitions, crouching, and even an overturned vehicle.
    const below = valid && position.y < this.floorHeight(position.x, position.z) - 8;
    if (valid && !outside && !below) return null;
    const target = valid ? position.clone() : this.fallback.clone();
    const inset = Math.min(12, (b.maxX - b.minX) / 4, (b.maxZ - b.minZ) / 4);
    target.x = clamp(target.x, b.minX + inset, b.maxX - inset);
    target.z = clamp(target.z, b.minZ + inset, b.maxZ - inset);
    target.y = Math.max(target.y, this.floorHeight(target.x, target.z) + (Number.isFinite(clearance) ? Math.max(.1, clearance) : 1));
    return { position: target, reason: !valid ? 'nonfinite' : outside ? 'outside' : 'below-floor' };
  }

  /** Before Havok: after vehicle forces, while interpolation has restored physics poses. */
  beforePhysics(body: PhysicsBody, dt: number, options: BoundaryBodyOptions = {}): BoundaryRecovery | null {
    if (body.isDisposed) return null;
    const recovery = this.protectBody(body, dt, options);
    const pending = this.pending.get(body);
    if (pending) pending.submitted = true;
    return recovery;
  }

  /** After Havok, BEFORE interpolation.afterStep(). A new post-step recovery is staged
   * until the next real Havok step. TELEPORT is never disabled before Havok consumes it.
   */
  afterPhysics(body: PhysicsBody, dt: number, options: BoundaryBodyOptions = {}): BoundaryRecovery | null {
    if (body.isDisposed) { this.pending.delete(body); return null; }
    const pending = this.pending.get(body);
    if (pending?.submitted) {
      body.setPrestepType(pending.previous);
      this.pending.delete(body);
    }
    return this.protectBody(body, dt, options);
  }

  private protectBody(body: PhysicsBody, dt: number, options: BoundaryBodyOptions): BoundaryRecovery | null {
    const node = body.transformNode;
    const previousY = node.position.y;
    const recovery = this.recovery(node.position, options.clearance, options.radius);
    let velocity = body.getLinearVelocity();
    if (recovery) {
      if (!this.pending.has(body)) this.pending.set(body, { previous: body.getPrestepType(), submitted: false });
      body.setPrestepType(PhysicsPrestepType.TELEPORT);
      node.position.copyFrom(recovery.position);
      const rotation = node.rotationQuaternion;
      if (rotation && ![rotation.x, rotation.y, rotation.z, rotation.w].every(Number.isFinite))
        node.rotationQuaternion = Quaternion.Identity();
      node.computeWorldMatrix(true);
      if (recovery.reason !== 'outside') {
        velocity = Vector3.Zero();
        body.setAngularVelocity(Vector3.Zero());
      } else if (velocity.y < 0 && recovery.position.y > previousY)
        velocity.y = 0;
    }
    const limited = this.limitVelocity(node.position, velocity, dt, options.radius);
    if (recovery || !limited.equals(velocity)) body.setLinearVelocity(limited);
    return recovery;
  }
}
