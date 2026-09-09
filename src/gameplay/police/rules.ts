import { distance, lineBlocked, type Point2 } from "../../core/math";
import type { Obstacle, RoadNode } from "../../core/contracts";

/** Project-authored five-level GTA V-inspired fallback; no claimed VI numeric parity. */
export const RESPONSE_LEVELS = [
  { patrol: 0, swat: 0, roadblocks: 0, helicopter: false, speed: 0, sight: 0 },
  {
    patrol: 1,
    swat: 0,
    roadblocks: 0,
    helicopter: false,
    speed: 17,
    sight: 75,
  },
  {
    patrol: 2,
    swat: 0,
    roadblocks: 0,
    helicopter: false,
    speed: 21,
    sight: 90,
  },
  {
    patrol: 2,
    swat: 1,
    roadblocks: 0,
    helicopter: false,
    speed: 24,
    sight: 105,
  },
  {
    patrol: 3,
    swat: 1,
    roadblocks: 1,
    helicopter: true,
    speed: 27,
    sight: 115,
  },
  {
    patrol: 3,
    swat: 2,
    roadblocks: 2,
    helicopter: true,
    speed: 29,
    sight: 125,
  },
] as const;
export const responseFor = (stars: number) =>
  RESPONSE_LEVELS[Math.max(0, Math.min(5, Math.floor(stars)))];
export const OFFICER_LIMIT = 12;
export const ARREST_SECONDS = 2.8;
export function compliant(
  speed: number,
  resisting: boolean,
  aiming: boolean,
  dead: boolean,
) {
  return Math.abs(speed) < 0.65 && !resisting && !aiming && !dead;
}
export function accessible(
  point: Point2,
  obstacles: Obstacle[],
  margin = 0.65,
) {
  return !obstacles.some(
    (o) =>
      o.height > 0.5 &&
      Math.abs(point.x - o.x) < o.w / 2 + margin &&
      Math.abs(point.z - o.z) < o.d / 2 + margin,
  );
}
export function clearSight(
  a: Point2 & { y: number },
  b: Point2 & { y: number },
  obstacles: Obstacle[],
) {
  return !obstacles.some((o) => {
    let lo = 0,
      hi = 1;
    for (const [start, delta, min, max] of [
      [a.x, b.x - a.x, o.x - o.w / 2, o.x + o.w / 2],
      [a.z, b.z - a.z, o.z - o.d / 2, o.z + o.d / 2],
      [a.y, b.y - a.y, 0, o.height],
    ]) {
      if (Math.abs(delta) < 1e-8) {
        if (start < min || start > max) return false;
      } else {
        let t1 = (min - start) / delta,
          t2 = (max - start) / delta;
        if (t1 > t2) [t1, t2] = [t2, t1];
        lo = Math.max(lo, t1);
        hi = Math.min(hi, t2);
        if (lo > hi) return false;
      }
    }
    return hi > 0.01 && lo < 0.99;
  });
}
/** Reuses the authored accessible lane graph bidirectionally for foot routing. */
export function footRoute(
  start: Point2,
  goal: Point2,
  roads: RoadNode[],
  obstacles: Obstacle[],
): Point2[] {
  const inflated = obstacles
    .filter((o) => o.height > 0.5)
    .map((o) => ({ ...o, w: o.w + 1.1, d: o.d + 1.1 }));
  const clear = (a: Point2, b: Point2) => !lineBlocked(a, b, inflated);
  if (accessible(goal, obstacles) && clear(start, goal))
    return [{ x: goal.x, z: goal.z }];
  const nodes = roads.filter(
    (n) => distance(n, start) < 190 || distance(n, goal) < 100,
  );
  const map = new Map(nodes.map((n) => [n.id, n]));
  const adjacency = new Map(
    nodes.map((n) => [n.id, new Set(n.next.filter((id) => map.has(id)))]),
  );
  for (const n of nodes)
    for (const next of n.next) adjacency.get(next)?.add(n.id);
  const scores = new Map<number, number>(),
    previous = new Map<number, number>();
  const open = new Set<number>();
  for (const n of nodes
    .filter((n) => distance(start, n) < 100 && clear(start, n))
    .sort((a, b) => distance(start, a) - distance(start, b))
    .slice(0, 8)) {
    scores.set(n.id, distance(start, n));
    open.add(n.id);
  }
  let end: RoadNode | undefined;
  while (open.size) {
    const id = [...open].sort(
      (a, b) =>
        scores.get(a)! +
        distance(map.get(a)!, goal) -
        (scores.get(b)! + distance(map.get(b)!, goal)),
    )[0];
    open.delete(id);
    const node = map.get(id)!;
    if (accessible(goal, obstacles) && clear(node, goal)) {
      end = node;
      break;
    }
    for (const nextId of adjacency.get(id) || []) {
      const next = map.get(nextId)!;
      if (!clear(node, next)) continue;
      const cost = scores.get(id)! + distance(node, next);
      if (cost < (scores.get(nextId) ?? Infinity)) {
        scores.set(nextId, cost);
        previous.set(nextId, id);
        open.add(nextId);
      }
    }
  }
  if (!end) return []; // Unreachable is a stop/search state, never a teleport through the wall.
  const result: Point2[] = [{ x: goal.x, z: goal.z }];
  for (
    let id: number | undefined = end.id;
    id !== undefined;
    id = previous.get(id)
  ) {
    const n = map.get(id)!;
    result.unshift({ x: n.x, z: n.z });
  }
  return result;
}
/** Directed road path prevents pursuit cars from greedily circling an intersection. */
export function laneNext(startId: number, goal: Point2, roads: RoadNode[]) {
  const map = new Map(roads.map((n) => [n.id, n]));
  const destination = [...roads].sort(
    (a, b) => distance(a, goal) - distance(b, goal),
  )[0];
  if (!destination || !map.has(startId)) return startId;
  const costs = new Map([[startId, 0]]),
    previous = new Map<number, number>(),
    open = new Set([startId]);
  while (open.size) {
    const current = [...open].sort(
      (a, b) =>
        costs.get(a)! +
        distance(map.get(a)!, destination) -
        (costs.get(b)! + distance(map.get(b)!, destination)),
    )[0];
    open.delete(current);
    if (current === destination.id) {
      let step = current;
      while (previous.has(step) && previous.get(step) !== startId)
        step = previous.get(step)!;
      return step === startId ? (map.get(startId)!.next[0] ?? startId) : step;
    }
    for (const id of map.get(current)!.next) {
      if (!map.has(id)) continue;
      const cost =
        costs.get(current)! + distance(map.get(current)!, map.get(id)!);
      if (cost < (costs.get(id) ?? Infinity)) {
        costs.set(id, cost);
        previous.set(id, current);
        open.add(id);
      }
    }
  }
  return map.get(startId)!.next[0] ?? startId;
}
