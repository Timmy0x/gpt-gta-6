/** Shared authored coast dimensions, in metres. These are project geometry, not surveyed Leonida. */
export const COAST = {
  waterLevel: -0.18,
  shorelineX: 210,
  minX: -1200,
  maxX: 2100,
  minZ: -800,
  maxZ: 800,
} as const;
export function playableMapPoint(point: { x: number; z: number }): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.z) && point.x >= COAST.minX + 2 && point.x <= COAST.maxX - 2 && point.z >= COAST.minZ + 2 && point.z <= COAST.maxZ - 2;
}
export const SEABED_SEGMENTS = [
  { start: 210, end: 250, top: -0.03, slope: -0.08 },
  { start: 250, end: 400, top: -3.23, slope: -0.04 },
  { start: 400, end: COAST.maxX + 40, top: -9.23, slope: 0 },
] as const;
export function coastFloorHeight(x: number, _z: number): number {
  if (x < COAST.shorelineX) return -0.03;
  const segment = SEABED_SEGMENTS.find(s => x < s.end) ?? SEABED_SEGMENTS[2];
  return segment.top + (x - segment.start) * segment.slope;
}
/** Oriented boxes put their top face exactly on the same plane queried by swimming. */
export function seabedSlabs() {
  return SEABED_SEGMENTS.map((s, i) => {
    const x = (s.start + s.end) / 2, normalLength = Math.hypot(1, s.slope);
    return {
      id: `collision/coastal-slope/${i}`,
      x: x + s.slope / normalLength * 0.5,
      y: coastFloorHeight(x, 0) - 0.5 / normalLength,
      z: 0,
      w: (s.end - s.start) * normalLength,
      h: 1,
      d: COAST.maxZ - COAST.minZ + 80,
      rotationZ: Math.atan(s.slope),
      global: true,
      material: 'sand',
    };
  });
}
