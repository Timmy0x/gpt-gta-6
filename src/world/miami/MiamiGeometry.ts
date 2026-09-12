import earcut, { deviation, flatten } from 'earcut';
import { VertexData } from '@babylonjs/core';
import type { MiamiMeshRecord, MiamiPoint2, MiamiPolygon } from './types';

export type MiamiGeometry = Pick<MiamiMeshRecord, 'positions' | 'normals' | 'uvs' | 'indices'>;
export type MiamiHeight = number | ((x: number, z: number) => number);
const at = (height: MiamiHeight, point: MiamiPoint2) => typeof height === 'number' ? height : height(point[0], point[1]);

/** Polygon holes stay empty. UV coordinates are metres; material scale is runtime-owned. */
export function miamiPolygonGeometry(polygons: MiamiPolygon[], top: MiamiHeight, bottom?: MiamiHeight, maximumEdgeM = 0): MiamiGeometry {
  const positions: number[] = [], indices: number[] = [], uvs: number[] = [], normals: number[] = [];
  for (const source of polygons) {
    const rings = source.map(ring => {
      const clean = ring.filter((point, i) => !i || point[0] !== ring[i - 1][0] || point[1] !== ring[i - 1][1]).map(point => [...point] as MiamiPoint2);
      if (clean.length > 1 && clean[0][0] === clean.at(-1)![0] && clean[0][1] === clean.at(-1)![1]) clean.pop();
      if (clean.length < 3 || clean.some(point => !point.every(Number.isFinite))) throw new TypeError('Invalid Miami polygon ring');
      return clean;
    });
    if (!rings.length) continue;
    const flat = flatten(rings), origin = [flat.vertices[0], flat.vertices[1]];
    // Shore clipping can leave very small valid polygons far from the world
    // origin. Triangulate locally to avoid cancellation in signed-area checks;
    // retain the original world coordinates for the emitted vertices and UVs.
    const local = flat.vertices.map((coordinate, i) => coordinate - origin[i % 2]);
    const isTriangle = local.length === 6 && !flat.holes.length;
    const triangles = isTriangle ? [0, 1, 2] : earcut(local, flat.holes, 2);
    // An existing triangle needs no decomposition. Comparing two differently
    // ordered area sums can manufacture relative error for a thin shore wedge.
    const error = isTriangle ? (local[2] * local[5] - local[4] * local[3] === 0 ? Infinity : 0) : deviation(local, flat.holes, 2, triangles);
    if (!triangles.length || !Number.isFinite(error) || error > 1e-7) throw Object.assign(new Error(`Miami polygon triangulation failed: area deviation ${error}`), { polygon: rings });
    const points: MiamiPoint2[] = [];
    for (let i = 0; i < flat.vertices.length; i += 2) points.push([flat.vertices[i], flat.vertices[i + 1]]);
    if (maximumEdgeM > 0) {
      if (!Number.isFinite(maximumEdgeM) || maximumEdgeM < .5) throw new TypeError('Invalid Miami surface subdivision');
      const pending: number[][] = []; for (let i = 0; i < triangles.length; i += 3) pending.push(triangles.slice(i, i + 3)); triangles.length = 0;
      const middles = new Map<string, number>(), limit = maximumEdgeM ** 2;
      while (pending.length) {
        const triangle = pending.pop()!;
        const lengths = triangle.map((a, i) => { const b = triangle[(i + 1) % 3]; return (points[a][0] - points[b][0]) ** 2 + (points[a][1] - points[b][1]) ** 2; });
        const longest = Math.max(...lengths);
        const heights = typeof top === 'function' ? triangle.map(index => at(top, points[index])) : undefined;
        const residual = heights ? Math.max(...triangle.map((a, i) => { const b = triangle[(i + 1) % 3]; return Math.abs(at(top, [(points[a][0] + points[b][0]) / 2, (points[a][1] + points[b][1]) / 2]) - (heights[i] + heights[(i + 1) % 3]) / 2); })) : 0;
        // Refine abrupt survey slopes beyond the coarse 4 m spacing. The
        // 0.75 m floor tracks the source 1 m grid without fabricating detail.
        if (longest <= limit && (residual <= .05 || longest <= .75 ** 2)) { triangles.push(...triangle); continue; }
        const edge = lengths.indexOf(longest), a = triangle[edge], b = triangle[(edge + 1) % 3], c = triangle[(edge + 2) % 3], key = a < b ? a + '/' + b : b + '/' + a;
        let middle = middles.get(key);
        if (middle === undefined) { middle = points.length; points.push([(points[a][0] + points[b][0]) / 2, (points[a][1] + points[b][1]) / 2]); middles.set(key, middle); }
        pending.push([a, middle, c], [middle, b, c]);
      }
      // Neighbours can need different survey refinement. Reuse every split
      // along their shared edge so no hanging vertex opens a terrain crack.
      for (let i = 0; i < triangles.length; i += 3) pending.push(triangles.slice(i, i + 3)); triangles.length = 0;
      while (pending.length) {
        const triangle = pending.pop()!; let divided = false;
        for (let edge = 0; edge < 3; edge++) {
          const a = triangle[edge], b = triangle[(edge + 1) % 3], c = triangle[(edge + 2) % 3], middle = middles.get(a < b ? a + '/' + b : b + '/' + a);
          if (middle === undefined) continue;
          pending.push([a, middle, c], [middle, b, c]); divided = true; break;
        }
        if (!divided) triangles.push(...triangle);
      }
    }
    const appendFace = (height: MiamiHeight, upward: boolean) => {
      const offset = positions.length / 3, local: number[] = [], face = [...triangles];
      for (const point of points) {
        const y = at(height, point);
        if (!Number.isFinite(y)) throw new TypeError('Invalid Miami surface elevation');
        local.push(point[0], y, point[1]); uvs.push(...point);
      }
      const testNormals: number[] = []; VertexData.ComputeNormals(local, face, testNormals);
      const up = testNormals.filter((_, i) => i % 3 === 1).reduce((sum, n) => sum + n, 0) > 0;
      if (up !== upward) for (let i = 0; i < face.length; i += 3) [face[i + 1], face[i + 2]] = [face[i + 2], face[i + 1]];
      positions.push(...local); indices.push(...face.map(index => index + offset));
    };
    appendFace(top, true);
    if (bottom === undefined) continue;
    appendFace(bottom, false);
    const boundaries = new Map<string, { a: number; b: number; direction: number; count: number }>();
    for (let n = 0; n < triangles.length; n += 3) {
      const tri = triangles.slice(n, n + 3), [a, b, c] = tri.map(index => points[index]);
      const direction = Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
      for (let edge = 0; edge < 3; edge++) {
        const a = tri[edge], b = tri[(edge + 1) % 3], key = a < b ? a + '/' + b : b + '/' + a, existing = boundaries.get(key);
        if (existing) existing.count++; else boundaries.set(key, { a, b, direction, count: 1 });
      }
    }
    for (const edge of boundaries.values()) {
      if (edge.count !== 1) continue;
      const a = points[edge.a], b = points[edge.b], length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const start = positions.length / 3, local = [a[0], at(top, a), a[1], b[0], at(top, b), b[1], b[0], at(bottom, b), b[1], a[0], at(bottom, a), a[1]];
      const face = [0, 1, 2, 0, 2, 3], testNormals: number[] = []; VertexData.ComputeNormals(local, face, testNormals);
      if ((testNormals[0] * (b[1] - a[1]) - testNormals[2] * (b[0] - a[0])) * edge.direction < 0)
        for (let n = 0; n < face.length; n += 3) [face[n + 1], face[n + 2]] = [face[n + 2], face[n + 1]];
      positions.push(...local); indices.push(...face.map(index => index + start));
      uvs.push(0, at(top, a), length, at(top, b), length, at(bottom, b), 0, at(bottom, a));
    }

  }
  VertexData.ComputeNormals(positions, indices, normals);
  return { positions, indices, normals, uvs };
}

export function miamiRectangle(minX: number, minZ: number, maxX: number, maxZ: number): MiamiPolygon {
  return [[[minX, minZ], [maxX, minZ], [maxX, maxZ], [minX, maxZ], [minX, minZ]]];
}
