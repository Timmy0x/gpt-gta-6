import { Vector3 } from '@babylonjs/core';
import type { MovementQueries } from './MovementQueries';
import type { SwimWater } from './Swimming';
import { playableMapPoint } from '../world/Coast';
type MapPoint = { x: number; z: number };

export function parseMapDestination(value: string | undefined): (MapPoint & { name: string }) | null {
  try {
    const point = JSON.parse(value ?? 'null');
    if (!point || !playableMapPoint(point)) return null;
    return { x: point.x, z: point.z, name: typeof point.name === 'string' ? point.name.slice(0, 80) : 'Map pin' };
  } catch { return null; }
}

/** Run after destination collision has streamed in. Searches safe support, never empty air. */
export function resolveTravelDestination(point: MapPoint, queries: Pick<MovementQueries, 'ground' | 'clear'>, water: SwimWater, preferStreet = false): Vector3 | null {
  if (!playableMapPoint(point)) return null;
  const offsets: MapPoint[] = [{ x: 0, z: 0 }];
  for (const radius of [.75, 1.5, 3, 6, 12]) for (let i = 0; i < 12; i++) offsets.push({ x: Math.cos(i * Math.PI / 6) * radius, z: Math.sin(i * Math.PI / 6) * radius });
  for (const offset of offsets) {
    const requested = new Vector3(point.x + offset.x, 1.5, point.z + offset.z);
    if (!playableMapPoint(requested)) continue;
    const ground = (preferStreet ? queries.ground(requested, 2, 24) : null) ?? queries.ground(requested, 510, 32);
    if (!ground) continue;
    const level = water.surfaceHeight(ground.x, ground.z), depth = water.depthAt(ground.x, ground.z);
    const y = level != null && depth > 1.3 && ground.y < level - 1.3 ? level - .45 : ground.y + .94;
    const destination = new Vector3(ground.x, y, ground.z);
    if (queries.clear(destination)) return destination;
  }
  return null;
}
