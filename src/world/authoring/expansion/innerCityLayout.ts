import type { RoadNode, WorldLocation } from '../../../core/contracts';

/** Original metric layout occupying the western VC-INNER atlas reserve. */
export const INNER_CITY_BOUNDS = { minX: -1100, maxX: -450, minZ: -300, maxZ: 600 } as const;
export const INNER_CITY_CONNECTIONS = [-216, 0, 216].map(z => ({ x: -432, z }));
export const INNER_CITY_GROUND = [
  { minX: -1100, maxX: -570, minZ: -300, maxZ: 600 },
  // The existing western margin already covers X−570…−450 through Z314.
  { minX: -570, maxX: -450, minZ: 314, maxZ: 600 },
] as const;
export const INNER_CITY_EXISTING_GROUND = { minX: -570, maxX: -432, minZ: -300, maxZ: 314 } as const;
export interface ExpansionRoad { id: string; x1: number; z1: number; x2: number; z2: number; width: number; laneOffset: number; }
export const INNER_CITY_ROADS: ExpansionRoad[] = [
  ...[-1032, -816, -600].map(x => ({ id: `boulevard-ns/${x}`, x1: x, z1: -216, x2: x, z2: 576, width: 14, laneOffset: 3.3 })),
  ...[-216, 0, 216, 432, 576].map(z => ({ id: `boulevard-ew/${z}`, x1: -1032, z1: z, x2: z < 300 ? -432 : -600, z2: z, width: 14, laneOffset: 3.3 })),
  ...[-924, -708].map(x => ({ id: `local-ns/${x}`, x1: x, z1: -216, x2: x, z2: 432, width: 7.6, laneOffset: 1.8 })),
  ...[-108, 108, 324].map(z => ({ id: `local-ew/${z}`, x1: -1032, z1: z, x2: -600, z2: z, width: 7.6, laneOffset: 1.8 })),
];
export const INNER_CITY_LOCATIONS: WorldLocation[] = [
  { id: 'inner-mercado-luna', name: 'Mercado Luna', x: -762, z: 54, type: 'market' },
  { id: 'inner-cafe-lucero', name: 'Café Lucero', x: -870, z: 166, type: 'landmark' },
  { id: 'inner-motor-court', name: 'Palma Motor Court', x: -762, z: -164, type: 'landmark' },
  { id: 'inner-west-gardens', name: 'West Drainage Gardens', x: -978, z: 486, type: 'park' },
  { id: 'inner-paseo-homes', name: 'Paseo Homes', x: -970, z: 150, type: 'district' },
  { id: 'inner-north-boulevard', name: 'North Boulevard', x: -816, z: 563, type: 'district' },
];
export const INNER_CITY_SPAWNS = [
  { id: 'market-walk', kind: 'pedestrian', x: -762, y: 1.2, z: 54, yaw: 0 },
  { id: 'cafe-walk', kind: 'pedestrian', x: -870, y: 1.2, z: 166, yaw: Math.PI },
  { id: 'park-walk', kind: 'pedestrian', x: -978, y: 1.2, z: 486, yaw: 0 },
  { id: 'motor-yard', kind: 'vehicle', x: -762, y: 1.2, z: -164, yaw: Math.PI / 2 },
] as const;

const directions = [{ x: 1, z: 0 }, { x: 0, z: 1 }, { x: -1, z: 0 }, { x: 0, z: -1 }];
const key = (x: number, z: number) => `${x},${z}`;
export function innerCityIntersections() {
  const points = new Map<string, { x: number; z: number }>();
  for (const road of INNER_CITY_ROADS) {
    for (const point of [{ x: road.x1, z: road.z1 }, { x: road.x2, z: road.z2 }]) points.set(key(point.x, point.z), point);
    for (const cross of INNER_CITY_ROADS) {
      if (road.x1 !== road.x2 || cross.z1 !== cross.z2) continue;
      if (road.x1 >= cross.x1 && road.x1 <= cross.x2 && cross.z1 >= road.z1 && cross.z1 <= road.z2) points.set(key(road.x1, cross.z1), { x: road.x1, z: cross.z1 });
    }
  }
  return [...points.values()].sort((a, b) => a.z - b.z || a.x - b.x);
}

