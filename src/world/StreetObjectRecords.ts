export type StreetObjectKind = "lamppost" | "palm";
export type StreetVector = [number, number, number];
export type StreetRotation = [number, number, number, number];
export interface StreetShape { kind: "box" | "cylinder"; position: StreetVector; rotation: StreetRotation; size: StreetVector; }
export interface StreetVisualRange {
  batch: string;
  vertexStart: number;
  vertexCount: number;
  indexStart: number;
  indexCount: number;
  emitter: boolean;
}
/** Native chunk geometry retains intact batching; ranges allow exact extraction after damage. */
export interface StreetObjectDefinition {
  id: string;
  kind: StreetObjectKind;
  position: StreetVector;
  meshes: string[];
  visuals?: StreetVisualRange[];
  shapes: StreetShape[];
  mass: number;
  health: number;
  light?: StreetVector;
}
export interface SavedStreetObject {
  id: string;
  health: number;
  burning: number;
  fallen: boolean;
  position: StreetVector;
  rotation: StreetRotation;
  velocity: StreetVector;
  angularVelocity: StreetVector;
}
export function validateStreetObjects(value: unknown): value is SavedStreetObject[] {
  if (!Array.isArray(value) || value.length > 4000) return false;
  const ids = new Set<string>();
  const vector = (v: unknown, count: number) => Array.isArray(v) && v.length === count && v.every(n => Number.isFinite(n) && Math.abs(n) < 100000);
  return value.every(s => {
    if (!s || typeof s.id !== "string" || !s.id.startsWith("street-object/") || s.id.length > 160 || ids.has(s.id)) return false;
    ids.add(s.id);
    return Number.isFinite(s.health) && s.health >= 0 && s.health <= 10000 && Number.isFinite(s.burning) && s.burning >= 0 && s.burning <= 120
      && typeof s.fallen === "boolean" && vector(s.position, 3) && vector(s.rotation, 4) && vector(s.velocity, 3) && vector(s.angularVelocity, 3)
      && Math.abs(s.rotation.reduce((n: number, v: number) => n + v * v, 0) - 1) < .02;
  });
}
