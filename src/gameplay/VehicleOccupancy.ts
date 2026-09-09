import { Vector3 } from '@babylonjs/core';
import type { Character } from './Character';
import type { Vehicle } from '../vehicles/VehicleSystem';

export type SeatPose = 'low' | 'upright' | 'rider' | 'reclined';
export const EJECTION_SECONDS = .78;

/** Shared by the player and civilian crew, including each authored model's seat. */
export function vehicleSeatOffset(v: Vehicle): Vector3 {
  if (v.model.seat) return v.model.seat.clone();
  if (v.kind === 'motorcycle') return new Vector3(0, -.7, -.18);
  if (v.kind === 'boat') return new Vector3(-.42, -.3, -.28);
  if (v.kind === 'plane') return new Vector3(-v.tuning.width * .21, -.78, -.03);
  if (v.kind === 'helicopter') return new Vector3(-v.tuning.width * .21, -.8, .55);
  return new Vector3(-v.tuning.width * .21,
    ['suv', 'truck'].includes(v.kind) ? -.7 : ['coupe', 'sedan', 'police'].includes(v.kind) ? -.92 : -.65, -.03);
}

export function vehicleSeatPose(v: Vehicle): SeatPose {
  return v.kind === 'motorcycle' ? 'rider' : v.kind === 'concept' ? 'reclined'
    : ['coupe', 'sedan', 'police', 'boat'].includes(v.kind) ? 'low' : 'upright';
}

export function parkedVehicleInput(v: Vehicle) {
  return { throttle: 0, steer: 0, brake: 1, handbrake: !['boat', 'plane', 'helicopter'].includes(v.kind), lift: 0 };
}

export interface TrafficOccupant {
  vehicle: Vehicle;
  model: Character;
  alive: () => boolean;
  onEjected: (position: Vector3) => void;
  state: 'driving' | 'ejecting';
  elapsed: number;
  panic: number;
  destination?: Vector3;
  start?: Vector3;
}

/** Civilian actors stay in world coordinates so combat hits and ragdolls remain correct. */
export class VehicleOccupancy {
  private readonly occupants = new Map<Vehicle, TrafficOccupant>();

  register(vehicle: Vehicle, model: Character, alive: () => boolean, onEjected: TrafficOccupant['onEjected']) {
    if (this.occupants.has(vehicle)) throw new Error('Vehicle already has a civilian driver');
    const occupant: TrafficOccupant = { vehicle, model, alive, onEjected, state: 'driving', elapsed: 0, panic: 0 };
    this.occupants.set(vehicle, occupant);
    this.seat(occupant, 0);
    // Reveal the actual driver through this instance's glazing without changing shared materials.
    for (const window of vehicle.model.windows) window.visibility = .42;
    return occupant;
  }

  get(vehicle: Vehicle) { return this.occupants.get(vehicle); }
  canDrive(vehicle: Vehicle) {
    const occupant = this.get(vehicle);
    return !!occupant && occupant.state === 'driving' && occupant.alive() && !occupant.model.root.metadata?.ragdollActive;
  }
  forget(vehicle: Vehicle) { this.occupants.delete(vehicle); }

  beginEjection(vehicle: Vehicle, destination: Vector3): boolean {
    const occupant = this.get(vehicle);
    if (!occupant || occupant.state !== 'driving') return false;
    occupant.state = 'ejecting';
    occupant.elapsed = 0;
    occupant.start = occupant.model.root.position.clone();
    occupant.destination = destination.clone();
    occupant.model.root.rotationQuaternion = null;
    vehicle.input = parkedVehicleInput(vehicle);
    return true;
  }

  frighten(position: Vector3, range = 38) {
    for (const occupant of this.occupants.values())
      if (Vector3.Distance(occupant.vehicle.root.position, position) < range) occupant.panic = 8;
  }

  update(dt: number) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    for (const occupant of this.occupants.values()) {
      const { vehicle, model } = occupant;
      occupant.panic = Math.max(0, occupant.panic - dt);
      if (vehicle.root.isDisposed()) { this.occupants.delete(vehicle); continue; }
      if (!occupant.alive() || model.root.metadata?.ragdollActive) {
        vehicle.input = parkedVehicleInput(vehicle);
        // The injury system owns the actor's pose; never re-seat an incapacitated body.
        if (occupant.state === 'ejecting') {
          this.occupants.delete(vehicle);
          occupant.onEjected(model.root.position.clone());
        }
        continue;
      }
      if (occupant.state === 'driving') { this.seat(occupant, dt); continue; }
      occupant.elapsed = Math.min(EJECTION_SECONDS, occupant.elapsed + dt);
      const progress = occupant.elapsed / EJECTION_SECONDS;
      const t = progress * progress * (3 - 2 * progress);
      model.root.position.copyFrom(Vector3.Lerp(occupant.start!, occupant.destination!, t));
      model.root.rotation.y = vehicle.heading - Math.PI / 2 * Math.min(1, progress * 2);
      model.animate(dt, 0);
      model.pose('mount', 1 - progress, vehicleSeatPose(vehicle));
      if (progress >= 1) {
        this.occupants.delete(vehicle);
        occupant.onEjected(occupant.destination!.clone());
      }
    }
  }

  private seat(occupant: TrafficOccupant, dt: number) {
    const { vehicle, model } = occupant;
    vehicle.root.computeWorldMatrix(true);
    model.root.position.copyFrom(Vector3.TransformCoordinates(vehicleSeatOffset(vehicle), vehicle.root.getWorldMatrix()));
    model.root.rotation.y = vehicle.heading;
    if (vehicle.root.rotationQuaternion) {
      model.root.rotationQuaternion ??= vehicle.root.rotationQuaternion.clone();
      model.root.rotationQuaternion.copyFrom(vehicle.root.rotationQuaternion);
    } else model.root.rotationQuaternion = null;
    model.animate(dt, 0);
    model.pose('seated', 1, vehicleSeatPose(vehicle));
  }
}
