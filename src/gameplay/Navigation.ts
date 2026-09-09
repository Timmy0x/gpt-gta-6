import type { RoadNode } from "../core/contracts";
type Point = { x: number; z: number };
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);

/** Routes follow the same directed lane graph as traffic, including one-way turns. */
export function roadRoute(roads: RoadNode[], from: Point, to: Point): Point[] {
  if (!roads.length) return [];
  const nearest = (p: Point) =>
    roads.reduce((best, n) => (distance(p, n) < distance(p, best) ? n : best));
  const start = nearest(from),
    end = nearest(to);
  const byId = new Map(roads.map((n) => [n.id, n]));
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
      return [{ x: from.x, z: from.z }, ...path, { x: to.x, z: to.z }];
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
  private timer = 0;
  constructor(private roads: RoadNode[]) {}
  set(destination: Point & { name: string }, position: Point) {
    this.destination = destination;
    this.timer = 0;
    this.update(0, position);
  }
  clear() {
    this.destination = null;
    this.route = [];
    this.remaining = 0;
  }
  update(dt: number, position: Point) {
    if (!this.destination) return;
    if (distance(position, this.destination) < 9) {
      this.clear();
      return;
    }
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 1.5;
    this.route = roadRoute(this.roads, position, this.destination);
    this.remaining = this.route
      .slice(1)
      .reduce((sum, p, i) => sum + distance(this.route[i], p), 0);
  }
}
