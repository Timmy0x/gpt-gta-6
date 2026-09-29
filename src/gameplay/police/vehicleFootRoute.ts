import type { Obstacle, RoadNode } from "../../core/contracts";
import { distance, lineBlocked, type Point2 } from "../../core/math";
import type { Vehicle } from "../../vehicles/VehicleSystem";
import { footRoute } from "./rules";

/** Local visibility corners let a dismounted responder walk around physical traffic. */
export function vehicleFootRoute(start: Point2 & { y?: number }, goal: Point2, roads: RoadNode[], obstacles: Obstacle[], vehicles: readonly Vehicle[]): Point2[] {
  const nearby: Obstacle[] = [];
  let roadHeight: number | undefined;
  if (!Number.isFinite(start.y)) {
    let nearest = Infinity;
    for (const road of roads) if (Number.isFinite(road.y)) {
      const gap = distance(road, start);
      if (gap < nearest) { nearest = gap; roadHeight = road.y; }
    }
  }
  const centerY = Number.isFinite(start.y) ? start.y! : roadHeight != null ? roadHeight + .94 : null;
  for (const vehicle of vehicles) {
    if (!vehicle.root.isEnabled() || distance(start, vehicle.root.position) > 28) continue;
    const bounds = vehicle.root.getHierarchyBoundingVectors(true, mesh => mesh.isEnabled());
    // An overhead aircraft does not obstruct a walking capsule. Ground cars
    // remain obstacles at every world elevation, including Miami's negative Y.
    if (centerY != null && (bounds.min.y > centerY + 1 || bounds.max.y < centerY - 1)) continue;
    nearby.push({ x: (bounds.min.x + bounds.max.x) / 2, z: (bounds.min.z + bounds.max.z) / 2,
      w: bounds.max.x - bounds.min.x, d: bounds.max.z - bounds.min.z, height: bounds.max.y - bounds.min.y });
  }
  if (!nearby.length) return footRoute(start, goal, roads, obstacles);
  const all = [...obstacles, ...nearby];
  const inflated = all.filter(o => o.height > .5).map(o => ({ ...o, w: o.w + 1.1, d: o.d + 1.1 }));
  const corners: RoadNode[] = [];
  let id = Math.max(0, ...roads.map(n => n.id)) + 1;
  for (const bounds of nearby) for (const x of [-1, 1]) for (const z of [-1, 1]) {
    const point = { x: bounds.x + x * (bounds.w / 2 + .95), z: bounds.z + z * (bounds.d / 2 + .95) };
    if (!inflated.some(o => Math.abs(point.x - o.x) < o.w / 2 && Math.abs(point.z - o.z) < o.d / 2))
      corners.push({ ...point, id: id++, next: [] });
  }
  const graph = [...roads, ...corners];
  for (const corner of corners) for (const node of graph)
    if (node.id !== corner.id && distance(corner, node) < 36 && !lineBlocked(corner, node, inflated)) corner.next.push(node.id);
  return footRoute(start, goal, graph, all);
}
