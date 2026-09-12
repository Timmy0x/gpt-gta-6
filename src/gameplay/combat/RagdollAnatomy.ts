import { Matrix, Mesh, Physics6DoFConstraint, PhysicsConstraintAxis as Axis, PhysicsShapeBox, PhysicsShapeConvexHull, Quaternion, Ragdoll, Space, Vector3, VertexBuffer, type Bone, type RagdollBoneProperties, type Scene } from '@babylonjs/core';
import type { Character } from '../Character';
import type { BodyRegion } from '../Injuries';

export interface PhysicalBone {
  bone: Bone;
  region: BodyRegion;
  initialWorldRotation: Quaternion;
  offset: Vector3;
  width: number; height: number; depth: number;
  mass: number;
}
/** Local anatomical radians: flexion about X, longitudinal twist Y, lateral swing Z.
 * Limits are authored gameplay anatomy, not a medical simulation. */
export function anatomicalLimits(name: string): readonly [number, number, number, number, number, number] {
  if (name.endsWith('Calf')) return [0, 2.35, 0, 0, 0, 0];
  if (name.endsWith('Forearm')) return [-2.45, 0, 0, 0, 0, 0];
  if (name.endsWith('Foot')) return [-.65, 1.10, -.12, .12, -.20, .20];
  if (name.endsWith('Hand')) return [-1.10, 1.10, -.30, .30, -.45, .45];
  if (name.endsWith('Thigh')) return [-1.8, .50, -.50, .50, -.65, .65];
  if (name.endsWith('Arm')) return [-2.4, .70, -.80, .80, -2.65, 2.65];
  if (name === 'head') return [-.75, .75, -.75, .75, -.40, .40];
  return [-.45, .55, -.40, .40, -.35, .35];
}



type BodySpec = [string, BodyRegion, number, number, number, number, Vector3];
/** Fit the currently rendered licensed outfit in each anatomical frame. A
 * skirt or jacket must receive support along with the underlying body. The
 * source skeleton uses explicit matrix indices, not array-order bone IDs. */
function fitSkinColliders(model: Character, specs: BodySpec[]): Vector3[][] {
  const key = (name: string): string | undefined => {
    if (!name.startsWith('Bip01_')) return;
    if (/Pelvis|Spine(?!2)/.test(name)) return 'pelvis';
    if (/Spine2|Neck/.test(name)) return 'chest';
    if (/Head/.test(name)) return 'head';
    const side = name.includes('_L_') ? 'left' : name.includes('_R_') ? 'right' : undefined;
    if (!side) return;
    if (/Finger|Hand/.test(name)) return side + 'Hand';
    if (/Forearm/.test(name)) return side + 'Forearm';
    if (/UpperArm/.test(name)) return side + 'Arm';
    if (/Thigh/.test(name)) return side + 'Thigh';
    if (/Calf/.test(name)) return side + 'Calf';
    if (/Toe|Foot/.test(name)) return side + 'Foot';
  };
  const indices = new Map(specs.map((spec, i) => [spec[0], i]));
  const frames = specs.map(spec => {
    const bone = model.skeleton.bones.find(b => b.name.endsWith('/' + spec[0]))!;
    const inverse = Matrix.Invert(Matrix.Compose(Vector3.One(), bone.getRotationQuaternion(Space.WORLD, model.root), bone.getAbsolutePosition(model.root)));
    const half = new Vector3(spec[2], spec[3], spec[4]).scale(.5);
    return { inverse, min: spec[6].subtract(half), max: spec[6].add(half), points: [] as Vector3[] };
  });
  const point = Vector3.Zero();
  for (const mesh of model.parts) {
    if (!mesh.skeleton || mesh.skeleton === model.skeleton || !mesh.isEnabled() || !mesh.isVisible) continue;
    mesh.skeleton.prepare(true);
    const positions = mesh.getPositionData(true, true), weights = mesh.getVerticesData(VertexBuffer.MatricesWeightsKind), joints = mesh.getVerticesData(VertexBuffer.MatricesIndicesKind);
    if (!positions || !weights || !joints) continue;
    const world = mesh.computeWorldMatrix(true), boneByIndex = new Map(mesh.skeleton.bones.map(bone => [bone.getIndex(), bone]));
    for (const index of new Set(mesh.getIndices() ?? [])) {
      let influence = 0; for (let i = 1; i < 4; i++) if (weights[index * 4 + i] > weights[index * 4 + influence]) influence = i;
      const name = boneByIndex.get(joints[index * 4 + influence])?.name.split('/').at(-1), part = name && key(name), body = part ? indices.get(part) : undefined;
      if (body === undefined) continue;
      const frame = frames[body]; Vector3.FromArrayToRef(positions, index * 3, point); Vector3.TransformCoordinatesToRef(point, world, point); Vector3.TransformCoordinatesToRef(point, frame.inverse, point);
      frame.min.minimizeInPlace(point); frame.max.maximizeInPlace(point);
      frame.points.push(point.clone());
    }
  }
  for (const [i, frame] of frames.entries()) {
    const size = frame.max.subtract(frame.min), center = frame.max.add(frame.min).scale(.5);
    specs[i][2] = size.x; specs[i][3] = size.y; specs[i][4] = size.z; specs[i][6] = center;
  }
  return frames.map(frame => frame.points);
}

