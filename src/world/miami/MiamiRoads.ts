import polygonClipping from 'polygon-clipping';
import type { RoadNode } from '../../core/contracts';
import type { MiamiDataset, MiamiMeshRecord, MiamiPoint, MiamiPoint2, MiamiPolygon, MiamiRoadFeature } from './types';
import { miamiPolygonGeometry, miamiRectangle } from './MiamiGeometry';
import { insideMiamiPolygon } from './MiamiQueries';
import type { MiamiDryCoverage } from './MiamiTerrain';

export interface MiamiRoadOptions { tileM?: number; curbHeightM?: number; curbWidthM?: number; surfaceOffsetM?: number; bounds?: MiamiDataset['bounds']; heightAt?: (x: number, z: number) => number; coverage?: MiamiPolygon; dryCoverage?: MiamiDryCoverage; maximumEdgeM?: number; }
const finite = (value: number, min: number, max: number) => Number.isFinite(value) && value >= min && value <= max;
const sourcedBridge = (road: MiamiRoadFeature) => road.bridge && !!road.elevationConfidence && road.elevationConfidence !== 'inferred';
function cleanRoad(road: MiamiRoadFeature): MiamiRoadFeature {
  if (road.medianWidthM !== undefined && !finite(road.medianWidthM, 0, road.widthM - 1)) throw new TypeError(`Invalid central band for ${road.id}`);
  if (!finite(road.widthM, .5, 80) || !finite(road.sidewalkWidthM, 0, 15) || !Number.isInteger(road.layer)) throw new TypeError(`Invalid dimensions for ${road.id}`);
  const centerline = road.centerline.filter((point, i) => !i || Math.hypot(point[0] - road.centerline[i - 1][0], point[2] - road.centerline[i - 1][2]) > .001);
  if (centerline.length < 2 || centerline.some(point => !point.every(Number.isFinite))) throw new TypeError(`Invalid centerline for ${road.id}`);
  return { ...road, centerline };
}

/** Metre-width segment rectangles and rounded joins, subsequently unioned at intersections. */
export function miamiRoadFootprint(centerline: MiamiPoint[], widthM: number): MiamiPolygon[] {
  if (!finite(widthM, .01, 120)) throw new TypeError('Invalid road buffer width');
  const radius = widthM / 2, pieces: MiamiPolygon[] = [];
  // Fixed micrometre precision prevents sin(PI) residuals from creating
  // almost-zero edges where adjacent buffers meet a chunk boundary.
  const rounded = (value: number) => Math.round(value * 1e6) / 1e6;
  for (let i = 1; i < centerline.length; i++) {
    const a = centerline[i - 1], b = centerline[i], length = Math.hypot(b[0] - a[0], b[2] - a[2]); if (length < .001) continue;
    const x = -(b[2] - a[2]) / length * radius, z = (b[0] - a[0]) / length * radius;
    pieces.push([[[a[0] + x, a[2] + z], [b[0] + x, b[2] + z], [b[0] - x, b[2] - z], [a[0] - x, a[2] - z]]]);
  }
  for (const point of centerline) pieces.push([Array.from({ length: 48 }, (_, i): MiamiPoint2 => {
    const angle = i * Math.PI * 2 / 48; return [point[0] + Math.cos(angle) * radius, point[2] + Math.sin(angle) * radius];
  })]);
  for (const polygon of pieces) for (const ring of polygon) for (const point of ring) { point[0] = rounded(point[0]); point[1] = rounded(point[1]); }
  return pieces.length ? polygonClipping.union(pieces) : [];
}

function nearestHeight(roads: MiamiRoadFeature[], x: number, z: number): number {
  let distance = Infinity, height = 0;
  for (const road of roads) for (let i = 1; i < road.centerline.length; i++) {
    const a = road.centerline[i - 1], b = road.centerline[i], dx = b[0] - a[0], dz = b[2] - a[2];
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[2]) * dz) / (dx * dx + dz * dz)));
    const d = (x - a[0] - t * dx) ** 2 + (z - a[2] - t * dz) ** 2;
    if (d < distance) { distance = d; height = a[1] + (b[1] - a[1]) * t; }
  }
  return height;
}

