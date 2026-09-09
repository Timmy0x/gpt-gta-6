import type { VehicleKind } from "../core/contracts";

/** Project-authored tuning. SI units; these are not claimed Rockstar specifications. */
export interface VehicleTuning {
  label: string;
  mass: number;
  width: number;
  length: number;
  height: number;
  wheelbase: number;
  wheelRadius: number;
  engineForce: number;
  topSpeed: number;
  grip: number;
  steering: number;
  suspensionTravel: number;
  suspensionCompression: number;
}
export const VEHICLE_TUNING: Record<VehicleKind, VehicleTuning> = {
  coupe: {
    label: "Cobalt GT",
    mass: 1420,
    width: 1.88,
    length: 4.42,
    height: 0.58,
    wheelbase: 2.72,
    wheelRadius: 0.34,
    engineForce: 12500,
    topSpeed: 62,
    grip: 1.32,
    steering: 0.5,
    suspensionTravel: 0.57,
    suspensionCompression: 0.17,
  },
  sedan: {
    label: "Palmetto Sedan",
    mass: 1680,
    width: 1.87,
    length: 4.82,
    height: 0.63,
    wheelbase: 2.9,
    wheelRadius: 0.35,
    engineForce: 9600,
    topSpeed: 48,
    grip: 1.16,
    steering: 0.52,
    suspensionTravel: 0.59,
    suspensionCompression: 0.18,
  },
  police: {
    label: "VCPD Interceptor",
    mass: 1860,
    width: 1.95,
    length: 4.96,
    height: 0.63,
    wheelbase: 2.95,
    wheelRadius: 0.36,
    engineForce: 13400,
    topSpeed: 56,
    grip: 1.3,
    steering: 0.53,
    suspensionTravel: 0.59,
    suspensionCompression: 0.18,
  },
  suv: {
    label: "Trailmaster 4×4",
    mass: 2260,
    width: 2.05,
    length: 4.9,
    height: 0.88,
    wheelbase: 2.94,
    wheelRadius: 0.43,
    engineForce: 12500,
    topSpeed: 42,
    grip: 1.0,
    steering: 0.49,
    suspensionTravel: 0.67,
    suspensionCompression: 0.21,
  },
  truck: {
    label: "Gellhorn Pickup",
    mass: 2680,
    width: 2.13,
    length: 5.88,
    height: 0.85,
    wheelbase: 3.5,
    wheelRadius: 0.44,
    engineForce: 13700,
    topSpeed: 40,
    grip: 0.95,
    steering: 0.46,
    suspensionTravel: 0.68,
    suspensionCompression: 0.22,
  },
  motorcycle: {
    label: "Coastal 750",
    mass: 310,
    width: 0.74,
    length: 2.24,
    height: 0.45,
    wheelbase: 1.48,
    wheelRadius: 0.34,
    engineForce: 3000,
    topSpeed: 55,
    grip: 1.1,
    steering: 0.46,
    suspensionTravel: 0.54,
    suspensionCompression: 0.16,
  },
  boat: {
    label: "Keys Runabout",
    mass: 1650,
    width: 2.38,
    length: 6.1,
    height: 0.8,
    wheelbase: 3.7,
    wheelRadius: 0.3,
    engineForce: 14000,
    topSpeed: 34,
    grip: 0.75,
    steering: 0.6,
    suspensionTravel: 0.5,
    suspensionCompression: 0.2,
  },
  helicopter: {
    label: "Mistral Helicopter",
    mass: 2200,
    width: 2,
    length: 7.2,
    height: 1.35,
    wheelbase: 3,
    wheelRadius: 0.3,
    engineForce: 21000,
    topSpeed: 62,
    grip: 0.8,
    steering: 0.6,
    suspensionTravel: 0.5,
    suspensionCompression: 0.2,
  },
  plane: {
    label: "Pelican Trainer",
    mass: 1250,
    width: 1.4,
    length: 7.8,
    height: 1.05,
    wheelbase: 3.2,
    wheelRadius: 0.3,
    engineForce: 6800,
    topSpeed: 78,
    grip: 1,
    steering: 0.38,
    suspensionTravel: 0.52,
    suspensionCompression: 0.15,
  },
  concept: {
    label: "Aster Concept",
    mass: 1630,
    width: 2.23,
    length: 4.61,
    height: 0.54,
    wheelbase: 2.8,
    wheelRadius: 0.384,
    engineForce: 15800,
    topSpeed: 66,
    grip: 1.38,
    steering: 0.48,
    suspensionTravel: 0.55,
    suspensionCompression: 0.2,
  },
};

export const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

/** Engine tapers naturally; reverse is deliberately limited to a parking speed. */
export function driveForce(
  throttle: number,
  forwardSpeed: number,
  tuning: VehicleTuning,
  health: number,
): number {
  const limit = throttle < 0 ? 10 : tuning.topSpeed;
  const taper = clamp(
    1 - Math.pow(Math.max(0, forwardSpeed * Math.sign(throttle)) / limit, 2),
    0,
    1,
  );
  if (taper === 0 || throttle === 0) return 0;
  return (
    clamp(throttle, -1, 1) *
    tuning.engineForce *
    taper *
    clamp(health / 70, 0.08, 1)
  );
}

/** Lateral + longitudinal demands share the same tire friction circle. */
export function frictionCircle(
  lateral: number,
  longitudinal: number,
  normalForce: number,
  grip: number,
): [number, number] {
  const magnitude = Math.hypot(lateral, longitudinal),
    limit = Math.max(0, normalForce * grip);
  const scale = magnitude > limit ? limit / Math.max(magnitude, 1) : 1;
  return [lateral * scale, longitudinal * scale];
}

export function suspensionForce(
  compression: number,
  verticalSpeed: number,
  mass: number,
  wheels: number,
  tuning: VehicleTuning,
): number {
  const spring = (mass * 9.81) / (wheels * tuning.suspensionCompression);
  const damper = 2 * Math.sqrt((spring * mass) / wheels) * 0.7;
  return clamp(
    compression * spring - verticalSpeed * damper,
    0,
    mass * 9.81 * 1.3,
  );
}

/** Impulse/mass is collision Δv; a 2 m/s parking bump is below damage threshold. */
export function impactDamage(deltaVelocity: number): number {
  return clamp(Math.max(0, deltaVelocity - 2.2) ** 1.35 * 1.7, 0, 75);
}

/** Trainer wing lift fades beyond 17° angle of attack and collapses at 34°. */
export function liftCoefficient(angleOfAttack: number): number {
  const a = Math.abs(angleOfAttack),
    stall = clamp((0.6 - a) / 0.3, 0, 1);
  return clamp(0.24 + angleOfAttack * 4.1, -1.2, 1.45) * stall;
}
