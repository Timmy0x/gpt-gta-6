export const clamp = (v: number, min: number, max: number) =>
  Math.max(min, Math.min(max, v));
export const angleDelta = (from: number, to: number) =>
  Math.atan2(Math.sin(to - from), Math.cos(to - from));
export function random(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export interface Point2 {
  x: number;
  z: number;
}
export function distance(a: Point2, b: Point2) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}
export function lineBlocked(
  a: Point2,
  b: Point2,
  boxes: { x: number; z: number; w: number; d: number }[],
) {
  return boxes.some((o) => {
    let lo = 0,
      hi = 1;
    for (const [start, delta, min, max] of [
      [a.x, b.x - a.x, o.x - o.w / 2, o.x + o.w / 2],
      [a.z, b.z - a.z, o.z - o.d / 2, o.z + o.d / 2],
    ]) {
      if (Math.abs(delta) < 1e-8) {
        if (start < min || start > max) return false;
      } else {
        let t1 = (min - start) / delta,
          t2 = (max - start) / delta;
        if (t1 > t2) [t1, t2] = [t2, t1];
        lo = Math.max(lo, t1);
        hi = Math.min(hi, t2);
        if (lo > hi) return false;
      }
    }
    return hi > 0.01 && lo < 0.99;
  });
}
