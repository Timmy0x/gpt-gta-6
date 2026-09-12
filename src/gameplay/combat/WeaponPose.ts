import { Matrix, Quaternion, Vector3 } from '@babylonjs/core';
import type { Character } from '../Character';
import type { WeaponHandling } from './WeaponHandling';
import { WEAPON_SPECS } from './WeaponCatalog';
const smooth = (t: number) => { const x = Math.max(0, Math.min(1, t)); return x * x * (3 - 2 * x); };

/** Orient the held item through the real wrist, preserving its solved position. */
export function aimWeaponHand(character: Character, side: -1 | 1, direction: Vector3): void {
  const hand = character.skeleton.bones.find(b => b.name.endsWith(side < 0 ? '/leftHand' : '/rightHand'));
  if (!hand) return;
  character.skeleton.computeAbsoluteMatrices(true);
  const inverse = Matrix.Invert(character.root.computeWorldMatrix(true));
  const target = Vector3.TransformNormal(direction, inverse).normalize();
  const source = Vector3.TransformNormal(Vector3.Down(), hand.getAbsoluteMatrix()).normalize();
  const correction = Matrix.Identity();
  Quaternion.FromUnitVectorsToRef(source, target, new Quaternion()).toRotationMatrix(correction);
  const absolute = hand.getAbsoluteMatrix().multiply(correction);
  absolute.setTranslation(hand.getAbsoluteMatrix().getTranslation());
  const local = absolute.multiply(Matrix.Invert(hand.getParent()!.getAbsoluteMatrix()));
  const rotation = new Quaternion(); local.decompose(undefined, rotation);
  hand.setRotationQuaternion(rotation);
}

/** Reach the carry position, acquire the grip, clear the body, then join the aimed pose. */
export function applyWeaponHandlingPose(character: Character, handling: WeaponHandling, reload: number, raised = false): void {
  const family = WEAPON_SPECS[handling.current].family;
  if (family === 'unarmed') return;
  const long = ['rifle', 'shotgun', 'sniper'].includes(family);
  const world = character.root.computeWorldMatrix(true);
  // Long arms remain cradled above the ground between shots. The carry pose is
  // also the endpoint of the draw, so a rifle never drops through the leg.
  if (long && !raised) {
    const grip = Vector3.TransformCoordinates(new Vector3(.11, 1.22, .24), world);
    character.reachHand(1, grip);
    aimWeaponHand(character, 1, Vector3.TransformNormal(new Vector3(0, -.22, .976), world));
    character.reachHand(-1, Vector3.TransformCoordinates(new Vector3(.08, 1.13, .51), world));
  } else if (long && raised) {
    character.skeleton.computeAbsoluteMatrices(true);
    const hand = character.skeleton.bones.find(b => b.name.endsWith('/rightHand'))!;
    const direction = Vector3.TransformNormal(Vector3.Down(), hand.getAbsoluteMatrix().multiply(world)).normalize();
    const support = character.jointPosition('rightHand').add(direction.scale(.22)).add(Vector3.TransformNormal(new Vector3(-.035, -.045, 0), world));
    character.reachHand(-1, support);
  }
  if (handling.phase === 'drawing' || handling.phase === 'stowing') {
    const t = handling.phase === 'drawing' ? handling.progress : 1 - handling.progress;
    const carry = long ? new Vector3(.2, 1.36, -.16) : new Vector3(.24, .92, -.045);
    const clear = long ? new Vector3(.34, 1.28, .19) : new Vector3(.27, 1.08, .16);
    const natural = character.jointPosition('rightHand');
    const acquired = Vector3.TransformCoordinates(carry, world), cleared = Vector3.TransformCoordinates(clear, world);
    const target = t < .24 ? Vector3.Lerp(natural, acquired, smooth(t / .24)) : t < .58 ? Vector3.Lerp(acquired, cleared, smooth((t - .24) / .34)) : Vector3.Lerp(cleared, natural, smooth((t - .58) / .42));
    character.reachHand(1, target);
    if (t < .68) {
      const localDirection = Vector3.Lerp(new Vector3(0, -.98, .2), Vector3.Forward(), smooth((t - .25) / .43));
      aimWeaponHand(character, 1, Vector3.TransformNormal(localDirection, world).normalize());
    }
    if (long) character.reachHand(-1, target.add(Vector3.TransformNormal(new Vector3(-.1, -.03, .15), world)), smooth((t - .45) / .4) * .85);
  } else if (reload > 0) {
    const t = 1 - reload / WEAPON_SPECS[handling.current].reload;
    const working = Vector3.TransformCoordinates(new Vector3(.13, 1.17, .3), world);
    character.reachHand(1, working, Math.sin(Math.PI * Math.min(1, t * 1.3)) * .82);
    const magazine = Vector3.TransformCoordinates(new Vector3(-.2, .9, -.02), world);
    const hand = t < .42 ? Vector3.Lerp(working, magazine, smooth(t / .42)) : Vector3.Lerp(magazine, working, smooth((t - .42) / .36));
    character.reachHand(-1, hand, Math.sin(Math.PI * t));
  }
}