/** Offline output: same-level intersections have one asphalt surface and no transverse curbs. */
export function buildMiamiRoads(source: MiamiRoadFeature[], options: MiamiRoadOptions = {}): MiamiMeshRecord[] {
  const tile = options.tileM ?? 256, curbHeight = options.curbHeightM ?? .15, curbWidth = options.curbWidthM ?? .18, offset = options.surfaceOffsetM ?? .025;
  if (!finite(tile, 16, 2048) || !finite(curbHeight, 0, .3) || !finite(curbWidth, .05, .5) || !finite(offset, 0, .1)) throw new TypeError('Invalid road geometry options');
  const roads = source.map(cleanRoad), records: MiamiMeshRecord[] = [];
  const footprint = (road: MiamiRoadFeature, width: number) => {
    const polygons = miamiRoadFootprint(road.centerline, width);
    return options.dryCoverage && !sourcedBridge(road) ? polygonClipping.intersection(polygons, options.dryCoverage.polygons) : polygons;
  };
  for (const layer of [...new Set(roads.map(road => road.layer))].sort((a, b) => a - b)) {
    const group = roads.filter(road => road.layer === layer), paved = group.flatMap(road => footprint(road, road.widthM));
    if (!paved.length) continue;
    const fullAsphalt = polygonClipping.union(paved);
    const raisedMedians = group.flatMap(road => road.raisedMedians ?? []);
    const islands = raisedMedians.length ? polygonClipping.intersection(polygonClipping.union(raisedMedians), fullAsphalt) : [];
    const asphalt = islands.length ? polygonClipping.difference(fullAsphalt, islands) : fullAsphalt;
    const walkable = group.filter(road => road.sidewalkWidthM > 0 && !road.tunnel);
    const outerPolygons = walkable.flatMap(road => footprint(road, road.widthM + 2 * road.sidewalkWidthM)), curbPolygons = walkable.flatMap(road => footprint(road, road.widthM + 2 * Math.min(curbWidth, road.sidewalkWidthM)));
    const outer = outerPolygons.length ? polygonClipping.union(outerPolygons) : [];
    const curbOuter = curbPolygons.length ? polygonClipping.union(curbPolygons) : [];
    const sidewalk = outer.length ? polygonClipping.difference(outer, asphalt, curbOuter) : [];
    const curb = curbOuter.length ? polygonClipping.difference(curbOuter, asphalt) : [];
    const all = [...asphalt.flat(2), ...outer.flat(2)], minX = Math.min(...all.map(p => p[0])), maxX = Math.max(...all.map(p => p[0])), minZ = Math.min(...all.map(p => p[1])), maxZ = Math.max(...all.map(p => p[1]));
    const bounds = options.bounds ?? { minX, maxX, minZ, maxZ };
    for (let tx = Math.floor(Math.max(minX, bounds.minX) / tile); tx <= Math.floor(Math.min(maxX, bounds.maxX) / tile); tx++) for (let tz = Math.floor(Math.max(minZ, bounds.minZ) / tile); tz <= Math.floor(Math.min(maxZ, bounds.maxZ) / tile); tz++) {
      if (Math.min((tx + 1) * tile, bounds.maxX) <= Math.max(tx * tile, bounds.minX) || Math.min((tz + 1) * tile, bounds.maxZ) <= Math.max(tz * tile, bounds.minZ)) continue;
      const box = miamiRectangle(Math.max(tx * tile, bounds.minX), Math.max(tz * tile, bounds.minZ), Math.min((tx + 1) * tile, bounds.maxX), Math.min((tz + 1) * tile, bounds.maxZ));
      const localRoads = group.filter(road => { const margin = road.widthM / 2 + road.sidewalkWidthM; return road.centerline.some((point, i) => {
        const next = road.centerline[Math.min(i + 1, road.centerline.length - 1)];
        return Math.min(point[0], next[0]) - margin <= (tx + 1) * tile && Math.max(point[0], next[0]) + margin >= tx * tile && Math.min(point[2], next[2]) - margin <= (tz + 1) * tile && Math.max(point[2], next[2]) + margin >= tz * tile;
      }); });
      if (!localRoads.length) continue;
      const sourceIds = [...new Set(localRoads.flatMap(road => road.sourceIds))].sort(), gaps = [...new Set(localRoads.flatMap(road => road.gaps))];
      const dry = options.dryCoverage && localRoads.some(road => !sourcedBridge(road)) ? options.dryCoverage : undefined;
      if (dry) {
        for (const id of dry.sourceIds) if (!sourceIds.includes(id)) sourceIds.push(id);
        for (const gap of dry.gaps) if (!gaps.includes(gap)) gaps.push(gap);
        gaps.push('Ground-road pavement, sidewalk and curb buffers are clipped to mapped dry coverage; source centerlines remain unchanged and current bank/pavement edges are not surveyed.');
      }
      if (localRoads.some(road => road.widthConfidence === 'inferred')) gaps.push('Road or sidewalk width uses a documented inference; centerline geography is not rescaled.');
      const confidence = dry?.confidence === 'inferred' || localRoads.some(road => road.confidence === 'inferred' || road.widthConfidence === 'inferred') ? 'inferred' : 'mapped';
      for (const [kind, polygons, raised, material] of [['road', asphalt, 0, 'asphalt'], ['sidewalk', sidewalk, curbHeight, 'sidewalk'], ['curb', curb, curbHeight, 'curb'], ['detail', islands, curbHeight, 'soil']] as const) {
        if (!polygons.length) continue;
        const clipped = options.coverage ? polygonClipping.intersection(polygons, box, options.coverage) : polygonClipping.intersection(polygons, box); if (!clipped.length) continue;
        const height = (x: number, z: number) => (options.heightAt && layer === 0 && !localRoads.some(road => road.bridge || road.tunnel) ? options.heightAt(x, z) : nearestHeight(localRoads, x, z)) + offset;
        records.push({ id: `miami/${kind}/${layer}/${tx}/${tz}`, kind, material, sourceIds, gaps, confidence, ...miamiPolygonGeometry(clipped, (x, z) => height(x, z) + raised, (x, z) => height(x, z) - .12, options.maximumEdgeM ?? 4), collision: true, friction: kind === 'road' ? .9 : .85, restitution: 0 });
      }
    }
  }
  return records;
}

