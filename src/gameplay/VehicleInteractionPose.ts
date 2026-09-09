import { Vector3 } from '@babylonjs/core';
import type { Character } from './Character';
import type { SeatPose, TrafficOccupant } from './VehicleOccupancy';
import type { Vehicle } from '../vehicles/VehicleSystem';

export type InteractionPhase = 'approaching' | 'ejecting-driver' | 'entering' | 'exiting';
const bounded = (value: number) => Math.max(0, Math.min(1, value));
export const interactionEase = (value: number) => { const t = bounded(value); return t * t * (3 - 2 * t); };
const window = (progress: number, begin: number, end: number) => interactionEase((progress - begin) / (end - begin));
const headingMix = (from: number, to: number, amount: number) => from + Math.atan2(Math.sin(to - from), Math.cos(to - from)) * amount;
function foot(base: Vector3, heading: number, side: -1 | 1, stride = 0): Vector3 {
  return base.add(new Vector3(Math.cos(heading) * side * .14 + Math.sin(heading) * stride, .13, -Math.sin(heading) * side * .14 + Math.cos(heading) * stride));
}

/** Read the moving handle geometry; integral handles use a point on the actual door skin. */
export function vehicleDoorContact(vehicle: Vehicle, side: -1 | 1): Vector3 | null {
  const door = vehicle.model.doors.find(candidate => candidate.front && candidate.side === side && candidate.mesh.isEnabled());
  if (!door) return null;
  const handle = door.mesh.getChildMeshes().find(mesh => /handle/i.test(mesh.name) && mesh.isEnabled());
  if (handle) { handle.computeWorldMatrix(true); return handle.getBoundingInfo().boundingBox.centerWorld.clone(); }
  const bounds = door.mesh.getBoundingInfo().boundingBox;
  const point = new Vector3((bounds.minimum.x + bounds.maximum.x) / 2, bounds.minimum.y + (bounds.maximum.y - bounds.minimum.y) * .70, bounds.minimum.z + (bounds.maximum.z - bounds.minimum.z) * .25);
  return Vector3.TransformCoordinates(point, door.mesh.computeWorldMatrix(true));
}

/** Root motion stays between validated endpoints; hips lower only after clearing the sill. */
export function vehicleMountPosition(from: Vector3, to: Vector3, progress: number): Vector3 {
  const horizontal = window(progress, .08, .93), vertical = window(progress, .24, 1);
  return new Vector3(from.x + (to.x - from.x) * horizontal, from.y + (to.y - from.y) * vertical, from.z + (to.z - from.z) * horizontal);
}

