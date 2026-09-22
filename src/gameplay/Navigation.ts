import type { RoadNode } from "../core/contracts";
type Point = { x: number; z: number };
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);

/** Walking approaches to a road stay local; they never replace a missing road connection. */
export const ROUTE_APPROACH = { maximum: 20, extra: 6, candidates: 8, exact: .1 } as const;

function endpointCandidates(roads: RoadNode[], point: Point, components: Map<number, number>) {
  const ordered = roads.map(node => ({ node, distance: distance(node, point) })).sort((a, b) => a.distance - b.distance || a.node.id - b.node.id);
  const nearest = ordered[0];
  if (!nearest || nearest.distance > ROUTE_APPROACH.maximum) return [];
  if (nearest.distance <= ROUTE_APPROACH.exact) return [nearest];
  const limit = Math.min(ROUTE_APPROACH.maximum, nearest.distance + ROUTE_APPROACH.extra);
  return ordered.filter(candidate => candidate.distance <= limit && components.get(candidate.node.id) === components.get(nearest.node.id)).slice(0, ROUTE_APPROACH.candidates);
}

function connectedComponents(roads: RoadNode[]) {
  const adjacency = new Map(roads.map(node => [node.id, new Set<number>()]));
  for (const node of roads) for (const next of node.next) if (adjacency.has(next)) {
    adjacency.get(node.id)!.add(next); adjacency.get(next)!.add(node.id);
  }
  const components = new Map<number, number>();
  for (const node of roads) {
    if (components.has(node.id)) continue;
    const queue = [node.id]; components.set(node.id, node.id);
    while (queue.length) for (const next of adjacency.get(queue.pop()!)!) if (!components.has(next)) {
      components.set(next, node.id); queue.push(next);
    }
  }
  return components;
}

/** Routes follow the same directed lane graph as traffic, including one-way turns. */
export function roadRoute(roads: RoadNode[], from: Point, to: Point): Point[] {
  if (!roads.length || ![from.x, from.z, to.x, to.z].every(Number.isFinite)) return [];
  const components = connectedComponents(roads), starts = endpointCandidates(roads, from, components), ends = endpointCandidates(roads, to, components);
  if (!starts.length || !ends.length || components.get(starts[0].node.id) !== components.get(ends[0].node.id)) return [];
  const byId = new Map(roads.map((n) => [n.id, n]));
  // Closest endpoints retain priority even when a farther approach would shorten a one-way journey.
  const pairs = starts.flatMap(start => ends.map(end => ({ start, end, approach: start.distance + end.distance })))
    .sort((a, b) => a.approach - b.approach || a.start.node.id - b.start.node.id || a.end.node.id - b.end.node.id);
  for (const pair of pairs) {
    const path = directedRoute(byId, pair.start.node, pair.end.node);
    if (path.length) return [{ x: from.x, z: from.z }, ...path, { x: to.x, z: to.z }];
  }
  return [];
}

function directedRoute(byId: Map<number, RoadNode>, start: RoadNode, end: RoadNode): Point[] {
  const costs = new Map<number, number>([[start.id, 0]]),
    previous = new Map<number, number>();
  const open = new Set([start.id]);
  while (open.size) {
    let id = [...open].reduce((a, b) =>
      costs.get(a)! + distance(byId.get(a)!, end) <
      costs.get(b)! + distance(byId.get(b)!, end)
        ? a
        : b,
    );
    if (id === end.id) {
      const path: Point[] = [{ x: end.x, z: end.z }];
      while (previous.has(id)) {
        id = previous.get(id)!;
        const n = byId.get(id)!;
        path.unshift({ x: n.x, z: n.z });
      }
      return path;
    }
    open.delete(id);
    const node = byId.get(id)!;
    for (const next of node.next) {
      const neighbour = byId.get(next);
      if (!neighbour) continue;
      const cost = costs.get(id)! + distance(node, neighbour);
      if (cost < (costs.get(next) ?? Infinity)) {
        costs.set(next, cost);
        previous.set(next, id);
        open.add(next);
      }
    }
  }
  return [];
}

export class Navigation {
  destination: (Point & { name: string }) | null = null;
  route: Point[] = [];
  remaining = 0;
  status: 'idle' | 'ready' | 'unavailable' | 'arrived' = 'idle';
  private timer = 0;
  constructor(private roads: RoadNode[]) {}
  set(destination: Point & { name: string }, position: Point) {
    this.destination = destination;
    this.timer = 0;
    this.update(0, position);
    return this.status;
  }
  clear() {
    this.destination = null;
    this.route = [];
    this.remaining = 0;
    this.status = 'idle';
  }
  update(dt: number, position: Point) {
    if (!this.destination) return;
    if (distance(position, this.destination) < 9) {
      this.clear();
      this.status = 'arrived';
      return;
    }
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 1.5;
    this.route = roadRoute(this.roads, position, this.destination);
    this.status = this.route.length ? 'ready' : 'unavailable';
    this.remaining = this.route
      .slice(1)
      .reduce((sum, p, i) => sum + distance(this.route[i], p), 0);
  }
}
