import { angleDelta, clamp } from "../core/math";

// Authored handling values: turn the body before firing, never shoot behind it.
export const WEAPON_TURN_RATE = 10;
export const WEAPON_FIRE_CONE = Math.PI / 12;
export const WEAPON_ARM_CONE = Math.PI / 3;
export function turnWeaponHeading(heading: number, target: number, dt: number): number {
  const limit = WEAPON_TURN_RATE * Math.max(0, dt);
  return heading + clamp(angleDelta(heading, target), -limit, limit);
}
