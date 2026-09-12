import { Bone, BoneIKController, Matrix, Quaternion, Skeleton, TransformNode, Vector3, type Scene } from '@babylonjs/core';

export type ContactLimb = 'leftHand' | 'rightHand' | 'leftFoot' | 'rightFoot';
const leftPalmRotation = Quaternion.RotationQuaternionFromAxis(Vector3.Down(), Vector3.Backward(), Vector3.Right());
const rightPalmRotation = Quaternion.RotationQuaternionFromAxis(Vector3.Up(), Vector3.Backward(), Vector3.Left());
type Chain = { upper: Bone; lower: Bone; end: Bone; a: Bone; b: Bone; tip: Bone; solver: BoneIKController; minReach: number };

/** Babylon's two-bone solver uses +Y segments; the gameplay rig uses downward rest axes. */
export class CharacterContactIK {
  private readonly skeleton: Skeleton;
  private readonly mesh: TransformNode;
  private readonly base: Bone;
  private readonly chains = new Map<ContactLimb, Chain>();
  private readonly inverse = Matrix.Identity();
  private readonly correction = Matrix.Identity();
  private readonly desired = Matrix.Identity();
  private readonly local = Matrix.Identity();
  private readonly rotation = Quaternion.Identity();
  private readonly from = Vector3.Zero();
  private readonly target = Vector3.Zero();
  private readonly current = Vector3.Zero();
  private readonly direction = Vector3.Zero();
  constructor(scene: Scene, private readonly root: TransformNode, private readonly driver: Skeleton) {
    this.skeleton = new Skeleton(root.name + '/contact-ik', root.name + '/contact-ik', scene);
    this.mesh = new TransformNode(root.name + '/contact-ik-frame', scene);
    this.base = new Bone('contact-root', this.skeleton, null, Matrix.Identity());
  }
  solve(limb: ContactLimb, worldTarget: Vector3, weight = 1, worldPole?: Vector3): void {
    if (!Number.isFinite(weight) || weight <= 0 || ![worldTarget.x,worldTarget.y,worldTarget.z].every(Number.isFinite)) return;
    const chain = this.chains.get(limb) ?? this.create(limb);
    this.driver.computeAbsoluteMatrices(true);
    this.root.computeWorldMatrix(true).invertToRef(this.inverse);
    Vector3.TransformCoordinatesToRef(worldTarget, this.inverse, this.target);
    chain.end.getAbsoluteMatrix().getTranslationToRef(this.current);
    Vector3.LerpToRef(this.current, this.target, Math.min(1,weight), this.target);
    const origin=chain.upper.getAbsoluteMatrix().getTranslation();
    chain.a.setPosition(origin);
    this.target.subtractToRef(origin,this.direction);
    if(this.direction.length()<chain.minReach) {
      if(this.direction.lengthSquared()<1e-8) this.current.subtractToRef(origin,this.direction);
      this.direction.normalize().scaleInPlace(chain.minReach);origin.addToRef(this.direction,this.target);
    }
    chain.solver.targetPosition.copyFrom(this.target);
    const side=limb.startsWith('left')?-1:1;
    if (worldPole) Vector3.TransformCoordinatesToRef(worldPole, this.inverse, chain.solver.poleTargetPosition);
    else chain.solver.poleTargetPosition.copyFrom(origin).addInPlace(limb.endsWith('Hand')?new Vector3(side*.65,-.45,-.12):new Vector3(side*.08,.6,1));
    chain.solver.update();this.skeleton.computeAbsoluteMatrices(true);
    chain.b.getAbsoluteMatrix().getTranslation().subtractToRef(chain.a.getAbsoluteMatrix().getTranslation(),this.direction);
    this.align(chain.upper,chain.lower,this.direction);
    chain.tip.getAbsoluteMatrix().getTranslation().subtractToRef(chain.b.getAbsoluteMatrix().getTranslation(),this.direction);
    this.align(chain.lower,chain.end,this.direction);
  }
  private create(limb: ContactLimb): Chain {
    const side=limb.startsWith('left')?'left':'right', names=limb.endsWith('Hand')?[side+'Arm',side+'Forearm',limb]:[side+'Thigh',side+'Calf',limb];
    const [upper,lower,end]=names.map(name=>this.driver.bones.find(bone=>bone.name.split('/').at(-1)===name)!);
    const first=lower.getPosition().length(),second=end.getPosition().length();
    const a=new Bone(limb+'/upper',this.skeleton,this.base,Matrix.Identity());
    const b=new Bone(limb+'/lower',this.skeleton,a,Matrix.Translation(0,first,0));
    const tip=new Bone(limb+'/end',this.skeleton,b,Matrix.Translation(0,second,0));
    this.skeleton.computeAbsoluteMatrices(true);
    const solver=new BoneIKController(this.mesh,b,{maxAngle:Math.PI-.04,poleAngle:Math.PI});solver.poleTargetBone=null;
    const chain={upper,lower,end,a,b,tip,solver,minReach:Math.abs(first-second)+.001};this.chains.set(limb,chain);return chain;
  }
  /** Shoes keep the actor's forward heading while the knee solves around a planted ankle. */
  levelEnd(limb: ContactLimb, weight = 1): void {
    const chain = this.chains.get(limb); if (!chain) return;
    this.driver.computeAbsoluteMatrices(true);
    const absolute = chain.end.getAbsoluteMatrix();
    absolute.decompose(undefined, this.rotation);
    Quaternion.SlerpToRef(this.rotation, Quaternion.Identity(), Math.max(0, Math.min(1, weight)), this.rotation);
    this.rotation.toRotationMatrix(this.desired);
    this.desired.setTranslation(absolute.getTranslation());
    chain.lower.getAbsoluteMatrix().invertToRef(this.inverse);
    this.desired.multiplyToRef(this.inverse, this.local);
    this.local.decompose(undefined, this.rotation);
    chain.end.setRotationQuaternion(this.rotation);
    this.driver.computeAbsoluteMatrices(true);
  }
  /** Prone toes trail behind the shins with anatomical plantarflexion. */
  flexFoot(limb: ContactLimb, pitch: number, weight = 1): void {
    const chain = this.chains.get(limb); if (!chain) return;
    const target = Quaternion.RotationAxis(Vector3.RightReadOnly, Math.max(-.65, Math.min(1.10, pitch)));
    chain.end.setRotationQuaternion(Quaternion.Slerp(chain.end.getRotationQuaternion(), target, Math.max(0, Math.min(1, weight))));
    this.driver.computeAbsoluteMatrices(true);
  }

