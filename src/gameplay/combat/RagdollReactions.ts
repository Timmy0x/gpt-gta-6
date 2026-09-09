import {
  Matrix,
  PhysicsConstraintType,
  PhysicsRaycastResult,
  Quaternion,
  Ragdoll,
  Vector3,
  type Bone,
  type PhysicsEngineV2,
  type RagdollBoneProperties,
  type Scene,
} from "@babylonjs/core";
import type { Character } from "../Character";

type BonePose = { bone: Bone; position: Vector3; rotation: Quaternion };
interface Reaction {
  model: Character;
  ragdoll: Ragdoll;
  life: number;
  fatal: boolean;
  recovering: boolean;
  start: BonePose[];
  target: BonePose[];
  disposed: boolean;
  removeDisposeObserver: () => void;
}
type Config = RagdollBoneProperties & { bone: string; mass: number };

/** Babylon's existing Physics V2 Ragdoll owns body constraints and physical skin synchronization. */
export class RagdollReactions {
  readonly active: Reaction[] = [];
  private frozen = new Map<Character, BonePose[]>();
  constructor(private scene: Scene) {}
  hit(model: Character, impulse: Vector3, fatal = false): void {
    if (model.root.isDisposed()) return;
    if(fatal)model.dead=true;
    this.frozen.delete(model);
    let reaction = this.active.find((r) => r.model === model);
    if (reaction?.recovering) {
      this.finish(reaction, true);
      this.hit(model, impulse, fatal);
      return;
    }
    if (reaction) {
      reaction.fatal ||= fatal;
      reaction.life = Math.max(reaction.life, fatal ? 6 : 1.8);
      if (!reaction.recovering) this.applyImpulse(reaction, impulse);
      return;
    }
    while (this.active.length >= 8)
      this.finish(this.active[0], !this.active[0].fatal);
    model.root.metadata = {
      ...model.root.metadata,
      ragdollActive: true,
      ragdollRecovering: false,
    };
    model.skeleton.computeAbsoluteMatrices(true);
    model.skeleton.prepare(true);
    model.root.computeWorldMatrix(true);
    const names = (suffix: string) =>
      model.skeleton.bones.find((b) => b.name.endsWith("/" + suffix))!.name;
    const conf = (
      bone: string,
      width: number,
      height: number,
      depth: number,
      mass: number,
      offset = 0,
      joint = PhysicsConstraintType.BALL_AND_SOCKET,
    ): Config => ({
      bone: names(bone),
      width,
      height,
      depth,
      mass,
      boxOffset: offset,
      boneOffsetAxis: Vector3.Up(),
      joint,
      rotationAxis: Vector3.Right(),
    });
    const config: Config[] = [
      conf("pelvis", 0.28, 0.21, 0.21, 13),
      conf("chest", 0.34, 0.35, 0.22, 20, -0.1),
      conf("head", 0.18, 0.22, 0.18, 5, 0.07),
      conf("leftArm", 0.11, 0.25, 0.11, 3, -0.13),
      conf(
        "leftForearm",
        0.09,
        0.22,
        0.09,
        2,
        -0.115,
        PhysicsConstraintType.HINGE,
      ),
      conf("rightArm", 0.11, 0.25, 0.11, 3, -0.13),
      conf(
        "rightForearm",
        0.09,
        0.22,
        0.09,
        2,
        -0.115,
        PhysicsConstraintType.HINGE,
      ),
      conf("leftThigh", 0.13, 0.34, 0.14, 7, -0.18),
      conf("leftCalf", 0.11, 0.33, 0.11, 4, -0.18, PhysicsConstraintType.HINGE),
      conf("rightThigh", 0.13, 0.34, 0.14, 7, -0.18),
      conf(
        "rightCalf",
        0.11,
        0.33,
        0.11,
        4,
        -0.18,
        PhysicsConstraintType.HINGE,
      ),
    ];
    const target = this.capture(model);
    const ragdoll = new Ragdoll(model.skeleton, model.root, config);
    reaction = {
      model,
      ragdoll,
      life: fatal ? 8 : 2.7,
      fatal,
      recovering: false,
      start: [],
      target,
      disposed: false,
      removeDisposeObserver: () => {},
    };
    this.active.push(reaction);
    ragdoll.ragdoll();
    for (let i = 0; i < config.length; i++) {
      const aggregate = ragdoll.getAggregate(i);
      aggregate.body.setLinearDamping(0.13);
      aggregate.body.setAngularDamping(0.6);
      aggregate.transformNode.metadata = {
        ...model.torso.metadata,
        ragdoll: true,
        ragdollModel: model,
      };
    }
    const entry = reaction,
      observer = model.root.onDisposeObservable.addOnce(() =>
        this.finish(entry, false),
      );
    entry.removeDisposeObserver = () => {
      model.root.onDisposeObservable.remove(observer);
    };
    this.applyImpulse(entry, impulse);
  }
  private capture(model: Character): BonePose[] {
    return model.skeleton.bones.map((bone) => ({
      bone,
      position: bone.getPosition().clone(),
      rotation: bone.getRotationQuaternion().clone(),
    }));
  }
  private applyImpulse(reaction: Reaction, impulse: Vector3): void {
    const bounded =
      impulse.length() > 280 ? impulse.normalizeToNew().scale(280) : impulse;
    for (let i = 0; i < 11; i++) {
      const body = reaction.ragdoll.getAggregate(i).body,
        mass = body.getMassProperties().mass ?? 1;
      body.applyImpulse(bounded.scale(mass / 70), body.transformNode.position);
    }
  }
  update(dt: number): void {
    for (const model of this.frozen.keys()) if (model.root.isDisposed()) this.frozen.delete(model);
    for (const reaction of [...this.active]) {
      if (reaction.model.root.isDisposed()) {
        this.finish(reaction, false);
        continue;
      }
      if (!reaction.recovering) {
        const pelvis = reaction.ragdoll.getAggregate(0).transformNode.position;
        reaction.model.root.position.x = pelvis.x;
        reaction.model.root.position.z = pelvis.z;
        reaction.model.root.computeWorldMatrix(true);
      }
      reaction.life -= dt;
      if (reaction.recovering) {
        const alpha = Math.max(0, Math.min(1, 1 - reaction.life / 0.7)),
          smooth = alpha * alpha * (3 - 2 * alpha);
        for (let i = 0; i < reaction.target.length; i++) {
          const target = reaction.target[i],
            start = reaction.start[i];
          target.bone.setPosition(
            Vector3.Lerp(start.position, target.position, smooth),
          );
          target.bone.setRotationQuaternion(
            Quaternion.Slerp(start.rotation, target.rotation, smooth),
          );
        }
        if (reaction.life <= 0) this.finish(reaction, true);
      } else if (reaction.life <= 0) {
        if (reaction.fatal) this.finish(reaction, false);
        else this.recover(reaction);
      }
    }
  }
  private recover(reaction: Reaction): void {
    const model = reaction.model,
      pelvis = reaction.ragdoll.getAggregate(0).transformNode.position.clone();
    reaction.ragdoll.dispose();
    reaction.disposed = true;
    const physics = this.scene.getPhysicsEngine() as PhysicsEngineV2,
      result = new PhysicsRaycastResult();
    physics.raycastToRef(
      pelvis.add(new Vector3(0, 1, 0)),
      pelvis.subtract(new Vector3(0, 4, 0)),
      result,
      { shouldHitTriggers: false },
    );
    const ground = result.hasHit
        ? result.hitPointWorld.y
        : Math.max(0, pelvis.y - 0.3),
      forward = model.root.getDirection(Vector3.Forward());
    model.root.rotationQuaternion = null;
    model.root.rotation.set(0, Math.atan2(forward.x, forward.z), 0);
    model.root.scaling.setAll(1);
    model.root.position.set(pelvis.x, ground + 0.015, pelvis.z);
    model.root.computeWorldMatrix(true);
    const rootBone = model.skeleton.bones[0];
    rootBone.setAbsolutePosition(
      Vector3.TransformCoordinates(
        pelvis,
        Matrix.Invert(model.root.getWorldMatrix()),
      ),
    );
    reaction.start = this.capture(model);
    reaction.life = 0.7;
    reaction.recovering = true;
    model.root.metadata.ragdollRecovering = true;
  }
  private finish(reaction: Reaction, recovered: boolean): void {
    const index = this.active.indexOf(reaction);
    if (index < 0) return;
    reaction.removeDisposeObserver();
    const settled=!recovered&&!reaction.model.root.isDisposed()?this.capture(reaction.model):null;
    if (!reaction.disposed) {
      reaction.ragdoll.dispose();
      reaction.disposed = true;
    }
    if (!reaction.model.root.isDisposed()) {
      reaction.model.root.metadata = {
        ...reaction.model.root.metadata,
        ragdollActive: !recovered,
        ragdollRecovering: false,
      };
      if (!recovered) this.frozen.set(reaction.model, reaction.target);
      if(settled)for(const pose of settled){pose.bone.setPosition(pose.position);pose.bone.setRotationQuaternion(pose.rotation);}
      if (recovered)
        for (const pose of reaction.target) {
          pose.bone.setPosition(pose.position);
          pose.bone.setRotationQuaternion(pose.rotation);
        }
    }
    this.active.splice(index, 1);
  }
  /** Full reset restores encounter poses; ordinary player recovery preserves fatal casualties. */
  reset(options:{preserveFatal?:boolean}={}): void {
    for (const reaction of [...this.active]) this.finish(reaction, !(options.preserveFatal&&reaction.fatal));
    for (const [model, poses] of this.frozen) {
      if(options.preserveFatal&&model.dead)continue;
      if (model.root.isDisposed()) continue;
      model.root.metadata = { ...model.root.metadata, ragdollActive: false, ragdollRecovering: false };
      for (const pose of poses) { pose.bone.setPosition(pose.position); pose.bone.setRotationQuaternion(pose.rotation); }
    }
    if(options.preserveFatal){for(const model of this.frozen.keys())if(!model.dead||model.root.isDisposed())this.frozen.delete(model);}else this.frozen.clear();
  }
  dispose(): void { this.reset(); }
}
