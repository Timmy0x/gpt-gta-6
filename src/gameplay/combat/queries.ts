import {
  AbstractMesh,
  PhysicsRaycastResult,
  Ray,
  Vector3,
  type PhysicsBody,
  type PhysicsEngineV2,
  type HavokPlugin,
  type Scene,
  type TransformNode,
} from "@babylonjs/core";

export interface CombatHit {
  point: Vector3;
  normal: Vector3;
  distance: number;
  mesh: AbstractMesh | null;
  body: PhysicsBody | null;
}

const collectorCapacity = new WeakMap<HavokPlugin, number>();
/** Filtering after Havok's default single hit would hide targets behind an excluded capsule. */
function physicsHits(physics: PhysicsEngineV2, from: Vector3, to: Vector3, options: QueryExclusions): PhysicsRaycastResult[] {
  const ignored = physics.getBodies().filter(body => !body.isDisposed && (
    options.bodies?.has(body) || excluded(body.transformNode, options) || options.bodyFilter?.(body) === false
  ));
  const query = { shouldHitTriggers: false, ignoreBody: ignored[0] };
  if (ignored.length <= 1) return [physics.raycast(from, to, query)];
  // Multiple exclusions can share a shape with visible bodies. Collect native
  // hits rather than changing shared shape filters during the query.
  const plugin = physics.getPhysicsPlugin() as HavokPlugin;
  let capacity = collectorCapacity.get(plugin) ?? 32;
  if (!collectorCapacity.has(plugin)) { plugin.setMaxQueryCollectorHits(capacity); collectorCapacity.set(plugin, capacity); }
  const hits: PhysicsRaycastResult[] = [];
  while (true) {
    hits.length = 0; physics.raycastToRef(from, to, hits, query);
    if (hits.length < capacity) return hits;
    // A full collector may have omitted a valid target behind excluded bodies.
    capacity *= 2; plugin.setMaxQueryCollectorHits(capacity); collectorCapacity.set(plugin, capacity);
  }
}
export interface QueryExclusions {
  roots?: readonly TransformNode[];
  bodies?: ReadonlySet<PhysicsBody>;
  bodyFilter?: (body: PhysicsBody) => boolean;
  softTargets?: boolean;
}
function excluded(node: TransformNode, options: QueryExclusions): boolean {
  if (options.roots?.some((root) => node === root || node.isDescendantOf(root)))
    return true;
  return (
    !!node.metadata?.combatEffect ||
    !!node.metadata?.weaponVisual ||
    (options.softTargets === false &&
      !!(
        node.metadata?.ped ||
        node.metadata?.officer ||
        node.metadata?.ragdoll
      ))
  );
}

/** The nearest rendered target and Havok collider share one ray, so invisible collision can block fire. */
export function castSegment(
  scene: Scene,
  from: Vector3,
  to: Vector3,
  options: QueryExclusions = {},
): CombatHit | null {
  const delta = to.subtract(from),
    length = delta.length();
  if (length < 1e-5) return null;
  const direction = delta.scale(1 / length);
  const visual = scene.pickWithRay(
    new Ray(from, direction, length),
    (mesh) =>
      mesh.isEnabled() &&
      mesh.isPickable &&
      !excluded(mesh, options) &&
      mesh.name !== "ocean",
  );
  let nearest: CombatHit | null =
    visual?.hit && visual.pickedPoint
      ? {
          point: visual.pickedPoint.clone(),
          normal: visual.getNormal(true) ?? direction.negate(),
          distance: visual.distance,
          mesh: visual.pickedMesh,
          body: null,
        }
      : null;
  const physics = scene.getPhysicsEngine() as PhysicsEngineV2 | null;
  if (physics) {
    const hits = physicsHits(physics, from, to, options);
    for (const hit of hits) {
      const body = hit.body;
      if (
        !hit.hasHit ||
        !body ||
        body.isDisposed ||
        options.bodies?.has(body) ||
        excluded(body.transformNode, options) ||
        options.bodyFilter?.(body) === false
      )
        continue;
      // Prefer visible component metadata when it coincides with its simplified collision proxy.
      if (nearest && hit.hitDistance >= nearest.distance - 0.03) continue;
      nearest = {
        point: hit.hitPointWorld.clone(),
        normal: hit.hitNormalWorld.clone(),
        distance: hit.hitDistance,
        mesh:
          body.transformNode instanceof AbstractMesh
            ? body.transformNode
            : null,
        body,
      };
    }
  }
  return nearest;
}

export function obstructed(
  scene: Scene,
  origin: Vector3,
  target: Vector3,
  options: QueryExclusions = {},
): boolean {
  const delta = target.subtract(origin),
    length = delta.length();
  if (length < 0.15) return false;
  const direction = delta.scale(1 / length);
  const hit = castSegment(
    scene,
    origin.add(direction.scale(0.07)),
    target.subtract(direction.scale(0.08)),
    { ...options, softTargets: false },
  );
  return !!hit;
}

/** Reticle establishes intent; the second ray resolves the actual muzzle-to-target path. */
export function muzzleShot(
  scene: Scene,
  cameraOrigin: Vector3,
  cameraDirection: Vector3,
  muzzle: Vector3,
  range: number,
  options: QueryExclusions = {},
  cameraOptions: QueryExclusions = options,
): { target: Vector3; hit: CombatHit | null; end: Vector3 } {
  const far = cameraOrigin.add(cameraDirection.normalizeToNew().scale(range));
  const aimed = castSegment(scene, cameraOrigin, far, cameraOptions),
    target = aimed?.point ?? far;
  const hit = castSegment(scene, muzzle, target, options);
  return { target, hit: hit ?? aimed, end: hit?.point ?? target };
}

export function blastFalloff(distance: number, radius = 14): number {
  return Math.max(0, 1 - Math.max(0, distance) / radius) ** 1.35;
}
