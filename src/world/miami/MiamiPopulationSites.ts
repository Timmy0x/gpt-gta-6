import { Vector3 } from '@babylonjs/core';
import type { WorldPopulationSite } from '../../core/contracts';
import { inMiamiBounds, insideMiamiPolygon } from './MiamiQueries';
import type { MiamiDataset } from './types';

/** Fixed public-road identities, independent of visit order and rendering tiles. */
export function populationIdentitySeed(id: string): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  return hash >>> 0;
}

/** Source candidates are verified again against resident Havok geometry before an actor is made. */
export function buildMiamiPopulationSites(
  dataset: MiamiDataset,
  initial: readonly Vector3[],
  heightAt: (x: number, z: number) => number | null,
  covered: (x: number, z: number, radius: number) => boolean,
): WorldPopulationSite[] {
  const candidates: WorldPopulationSite[] = [];
  const valid = (x: number, z: number) => inMiamiBounds({x, z}, dataset.bounds, 6)
    && covered(x, z, .45)
    && !dataset.water.some(area => area.polygons.some(polygon => insideMiamiPolygon(x, z, polygon)))
    && !dataset.buildings.some(building => [[0, 0], [.4, 0], [-.4, 0], [0, .4], [0, -.4]]
      .some(([dx, dz]) => insideMiamiPolygon(x + dx, z + dz, building.footprint)));
  const point = (x: number, z: number) => {
    if (!valid(x, z)) return null;
    const y = heightAt(x, z);
    return y === null || !Number.isFinite(y) ? null : new Vector3(x, y, z);
  };
  for (const road of [...dataset.roads].sort((a, b) => a.id.localeCompare(b.id))) {
    if (road.unavailableReason || road.bridge || road.tunnel || road.layer !== 0) continue;
    for (let segment = 1; segment < road.centerline.length; segment++) {
      const a = road.centerline[segment - 1], b = road.centerline[segment];
      const dx = b[0] - a[0], dz = b[2] - a[2], length = Math.hypot(dx, dz);
      if (length < 6) continue;
      const steps = Math.max(1, Math.ceil(length / 16));
      for (let step = 0; step < steps; step++) for (const side of [-1, 1]) {
        const t = (step + .5) / steps;
        const stationary=road.sidewalkWidthM<1;
        const offset = road.widthM / 2 + (stationary ? 1.8 : road.sidewalkWidthM * .65);
        const at = (fraction: number) => point(a[0] + dx * fraction + side * dz / length * offset,
          a[2] + dz * fraction - side * dx / length * offset);
        const position = at(t), target = stationary ? position?.clone() : at(Math.max(.02, Math.min(.98, t + (step % 2 ? -1 : 1) * Math.min(12 / length, .38))));
        if (!position || !target || !stationary && Vector3.Distance(position, target) < 2) continue;
        let safe = true;
        for (let probe = 0; probe <= 8; probe++) {
          const fraction = probe / 8, x = position.x + (target.x - position.x) * fraction, z = position.z + (target.z - position.z) * fraction;
          if (!valid(x, z)) { safe = false; break; }
        }
        if (safe) candidates.push({id: `miami-local-${populationIdentitySeed(road.id).toString(36)}-${segment}-${step}-${side < 0 ? 'l' : 'r'}`, position, target, ...(stationary?{stationary:true}:{})});
      }
    }
  }
  // A spatial round-robin preserves every populated cell before adding extra
  // residents. The catalogue remains finite even if a later import grows.
  const cells = new Map<string, WorldPopulationSite[]>();
  for (const site of candidates) {
    if (initial.some(p => Vector3.DistanceSquared(p, site.position) < 36)) continue;
    const key = `${Math.floor(site.position.x / 64)}:${Math.floor(site.position.z / 64)}`;
    const cell = cells.get(key) ?? [];
    cell.push(site); cells.set(key, cell);
  }
  const groups = [...cells.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, sites]) =>
    sites.sort((a, b) => populationIdentitySeed(a.id) - populationIdentitySeed(b.id)));
  const result: WorldPopulationSite[] = initial.map((position, i) => {
    const nearest = [...candidates].sort((a, b) => Vector3.DistanceSquared(a.position, position) - Vector3.DistanceSquared(b.position, position))[0];
    return {id: `miami-civilian-${i}`, position: position.clone(), target: nearest?.target.clone() ?? position.clone()};
  });
  for (let layer = 0; layer < 4; layer++) for (const sites of groups) {
    const site = sites[layer];
    if (!site || result.some(other => Vector3.DistanceSquared(other.position, site.position) < 36)) continue;
    result.push(site);
    if (result.length >= 1024) return result;
  }
  return result;
}
