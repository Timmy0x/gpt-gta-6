import { Vector3 } from '@babylonjs/core';
import type { Character } from './Character';
import type { SeatPose, TrafficOccupant } from './VehicleOccupancy';
import type { Vehicle } from '../vehicles/VehicleSystem';

export type InteractionPhase = 'approaching' | 'ejecting-driver' | 'entering' | 'exiting';
export const VEHICLE_INTERACTION_TIMING = { approach: .46, ejection: 1.18, handoff: .12, enter: 1.02, exit: 1.0, doorReach: .23 } as const;
const bounded = (value: number) => Math.max(0, Math.min(1, value));
export const interactionEase = (value: number) => { const t = bounded(value); return t * t * (3 - 2 * t); };
const window = (progress: number, begin: number, end: number) => interactionEase((progress - begin) / (end - begin));
const headingMix = (from: number, to: number, amount: number) => from + Math.atan2(Math.sin(to - from), Math.cos(to - from)) * amount;
function foot(base: Vector3, heading: number, side: -1 | 1, stride = 0): Vector3 {
  return base.add(new Vector3(Math.cos(heading) * side * .14 + Math.sin(heading) * stride, .13, -Math.sin(heading) * side * .14 + Math.cos(heading) * stride));
}

/** Read the moving handle geometry; integral handles use a point on the actual door skin. */
export function vehicleDoorContact(vehicle: Vehicle, side: -1 | 1, inside = false): Vector3 | null {
  const door = vehicle.model.doors.find(candidate => candidate.front && candidate.side === side && candidate.mesh.isEnabled());
  if (!door) return null;
  const handle = door.mesh.getChildMeshes().find(mesh => /handle/i.test(mesh.name) && mesh.isEnabled());
  if (handle && !inside) { handle.computeWorldMatrix(true); return handle.getBoundingInfo().boundingBox.centerWorld.clone(); }
  const bounds = door.mesh.getBoundingInfo().boundingBox;
  // A contact is on the panel surface, never at the centre of its solid thickness.
  const face = inside ? -side : side;
  const point = new Vector3(face < 0 ? bounds.minimum.x - .025 : bounds.maximum.x + .025, bounds.minimum.y + (bounds.maximum.y - bounds.minimum.y) * .70, bounds.minimum.z + (bounds.maximum.z - bounds.minimum.z) * .25);
  return Vector3.TransformCoordinates(point, door.mesh.computeWorldMatrix(true));
}

function doorNormal(vehicle: Vehicle, side: -1 | 1, inside: boolean): Vector3 {
  const door = vehicle.model.doors.find(candidate => candidate.front && candidate.side === side);
  return door ? Vector3.TransformNormal(new Vector3(inside ? -side : side, 0, 0), door.mesh.computeWorldMatrix(true)).normalize() : vehicle.root.right.scale(inside ? -side : side);
}

function track(progress: number, keys: [number, Vector3][]): Vector3 {
  for (let index = 1; index < keys.length; index++) {
    if (progress <= keys[index][0]) return Vector3.Lerp(keys[index - 1][1], keys[index][1], window(progress, keys[index - 1][0], keys[index][0]));
  }
  return keys.at(-1)![1].clone();
}

function local(vehicle: Vehicle, origin: Vector3, x: number, y: number, z: number): Vector3 {
  return origin.add(vehicle.root.right.scale(x)).addInPlace(vehicle.root.forward.scale(z)).addInPlaceFromFloats(0, y, 0);
}

/** Sample the actual seated rig before posing the frame, retaining the established cockpit fit. */
function seatedFeet(model: Character, seat: Vector3, vehicle: Vehicle, seating: SeatPose): [Vector3, Vector3] {
  const position = model.root.position.clone(), yaw = model.root.rotation.y;
  model.root.position.copyFrom(seat); model.root.rotation.y = vehicle.heading;
  model.interactionPosture(0, seating === 'reclined' ? -.38 : .1); model.pose('seated', 1, seating);
  const result: [Vector3, Vector3] = [model.jointPosition('leftFoot'), model.jointPosition('rightFoot')];
  model.root.position.copyFrom(position); model.root.rotation.y = yaw;
  return result;
}

