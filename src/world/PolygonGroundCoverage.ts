export type GroundPoint = readonly [number, number];
export type GroundPolygon = readonly (readonly GroundPoint[])[];
export interface GroundCoverageHit { fraction: number; normalX: number; normalZ: number }
export interface SupportedGroundCoverage {
  containsDisk(x: number, z: number, radius: number): boolean;
  /** Earliest boundary contact of the complete moving disk, including holes. */
  sweep(x: number, z: number, dx: number, dz: number, radius: number): GroundCoverageHit | null;
  nearestSupported(x: number, z: number, radius: number): GroundPoint | null;
}

type Box = { minX: number; maxX: number; minZ: number; maxZ: number };
type Segment = { ax: number; az: number; bx: number; bz: number; ring: number };
const EPS = 1e-8;
function closest(x: number, z: number, s: Segment) {
  const dx = s.bx - s.ax, dz = s.bz - s.az;
  const t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / (dx * dx + dz * dz)));
  const qx = s.ax + dx * t, qz = s.az + dz * t;
  return { x: qx, z: qz, distance: Math.hypot(x - qx, z - qz) };
}

/** A navigation safety query over already compiled physical support, never renderer data.
 * Rings must describe dry collision coverage, including its holes and raster voids, in
 * metres in the physics x/z frame. It creates no terrain, collider, wall or water floor.
 * Overlapping polygons are safe but conservative: internal edges also limit motion.
 */
export class PolygonGroundCoverage implements SupportedGroundCoverage {
  private readonly polygons: GroundPolygon[];
  private readonly segments: Segment[] = [];
  private readonly polygonCells = new Map<string, number[]>();
  private readonly segmentCells = new Map<string, number[]>();
  private readonly segmentRows = new Map<number, number[]>();
  private readonly polygonRings: number[][] = [];
  private readonly cellSize: number;
  private readonly bounds: Box;

  constructor(polygons: readonly GroundPolygon[], cellSize = 32) {
    if (!Number.isFinite(cellSize) || cellSize <= 0) throw new RangeError('Invalid coverage cell size');
    this.cellSize = cellSize;
    this.polygons = polygons.map(poly => poly.map(ring => ring.map(p => [p[0], p[1]] as GroundPoint)));
    this.bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
    for (const [id, polygon] of this.polygons.entries()) {
      if (!polygon.length || polygon.some(r => r.length < 3 || r.some(p => !p.every(Number.isFinite))))
        throw new TypeError('Invalid physical coverage polygon');
      const b = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
      const rings: number[] = []; this.polygonRings.push(rings);
      for (const ring of polygon) {
        const ringId = this.segments.length; rings.push(ringId);
        for (let i = 0; i < ring.length; i++) {
        const a = ring[i], next = ring[(i + 1) % ring.length];
        b.minX = Math.min(b.minX, a[0]); b.maxX = Math.max(b.maxX, a[0]);
        b.minZ = Math.min(b.minZ, a[1]); b.maxZ = Math.max(b.maxZ, a[1]);
        if (a[0] === next[0] && a[1] === next[1]) continue;
        const index = this.segments.push({ ax: a[0], az: a[1], bx: next[0], bz: next[1], ring: ringId }) - 1;
        this.cells(Math.min(a[0], next[0]), Math.max(a[0], next[0]), Math.min(a[1], next[1]), Math.max(a[1], next[1]), key => {
          const list = this.segmentCells.get(key); if (list) list.push(index); else this.segmentCells.set(key, [index]);
        });
        for (let row = Math.floor(Math.min(a[1], next[1]) / this.cellSize); row <= Math.floor(Math.max(a[1], next[1]) / this.cellSize); row++) {
          const list = this.segmentRows.get(row); if (list) list.push(index); else this.segmentRows.set(row, [index]);
        }
        }
      }
      this.cells(b.minX, b.maxX, b.minZ, b.maxZ, key => {
        const list = this.polygonCells.get(key); if (list) list.push(id); else this.polygonCells.set(key, [id]);
      });
      this.bounds.minX = Math.min(this.bounds.minX, b.minX); this.bounds.maxX = Math.max(this.bounds.maxX, b.maxX);
      this.bounds.minZ = Math.min(this.bounds.minZ, b.minZ); this.bounds.maxZ = Math.max(this.bounds.maxZ, b.maxZ);
    }
    if (!this.segments.length) throw new RangeError('Physical coverage is empty');
  }

