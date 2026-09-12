import { MIAMI_ORIGIN, projectMiami } from './projection';
import { inferMiamiRoadProfile, type MiamiRoadSupplement } from './MiamiRoadProfiles';
import type { MiamiDataset, MiamiPoint, MiamiPolygon, MiamiSource } from './types';

export interface MiamiGeoFeature {
  id?: string | number;
  properties: Record<string, any>;
  geometry: { type: string; coordinates: any };
}
export interface MiamiGeoCollection { features: MiamiGeoFeature[]; }
export interface MiamiEnvelope {
  id: string; sourceUniqueId: string; groundM: number; heightM: number; yearUpdated: number;
}
export interface MiamiDatasetInputs {
  id: string;
  bboxWgs84: [number, number, number, number];
  streets: MiamiGeoCollection;
  buildings: MiamiGeoCollection;
  water: MiamiGeoCollection;
  boundary: MiamiGeoCollection;
  osm: MiamiGeoCollection;
  envelopes: MiamiEnvelope[];
  sources: MiamiSource[];
}

export function projectMiamiPolygon(geometry: MiamiGeoFeature['geometry']): MiamiPolygon[] {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : null;
  if (!polygons) throw new TypeError(`Expected geographic polygon, got ${geometry.type}`);
  return polygons.map((polygon: number[][][]) => polygon.map(ring => ring.map(coordinate => {
    const [x, , z] = projectMiami(coordinate[0], coordinate[1]); return [x, z];
  })));
}

/** Converts placement only. Every inferred dimension survives in the coverage ledger. */
export function assembleMiamiDataset(input: MiamiDatasetInputs): MiamiDataset {
  const [west, south, east, north] = input.bboxWgs84;
  if (!(west < east && south < north)) throw new TypeError('Invalid geographic bounds');
  const corners = [[west, south], [west, north], [east, south], [east, north]].map(([lon, lat]) => projectMiami(lon, lat));
  const bounds = { minX: Math.min(...corners.map(p => p[0])), maxX: Math.max(...corners.map(p => p[0])), minZ: Math.min(...corners.map(p => p[2])), maxZ: Math.max(...corners.map(p => p[2])) };
  const osmRoads: MiamiRoadSupplement[] = input.osm.features.filter(f => f.properties.kind === 'road' && f.geometry.type === 'LineString').map(f => ({
    id: String(f.id ?? f.properties.sourceId), name: f.properties.name ?? '', tags: f.properties.tags ?? {},
    centerline: f.geometry.coordinates.map((p: number[]) => projectMiami(p[0], p[1], 1.5)),
  }));
  const roads: MiamiDataset['roads'] = input.streets.features.flatMap(f => {
    const paths: number[][][] = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : [];
    if (!paths.length) throw new TypeError(`Street ${f.id} has no source polyline`);
    return paths.map((path, part) => {
      const oneWay = String(f.properties.One_Way ?? '').trim();
      // City FT/TF cost direction provides an independent consistency check.
      if (oneWay === 'TF' && Number(f.properties.TF_Cost) < 0 || oneWay === 'FT' && Number(f.properties.FT_Cost) < 0) throw new Error(`Conflicting street direction: ${f.id}`);
      const line = oneWay === 'TF' ? [...path].reverse() : path;
      const centerline: MiamiPoint[] = line.map(p => projectMiami(p[0], p[1], 1.5));
      const base = { id: `city-street:${f.id ?? f.properties.FID}:${part}`, name: String(f.properties.St_Label ?? '').trim(), centerline, oneway: ['FT', 'TF'].includes(oneWay), roadClass: `city-class-${f.properties.Rd_Class}` };
      // City layer fields are zero throughout this extract. Let aligned OSM
      // matches report grade tags; never use zero as proof of a ground road.
      const profile = inferMiamiRoadProfile(base, osmRoads);
      const tags = osmRoads.find(r => r.id === profile.matchedWayId)?.tags ?? {};
      const rawLayer = Number(tags.layer ?? f.properties.ZLevel ?? 0), layer = Number.isInteger(rawLayer) ? rawLayer : 0;
      const bridge = tags.bridge !== undefined && tags.bridge !== 'no', tunnel = tags.tunnel !== undefined && tags.tunnel !== 'no';
      return { ...base, ...profile, layer, bridge, tunnel, roadClass: tags.highway ?? base.roadClass,
        sourceIds: ['city-streets', ...profile.sourceIds], confidence: 'mapped' as const,
        gaps: [...profile.gaps, 'Street elevation is provisionally 1.5 m NAVD88; terrain and bridge-deck elevation integration remains open.', ...(bridge || tunnel || layer !== 0 ? ['Grade-separated segment has no accepted deck profile and is excluded from initial drivable mesh/navigation.'] : [])],
      };
    });
  });
  const envelopes = new Map(input.envelopes.map(e => [e.sourceUniqueId, e]));
  const buildings: MiamiDataset['buildings'] = input.buildings.features.flatMap(f => {
    const sourceBuildingId = typeof f.properties.UNIQUEID === 'string' && f.properties.UNIQUEID.trim() ? f.properties.UNIQUEID : undefined;
    const envelope = sourceBuildingId ? envelopes.get(sourceBuildingId) : undefined;
    return projectMiamiPolygon(f.geometry).map((footprint, part) => ({
      id: `county-footprint:${f.id ?? f.properties.OBJECTID}:${part}`, sourceBuildingId,
      ...(envelope ? { mappedMeshId: envelope.id } : {}), name: '', footprint,
      groundM: envelope?.groundM ?? 1.5, heightM: envelope?.heightM ?? 0,
      confidence: 'mapped' as const, heightConfidence: envelope ? 'mapped' as const : 'inferred' as const,
      sourceIds: ['county-buildings', ...(envelope ? ['county-i3s-buildings'] : [])],
      gaps: [envelope ? `Building form is the County ${envelope.yearUpdated} I3S source mesh; current exterior and changes since acquisition require review.` : 'No accepted metre height or matched source mesh; footprint is indexed but no tower height is fabricated.',
        'Building-specific facades, entrances, finish and current condition are not yet accepted.',
        ...(envelope && Number(f.properties.YEARUPDATE) > envelope.yearUpdated ? ['Footprint postdates source 3D geometry; temporal reconciliation is required.'] : [])],
    }));
  });
  const water: MiamiDataset['water'] = input.water.features.map(f => ({ id: `city-water:${f.id ?? f.properties.FID}`, name: 'Miami waterfront', polygons: projectMiamiPolygon(f.geometry), elevationM: 0,
    confidence: 'mapped', sourceIds: ['city-water'], gaps: ['Water outline follows City GIS; constant 0 m NAVD88 water level is provisional, not a tidal survey.'],
  }));
  const dataset: MiamiDataset = { version: 1, id: input.id, origin: { ...MIAMI_ORIGIN }, bounds, roads, buildings, land: [], water,
    municipalBoundary: input.boundary.features.flatMap(f => projectMiamiPolygon(f.geometry)), sources: input.sources };
  const sourceIds = new Set(dataset.sources.map(s => s.id));
  for (const feature of [...roads, ...buildings, ...water]) for (const id of feature.sourceIds) if (!sourceIds.has(id)) throw new Error(`Missing provenance source ${id}`);
  return dataset;
}