/** Root motion stays between validated endpoints; hips lower only after clearing the sill. */
export function vehicleMountPosition(from: Vector3, to: Vector3, progress: number): Vector3 {
  const horizontal = window(progress, .08, .93), vertical = window(progress, .24, 1);
  return new Vector3(from.x + (to.x - from.x) * horizontal, from.y + (to.y - from.y) * vertical, from.z + (to.z - from.z) * horizontal);
}

export function poseVehicleEntrant(model: Character, vehicle: Vehicle, phase: InteractionPhase, progress: number, start: Vector3, doorway: Vector3, destination: Vector3, side: -1 | 1, seating: SeatPose, victim?: Character, startHeading = vehicle.heading): void {
  if (model.dead || model.root.metadata?.ragdollActive) return;
  const p = bounded(progress), inward = vehicle.heading - side * Math.PI / 2;
  const handle = vehicleDoorContact(vehicle, side, phase === 'exiting');
  if (phase === 'approaching') {
    const move = window(p, 0, .64);
    model.root.position.copyFrom(Vector3.Lerp(start, doorway, move));
    model.root.rotation.y = headingMix(startHeading, inward, window(p, 0, .6));
    model.pose('mount', 0, seating); model.interactionPosture(.025 * window(p, .4, .75), .08 * window(p, .4, .75));
    // One step onto the outside support foot, then bring the trailing foot alongside.
    for (const footSide of [-1, 1] as const) {
      const lift = Math.sin(Math.PI * window(p, footSide < 0 ? 0 : .25, footSide < 0 ? .5 : .72));
      const target = Vector3.Lerp(foot(start, inward, footSide, 0), foot(doorway, inward, footSide, 0), window(p, footSide < 0 ? 0 : .25, footSide < 0 ? .5 : .72));
      target.y += .09 * Math.max(0, lift); model.plantFoot(footSide, target);
    }
    if (handle) model.touchSurface(side, handle, doorNormal(vehicle, side, false), window(p, .12, .50));
    return;
  }
  if (phase === 'ejecting-driver') {
    const brace = window(p, 0, .18), pull = window(p, .20, .65), release = 1 - window(p, .60, .78), returnToDoor = window(p, .80, 1);
    const retreat = local(vehicle, doorway, side * 0.55 * pull * (1 - returnToDoor), 0, -0.1 * pull * (1 - returnToDoor));
    model.root.position.copyFrom(retreat);
    model.root.rotation.y = inward;
    model.pose('mount', 0, seating);
    const low = seating === 'reclined';
    model.interactionPosture((low ? .30 : .22) * brace * (1 - returnToDoor), ((low ? .90 : .57) * (1 - pull) - 0.24 * pull) * brace * release, side * .08 * pull * (1 - returnToDoor), .20 * brace * (1 - pull));
    // Feet retreat with two distinct planted steps. They never cross each other.
    for (const footSide of [-1, 1] as const) {
      const step = window(p, footSide < 0 ? .19 : .39, footSide < 0 ? .43 : .65);
      const home = foot(doorway, inward, footSide, footSide < 0 ? -.10 : .13);
      const back = local(vehicle, home, side * 0.55, 0, -0.1);
      const target = Vector3.Lerp(home, back, step * (1 - returnToDoor));
      target.y += .075 * Math.sin(Math.PI * step) * (1 - returnToDoor) + .065 * Math.sin(Math.PI * returnToDoor);
      model.plantFoot(footSide, target);
    }
    if (victim && release > 0) {
      const shoulder = victim.jointPosition('leftArm', new Vector3(-.035, -.015, .03));
      const wrist = victim.jointPosition('leftForearm', new Vector3(-.02, -.10, .015));
      model.reachHand(1, shoulder, brace * release);
      model.reachHand(-1, wrist, brace * release);
    }
    return;
  }
  const entering = phase === 'entering', mount = entering ? p : 1 - window(p, 0, .78);
  const seat = entering ? destination : start;
  const ground = entering ? doorway : local(vehicle, vehicle.root.position, side * (vehicle.tuning.width / 2 + .48), 0, -.20);
  if (!entering) ground.y = destination.y;
  const finalFeet = seatedFeet(model, seat, vehicle, seating);
  const standing = ground.clone(), sill = Vector3.Lerp(standing, seat, .52);
  sill.y = seat.y + .03;
  model.root.position.copyFrom(track(mount, [[0, standing], [.28, local(vehicle, standing, -side * .16, 0, 0)], [.61, sill], [.85, local(vehicle, seat, side * .12, 0, 0)], [1, seat]]));
  if (!entering && p >= .78) model.root.position.copyFrom(Vector3.Lerp(ground, destination, window(p, .78, 1)));
  model.root.rotation.y = headingMix(inward, vehicle.heading, window(mount, .12, .77));
  model.pose('mount', window(mount, 0, .40), seating);
  const duck = Math.sin(Math.PI * window(mount, .08, .98));
  model.interactionPosture(.13 * duck, (seating === 'reclined' ? -.38 : .1) * window(mount, .65, 1) + .62 * duck, -side * .07 * duck);
  for (const footSide of [-1, 1] as const) {
    const outer = footSide === side, final = finalFeet[footSide < 0 ? 0 : 1];
    const begin = outer ? .45 : .10, landed = outer ? .94 : .53;
    const home = foot(ground, inward, footSide, 0);
    // Move sideways through the doorway behind the open door, then extend into the footwell.
    const overSill = Vector3.Lerp(home, final, .48); overSill.y = Math.max(home.y + .22, final.y);
    overSill.addInPlace(vehicle.root.forward.scale(-.22));
    const target = track(mount, [[0, home], [begin, home], [(begin + landed) / 2, overSill], [landed, final], [1, final]]);
    if (!entering && p >= .78) {
      const step = window(p, footSide < 0 ? .78 : .84, footSide < 0 ? .93 : 1);
      const landing = foot(destination, inward, footSide, 0);
      target.copyFrom(Vector3.Lerp(home, landing, step)); target.y += .07 * Math.sin(Math.PI * step);
    }
    model.plantFoot(footSide, target);
  }
  if (handle) {
    const touch = entering ? window(p, 0, .16) * (1 - window(p, .32, .52)) : window(p, 0, .13) * (1 - window(p, .22, .42));
    model.touchSurface(side, handle, doorNormal(vehicle, side, !entering), touch);
  }
}