  private cells(minX: number, maxX: number, minZ: number, maxZ: number, visit: (key: string) => void) {
    for (let x = Math.floor(minX / this.cellSize); x <= Math.floor(maxX / this.cellSize); x++)
      for (let z = Math.floor(minZ / this.cellSize); z <= Math.floor(maxZ / this.cellSize); z++) visit(`${x},${z}`);
  }
  private containsPoint(x: number, z: number) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
    const candidates = this.polygonCells.get(`${Math.floor(x / this.cellSize)},${Math.floor(z / this.cellSize)}`);
    if (!candidates) return false;
    // Scan only edges in this row, rather than every river/coast vertex for each NPC.
    const inside = new Set<number>();
    for (const id of this.segmentRows.get(Math.floor(z / this.cellSize)) ?? []) {
      const s = this.segments[id];
      if ((s.az > z) !== (s.bz > z) && x < (s.bx - s.ax) * (z - s.az) / (s.bz - s.az) + s.ax)
        if (inside.has(s.ring)) inside.delete(s.ring); else inside.add(s.ring);
    }
    return candidates.some(id => {
      const rings = this.polygonRings[id]; return inside.has(rings[0]) && !rings.slice(1).some(r => inside.has(r));
    });
  }
  private nearSegments(x: number, z: number, radius: number) {
    const result = new Set<number>();
    this.cells(x - radius, x + radius, z - radius, z + radius, key => this.segmentCells.get(key)?.forEach(id => result.add(id)));
    return result;
  }
  containsDisk(x: number, z: number, radius: number) {
    if (!Number.isFinite(radius) || radius < 0 || !this.containsPoint(x, z)) return false;
    for (const id of this.nearSegments(x, z, radius + EPS)) if (closest(x, z, this.segments[id]).distance < radius - EPS) return false;
    return true;
  }

  sweep(x: number, z: number, dx: number, dz: number, radius: number): GroundCoverageHit | null {
    if (![x, z, dx, dz, radius].every(Number.isFinite) || radius < 0) return { fraction: 0, normalX: 0, normalZ: 0 };
    if (!this.containsDisk(x, z, radius)) return { fraction: 0, normalX: 0, normalZ: 0 };
    const requestedLength = Math.hypot(dx, dz); if (requestedLength < EPS) return null;
    if (!Number.isFinite(requestedLength)) return { fraction: 0, normalX: 0, normalZ: 0 };
    // A supported origin must meet the outer boundary within the coverage diameter.
    // Bound index traversal even for a corrupted save's enormous but finite velocity.
    const scale = Math.min(1, (Math.hypot(this.bounds.maxX - this.bounds.minX, this.bounds.maxZ - this.bounds.minZ) + 1) / requestedLength);
    dx *= scale; dz *= scale;
    const length = requestedLength * scale;
    // Traverse cells along the path, rather than visiting every segment in the city.
    // Half-cell spacing and expanded neighbours cover every swept-disk cell.
    const ids = new Set<number>(), steps = Math.max(1, Math.ceil(length / (this.cellSize * .5)));
    for (let i = 0; i <= steps; i++) {
      const px = x + dx * i / steps, pz = z + dz * i / steps, pad = radius + this.cellSize * .5;
      this.cells(px - pad, px + pad, pz - pad, pz + pad, key => this.segmentCells.get(key)?.forEach(id => ids.add(id)));
    }
    let hit: GroundCoverageHit | null = null;
    const consider = (t: number, s: Segment) => {
      if (t < -EPS || t > 1 + EPS || (hit && t >= hit.fraction)) return;
      const px = x + dx * Math.max(0, t), pz = z + dz * Math.max(0, t), q = closest(px, pz, s);
      if (q.distance > radius + 1e-6) return;
      let nx = (px - q.x) / Math.max(q.distance, EPS), nz = (pz - q.z) / Math.max(q.distance, EPS);
      if (q.distance < EPS) {
        const sl = Math.hypot(s.bx - s.ax, s.bz - s.az);
        nx = (s.az - s.bz) / sl; nz = (s.bx - s.ax) / sl;
        if (dx * nx + dz * nz > 0) { nx = -nx; nz = -nz; }
      }
      if (dx * nx + dz * nz >= -EPS) return; // Tangency and inward travel remain free.
      hit = { fraction: Math.max(0, t), normalX: nx, normalZ: nz };
    };
    for (const id of ids) {
      const s = this.segments[id], sx = s.bx - s.ax, sz = s.bz - s.az, sl = Math.hypot(sx, sz);
      const nx = -sz / sl, nz = sx / sl, d = (x - s.ax) * nx + (z - s.az) * nz, speed = dx * nx + dz * nz;
      if (Math.abs(speed) > EPS) for (const side of [-radius, radius]) {
        const t = (side - d) / speed, along = ((x + dx * t - s.ax) * sx + (z + dz * t - s.az) * sz) / (sl * sl);
        if (along >= -EPS && along <= 1 + EPS) consider(t, s);
      }
      for (const [cx, cz] of [[s.ax, s.az], [s.bx, s.bz]]) {
        const ox = x - cx, oz = z - cz, a = length * length, b = 2 * (ox * dx + oz * dz), c = ox * ox + oz * oz - radius * radius;
        const disc = b * b - 4 * a * c;
        if (disc >= 0) consider((-b - Math.sqrt(disc)) / (2 * a), s);
      }
    }
    if (hit) (hit as GroundCoverageHit).fraction *= scale;
    return hit;
  }

  nearestSupported(x: number, z: number, radius: number): GroundPoint | null {
    if (![x, z, radius].every(Number.isFinite) || radius < 0) return null;
    if (this.containsDisk(x, z, radius)) return [x, z];
    const candidates = this.segments.map(s => ({ s, q: closest(x, z, s) })).sort((a, b) => a.q.distance - b.q.distance);
    let best: GroundPoint | null = null, distance = Infinity;
    const accept = (px: number, pz: number) => {
      const d = Math.hypot(px - x, pz - z);
      if (d < distance && this.containsDisk(px, pz, radius)) { best = [px, pz]; distance = d; }
    };
    // Recovery is exceptional. Search boundary offsets and corner arcs, then return
    // a verified footprint. No candidate is returned merely because its centre is dry.
    for (const { s, q } of candidates) {
      if (q.distance > distance + radius + .05) break;
      const length = Math.hypot(s.bx - s.ax, s.bz - s.az), nx = (s.az - s.bz) / length, nz = (s.bx - s.ax) / length;
      for (const sign of [-1, 1]) accept(q.x + nx * (radius + .04) * sign, q.z + nz * (radius + .04) * sign);
      for (let i = 0; i < 32; i++) {
        const a = i * Math.PI / 16; accept(q.x + Math.cos(a) * (radius + .08), q.z + Math.sin(a) * (radius + .08));
      }
    }
    if (!best) {
      // A broad interior can be farther from every edge than a large aircraft radius.
      // Deterministic cell-centre search is a bounded recovery fallback, not per-frame work.
      const step = Math.max(1, radius * .5, (this.bounds.maxX - this.bounds.minX) / 128, (this.bounds.maxZ - this.bounds.minZ) / 128);
      for (let px = this.bounds.minX + step * .5; px < this.bounds.maxX; px += step)
        for (let pz = this.bounds.minZ + step * .5; pz < this.bounds.maxZ; pz += step) accept(px, pz);
    }
    return best;
  }
}
