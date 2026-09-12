import type { VehicleKind } from "../core/contracts";
import { VEHICLE_TUNING } from "./handling";
import { DEFORMATION_COORDINATES } from "./LatticeDeformation";

export type VectorTuple = [number, number, number];
export type QuaternionTuple = [number, number, number, number];

/** Component slots refer to the deterministic model layout for this damage schema version. */
export interface VehicleDamageState {
  schemaVersion: 1;
  /** Source topology identity. Missing only in the original procedural saves. */
  model?: string;
  panels: { slot: number; vertices: number[]; enabled: boolean }[];
  tiresDamaged: boolean[];
  windowsEnabled: boolean[];
  lightsEnabled: boolean[];
  bumpersEnabled: boolean[];
  doors?: { enabled: boolean; angle: number }[];
  /** Detailed models retain a bounded lattice instead of serializing dense mesh vertices. */
  deformation?: number[];
}

/** Flat pose fields intentionally retain compatibility with the original sandbox save format. */
export interface LegacyVehicleSnapshot {
  kind: string;
  x: number;
  y: number;
  z: number;
  heading: number;
  health: number;
  id?: string;
}
export interface SerializableVehicle extends LegacyVehicleSnapshot {
  schemaVersion: 1;
  id: string;
  kind: VehicleKind;
  rotationQuaternion: QuaternionTuple;
  linearVelocity: VectorTuple;
  angularVelocity: VectorTuple;
  engineRunning: boolean;
  siren: boolean;
  headlights?: boolean;
  paint?: string;
  rotorSpeed: number;
  appearanceSeed: number;
  damage: VehicleDamageState;
}

export interface ValidatedVehicleSnapshot {
  kind: VehicleKind;
  x: number;
  y: number;
  z: number;
  heading: number;
  health: number;
  id?: string;
  rotationQuaternion?: QuaternionTuple;
  linearVelocity: VectorTuple;
  angularVelocity: VectorTuple;
  engineRunning: boolean;
  siren: boolean;
  headlights: boolean;
  paint?: string;
  rotorSpeed: number;
  appearanceSeed?: number;
  damage?: VehicleDamageState;
}

export function validVehicleId(id: unknown): id is string {
  return (
    typeof id === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$/.test(id)
  );
}

function finite(value: unknown, label: string, limit = 1_000_000): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    Math.abs(value) > limit
  )
    throw new TypeError(`Invalid vehicle ${label}`);
  return value;
}
function vector(value: unknown, label: string, length: 3): VectorTuple;
function vector(value: unknown, label: string, length: 4): QuaternionTuple;
function vector(value: unknown, label: string, length: number): number[] {
  if (!Array.isArray(value) || value.length !== length)
    throw new TypeError(`Invalid vehicle ${label}`);
  return value.map((n) => finite(n, label, 1000));
}
function flags(value: unknown, label: string): boolean[] {
  if (
    !Array.isArray(value) ||
    value.length > 32 ||
    value.some((v) => typeof v !== "boolean")
  )
    throw new TypeError(`Invalid vehicle ${label}`);
  return [...value];
}

