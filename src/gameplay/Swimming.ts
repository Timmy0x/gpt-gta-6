import { Vector3 } from '@babylonjs/core';
export interface SwimWater {
  surfaceHeight(x: number, z: number): number | null;
  depthAt(x: number, z: number): number;
}
/** Metre-based immersion. A bridge above the ocean is still solid walking ground. */
export class Swimming {
  active = false;
  submerged = false;
  diving = false;
  breath = 30;
  surface = 0;
  update(position: Vector3, water: SwimWater | undefined, dt: number): void {
    const level = water?.surfaceHeight(position.x, position.z);
    const depth = water?.depthAt(position.x, position.z) ?? 0;
    this.surface = level ?? 0;
    this.active = level != null && depth > (this.active ? 1.0 : 1.3) && position.y < level + (this.active ? .35 : .2);
    this.submerged = this.active && position.y + .55 < this.surface - .08;
    if (!this.active || position.y > this.surface - .5) this.diving = false;
    this.breath = this.submerged ? Math.max(0, this.breath - dt) : Math.min(30, this.breath + dt * 8);
  }
  verticalVelocity(position: Vector3, previousY: number, forward: number, pitch: number, ascend: boolean, descend: boolean, dt: number): number {
    if (descend) this.diving = true;
    if (ascend) return 2.2;
    if (descend) return -1.8;
    if (this.diving) {
      const target = -forward * Math.sin(pitch) * 2.2;
      return previousY + (target - previousY) * Math.min(1, dt * 5);
    }
    return Math.max(-1.6, Math.min(1.6, (this.surface - .45 - position.y) * 3));
  }
}
