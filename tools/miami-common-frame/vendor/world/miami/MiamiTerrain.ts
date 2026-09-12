import polygonClipping from 'polygon-clipping';
import type { MiamiAreaFeature, MiamiDataset, MiamiMeshRecord, MiamiPolygon, MiamiProvenance } from './types';
import { miamiPolygonGeometry, miamiRectangle } from './MiamiGeometry';

export interface MiamiTerrainOptions {
  tileM?: number;
  /** Temporary depth until surveyed bathymetry is supplied; recorded as inferred. */
  waterDepthM?: number;
  defaultGroundM?: number;
  heightAt?: (x: number, z: number) => number;
  coverage?: MiamiPolygon;
  maximumEdgeM?: number;
}
export type MiamiTerrainDataset = Pick<MiamiDataset, 'land' | 'water' | 'bounds'>;
export interface MiamiDryCoverage extends MiamiProvenance { polygons: MiamiPolygon[]; }

function preparedAreas(dataset: MiamiTerrainDataset, options: MiamiTerrainOptions) {
  const { minX, minZ, maxX, maxZ } = dataset.bounds;
  if (![minX, minZ, maxX, maxZ].every(Number.isFinite) || maxX <= minX || maxZ <= minZ) throw new TypeError('Invalid Miami terrain bounds');
  const box = miamiRectangle(minX, minZ, maxX, maxZ);
  const clip = options.coverage ? polygonClipping.intersection(box, options.coverage) : [box];
  const water = dataset.water.map(area => ({ ...area, polygons: polygonClipping.intersection(area.polygons, clip) })).filter(area => area.polygons.length);
  const wet = water.length ? polygonClipping.union(water.flatMap(area => area.polygons)) : [];
  const land: MiamiAreaFeature[] = dataset.land.length ? dataset.land : [{
    id: 'derived-land', name: 'Land inside source water outline', polygons: [box], elevationM: options.defaultGroundM ?? 1.5,
    confidence: 'inferred', sourceIds: [...new Set(water.flatMap(area => area.sourceIds))], gaps: [options.heightAt
      ? 'Dry-ground extent is inferred from the AOI minus mapped water; surface heights use the supplied elevation field.'
      : 'Dry ground derived from the AOI minus mapped water polygons; ground elevation is provisional until terrain survey integration.'],
  }];
  return { water, land: land.map(area => ({ ...area, polygons: wet.length ? polygonClipping.difference(polygonClipping.intersection(area.polygons, clip), wet) : polygonClipping.intersection(area.polygons, clip) })).filter(area => area.polygons.length) };
}

/** Reusable horizontal support mask; mapped water holes are never filled by inferred road widths. */
export function createMiamiDryCoverage(dataset: MiamiTerrainDataset, options: MiamiTerrainOptions = {}): MiamiDryCoverage {
  const areas = preparedAreas(dataset, options), polygons = areas.land.flatMap(area => area.polygons), features = [...areas.land, ...areas.water];
  return { polygons: polygons.length ? polygonClipping.union(polygons) : [], sourceIds: [...new Set(features.flatMap(area => area.sourceIds))].sort(),
    confidence: features.some(area => area.confidence === 'inferred') ? 'inferred' : 'mapped',
    gaps: [...new Set(features.flatMap(area => area.gaps)), 'Dry coverage follows mapped land/raster extent minus mapped water, including islands; it is not a surveyed pavement-edge boundary.'],
  };
}