/** Clip centerlines before lane offsets so traffic stays inside the supported AOI. */
function clippedLaneRoads(roads: MiamiRoadFeature[], bounds: MiamiDataset['bounds']): MiamiRoadFeature[] {
  const result: MiamiRoadFeature[] = [];
  for (const road of roads) {
    const margin = road.widthM / 2 + 2, box = [bounds.minX + margin, bounds.maxX - margin, bounds.minZ + margin, bounds.maxZ - margin];
    if (box[0] >= box[1] || box[2] >= box[3]) continue;
    let points: MiamiPoint[] = [], part = 0;
    const flush = () => { if (points.length > 1) result.push({ ...road, id: road.id + '/aoi-' + part++, centerline: points }); points = []; };
    for (let i = 1; i < road.centerline.length; i++) {
      const a = road.centerline[i - 1], b = road.centerline[i], dx = b[0] - a[0], dz = b[2] - a[2];
      let begin = 0, end = 1, valid = true;
      for (const [p, q] of [[-dx, a[0] - box[0]], [dx, box[1] - a[0]], [-dz, a[2] - box[2]], [dz, box[3] - a[2]]]) {
        if (Math.abs(p) < 1e-9) { if (q < 0) valid = false; continue; }
        const t = q / p; if (p < 0) begin = Math.max(begin, t); else end = Math.min(end, t);
      }
      if (!valid || begin >= end) { flush(); continue; }
      const at = (t: number): MiamiPoint => [a[0] + dx * t, a[1] + (b[1] - a[1]) * t, a[2] + dz * t];
      const start = at(begin), finish = at(end);
      if (points.length && Math.hypot(points.at(-1)![0] - start[0], points.at(-1)![2] - start[2]) > .001) flush();
      if (!points.length) points.push(start); points.push(finish);
      if (end < 1) flush();
    }
    flush();
  }
  return result;
}

/** Classifies every polygon-boundary interval, so narrow water holes cannot be
 * missed by fixed-distance route samples. The original source path is not moved. */
export function createMiamiDryRouteFilter(coverage: MiamiDryCoverage) {
  const edges: [MiamiPoint2, MiamiPoint2][] = [];
  for (const polygon of coverage.polygons) for (const ring of polygon) for (let i = 0; i < ring.length; i++) edges.push([ring[i], ring[(i + 1) % ring.length]]);
  const point = (p: { x: number; z: number }) => coverage.polygons.some(polygon => insideMiamiPolygon(p.x, p.z, polygon));
  return { point,
    segment(a: { x: number; z: number }, b: { x: number; z: number }): boolean {
      if (!point(a) || !point(b)) return false;
      const dx = b.x - a.x, dz = b.z - a.z, length = dx * dx + dz * dz;
      if (length < 1e-12) return true;
      const splits = [0, 1], minX = Math.min(a.x, b.x), maxX = Math.max(a.x, b.x), minZ = Math.min(a.z, b.z), maxZ = Math.max(a.z, b.z);
      for (const [c, d] of edges) {
        if (Math.max(c[0], d[0]) < minX || Math.min(c[0], d[0]) > maxX || Math.max(c[1], d[1]) < minZ || Math.min(c[1], d[1]) > maxZ) continue;
        const ex = d[0] - c[0], ez = d[1] - c[1], cx = c[0] - a.x, cz = c[1] - a.z, determinant = dx * ez - dz * ex;
        if (Math.abs(determinant) < 1e-12) {
          if (Math.abs(cx * dz - cz * dx) < 1e-9) for (const end of [c, d]) { const fraction = ((end[0] - a.x) * dx + (end[1] - a.z) * dz) / length; if (fraction > 0 && fraction < 1) splits.push(fraction); }
          continue;
        }
        const fraction = (cx * ez - cz * ex) / determinant, edgeFraction = (cx * dz - cz * dx) / determinant;
        if (fraction > 0 && fraction < 1 && edgeFraction >= 0 && edgeFraction <= 1) splits.push(fraction);
      }
      splits.sort((x, z) => x - z);
      for (let i = 1; i < splits.length; i++) {
        if (splits[i] - splits[i - 1] < 1e-10) continue;
        const fraction = (splits[i] + splits[i - 1]) / 2;
        if (!point({ x: a.x + dx * fraction, z: a.z + dz * fraction })) return false;
      }
      return true;
    },
  };
}

