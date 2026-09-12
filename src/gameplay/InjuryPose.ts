import { Quaternion, Vector3, type Bone, type Skeleton, type TransformNode } from '@babylonjs/core';
import type { BodyInjuryEffects } from './Injuries';

type ContactRig = {
  skeleton: Skeleton; root: TransformNode; phase: number;
  jointPosition(name: string, offset?: Vector3): Vector3;
  keepSkinAboveFloor(groundY: number): void;
  plantFoot(side: -1 | 1, target: Vector3, weight?: number, knee?: Vector3, contact?: 'sole' | 'toe'): void;
  plantHand(side: -1 | 1, target: Vector3, weight?: number, elbow?: Vector3): void;
  reachHand(side: -1 | 1, target: Vector3, weight?: number): void;
};
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const ease = (n: number) => { const t = clamp(n); return t * t * (3 - 2 * t); };
const rigBones = new WeakMap<Skeleton, Map<string, Bone>>();
const rotation = (pitch: number, yaw = 0, roll = 0) => Quaternion.RotationYawPitchRoll(yaw, pitch, roll);

/** Bone-space damage poses share the same anatomical axes for player and NPC skins. */
export function poseBodyInjury(rig: ContactRig, effects: BodyInjuryEffects, speed: number, baseHeight: number): void {
  let bones = rigBones.get(rig.skeleton);
  if (!bones) { bones = new Map(rig.skeleton.bones.map(bone => [bone.name.split('/').at(-1)!, bone])); rigBones.set(rig.skeleton, bones); }
  const bone = (name: string) => bones.get(name)!;
  const blend = (name: string, pitch: number, yaw = 0, roll = 0, weight = 1) => {
    const b = bone(name), target = rotation(pitch, yaw, roll);
    b.setRotationQuaternion(Quaternion.Slerp(b.getRotationQuaternion(), target, clamp(weight)));
  };
  const forward = rig.root.forward, right = rig.root.right, origin = rig.root.position;
  const point = (x: number, y: number, z: number) => origin.add(right.scale(x)).addInPlace(forward.scale(z)).addInPlaceFromFloats(0, y, 0);
  const legSeverity = Math.max(effects.leftLeg, effects.rightLeg), moving = clamp(Math.abs(speed) / 1.5);
  const crawlMoving = clamp(Math.abs(speed) / .5);
  const ground = ease(effects.groundBlend), pelvis = bone('pelvis');
  if (ground > 0 || effects.mode === 'down' || effects.mode === 'recovering') {
    rig.root.scaling.y = 1;
    // Long axes stay nearly parallel to the floor; knees bend forward only.
    pelvis.setPosition(new Vector3(0, baseHeight + (.135 - baseHeight) * ground, -.06 * ground));
    blend('pelvis', 1.60 * ground, Math.sin(rig.phase) * .025 * ground);
    blend('spine', -.02 * ground); blend('chest', -.02 * ground);
    blend('neck', -.48 * ground); blend('head', -.15 * ground);
    for (const side of [-1, 1] as const) {
      const prefix = side < 0 ? 'left' : 'right', severity = side < 0 ? effects.leftLeg : effects.rightLeg;
      const wave = Math.sin(rig.phase + (side > 0 ? Math.PI : 0));
      const stroke = crawlMoving * (1 - severity * .65);
      blend(prefix + 'Thigh', (.13 + wave * .07 * stroke) * ground, 0, side * .045 * ground);
      blend(prefix + 'Calf', (.12 + Math.max(0, -wave) * .16 * stroke) * ground);
      blend(prefix + 'Foot', -(1.55 + wave * .07 * stroke + Math.max(0, -wave) * .16 * stroke) * ground);
      blend(prefix + 'Arm', -.7 * ground, 0, side * .1 * ground);
      blend(prefix + 'Forearm', -.65 * ground); blend(prefix + 'Hand', -.12 * ground);
      if (ground > .15) {
        const lift = Math.max(0, wave) * .045 * crawlMoving;
        const reach = point(side * .29, .080 + lift, .61 + .11 * wave * crawlMoving);
        rig.plantHand(side, reach, ground, point(side * .48, .15, .38));
        const advance = Math.max(0, -wave) * stroke;
        rig.plantFoot(side, point(side * (.16 + .13 * advance), .16 + .05 * Math.sin(Math.PI * ground), -.91 + .18 * advance), ground, point(side * (.17 + .40 * advance), .10, -.40 + .12 * advance), 'toe');
      }
    }
  } else {
    // A unilateral limp shortens the damaged leg's swing and unloads that side.
    const shift = (effects.leftLeg - effects.rightLeg) * .095;
    const p = pelvis.getPosition().clone(); p.x += shift; p.y -= legSeverity * .026;
    pelvis.setPosition(p);
    blend('pelvis', 0, 0, -shift * 1.8, Math.min(1, legSeverity * 2));
    blend('spine', .40 * effects.torso + .20 * effects.head + .25 * effects.systemic, 0, -shift, Math.min(1, Math.max(legSeverity, effects.torso, effects.head, effects.systemic) * 3));
    blend('neck', .13 * effects.head, 0, 0, effects.head);
    for (const side of [-1, 1] as const) {
      const prefix = side < 0 ? 'left' : 'right', severity = side < 0 ? effects.leftLeg : effects.rightLeg;
      const arm = side < 0 ? effects.leftArm : effects.rightArm;
      const wave = Math.sin(rig.phase + (side > 0 ? Math.PI : 0));
      if (severity > 0) {
        blend(prefix + 'Thigh', -wave * .25 * moving * (1 - severity * .75) - .04 * severity, 0, side * .025 * severity, severity);
        blend(prefix + 'Calf', .08 * severity + Math.max(0, -wave) * .35 * moving * (1 - severity * .65), 0, 0, severity);
      }
      if (legSeverity > .01) {
        const ankle = point(side * .115, .13 + Math.max(0, wave) * .06 * moving * (1 - severity * .8), wave * .37 * moving * (1 - severity * .88));
        rig.plantFoot(side, ankle);
      }
      if (arm > .01 || effects.torso > .1) {
        // The damaged arm stays guarded near its own ribs, without mirrored left/right pain.
        const guard = Math.min(1, Math.max(arm * 1.5, effects.torso * 1.8));
        blend(prefix + 'Arm', -.40, side * -.20, side * .04, guard);
        blend(prefix + 'Forearm', -1.35, 0, 0, guard);
        blend(prefix + 'Hand', -.12, 0, -side * .08, guard);
      }
    }
  }
  keepAnatomyAboveFloor(rig, bones, ground);
  if (ground > 0) {
    // Clothing is part of the support envelope, while hands remain planted.
    rig.keepSkinAboveFloor(origin.y + .006);
    for (const side of [-1, 1] as const) {
      const wave = Math.sin(rig.phase + (side > 0 ? Math.PI : 0));
      const lift = Math.max(0, wave) * .045 * crawlMoving;
      rig.plantHand(side, point(side * .29, .080 + lift, .61 + .11 * wave * crawlMoving), ground, point(side * .48, .15, .38));
    }
    rig.keepSkinAboveFloor(origin.y + .006);
  }
}

