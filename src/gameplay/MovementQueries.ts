import {
  HavokPlugin,
  PhysicsEngineV2,
  PhysicsRaycastResult,
  PhysicsShapeCapsule,
  ProximityCastResult,
  Quaternion,
  ShapeCastResult,
  Vector3,
  type PhysicsBody,
  type Scene,
} from "@babylonjs/core";

/** Capsule queries use the same SI dimensions as the standing character controller. */
export class MovementQueries {
  readonly capsule: PhysicsShapeCapsule;
  private plugin: HavokPlugin;
  private input = new ShapeCastResult();
  private hit = new ShapeCastResult();
  private overlapInput = new ProximityCastResult();
  private overlapHit = new ProximityCastResult();
  private ray = new PhysicsRaycastResult();
  constructor(private scene: Scene) {
    this.plugin = scene.getPhysicsEngine()!.getPhysicsPlugin() as HavokPlugin;
    this.capsule = new PhysicsShapeCapsule(
      new Vector3(0, -0.58, 0),
      new Vector3(0, 0.58, 0),
      0.32,
      scene,
    );
  }
  clear(position: Vector3, ignoreBody?: PhysicsBody) {
    this.plugin.shapeProximity(
      {
        shape: this.capsule,
        position,
        rotation: Quaternion.Identity(),
        maxDistance: 0,
        shouldHitTriggers: false,
        ignoreBody,
      },
      this.overlapInput,
      this.overlapHit,
    );
    return !this.overlapHit.hasHit || this.overlapHit.hitDistance > -0.015;
  }
  path(start: Vector3, end: Vector3, ignoreBody?: PhysicsBody) {
    this.plugin.shapeCast(
      {
        shape: this.capsule,
        rotation: Quaternion.Identity(),
        startPosition: start,
        endPosition: end,
        shouldHitTriggers: false,
        ignoreBody,
      },
      this.input,
      this.hit,
    );
    return !this.hit.hasHit || this.hit.hitFraction > 0.985;
  }
  ground(position: Vector3, up = 1.5, down = 3, ignoreBody?: PhysicsBody) {
    const from = position.add(new Vector3(0, up, 0));
    const to = position.add(new Vector3(0, -down, 0));
    (this.scene.getPhysicsEngine()! as PhysicsEngineV2).raycastToRef(
      from,
      to,
      this.ray,
      { ignoreBody, shouldHitTriggers: false },
    );
    return this.ray.hasHit && this.ray.hitNormalWorld.y > 0.65
      ? this.ray.hitPointWorld.clone()
      : null;
  }
  /** Two-stage up/across clearance plus a walkable landing; no blind ledge teleport. */
  mantle(position: Vector3, heading: number) {
    const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading));
    const feet = position.y - 0.9;
    const landing = this.ground(position.add(forward.scale(1.05)), 1.6, 0.55);
    if (!landing || landing.y - feet < 0.42 || landing.y - feet > 1.45)
      return null;
    const end = landing.add(new Vector3(0, 0.94, 0));
    const top = new Vector3(position.x, end.y + 0.08, position.z);
    const across = new Vector3(end.x, top.y, end.z);
    const start = position.add(new Vector3(0, 0.035, 0));
    if (
      !this.clear(end) ||
      !this.path(start, top) ||
      !this.path(top, across) ||
      !this.path(across, end)
    )
      return null;
    return { top, across, end };
  }
  dispose() {
    this.capsule.dispose();
  }
}