/** Validate and copy before replacing a live ID. Invalid saves cannot delete a living vehicle. */
export function validateVehicleSnapshot(
  value: unknown,
): ValidatedVehicleSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("Invalid vehicle snapshot");
  const s = value as Record<string, unknown>;
  if (typeof s.kind !== "string" || !Object.hasOwn(VEHICLE_TUNING, s.kind))
    throw new TypeError("Unknown vehicle kind");
  if (s.schemaVersion !== undefined && s.schemaVersion !== 1)
    throw new TypeError("Unsupported vehicle snapshot version");
  if (s.id !== undefined && !validVehicleId(s.id))
    throw new TypeError("Invalid vehicle ID");
  const health = Math.max(0, Math.min(100, finite(s.health, "health", 1000)));
  const out: ValidatedVehicleSnapshot = {
    kind: s.kind as VehicleKind,
    id: s.id as string | undefined,
    x: finite(s.x, "x"),
    y: finite(s.y, "y"),
    z: finite(s.z, "z"),
    heading: finite(s.heading ?? 0, "heading"),
    health,
    linearVelocity:
      s.linearVelocity === undefined
        ? [0, 0, 0]
        : vector(s.linearVelocity, "linear velocity", 3),
    angularVelocity:
      s.angularVelocity === undefined
        ? [0, 0, 0]
        : vector(s.angularVelocity, "angular velocity", 3),
    engineRunning:
      health > 0 &&
      (typeof s.engineRunning === "boolean" ? s.engineRunning : true),
    siren: s.siren === true,
    headlights: s.headlights !== false,
    rotorSpeed:
      s.rotorSpeed === undefined
        ? 0
        : Math.max(0, Math.min(1, finite(s.rotorSpeed, "rotor speed"))),
  };
  if (s.rotationQuaternion !== undefined) {
    const q = vector(s.rotationQuaternion, "rotation quaternion", 4),
      norm = Math.hypot(...q);
    if (norm < 1e-8) throw new TypeError("Invalid vehicle rotation quaternion");
    out.rotationQuaternion = q.map((n) => n / norm) as QuaternionTuple;
  }
  if (s.appearanceSeed !== undefined) {
    const seed = finite(s.appearanceSeed, "appearance seed", 2_147_483_647);
    if (seed < 0 || !Number.isInteger(seed))
      throw new TypeError("Invalid vehicle appearance seed");
    out.appearanceSeed = seed;
  }
  if (s.paint !== undefined) {
    if (typeof s.paint !== "string" || !/^#[0-9a-f]{6}$/i.test(s.paint)) throw new TypeError("Invalid vehicle paint");
    out.paint = s.paint.toUpperCase();
  }
  if (s.damage !== undefined) {
    if (!s.damage || typeof s.damage !== "object" || Array.isArray(s.damage))
      throw new TypeError("Invalid vehicle component damage");
    const damage = s.damage as Record<string, unknown>;
    if (
      damage.schemaVersion !== 1 ||
      !Array.isArray(damage.panels) ||
      damage.panels.length > 32
    )
      throw new TypeError("Unsupported vehicle damage layout");
    const usedSlots = new Set<number>();
    let coordinates = 0;
    const panels = damage.panels.map((entry: unknown) => {
      if (!entry || typeof entry !== "object")
        throw new TypeError("Invalid vehicle panel");
      const panel = entry as Record<string, unknown>;
      if (
        typeof panel.slot !== "number" ||
        !Number.isInteger(panel.slot) ||
        panel.slot < 0 ||
        panel.slot >= 32 ||
        usedSlots.has(panel.slot)
      )
        throw new TypeError("Invalid vehicle panel slot");
      if (
        !Array.isArray(panel.vertices) ||
        panel.vertices.length % 3 !== 0 ||
        typeof panel.enabled !== "boolean"
      )
        throw new TypeError("Invalid vehicle panel geometry");
      coordinates += panel.vertices.length;
      if (coordinates > 24_000)
        throw new TypeError("Vehicle damage snapshot exceeds geometry limit");
      usedSlots.add(panel.slot);
      return {
        slot: panel.slot,
        vertices: panel.vertices.map((n) => finite(n, "panel coordinate", 100)),
        enabled: panel.enabled,
      };
    });
    out.damage = {
      schemaVersion: 1,
      panels,
      tiresDamaged: flags(damage.tiresDamaged, "tires"),
      windowsEnabled: flags(damage.windowsEnabled, "windows"),
      lightsEnabled: flags(damage.lightsEnabled, "lights"),
      bumpersEnabled: flags(damage.bumpersEnabled, "bumpers"),
    };
    if(damage.model!==undefined){
      if(typeof damage.model!=="string"||!/^[A-Za-z0-9][A-Za-z0-9:_-]{0,95}$/.test(damage.model))throw new TypeError("Invalid vehicle damage model");
      out.damage.model=damage.model;
    }
    if (damage.doors !== undefined) {
      if (!Array.isArray(damage.doors) || damage.doors.length > 8) throw new TypeError("Invalid vehicle doors");
      out.damage.doors = damage.doors.map(entry => {
        if (!entry || typeof entry !== "object" || typeof entry.enabled !== "boolean") throw new TypeError("Invalid vehicle door");
        const angle = finite(entry.angle, "door angle", 1.2);
        if (angle < 0) throw new TypeError("Invalid vehicle door angle");
        return { enabled: entry.enabled, angle };
      });
    }
    if (damage.deformation !== undefined) {
      if (!Array.isArray(damage.deformation) || damage.deformation.length !== DEFORMATION_COORDINATES) throw new TypeError("Invalid vehicle deformation lattice");
      out.damage.deformation = damage.deformation.map(n => finite(n, "deformation offset", 0.651));
    }
  }
  return out;
}
