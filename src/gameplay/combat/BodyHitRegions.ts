import { Vector3 } from '@babylonjs/core';
import type { Character } from '../Character';
import type { BodyRegion } from '../Injuries';

export interface BodyVolume { region: BodyRegion; a: Vector3; b: Vector3; radius: number; }
export interface BodyHit { region: BodyRegion; point: Vector3; normal: Vector3; distance: number; }

/** Authoring dimensions in metres. These volumes follow the current posed bones,
 * including a seated, crawling, or physically fallen character, rather than its bind mesh. */
export function bodyVolumes(character: Character): BodyVolume[] {
  character.root.computeWorldMatrix(true);
  character.skeleton.computeAbsoluteMatrices(true);
  const joint = (name: Parameters<Character['jointPosition']>[0]) => character.jointPosition(name);
  const scale = Math.max(Math.abs(character.root.scaling.x), Math.abs(character.root.scaling.y), Math.abs(character.root.scaling.z));
  const segment = (region: BodyRegion, a: Vector3, b: Vector3, radius: number): BodyVolume => ({region, a, b, radius: radius * scale});
  const head = joint('head'), neck = joint('neck');
  const up = head.subtract(neck).normalize();
  const volumes = [
    segment('head', head.add(up.scale(.035 * scale)), head.add(up.scale(.12 * scale)), .118),
    segment('torso', joint('pelvis'), joint('chest'), .185),
    segment('torso', joint('chest'), joint('neck'), .13),
  ];
  for (const side of ['left', 'right'] as const) {
    volumes.push(
      segment(`${side}Arm`, joint(`${side}Arm`), joint(`${side}Forearm`), .072),
      segment(`${side}Arm`, joint(`${side}Forearm`), joint(`${side}Hand`), .059),
      segment(`${side}Leg`, joint(`${side}Thigh`), joint(`${side}Calf`), .105),
      segment(`${side}Leg`, joint(`${side}Calf`), joint(`${side}Foot`), .078),
    );
  }
  return volumes;
}

function closestOnSegment(point: Vector3, a: Vector3, b: Vector3): Vector3 {
  const axis = b.subtract(a), square = axis.lengthSquared();
  const t = square > 1e-12 ? Math.max(0, Math.min(1, Vector3.Dot(point.subtract(a), axis) / square)) : 0;
  return a.add(axis.scale(t));
}
function raySphere(origin: Vector3, direction: Vector3, center: Vector3, radius: number): number | null {
  const offset = origin.subtract(center), b = Vector3.Dot(offset, direction), c = offset.lengthSquared() - radius * radius;
  if (c <= 0) return 0;
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : null;
}
/** Exact ray/capsule intersection, with spherical end caps and inside-origin handling. */
export function rayBodyVolume(origin: Vector3, direction: Vector3, volume: BodyVolume): number | null {
  const {a, b, radius} = volume;
  if (Vector3.DistanceSquared(origin, closestOnSegment(origin, a, b)) <= radius * radius) return 0;
  const axis = b.subtract(a), offset = origin.subtract(a), aa = axis.lengthSquared();
  const ad = Vector3.Dot(axis, direction), ao = Vector3.Dot(axis, offset), od = Vector3.Dot(offset, direction);
  const qa = aa - ad * ad, qb = aa * od - ao * ad, qc = aa * offset.lengthSquared() - ao * ao - radius * radius * aa;
  const candidates: number[] = [];
  const disc = qb * qb - qa * qc;
  if (qa > 1e-12 && disc >= 0) {
    const t = (-qb - Math.sqrt(disc)) / qa, y = ao + t * ad;
    if (t >= 0 && y > 0 && y < aa) candidates.push(t);
  }
  for (const center of [a, b]) { const t = raySphere(origin, direction, center, radius); if (t !== null) candidates.push(t); }
  return candidates.length ? Math.min(...candidates) : null;
}
export function hitCharacterBody(character: Character, from: Vector3, to: Vector3): BodyHit | null {
  if (character.root.isDisposed() || !character.root.isEnabled()) return null;
  const delta = to.subtract(from), length = delta.length();
  if (length < 1e-8) return null;
  const direction = delta.scale(1 / length);
  let nearest: BodyHit | null = null;
  for (const volume of bodyVolumes(character)) {
    const distance = rayBodyVolume(from, direction, volume);
    if (distance === null || distance > length || nearest && distance >= nearest.distance) continue;
    const point = from.add(direction.scale(distance)), normal = point.subtract(closestOnSegment(point, volume.a, volume.b));
    nearest = {region: volume.region, point, normal: normal.lengthSquared() > 1e-12 ? normal.normalize() : direction.negate(), distance};
  }
  return nearest;
}
/** Impacts without a ray (collisions and blasts) use the nearest current body region. */
export function bodyRegionAtPoint(character: Character, point: Vector3): BodyRegion {
  let region: BodyRegion = 'torso', nearest = Infinity;
  for (const volume of bodyVolumes(character)) {
    const gap = Vector3.Distance(point, closestOnSegment(point, volume.a, volume.b)) - volume.radius;
    if (gap < nearest) { nearest = gap; region = volume.region; }
  }
  return region;
}
