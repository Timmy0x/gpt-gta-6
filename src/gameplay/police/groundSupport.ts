import { HavokPlugin, PhysicsEngineV2, PhysicsRaycastResult, PhysicsShapeCapsule, ProximityCastResult, Quaternion, ShapeCastResult, Vector3, type PhysicsBody, type Scene } from '@babylonjs/core';
import type { WorldContract } from '../../core/contracts';
import { MovementQueries } from '../MovementQueries';

/** Source terrain is independent of tile residency; legacy worlds use resident native geometry. */
export function policeGroundHeight(scene: Scene, world: WorldContract, point: Vector3, ignoreBody?: PhysicsBody): number | null {
  if (world.hasGroundCoverage && !world.hasGroundCoverage(point.x, point.z, .36)) return null;
  const source = world as WorldContract & { floorHeightAt?: (x: number, z: number) => number | null };
  if (source.floorHeightAt) {
    const height = source.floorHeightAt(point.x, point.z);
    return height != null && Number.isFinite(height) ? height : null;
  }
  const hit = new PhysicsRaycastResult();
  (scene.getPhysicsEngine()! as PhysicsEngineV2).raycastToRef(
    point.add(new Vector3(0, 2, 0)), point.add(new Vector3(0, -300, 0)), hit,
    { ignoreBody, shouldHitTriggers: false },
  );
  return hit.hasHit && hit.hitNormalWorld.y > .65 ? hit.hitPointWorld.y : null;
}

/** The responder uses its exact standing capsule dimensions for exit overlap and sweep queries. */
export class PoliceExitQueries {
  private readonly groundQueries: MovementQueries;
  private readonly capsule: PhysicsShapeCapsule;
  private readonly plugin: HavokPlugin;
  private readonly overlapInput = new ProximityCastResult();
  private readonly overlapHit = new ProximityCastResult();
  private readonly sweepInput = new ShapeCastResult();
  private readonly sweepHit = new ShapeCastResult();
  constructor(scene: Scene) {
    this.groundQueries = new MovementQueries(scene);
    this.plugin = scene.getPhysicsEngine()!.getPhysicsPlugin() as HavokPlugin;
    this.capsule = new PhysicsShapeCapsule(
      new Vector3(0, -.56, 0), new Vector3(0, .56, 0), .34, scene,
    );
  }
  ground(position: Vector3, up: number, down: number, ignoreBody?: PhysicsBody) {
    return this.groundQueries.ground(position, up, down, ignoreBody);
  }
  clear(position: Vector3) {
    this.plugin.shapeProximity({ shape: this.capsule, position, rotation: Quaternion.Identity(), maxDistance: 0, shouldHitTriggers: false }, this.overlapInput, this.overlapHit);
    return !this.overlapHit.hasHit || this.overlapHit.hitDistance > -.015;
  }
  path(startPosition: Vector3, endPosition: Vector3, ignoreBody: PhysicsBody) {
    this.plugin.shapeCast({ shape: this.capsule, rotation: Quaternion.Identity(), startPosition, endPosition, shouldHitTriggers: false, ignoreBody }, this.sweepInput, this.sweepHit);
    return !this.sweepHit.hasHit || this.sweepHit.hitFraction > .985;
  }
  dispose() {
    this.groundQueries.dispose();
    this.capsule.dispose();
  }
}
