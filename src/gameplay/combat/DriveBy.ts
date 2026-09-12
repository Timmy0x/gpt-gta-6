import { Matrix, Vector3, type Mesh } from '@babylonjs/core';
import type { Player } from '../Player';
import type { Vehicle } from '../../vehicles/VehicleSystem';
import { vehicleSeatOffset } from '../VehicleOccupancy';
import { aimWeaponHand } from './WeaponPose';
type WindowState = { mesh: Mesh; rest: Vector3; travel: number; opening: Vector3; amount: number };

/** Driver-side windows lower inside the door; broken glass is never restored. */
export class DriveBy {
  private windows = new Map<Vehicle, WindowState[]>();
  ready = false;
  active = false;
  private blend = 0;
  supports(vehicle: Vehicle) { return vehicle.model.doors.some(d => d.front && d.side === -1); }
  update(player: Player, requested: boolean, dt: number) {
    const vehicle = player.vehicle;
    this.active = !!vehicle && !player.transitioning && requested && this.supports(vehicle);
    this.blend += (Number(this.active) - this.blend) * Math.min(1, dt * 7);
    if (vehicle && this.active && !this.windows.has(vehicle)) {
      const door = vehicle.model.doors.find(d => d.front && d.side === -1)!;
      const inverse = Matrix.Invert(vehicle.root.computeWorldMatrix(true));
      const meshes = vehicle.model.windows.filter(m => m.isDescendantOf(door.mesh));
      this.windows.set(vehicle, meshes.map(mesh => {
        mesh.computeWorldMatrix(true);
        const bounds = mesh.getBoundingInfo().boundingBox;
        return {mesh, rest: mesh.position.clone(), travel: (bounds.maximumWorld.y - bounds.minimumWorld.y) * 1.08, opening: Vector3.TransformCoordinates(bounds.centerWorld, inverse), amount: 0};
      }));
    }
    for (const [car, windows] of this.windows) {
      if (car.root.isDisposed()) { this.windows.delete(car); continue; }
      for (const window of windows) {
        window.amount += Math.max(-dt * 2.2, Math.min(dt * 2.2, Number(car === vehicle && this.active) - window.amount));
        if (!window.mesh.isDisposed()) { window.mesh.position.copyFrom(window.rest); window.mesh.position.y -= window.travel * window.amount; }
      }
      if (car !== vehicle && windows.every(w => w.amount === 0)) this.windows.delete(car);
    }
    this.ready = false;
  }
  pose(player: Player): boolean {
    const vehicle = player.vehicle;
    if (!vehicle || player.transitioning) { this.ready = false; return false; }
    player.model.root.position.x = vehicleSeatOffset(vehicle).x - this.blend * .17;
    if (!this.active) { this.ready = false; return false; }
    const windows = this.windows.get(vehicle) ?? [];
    const window = windows[0]; if (!window) return false;
    const direction = player.camera.getForwardRay().direction;
    const local = Vector3.TransformNormal(direction, Matrix.Invert(vehicle.root.computeWorldMatrix(true))).normalize();
    // Across the bonnet/roof or through the passenger compartment is not a clear window shot.
    const outward = local.x < -.2 && Math.abs(local.y) < .6;
    player.model.root.computeWorldMatrix(true);
    const wrist = window.opening.clone(); wrist.x = -vehicle.tuning.width / 2 - .025; wrist.y -= .02;
    const target = Vector3.TransformCoordinates(wrist, vehicle.root.getWorldMatrix());
    player.model.reachHand(-1, target, this.blend);
    aimWeaponHand(player.model, -1, direction);
    const gap = Vector3.Distance(player.model.jointPosition('leftHand'), target);
    this.ready = outward && this.blend > .95 && (window.amount > .95 || !window.mesh.isEnabled()) && gap < .12;
    return this.ready;
  }
  dispose() { for (const windows of this.windows.values()) for (const w of windows) if (!w.mesh.isDisposed()) w.mesh.position.copyFrom(w.rest); this.windows.clear(); }
}