  /** A palm is level with the floor, with fingers pointing along the actor's forward axis. */
  levelPalm(limb: ContactLimb, weight = 1): void {
    const chain = this.chains.get(limb); if (!chain) return;
    this.driver.computeAbsoluteMatrices(true);
    const absolute = chain.end.getAbsoluteMatrix(); absolute.decompose(undefined, this.rotation);
    Quaternion.SlerpToRef(this.rotation, limb.startsWith('left') ? leftPalmRotation : rightPalmRotation, Math.max(0, Math.min(1, weight)), this.rotation);
    this.rotation.toRotationMatrix(this.desired); this.desired.setTranslation(absolute.getTranslation());
    chain.lower.getAbsoluteMatrix().invertToRef(this.inverse); this.desired.multiplyToRef(this.inverse, this.local);
    this.local.decompose(undefined, this.rotation); chain.end.setRotationQuaternion(this.rotation);
    this.driver.computeAbsoluteMatrices(true);
  }

  /** Align the fingers independently of the elbow so a palm can rest along a surface. */
  pointEnd(limb: ContactLimb, worldDirection: Vector3, weight = 1): void {
    const chain = this.chains.get(limb); if (!chain || weight <= 0 || worldDirection.lengthSquared() < 1e-8) return;
    this.driver.computeAbsoluteMatrices(true);
    this.root.computeWorldMatrix(true).invertToRef(this.inverse);
    Vector3.TransformNormalToRef(worldDirection, this.inverse, this.target); this.target.normalize();
    const absolute = chain.end.getAbsoluteMatrix();
    Vector3.TransformNormalToRef(Vector3.DownReadOnly, absolute, this.from); this.from.normalize();
    Quaternion.FromUnitVectorsToRef(this.from, this.target, this.rotation);
    Quaternion.SlerpToRef(Quaternion.Identity(), this.rotation, Math.min(1, weight), this.rotation);
    this.rotation.toRotationMatrix(this.correction);
    absolute.multiplyToRef(this.correction, this.desired); this.desired.setTranslation(absolute.getTranslation());
    chain.lower.getAbsoluteMatrix().invertToRef(this.inverse); this.desired.multiplyToRef(this.inverse, this.local);
    this.local.decompose(undefined, this.rotation); chain.end.setRotationQuaternion(this.rotation);
    this.driver.computeAbsoluteMatrices(true);
  }
  private align(upper: Bone, child: Bone, direction: Vector3):void {
    this.driver.computeAbsoluteMatrices(true);const absolute=upper.getAbsoluteMatrix();
    child.getAbsoluteMatrix().getTranslation().subtractToRef(absolute.getTranslation(),this.from);this.from.normalize();
    this.direction.copyFrom(direction).normalize();
    Quaternion.FromUnitVectorsToRef(this.from,this.direction,this.rotation).toRotationMatrix(this.correction);
    absolute.multiplyToRef(this.correction,this.desired);this.desired.setTranslation(absolute.getTranslation());
    const parent=upper.getParent();
    if(parent){parent.getAbsoluteMatrix().invertToRef(this.inverse);this.desired.multiplyToRef(this.inverse,this.local);}else this.local.copyFrom(this.desired);
    this.local.decompose(undefined,this.rotation);upper.setRotationQuaternion(this.rotation);this.driver.computeAbsoluteMatrices(true);
  }
  dispose():void {this.skeleton.dispose();this.mesh.dispose();this.chains.clear();}
}