export function anatomicalRagdoll(model: Character, scene: Scene): { ragdoll: Ragdoll; bones: PhysicalBone[] } {
  const specs: [string, BodyRegion, number, number, number, number, Vector3][] = [
    ['pelvis', 'torso', .30, .23, .30, 13, Vector3.Zero()],
    ['chest', 'torso', .35, .39, .32, 20, new Vector3(0, -.10, 0)],
    ['head', 'head', .31, .36, .40, 5, new Vector3(0, .09, -.015)],
    ['leftArm', 'leftArm', .12, .27, .12, 3, new Vector3(0, -.14, 0)],
    ['leftForearm', 'leftArm', .105, .235, .105, 2, new Vector3(0, -.12, 0)],
    ['rightArm', 'rightArm', .12, .27, .12, 3, new Vector3(0, -.14, 0)],
    ['rightForearm', 'rightArm', .105, .235, .105, 2, new Vector3(0, -.12, 0)],
    ['leftThigh', 'leftLeg', .16, .38, .17, 7, new Vector3(0, -.205, 0)],
    ['leftCalf', 'leftLeg', .13, .36, .14, 4, new Vector3(0, -.20, 0)],
    ['rightThigh', 'rightLeg', .16, .38, .17, 7, new Vector3(0, -.205, 0)],
    ['rightCalf', 'rightLeg', .13, .36, .14, 4, new Vector3(0, -.20, 0)],
    ['leftHand', 'leftArm', .105, .175, .075, .7, new Vector3(0, -.075, 0)],
    ['rightHand', 'rightArm', .105, .175, .075, .7, new Vector3(0, -.075, 0)],
    ['leftFoot', 'leftLeg', .21, .20, .42, 1, new Vector3(0, -.035, .075)],
    ['rightFoot', 'rightLeg', .21, .20, .42, 1, new Vector3(0, -.035, .075)],
  ];
  model.syncVisualPose();
  const skinPoints = fitSkinColliders(model, specs);
  const bones = specs.map(([name, region, width, height, depth, mass, offset]) => {
    const bone = model.skeleton.bones.find(b => b.name.endsWith('/' + name))!;
    return { bone, region, width, height, depth, mass, offset, initialWorldRotation: bone.getRotationQuaternion(Space.WORLD, model.root).clone() };
  });
  const config: (RagdollBoneProperties & { bone: string })[] = specs.map((spec, i) => {
    const offset = spec[6];
    return { bone: bones[i].bone.name, width: spec[2], height: spec[3], depth: spec[4], mass: spec[5], boxOffset: offset.length(), boneOffsetAxis: offset.lengthSquared() ? offset.normalizeToNew() : Vector3.Up() };
  });
  const ragdoll = new Ragdoll(model.skeleton, model.root, config);
  // Babylon 9.25 stores config min/max without installing native limits. Replace
  // its public joint list; Ragdoll still owns all body/constraint disposal.
  const constraints = ragdoll.getConstraints();
  for (const constraint of constraints) constraint.dispose();
  constraints.length = 0;
  for (let i = 0; i < bones.length; i++) {
    const binding = bones[i], aggregate = ragdoll.getAggregate(i), previousShape = aggregate.shape;
    // Ragdoll body rotations are deltas from the pose at construction. An
    // oriented shape supplies that pose's actual bone frame, including yaw.
    if (skinPoints[i].length >= 8 && i < 11) {
      // A posed skirt's oriented bounding-box corners can extend far below
      // its actual cloth and eject the actor on a second hit. Its convex
      // support follows the captured rendered surface without those corners.
      const topology = new Mesh(binding.bone.name + '/support-topology', scene);
      const vertices = skinPoints[i].flatMap(point => {
        const local = point.subtract(binding.offset).applyRotationQuaternion(binding.initialWorldRotation), padded: number[] = [];
        // Minkowski box padding supplies a real contact margin in every
        // direction. Radial expansion barely pads the sole of a long shoe.
        for (const x of [-.025,.025]) for (const y of [-.025,.025]) for (const z of [-.025,.025]) padded.push(local.x+x,local.y+y,local.z+z);
        return padded;
      });
      topology.setVerticesData(VertexBuffer.PositionKind, vertices);
      aggregate.shape = new PhysicsShapeConvexHull(topology, scene);
      topology.dispose();
    } else {
      const margin = i >= 13 ? .080 : i >= 11 ? .105 : .065;
      aggregate.shape = new PhysicsShapeBox(Vector3.Zero(), binding.initialWorldRotation, new Vector3(binding.width + margin, binding.height + margin, binding.depth + margin), scene);
    }
    aggregate.shape.material = { friction: .65, restitution: 0 };
    aggregate.body.shape = aggregate.shape;
    aggregate.body.setMassProperties({ mass: binding.mass });
    const mass = aggregate.body.getMassProperties();
    if (mass.inertia) aggregate.body.setMassProperties({ ...mass, inertia: mass.inertia.scale(4) });
    previousShape.dispose();
    aggregate.body.setLinearDamping(.12);
    aggregate.body.setAngularDamping(.8);
    if (i === 0) continue;
    let parent = binding.bone.getParent();
    while (parent && !bones.some(b => b.bone === parent)) parent = parent.getParent();
    const parentIndex = bones.findIndex(b => b.bone === parent), parentBinding = bones[parentIndex];
    const parentBody = ragdoll.getAggregate(parentIndex).body, childBody = aggregate.body;
    const pivot = binding.bone.getAbsolutePosition(model.root);
    const axes = (rotation: Quaternion) => {
      const m = Matrix.FromQuaternionToRef(rotation, new Matrix());
      return [Vector3.TransformNormal(Vector3.Right(), m), Vector3.TransformNormal(Vector3.Up(), m)];
    };
    let [axisA, perpAxisA] = axes(parentBinding.initialWorldRotation), [axisB, perpAxisB] = axes(binding.initialWorldRotation);
    const limits = [...anatomicalLimits(specs[i][0])];
    if (specs[i][0].endsWith('Calf') || specs[i][0].endsWith('Forearm')) {
      // An IK-authored elbow/knee can bend in an oblique world plane. Its
      // hinge is that plane's normal, not an assumed global/local X axis.
      const endName = specs[i][0].replace('Calf', 'Foot').replace('Forearm', 'Hand');
      const end = bones.find(entry => entry.bone.name.endsWith('/' + endName))!.bone.getAbsolutePosition(model.root);
      const upper = pivot.subtract(parentBinding.bone.getAbsolutePosition(model.root)).normalize();
      const lower = end.subtract(pivot).normalize();
      const flexion = Math.acos(Math.max(-1, Math.min(1, Vector3.Dot(upper, lower))));
      const sign = specs[i][0].endsWith('Calf') ? 1 : -1;
      const normal = Vector3.Cross(upper, lower);
      if (normal.lengthSquared() > .0001) axisA = normal.normalize().scale(sign);
      perpAxisA = upper.subtract(axisA.scale(Vector3.Dot(upper, axisA))).normalize();
      axisB = axisA.clone(); perpAxisB = perpAxisA.clone();
      limits[0] -= sign * flexion; limits[1] -= sign * flexion;

    }
    const joint = new Physics6DoFConstraint({
      pivotA: pivot.subtract(parentBody.transformNode.position), pivotB: pivot.subtract(childBody.transformNode.position),
      axisA, axisB, perpAxisA, perpAxisB, collision: false,
    }, [
      ...[Axis.LINEAR_X, Axis.LINEAR_Y, Axis.LINEAR_Z].map(axis => ({ axis, minLimit: 0, maxLimit: 0 })),
      ...[Axis.ANGULAR_X, Axis.ANGULAR_Y, Axis.ANGULAR_Z].map((axis, j) => ({ axis, minLimit: limits[j * 2], maxLimit: limits[j * 2 + 1] })),
    ], scene);
    parentBody.addConstraint(childBody, joint);
    for (const axis of [Axis.ANGULAR_X, Axis.ANGULAR_Y, Axis.ANGULAR_Z]) joint.setAxisFriction(axis, .10);
    joint.isEnabled = false;
    constraints.push(joint);
  }
  return { ragdoll, bones };
}

export { skinSupportMinimum } from '../CharacterSkinSupport';