/** Source bay/river polygons remain holes in the land; water surfaces are not solid colliders. */
export function buildMiamiTerrain(dataset: MiamiTerrainDataset, options: MiamiTerrainOptions = {}): MiamiMeshRecord[] {
  const tile = options.tileM ?? 256, depth = options.waterDepthM ?? 8;
  if (!Number.isFinite(tile) || tile < 16 || tile > 2048 || !Number.isFinite(depth) || depth < .5 || depth > 100) throw new TypeError('Invalid Miami terrain settings');
  const areas = preparedAreas(dataset, options), records: MiamiMeshRecord[] = [];
  for (const [wet, features] of [[false, areas.land], [true, areas.water]] as const) for (const area of features) {
    if (!Number.isFinite(area.elevationM)) throw new TypeError(`Invalid terrain elevation: ${area.id}`);
    const points = area.polygons.flat(2), x0 = Math.max(dataset.bounds.minX, Math.min(...points.map(point => point[0]))), x1 = Math.min(dataset.bounds.maxX, Math.max(...points.map(point => point[0])));
    const z0 = Math.max(dataset.bounds.minZ, Math.min(...points.map(point => point[1]))), z1 = Math.min(dataset.bounds.maxZ, Math.max(...points.map(point => point[1])));
    for (let tx = Math.floor(x0 / tile); tx <= Math.floor(x1 / tile); tx++) for (let tz = Math.floor(z0 / tile); tz <= Math.floor(z1 / tile); tz++) {
      const x = Math.max(tx * tile, x0), z = Math.max(tz * tile, z0), endX = Math.min((tx + 1) * tile, x1), endZ = Math.min((tz + 1) * tile, z1);
      if (endX <= x || endZ <= z) continue;
      const polygons = polygonClipping.intersection(area.polygons, miamiRectangle(x, z, endX, endZ)); if (!polygons.length) continue;
      const height = area.elevationM - (wet ? depth : 0);
      records.push({ id: `miami/${wet ? 'waterbed' : 'terrain'}/${area.id}/${tx}/${tz}`, kind: wet ? 'waterbed' : 'terrain', material: wet ? 'waterbed' : 'soil',
        ...miamiPolygonGeometry(polygons, !wet && options.heightAt ? options.heightAt : height, !wet && options.heightAt ? (x, z) => options.heightAt!(x, z) - depth - 1 : height - (wet ? 1 : depth + 1), !wet && options.heightAt ? options.maximumEdgeM ?? 4 : 0), collision: true, friction: wet ? .7 : .85, restitution: 0,
        sourceIds: [...area.sourceIds], confidence: wet ? 'inferred' : area.confidence,
        gaps: wet ? [...area.gaps, `Water outline is mapped; ${depth} m bed depth is a provisional collision assumption, not surveyed bathymetry.`] : [...area.gaps],
      });
    }
  }
  return records;
}

function inside(point: [number, number], polygons: MiamiPolygon[]): boolean {
  const ringContains = (ring: MiamiPolygon[number]) => {
    let result = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i], b = ring[j];
      if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) result = !result;
    }
    return result;
  };
  return polygons.some(polygon => ringContains(polygon[0]) && !polygon.slice(1).some(ringContains));
}

/** Shares collision footprints, including islands. Height queries use the source
 * field; finite collision triangles approximate that field between vertices. */
export function createMiamiTerrainQueries(dataset: MiamiTerrainDataset, options: MiamiTerrainOptions = {}) {
  const areas = preparedAreas(dataset, options), depth = options.waterDepthM ?? 8;
  return {
    waterLevelAt(x: number, z: number): number | null { return areas.water.find(area => inside([x, z], area.polygons))?.elevationM ?? null; },
    floorHeightAt(x: number, z: number): number | null {
      const water = areas.water.find(area => inside([x, z], area.polygons)); if (water) return water.elevationM - depth;
      const land = areas.land.find(area => inside([x, z], area.polygons)); return land ? options.heightAt ? options.heightAt(x, z) : land.elevationM : null;
    },
  };
}

/** A water crossing is not permission to invent a bridge deck at flat street elevation. */
export function auditMiamiRoadWaterCrossings(dataset: MiamiTerrainDataset & Pick<MiamiDataset, 'roads'>) {
  const queries = createMiamiTerrainQueries(dataset), excluded: { id: string; name: string; reason: string; samples: [number, number][] }[] = [];
  const roads = dataset.roads.filter(road => {
    const samples: [number, number][] = [];
    for (let i = 1; i < road.centerline.length; i++) {
      const a = road.centerline[i - 1], b = road.centerline[i], steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[2] - a[2]) / 2));
      for (let n = 0; n <= steps; n++) {
        const t = n / steps, x = a[0] + (b[0] - a[0]) * t, z = a[2] + (b[2] - a[2]) * t;
        if (x < dataset.bounds.minX || x > dataset.bounds.maxX || z < dataset.bounds.minZ || z > dataset.bounds.maxZ) continue;
        if (queries.waterLevelAt(x, z) !== null) samples.push([x, z]);
      }
    }
    if (!samples.length || (road.bridge || road.tunnel) && road.elevationConfidence && road.elevationConfidence !== 'inferred') return true;
    excluded.push({ id: road.id, name: road.name, reason: 'Mapped centerline crosses mapped water, but bridge/tunnel type and non-inferred deck elevation are not both available. This segment is omitted from physical road and traffic generation.', samples });
    return false;
  });
  return { roads, excluded };
}
