import { Quaternion } from '@babylonjs/core';
import type { DoorVisual } from './models';

/** Apply the same authored hinge to rendering, obstruction queries and saved doors. */
export function applyDoorPose(door: DoorVisual, angle: number): void {
  if (door.hingeAxis) {
    door.mesh.rotation.setAll(0);
    door.mesh.rotationQuaternion ??= Quaternion.Identity();
    Quaternion.RotationAxisToRef(door.hingeAxis, angle, door.mesh.rotationQuaternion);
  } else {
    door.mesh.rotationQuaternion = null;
    door.mesh.rotation.set(0, -door.side * angle, 0);
  }
}