/** Constrain the anatomical envelope, not just the pelvis, during lowering and rising. */
function keepAnatomyAboveFloor(rig: ContactRig, bones: Map<string, Bone>, ground: number): void {
  rig.skeleton.computeAbsoluteMatrices(true);
  const radii: Record<string, number> = { pelvis: .16 - .04 * ground, spine: .15 - .04 * ground, chest: .19 - .07 * ground, neck: .10, head: .17,
    leftArm: .11, rightArm: .11, leftForearm: .10, rightForearm: .10, leftHand: .078, rightHand: .078,
    leftThigh: .10, rightThigh: .10, leftCalf: .095, rightCalf: .095, leftFoot: .12, rightFoot: .12 };
  let penetration = 0;
  for (const [name, radius] of Object.entries(radii)) penetration = Math.max(penetration, rig.root.position.y + radius - rig.jointPosition(name).y);
  for (const name of ['leftHand', 'rightHand']) {
    const fingers = rig.jointPosition(name, new Vector3(0, -.14, 0));
    penetration = Math.max(penetration, rig.root.position.y + .069 - fingers.y);
  }
  for (const name of ['leftFoot', 'rightFoot']) {
    const toes = rig.jointPosition(name, new Vector3(0, -.035, .145));
    penetration = Math.max(penetration, (rig.root.position.y + .098 - toes.y) * (1 - ground));
  }
  if (penetration > 0) {
    const pelvis = bones.get('pelvis')!, p = pelvis.getPosition().clone(); p.y += penetration * (1 - ground); pelvis.setPosition(p);
    rig.skeleton.computeAbsoluteMatrices(true);
  }
}

/** Keep an injured occupant in the seat; only the supported upper body guards/slumps. */
export function poseSeatedBodyInjury(rig: ContactRig, effects: BodyInjuryEffects): void {
  const severity = Math.max(effects.torso, effects.head, effects.systemic);
  const critical = effects.mode === 'down' || effects.mode === 'crawling' || effects.mode === 'recovering';
  const slump = critical ? 1 : Math.min(1, severity * 1.5);
  let bones = rigBones.get(rig.skeleton);
  if (!bones) { bones = new Map(rig.skeleton.bones.map(bone => [bone.name.split('/').at(-1)!, bone])); rigBones.set(rig.skeleton, bones); }
  const blend = (name: string, pitch: number, yaw: number, roll: number, weight: number) => {
    const bone = bones.get(name)!;
    bone.setRotationQuaternion(Quaternion.Slerp(bone.getRotationQuaternion(), rotation(pitch, yaw, roll), clamp(weight)));
  };
  blend('spine', critical ? .55 : .28, 0, .035 * effects.systemic, slump);
  blend('chest', critical ? .16 : .10, 0, 0, slump);
  blend('neck', critical ? .40 : .26, 0, 0, slump);
  blend('head', .17, 0, 0, slump);
  for (const side of [-1, 1] as const) {
    const prefix = side < 0 ? 'left' : 'right';
    const arm = side < 0 ? effects.leftArm : effects.rightArm;
    const guard = Math.min(1, Math.max(arm * 1.6, effects.torso * 1.6, critical ? 1 : 0));
    blend(prefix + 'Arm', -.42, -.10 * side, .04 * side, guard);
    blend(prefix + 'Forearm', -1.35, 0, 0, guard);
    blend(prefix + 'Hand', -.12, 0, -.08 * side, guard);
  }
}
