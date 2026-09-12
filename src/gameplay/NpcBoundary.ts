import { Vector3, type PhysicsCharacterController } from '@babylonjs/core';
import type { WorldBoundary } from '../world/WorldBoundary';

// The prone capsule extends .58 m from its centre plus a .32 m radius.
// Keep this footprint in all stances so changing posture cannot enlarge it at an edge.
const NPC_BOUNDARY_RADIUS = .90;

/** Constrain the real controller velocity; normal height, heading and tangent motion are unchanged. */
export function protectNpcController(controller: PhysicsCharacterController, boundary: WorldBoundary | undefined, dt: number): boolean {
  if (!boundary) return false;
  const position = controller.getPosition(), previousY = position.y;
  const recovery = boundary.recovery(position, controller.footOffset + .04, NPC_BOUNDARY_RADIUS);
  let velocity = controller.getVelocity();
  if (recovery) {
    controller.setPosition(recovery.position);
    if (recovery.reason !== 'outside') velocity = Vector3.Zero();
    else if (velocity.y < 0 && recovery.position.y > previousY) velocity.y = 0;
  }
  const limited = boundary.limitVelocity(controller.getPosition(), velocity, dt, NPC_BOUNDARY_RADIUS);
  if (recovery || !limited.equals(velocity)) controller.setVelocity(limited);
  return !!recovery;
}
