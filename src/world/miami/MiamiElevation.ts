import { projectMiami } from './projection';
import type { MiamiPolygon } from './types';

export interface MiamiElevationGrid {
  width: number; height: number; pixelCenterLongitude: number; pixelCenterLatitude: number;
  longitudeStep: number; latitudeStep: number; noData: number;
  extentWgs84: { xmin: number; xmax: number; ymin: number; ymax: number };
  id: string; confidence: string; verticalDatum: string;
}

/** Bilinear NAVD88 grid sampling. Ground survey is not bridge-deck or bathymetric evidence. */
export function createMiamiElevationSampler(grid: MiamiElevationGrid, heights: Float32Array) {
  if (!Number.isInteger(grid.width) || !Number.isInteger(grid.height) || grid.width < 2 || grid.height < 2 || heights.length !== grid.width * grid.height || grid.longitudeStep <= 0 || grid.latitudeStep >= 0) throw new TypeError('Invalid Miami elevation grid');
  if (heights.some(height => !Number.isFinite(height) || height === grid.noData)) throw new Error('Miami elevation grid contains missing source cells');
  const origin = projectMiami(grid.pixelCenterLongitude, grid.pixelCenterLatitude), east = projectMiami(grid.pixelCenterLongitude + .0001, grid.pixelCenterLatitude), north = projectMiami(grid.pixelCenterLongitude, grid.pixelCenterLatitude + .0001);
  const ex = (east[0] - origin[0]) / .0001, ez = (east[2] - origin[2]) / .0001, nx = (north[0] - origin[0]) / .0001, nz = (north[2] - origin[2]) / .0001, determinant = ex * nz - nx * ez;
  const coordinates = (x: number, z: number) => {
    let longitude = grid.pixelCenterLongitude, latitude = grid.pixelCenterLatitude;
    for (let pass = 0; pass < 3; pass++) {
      const point = projectMiami(longitude, latitude), dx = x - point[0], dz = z - point[2];
      longitude += (dx * nz - dz * nx) / determinant; latitude += (dz * ex - dx * ez) / determinant;
    }
    return { column: (longitude - grid.pixelCenterLongitude) / grid.longitudeStep, row: (latitude - grid.pixelCenterLatitude) / grid.latitudeStep };
  };
  const sample = (x: number, z: number): number | null => {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
    const { column, row } = coordinates(x, z), epsilon = .00001;
    // Only half-pixel edge coverage is clamped; outside the physical raster is unknown.
    if (column < -.5 - epsilon || column > grid.width - .5 + epsilon || row < -.5 - epsilon || row > grid.height - .5 + epsilon) return null;
    const c = Math.max(0, Math.min(grid.width - 1, column)), r = Math.max(0, Math.min(grid.height - 1, row)), c0 = Math.floor(c), r0 = Math.floor(r), c1 = Math.min(c0 + 1, grid.width - 1), r1 = Math.min(r0 + 1, grid.height - 1), u = c - c0, v = r - r0;
    const a = heights[r0 * grid.width + c0] * (1 - u) + heights[r0 * grid.width + c1] * u, b = heights[r1 * grid.width + c0] * (1 - u) + heights[r1 * grid.width + c1] * u;
    return a * (1 - v) + b * v;
  };
  const { xmin, xmax, ymin, ymax } = grid.extentWgs84;
  // A1mm interior margin keeps straight ENU boundary chords inside the
  // curved WGS84 raster footprint without extrapolating any sample.
  const inset = 1e-8, corners = [[xmin + inset, ymin + inset], [xmax - inset, ymin + inset], [xmax - inset, ymax - inset], [xmin + inset, ymax - inset]], ring: [number, number][] = [];
  for (let side = 0; side < 4; side++) for (let n = 0; n < 32; n++) {
    const a = corners[side], b = corners[(side + 1) % 4], t = n / 32, point = projectMiami(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t); ring.push([point[0], point[2]]);
  }
  const coverage: MiamiPolygon = [ring];
  return { sample, coverage, sourceId: grid.id,
    heightAt(x: number, z: number): number { const height = sample(x, z); if (height === null) throw new RangeError(`Miami elevation outside source coverage at ${x},${z}`); return height; },
  };
}