/** Append new directed lanes and splice all three real junctions in both directions. */
export function connectInnerCityRoads(existing: RoadNode[]): RoadNode[] {
  const nodes = existing.map(node => ({ ...node, next: [...node.next] }));
  let nextId = Math.max(-1, ...nodes.map(node => node.id)) + 1;
  const byId = new Map(nodes.map(node => [node.id, node]));
  const points = innerCityIntersections(), arms = new Map<string, Map<number, { point: { x: number; z: number }; offset: number }>>();
  for (const point of points) arms.set(key(point.x, point.z), new Map());
  for (const road of INNER_CITY_ROADS) {
    const horizontal = road.z1 === road.z2;
    const onRoad = points.filter(point => horizontal ? point.z === road.z1 && point.x >= road.x1 && point.x <= road.x2 : point.x === road.x1 && point.z >= road.z1 && point.z <= road.z2).sort((a, b) => horizontal ? a.x - b.x : a.z - b.z);
    for (let i = 0; i < onRoad.length - 1; i++) {
      const a = onRoad[i], b = onRoad[i + 1], heading = horizontal ? 0 : 1;
      arms.get(key(a.x, a.z))!.set(heading, { point: b, offset: road.laneOffset });
      arms.get(key(b.x, b.z))!.set(heading + 2, { point: a, offset: road.laneOffset });
    }
  }
  const lookup = new Map<string, number>();
  for (const point of points) for (const [arm, { offset }] of arms.get(key(point.x, point.z))!) for (const outgoing of [false, true]) {
    const heading = outgoing ? arm : (arm + 2) % 4, direction = directions[heading], sign = outgoing ? 1 : -1;
    const node = { id: nextId++, x: point.x + direction.x * 10 * sign + direction.z * offset, z: point.z + direction.z * 10 * sign - direction.x * offset, next: [] as number[] };
    nodes.push(node); byId.set(node.id, node); lookup.set(`${key(point.x, point.z)}/${heading}/${outgoing}`, node.id);
  }
  for (const point of points) for (const [arm, { point: neighbor }] of arms.get(key(point.x, point.z))!) {
    const departure = byId.get(lookup.get(`${key(point.x, point.z)}/${arm}/true`)!)!;
    departure.next.push(lookup.get(`${key(neighbor.x, neighbor.z)}/${arm}/false`)!);
    const arrivalHeading = (arm + 2) % 4;
    const arrival = byId.get(lookup.get(`${key(point.x, point.z)}/${arrivalHeading}/false`)!)!;
    for (const out of arms.get(key(point.x, point.z))!.keys()) if (out !== arm) arrival.next.push(lookup.get(`${key(point.x, point.z)}/${out}/true`)!);
  }
  const oldNode = (x: number, z: number, required = false) => {
    const node = existing.find(node => Math.hypot(node.x - x, node.z - z) < .01);
    if (!node && required) throw new Error(`VC-INNER connector requires the existing lane at ${x},${z}`);
    return node ? byId.get(node.id)! : undefined;
  };
  for (const { x, z } of INNER_CITY_CONNECTIONS) {
    const west = lookup.get(`${key(x, z)}/2/true`)!;
    for (const [dx, dz] of [[10, 3.3], [3.3, -10], [-3.3, 10]]) oldNode(x + dx, z + dz, dx === 10)?.next.push(west);
    const east = byId.get(lookup.get(`${key(x, z)}/0/false`)!)!;
    for (const [dx, dz] of [[10, -3.3], [3.3, 10], [-3.3, -10]]) { const out = oldNode(x + dx, z + dz, dx === 10); if (out) east.next.push(out.id); }
  }
  return nodes;
}
