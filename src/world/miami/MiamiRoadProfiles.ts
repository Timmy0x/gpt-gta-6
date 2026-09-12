import type { MiamiPoint, MiamiRoadFeature } from './types';

export interface MiamiRoadSupplement { id: string; name?: string; centerline: MiamiPoint[]; tags: Record<string, string>; }
export type MiamiProfileRoad = Pick<MiamiRoadFeature, 'id' | 'name' | 'centerline' | 'oneway' | 'roadClass'> & Partial<Pick<MiamiRoadFeature, 'layer'>>;
export type MiamiRoadProfile = Pick<MiamiRoadFeature, 'widthM' | 'sidewalkWidthM' | 'lanes' | 'widthConfidence' | 'sourceIds' | 'gaps'> & { matchedWayId?: string; matchDistanceM?: number };

/** OSM width values are metres unless an explicit supported unit is present. */
export function miamiWidthMetres(value?: string): number | null {
  if (!value) return null;
  const text = value.trim().toLowerCase();
  let width: number | undefined;
  const imperial = text.match(/^(\d+(?:\.\d+)?)\s*'\s*(?:(\d+(?:\.\d+)?)\s*")?$/);
  const unit = text.match(/^(\d+(?:\.\d+)?)\s*(m|metres?|meters?|ft|feet|foot)?$/);
  if (imperial) width = Number(imperial[1]) * .3048 + Number(imperial[2] ?? 0) * .0254;
  else if (unit) width = Number(unit[1]) * (['ft', 'feet', 'foot'].includes(unit[2]) ? .3048 : 1);
  return width !== undefined && Number.isFinite(width) && width >= .25 && width <= 80 ? width : null;
}
const streetName = (value: string) => value.toUpperCase().replace(/\bNORTHEAST\b/g, 'NE').replace(/\bNORTHWEST\b/g, 'NW').replace(/\bSOUTHEAST\b/g, 'SE').replace(/\bSOUTHWEST\b/g, 'SW').replace(/\bNORTH\b/g, 'N').replace(/\bSOUTH\b/g, 'S').replace(/\bEAST\b/g, 'E').replace(/\bWEST\b/g, 'W').replace(/\b(COURT|CT)\b/g, 'CT').replace(/\b(\d+)(ST|ND|RD|TH)\b/g, '$1').replace(/\b(AVENUE|AVE|AV)\b/g, 'AV').replace(/\b(STREET|ST)\b/g, 'ST').replace(/\b(ROAD|RD)\b/g, 'RD').replace(/\b(BOULEVARD|BLVD)\b/g, 'BLVD').replace(/\b(DRIVE|DR)\b/g, 'DR').replace(/[^A-Z0-9]/g, '');
const NON_ROAD = new Set(['footway', 'path', 'steps', 'cycleway', 'pedestrian', 'corridor', 'elevator', 'proposed', 'construction']);

function matchDistance(road: MiamiProfileRoad, candidate: MiamiRoadSupplement): number | null {
  if (candidate.centerline.length < 2 || NON_ROAD.has(candidate.tags.highway)) return null;
  const name = streetName(road.name), otherName = streetName(candidate.name ?? candidate.tags.name ?? '');
  if (name && otherName && name !== otherName) return null;
  const oneWay = candidate.tags.oneway;
  if (oneWay && ['yes', '1', '-1', 'no', '0'].includes(oneWay) && road.oneway !== ['yes', '1', '-1'].includes(oneWay)) return null;
  const layer = Number(candidate.tags.layer ?? 0); if (road.layer !== undefined && Number.isFinite(layer) && layer !== road.layer) return null;
  const distances: number[] = [], limit = name && otherName ? 12 : 3;
  for (let i = 1; i < road.centerline.length; i++) {
    const a = road.centerline[i - 1], b = road.centerline[i], dx = b[0] - a[0], dz = b[2] - a[2], length = Math.hypot(dx, dz); if (length < .01) continue;
    for (const t of [.2, .5, .8]) {
      const x = a[0] + dx * t, z = a[2] + dz * t; let closest = Infinity;
      for (let j = 1; j < candidate.centerline.length; j++) {
        const c = candidate.centerline[j - 1], d = candidate.centerline[j], ex = d[0] - c[0], ez = d[2] - c[2], extent = Math.hypot(ex, ez); if (extent < .01) continue;
        if (Math.abs((dx * ex + dz * ez) / (length * extent)) < .9) continue;
        const u = Math.max(0, Math.min(1, ((x - c[0]) * ex + (z - c[2]) * ez) / (extent * extent)));
        closest = Math.min(closest, Math.hypot(x - c[0] - ex * u, z - c[2] - ez * u));
      }
      distances.push(closest);
    }
  }
  distances.sort((a, b) => a - b);
  if (!distances.length || distances.filter(distance => distance <= limit).length / distances.length < .7) return null;
  const median = distances[Math.floor(distances.length / 2)]; return median <= limit ? median : null;
}

/** City centerlines are never replaced or moved by the OSM profile supplement. */
export function inferMiamiRoadProfile(road: MiamiProfileRoad, candidates: MiamiRoadSupplement[]): MiamiRoadProfile {
  const matches = candidates.map(candidate => ({ candidate, distance: matchDistance(road, candidate) })).filter((item): item is { candidate: MiamiRoadSupplement; distance: number } => item.distance !== null).sort((a, b) => a.distance - b.distance);
  const best = matches[0], ambiguous = !!best && matches[1]?.distance < best.distance + .5 && streetName(best.candidate.name ?? '') !== streetName(matches[1].candidate.name ?? '');
  const match = ambiguous ? undefined : best, tags = match?.candidate.tags ?? {}, gaps: string[] = [];
  const explicit = miamiWidthMetres(tags.width ?? tags['width:carriageway']);
  const parsedLanes = /^\d+$/.test(tags.lanes ?? '') ? Number(tags.lanes) : null;
  const lanes = parsedLanes && parsedLanes >= 1 && parsedLanes <= 12 ? parsedLanes : road.oneway ? 1 : 2;
  if (!match) gaps.push(ambiguous ? 'Conflicting nearby OSM street profiles were rejected; City placement remains authoritative.' : 'No sufficiently aligned, named OSM carriageway profile matched this City segment.');
  if (!parsedLanes) gaps.push(`Lane count inferred as ${lanes}; source centerline does not survey carriageway edges.`);
  // This is a provisional mesh profile, not a claim that every Brickell lane
  // measures 3.2 m. Every lane-derived width remains labelled inferred.
  const laneWidth = 3.2, parkingSides = tags['parking:both'] === 'lane' ? 2 : Number(tags['parking:left'] === 'lane') + Number(tags['parking:right'] === 'lane');
  const widthM = explicit ?? Math.max(3.2, lanes * laneWidth + parkingSides * 2.2);
  if (explicit === null) gaps.push(`Carriageway width inferred from ${lanes} lanes at ${laneWidth} m${parkingSides ? ` plus ${parkingSides} parking lanes at 2.2 m` : ''}; requires imagery or surveyed-edge confirmation.`);
  const sidewalkTag = tags['sidewalk:both'] ?? tags.sidewalk;
  const absent = ['no', 'none', 'separate'].includes(sidewalkTag) || ['motorway', 'motorway_link', 'trunk', 'trunk_link'].includes(tags.highway ?? road.roadClass);
  const explicitSidewalk = miamiWidthMetres(tags['sidewalk:both:width'] ?? tags['sidewalk:width']);
  const sidewalkWidthM = absent ? 0 : explicitSidewalk ?? 2;
  if (!absent && explicitSidewalk === null) gaps.push('Symmetric 2 m sidewalk width is provisional; individual side widths and separately mapped footpaths require integration.');
  return { widthM, lanes, sidewalkWidthM, widthConfidence: explicit === null ? 'inferred' : 'mapped', sourceIds: match ? ['osm-brickell-supplement'] : [], gaps,
    ...(match ? { matchedWayId: match.candidate.id, matchDistanceM: match.distance } : {}),
  };
}
