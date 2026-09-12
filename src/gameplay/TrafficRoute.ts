import type { RoadNode } from '../core/contracts';

/** Follow only unambiguous authored successors. Branches and cycles are not endpoints. */
export function terminalApproachDistance(
  nodes: ReadonlyMap<number, RoadNode>, target: RoadNode,
  position: { x: number; z: number }, lookaheadM = 60,
): number | null {
  let distance = Math.hypot(target.x - position.x, target.z - position.z);
  let node = target;
  const visited = new Set<number>();
  for (let steps = 0; steps < 128 && distance <= lookaheadM; steps++) {
    if (visited.has(node.id)) return null;
    visited.add(node.id);
    const successors = [...new Set(node.next)];
    if (successors.length === 0) return distance;
    if (successors.length !== 1) return null;
    const next = nodes.get(successors[0]);
    // A broken continuation is unavailable road; stop before the last known node.
    if (!next) return distance;
    distance += Math.hypot(next.x - node.x, next.z - node.z);
    node = next;
  }
  return null;
}

/** 2.5 m/s² approach envelope; reserve six metres before the boundary endpoint. */
export function terminalSpeedLimit(distanceM: number): number {
  return Math.sqrt(2 * 2.5 * Math.max(0, distanceM - 6));
}