/** Source endpoints are junctions; parallel directions stay in their own right-hand lane. */
export function buildMiamiLaneGraph(source: MiamiRoadFeature[], options: { bounds?: MiamiDataset['bounds']; pruneDeadEnds?: boolean; heightAt?: (x: number, z: number) => number; dryCoverage?: MiamiDryCoverage } = {}): RoadNode[] {
  const cleaned = source.map(cleanRoad), roads = options.bounds ? clippedLaneRoads(cleaned, options.bounds) : cleaned;
  const nodes: RoadNode[] = [], verifiedDeck = new Set<number>(), routes: { road: MiamiRoadFeature; start: MiamiPoint; end: MiamiPoint; first: RoadNode; last: RoadNode }[] = [];
  for (const road of roads) {
    if (road.tunnel || ['footway', 'pedestrian', 'path', 'steps', 'cycleway'].includes(road.roadClass)) continue;
    for (const reverse of road.oneway ? [false] : [false, true]) {
      const line = reverse ? [...road.centerline].reverse() : road.centerline, laneOffset = road.oneway ? 0 : (road.widthM + (road.medianWidthM ?? 0)) / 4;
      let first: RoadNode | undefined, last: RoadNode | undefined;
      for (let i = 1; i < line.length; i++) {
        const a = line[i - 1], b = line[i], dx = b[0] - a[0], dz = b[2] - a[2], length = Math.hypot(dx, dz), divisions = Math.max(1, Math.ceil(length / 18));
        for (let n = i === 1 ? 0 : 1; n <= divisions; n++) {
          const t = n / divisions, node: RoadNode = { id: nodes.length, y: a[1] + (b[1] - a[1]) * t, x: a[0] + dx * t + dz / length * laneOffset, z: a[2] + dz * t - dx / length * laneOffset, next: [] };
          if (options.heightAt && road.layer === 0 && !road.bridge && !road.tunnel) node.y = options.heightAt(node.x, node.z);
          if (sourcedBridge(road)) verifiedDeck.add(node.id);
          nodes.push(node); first ??= node; if (last) last.next.push(node.id); last = node;
        }
      }
      if (first && last) routes.push({ road, start: line[0], end: line.at(-1)!, first, last });
    }
  }
  for (const route of routes) for (const other of routes) {
    if (route.road.id === other.road.id || route.road.layer !== other.road.layer) continue;
    if (Math.hypot(route.end[0] - other.start[0], route.end[2] - other.start[2]) < 1.5 && Math.abs(route.end[1] - other.start[1]) < .5) route.last.next.push(other.first.id);
  }
  const prune = options.pruneDeadEnds ?? (!!options.bounds || !!options.dryCoverage);
  if (prune || options.dryCoverage) {
    const retained = new Set(nodes.map(node => node.id));
    if (options.dryCoverage) {
      const dry = createMiamiDryRouteFilter(options.dryCoverage);
      for (const node of nodes) if (!verifiedDeck.has(node.id) && !dry.point(node)) retained.delete(node.id);
      for (const node of nodes) node.next = node.next.filter(next => retained.has(next) && ((verifiedDeck.has(node.id) && verifiedDeck.has(next)) || dry.segment(node, nodes[next])));
    }
    if (prune) {
      let changed = true;
      while (changed) { changed = false; for (const id of retained) if (!nodes[id].next.some(next => retained.has(next))) { retained.delete(id); changed = true; } }
    }
    const ids = new Map([...retained].map((id, index) => [id, index]));
    return [...retained].map(id => ({ ...nodes[id], id: ids.get(id)!, next: nodes[id].next.filter(next => retained.has(next)).map(next => ids.get(next)!) }));
  }
  return nodes;
}