/** The first foot clears the sill before the hips rise; the second foot catches the withdrawal. */
export function poseVehicleWithdrawal(occupant: TrafficOccupant, progress: number, seating: SeatPose): void {
  const { model, vehicle, start, destination } = occupant;
  if (!start || !destination || model.dead || model.root.metadata?.ragdollActive) return;
  const p = bounded(progress), turn = window(p, .02, .42), stand = window(p, .48, .92);
  const feet = seatedFeet(model, start, vehicle, seating);
  const outside = Vector3.Lerp(start, destination, .72); outside.y = destination.y - .17;
  // Delay the rearward recovery step until the driver has cleared the opening.
  outside.addInPlace(vehicle.root.forward.scale(.26));
  model.root.position.copyFrom(track(p, [[0,start],[.15,start],[.62,outside],[1,destination]]));
  model.root.rotation.y = vehicle.heading - Math.PI / 2 * turn;
  model.pose('mount', 1 - stand, seating);
  const lean = 0.12 * Math.sin(Math.PI * window(p,.24,1));
  model.interactionPosture(.08 * Math.sin(Math.PI * stand), (seating === 'reclined' ? -.38 : .1) * (1 - turn) + lean, -.10 * turn * (1 - stand));
  for (const footSide of [-1, 1] as const) {
    const initial = feet[footSide < 0 ? 0 : 1];
    const final = foot(destination, vehicle.heading - Math.PI / 2, footSide, footSide < 0 ? -.12 : .11);
    const begin = footSide < 0 ? .12 : .40, land = footSide < 0 ? .62 : .90;
    const over = Vector3.Lerp(initial, final, .55); over.y = Math.max(.32 + destination.y, initial.y * .55 + final.y * .45);
    over.addInPlace(vehicle.root.forward.scale(-.16));
    const target = track(p, [[0,initial],[begin,initial],[(begin+land)/2,over],[land,final],[1,final]]);
    model.plantFoot(footSide,target);
  }
  // A door-frame brace releases into a protective counterbalance instead of frozen driving arms.
  const outward = local(vehicle, model.root.position, -.32, 1.12 - .1 * stand, .18);
  model.reachHand(-1, outward, window(p,.08,.30));
  const balance = local(vehicle, model.root.position, .20 - .38 * turn, 1.22 + .12 * Math.sin(Math.PI * stand), -.28);
  model.reachHand(1, balance, window(p,.27,.56));
}
