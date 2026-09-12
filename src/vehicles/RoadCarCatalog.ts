import catalog from './road-car-catalog.json';
import type { VehicleTuning } from './handling';

export const ROAD_CAR_KINDS = ['coupe','sedan','suv','truck','police','hatchback','executive','van','offroad','mpv'] as const;
export type RoadCarKind = typeof ROAD_CAR_KINDS[number];
export const isRoadCar = (kind: string): kind is RoadCarKind => (ROAD_CAR_KINDS as readonly string[]).includes(kind);
export interface RoadCarDefinition {
  source: string; file: string; hash: string; triangles: number;
  offset: [number,number,number]; seat: [number,number,number]; seatPose: 'low'|'upright';
  bounds: { min: number[]; max: number[] };
  collision: { center: [number,number,number]; size: [number,number,number] }[];
  tuning: VehicleTuning;
}
export const ROAD_CARS = catalog as unknown as Record<RoadCarKind,RoadCarDefinition>;
/** A bounded shared mesh/texture cache; each spawned copy shares immutable source data. */
export const ROAD_CAR_LIMIT = 24;
