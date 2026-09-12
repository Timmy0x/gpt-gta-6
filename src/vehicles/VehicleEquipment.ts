import { Color3, SpotLight, Vector3, type Scene } from "@babylonjs/core";
import type { Vehicle } from "./VehicleSystem";
import type { DoorVisual } from "./models";
import { applyDoorPose } from './DoorPose';

/** Entry and exit open the nearest front door; its spring closes it after the animation. */
export function openVehicleDoor(v: Vehicle, side: number, seconds = 0.85): void {
  const door = v.model.doors.find(d => d.front && d.side === side);
  if (door?.mesh.isEnabled()) door.hold = Math.max(door.hold, seconds);
}

/** A fixed pool of four road beams prevents traffic density from growing the light budget. */
export class VehicleEquipment {
  readonly beams: SpotLight[];
  private elapsed = 0;
  constructor(scene: Scene, private limitDoorAngle?: (vehicle: Vehicle, door: DoorVisual, angle: number) => number) {
    this.beams = Array.from({ length: 4 }, (_, i) => {
      const light = new SpotLight(`vehicle-beam-${i}`, Vector3.Zero(), Vector3.Forward(), 0.58, 2, scene);
      light.diffuse = new Color3(0.95, 0.96, 1);
      light.specular = new Color3(0.7, 0.75, 0.85);
      light.range = 48;
      light.intensity = 0;
      light.setEnabled(false);
      return light;
    });
  }
  update(dt: number, vehicles: readonly Vehicle[], focus: Vector3): void {
    this.elapsed += dt;
    for (const v of vehicles) {
      for (const door of v.model.doors) {
        door.hold = Math.max(0, door.hold - dt);
        const target = door.hold > 0 && v.speed < 5 ? door.maxAngle ?? 1.12 : 0;
        const change = Math.max(-dt * 3.8, Math.min(dt * 3.8, target - door.angle));
        door.angle = this.limitDoorAngle?.(v, door, door.angle + change) ?? door.angle + change;
        applyDoorPose(door, door.angle);
      }
      for (const mat of v.model.materials) {
        if (mat.name.startsWith("headlight-")) mat.emissiveColor.setAll(v.headlights && v.health > 0 ? 1.8 : 0.01);
        if (mat.name.startsWith("taillight-")) mat.emissiveColor.set(v.input.brake > 0.1 || v.input.handbrake ? 2.3 : v.headlights && v.health > 0 ? 0.45 : 0.015, 0.003, 0.006);
        const red = mat.name.startsWith("police-red-"), blue = mat.name.startsWith("police-blue-");
        if (red || blue) {
          const pulse = v.siren && v.health > 0 && (Math.floor(this.elapsed * 8) % 2 === (red ? 0 : 1));
          mat.emissiveColor.copyFrom(red ? new Color3(pulse ? 3 : 0.025, 0.002, 0.004) : new Color3(0.002, 0.007, pulse ? 3 : 0.025));
        }
      }
    }
    const candidates = vehicles.filter(v => v.root.isEnabled() && v.headlights && v.health > 0 && Vector3.DistanceSquared(v.root.position, focus) < 110 ** 2)
      .sort((a, b) => Number(b.occupied) - Number(a.occupied) || Vector3.DistanceSquared(a.root.position, focus) - Vector3.DistanceSquared(b.root.position, focus));
    let slot = 0;
    for (const v of candidates) {
      for (const lamp of v.model.lights.filter(m => m.name.startsWith("headlight-") && m.isEnabled())) {
        if (slot >= this.beams.length) break;
        const beam = this.beams[slot++];
        beam.position.copyFrom(lamp.getAbsolutePosition()).addInPlace(v.root.forward.scale(0.07));
        beam.direction.copyFrom(v.root.getDirection(new Vector3(0, -0.065, 1)).normalize());
        beam.intensity = 85;
        beam.setEnabled(true);
      }
      if (slot >= this.beams.length) break;
    }
    for (; slot < this.beams.length; slot++) { this.beams[slot].intensity = 0; this.beams[slot].setEnabled(false); }
  }
  dispose(): void { for (const beam of this.beams) beam.dispose(); }
}
