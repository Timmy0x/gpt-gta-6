import { COAST } from '../world/Coast';
import type { WorldBounds } from '../world/WorldBoundary';
import { inMiamiBounds } from '../world/miami/MiamiQueries';
export const playableMapPoint = (point: MapPoint, bounds: WorldBounds = COAST) => inMiamiBounds(point, bounds, 2);
export type MapPoint = { x: number; z: number };
export class MapViewport {
  bounds: WorldBounds = COAST;
  x = -350;
  z = 0;
  zoom = .32;
  fit(width: number, height: number, points: readonly MapPoint[], wholeWorld = false): void {
    const minX = wholeWorld || !points.length ? this.bounds.minX : Math.min(...points.map(p => p.x)) - 70;
    const maxX = wholeWorld || !points.length ? this.bounds.maxX : Math.max(...points.map(p => p.x)) + 70;
    const minZ = wholeWorld || !points.length ? this.bounds.minZ : Math.min(...points.map(p => p.z)) - 70;
    const maxZ = wholeWorld || !points.length ? this.bounds.maxZ : Math.max(...points.map(p => p.z)) + 70;
    this.x = (minX + maxX) / 2; this.z = (minZ + maxZ) / 2;
    this.zoom = Math.min((width - 50) / (maxX - minX), (height - 50) / (maxZ - minZ));
  }
  screen(point: MapPoint, width: number, height: number): [number, number] { return [width / 2 + (point.x - this.x) * this.zoom, height / 2 - (point.z - this.z) * this.zoom]; }
  world(x: number, y: number, width: number, height: number): MapPoint { return { x: this.x + (x - width / 2) / this.zoom, z: this.z - (y - height / 2) / this.zoom }; }
  zoomAt(factor: number, px: number, py: number, width: number, height: number): void {
    const before = this.world(px, py, width, height);
    this.zoom = Math.max(.005, Math.min(4, this.zoom * factor));
    const after = this.world(px, py, width, height);
    this.x += before.x - after.x; this.z += before.z - after.z;
    this.clamp();
  }
  pan(dx: number, dy: number): void { this.x -= dx / this.zoom; this.z += dy / this.zoom; this.clamp(); }
  private clamp(): void { this.x = Math.max(this.bounds.minX, Math.min(this.bounds.maxX, this.x)); this.z = Math.max(this.bounds.minZ, Math.min(this.bounds.maxZ, this.z)); }
}
