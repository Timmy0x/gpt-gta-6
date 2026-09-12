import type { MiamiPoint } from './types';

export const MIAMI_ORIGIN = { latitude: 25.765, longitude: -80.193, elevationM: 0 } as const;
const A = 6378137, E2 = 6.6943799901413165e-3, RAD = Math.PI / 180;
function ecef(latitude: number, longitude: number): [number, number, number] {
  const phi = latitude * RAD, lambda = longitude * RAD, sin = Math.sin(phi);
  const n = A / Math.sqrt(1 - E2 * sin * sin);
  return [n * Math.cos(phi) * Math.cos(lambda), n * Math.cos(phi) * Math.sin(lambda), n * (1 - E2) * sin];
}

/** WGS84 ellipsoid to a Brickell-centred tangent plane. Elevations remain survey metres. */
export function projectMiami(longitude: number, latitude: number, elevationM = 0): MiamiPoint {
  if (![longitude, latitude, elevationM].every(Number.isFinite) || longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90)
    throw new TypeError('Invalid WGS84 coordinate');
  const origin = ecef(MIAMI_ORIGIN.latitude, MIAMI_ORIGIN.longitude), point = ecef(latitude, longitude);
  const d = point.map((n, i) => n - origin[i]), phi = MIAMI_ORIGIN.latitude * RAD, lambda = MIAMI_ORIGIN.longitude * RAD;
  return [-Math.sin(lambda) * d[0] + Math.cos(lambda) * d[1], elevationM - MIAMI_ORIGIN.elevationM,
    -Math.sin(phi) * Math.cos(lambda) * d[0] - Math.sin(phi) * Math.sin(lambda) * d[1] + Math.cos(phi) * d[2]];
}
