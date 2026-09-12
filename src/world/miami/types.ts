/** Miami uses east/north metres, Y up. No geographic distance compression. */
export type MiamiPoint = [x: number, y: number, z: number];
export type MiamiPoint2 = [x: number, z: number];
export type MiamiRing = MiamiPoint2[];
/** First ring is the exterior; subsequent rings are holes. */
export type MiamiPolygon = MiamiRing[];
export type MiamiConfidence = 'surveyed' | 'mapped' | 'inferred';

export interface MiamiSource {
  id: string;
  url: string;
  retrieved: string;
  license: string;
  attribution: string;
  sha256?: string;
}
export interface MiamiProvenance {
  sourceIds: string[];
  confidence: MiamiConfidence;
  /** Unresolved measurements must remain visible in the coverage ledger. */
  gaps: string[];
}
export interface MiamiRoadFeature extends MiamiProvenance {
  id: string;
  name: string;
  centerline: MiamiPoint[];
  widthM: number;
  sidewalkWidthM: number;
  /** Reserved centre median/turning band. Raised islands require separate mapped polygons. */
  medianWidthM?: number;
  raisedMedians?: MiamiPolygon[];
  elevationConfidence?: MiamiConfidence;
  lanes: number;
  oneway: boolean;
  layer: number;
  bridge: boolean;
  tunnel: boolean;
  roadClass: string;
  widthConfidence: MiamiConfidence;
}
export interface MiamiBuildingFeature extends MiamiProvenance {
  id: string;
  sourceBuildingId?: string;
  /** The full source mesh, not a maximum-height extrusion of every footprint part. */
  mappedMeshId?: string;
  name: string;
  footprint: MiamiPolygon;
  groundM: number;
  heightM: number;
  heightConfidence: MiamiConfidence;
  levels?: number;
  /** Authored facade model can replace the survey envelope without moving its parcel. */
  model?: string;
}
export interface MiamiAreaFeature extends MiamiProvenance {
  id: string;
  name: string;
  polygons: MiamiPolygon[];
  elevationM: number;
}
export interface MiamiDataset {
  version: 1;
  id: string;
  origin: { latitude: number; longitude: number; elevationM: number };
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  roads: MiamiRoadFeature[];
  buildings: MiamiBuildingFeature[];
  land: MiamiAreaFeature[];
  water: MiamiAreaFeature[];
  sources: MiamiSource[];
  municipalBoundary?: MiamiPolygon[];
}
/** Offline geometry owns metre-scaled UVs. The runtime owns rendering/residency. */
export interface MiamiMeshRecord extends MiamiProvenance {
  id: string;
  kind: 'road' | 'sidewalk' | 'curb' | 'terrain' | 'waterbed' | 'building' | 'detail';
  material: string;
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
  collision: boolean;
  friction: number;
  restitution: number;
  /** Optional local origin for precision; geometry defaults to world coordinates. */
  origin?: MiamiPoint;
}