export function poseVehicleEntrant(model: Character, vehicle: Vehicle, phase: InteractionPhase, progress: number, start: Vector3, doorway: Vector3, destination: Vector3, side: -1 | 1, seating: SeatPose, victim?: Character): void {
  if (model.dead || model.root.metadata?.ragdollActive) return;
  const p = bounded(progress), inward = vehicle.heading - side * Math.PI / 2;
  const handle = vehicleDoorContact(vehicle, side);
  if (phase === 'approaching') {
    model.root.position.copyFrom(Vector3.Lerp(start, doorway, interactionEase(p)));
    model.root.rotation.y = headingMix(vehicle.heading, inward, interactionEase(p));
    model.pose('mount', 0, seating);
    model.interactionPosture(.035 * p, .10 * p);
    if (handle) model.reachHand(side, handle, window(p, .3, .9));
    return;
  }
  if (phase === 'ejecting-driver') {
    const pull = window(p, .18, .75), release = 1 - window(p, .69, .91);
    const brace = window(p, 0, .13);
    model.root.position.copyFrom(doorway).addInPlace(vehicle.root.forward.scale(-.43 * pull * release));
    const shoulder = victim?.jointPosition('leftArm', new Vector3(-.04, -.025, .025));
    const forearm = victim?.jointPosition('leftForearm', new Vector3(-.025, -.03, .015));
    const facing = shoulder ? Math.atan2(shoulder.x - model.root.position.x, shoulder.z - model.root.position.z) : inward;
    model.root.rotation.y = headingMix(inward, facing, brace * release);
    model.pose('mount', 0, seating);
    const lowSeat = seating === 'reclined';
    model.interactionPosture((.035 + ((lowSeat ? .32 : .24) - .035) * brace) * release, (.1 + ((lowSeat ? .78 : .58) * (1 - pull) - .12 * pull - .1) * brace) * release, 0, (lowSeat ? .25 : .20) * brace * release);
    const backStep = window(p, .25, .58) * release;
    const rearFoot = foot(doorway, inward, -1, -.12).addInPlace(vehicle.root.forward.scale(-.20 * backStep));
    rearFoot.y += .055 * Math.sin(Math.PI * backStep);
    // Blend the step target, never the support solve: blending IK off while the
    // pelvis is still low would sink the visual shoe below the street.
    const neutralLeft = foot(doorway, inward, -1, .005), neutralRight = foot(doorway, inward, 1, .005);
    model.plantFoot(-1, Vector3.Lerp(neutralLeft, rearFoot, brace * release), 1);
    model.plantFoot(1, Vector3.Lerp(neutralRight, foot(doorway, inward, 1, .13), brace * release), 1);
    if (shoulder && forearm && release > 0) {
      const contact = window(p, 0, .13) * release;
      model.reachHand(1, shoulder, contact);
      model.reachHand(-1, forearm, contact);
    }
    return;
  }
  const entering = phase === 'entering';
  const mount = entering ? p : 1 - p;
  const ground = entering ? doorway : destination;
  model.root.position.copyFrom(entering ? vehicleMountPosition(start, destination, p) : vehicleMountPosition(destination, start, 1 - p));
  model.root.rotation.y = entering ? headingMix(inward, vehicle.heading, window(p, 0, .72)) : headingMix(vehicle.heading, inward, window(p, .18, 1));
  model.pose('mount', window(mount, .04, 1), seating);
  const duck = Math.sin(Math.PI * mount);
  // Retain the exact seated profile at both ends; the overlay is only active at the doorway.
  if (duck > 1e-4) {
    const seatedLean = seating === 'reclined' ? -.38 : .1;
    model.interactionPosture(.065 * duck, seatedLean * mount + .30 * duck, -side * .08 * duck);
  }
  const outerFoot = entering ? 1 - window(p, .28, .65) : window(p, .38, .83);
  model.plantFoot(side, foot(ground, inward, side, -.10), outerFoot);
  if (handle) model.reachHand(side, handle, duck * .85);
}

/** Turn and clear the seat first, then recover on two staggered planted steps. */
export function poseVehicleWithdrawal(occupant: TrafficOccupant, progress: number, seating: SeatPose): void {
  const { model, vehicle, start, destination } = occupant;
  if (!start || !destination || model.dead || model.root.metadata?.ragdollActive) return;
  const p = bounded(progress), travel = window(p, .15, .88), stand = window(p, .24, .94);
  model.root.position.copyFrom(Vector3.Lerp(start, destination, travel));
  // Small rearward arc sends the knees through the open doorway before the hips rise.
  model.root.position.addInPlace(vehicle.root.forward.scale(-.12 * Math.sin(Math.PI * travel)));
  model.root.rotation.y = vehicle.heading - Math.PI / 2 * window(p, .02, .67);
  model.pose('mount', 1 - stand, seating);
  const stumble = Math.sin(Math.PI * window(p, .54, 1));
  if (stand > 0) model.interactionPosture(.09 * stumble, (seating === 'reclined' ? -.38 : .1) * (1 - stand) + .24 * stumble, -.18 * (1 - stand));
  const exitHeading = vehicle.heading - Math.PI / 2;
  model.plantFoot(-1, foot(destination, exitHeading, -1, -.12), window(p, .51, .69));
  model.plantFoot(1, foot(destination, exitHeading, 1, .11), window(p, .73, .96));
}
