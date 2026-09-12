import {
  Matrix,
  PhysicsRaycastResult,
  Quaternion,
  Ragdoll,
  Space,
  Vector3,
  type Bone,
  type PhysicsEngineV2,
  type Scene,
} from "@babylonjs/core";
import type { Character } from "../Character";
import { anatomicalRagdoll, skinSupportMinimum, type PhysicalBone } from "./RagdollAnatomy";
import { bodyInjuryEffects } from "../Injuries";
import { INJURY_RULES, injuryFromImpact, type CharacterImpact } from "./injuries";

const HANDOFF_SECONDS = 1.25;
type BonePose = { bone: Bone; position: Vector3; rotation: Quaternion };
interface Reaction {
  model: Character;
  ragdoll: Ragdoll;
  bones: PhysicalBone[];
  regional: boolean;
  life: number;
  physicalLife: number;
  pelvis: Vector3;
  fatal: boolean;
  recovering: boolean;
  start: BonePose[];
  target: BonePose[];
  disposed: boolean;
  removeDisposeObserver: () => void;
  removeSyncObserver: () => void;
}


/** Babylon's existing Physics V2 Ragdoll owns body constraints and physical skin synchronization. */
export class RagdollReactions {
  readonly active: Reaction[] = [];
  private frozen = new Map<Character, Reaction>();
  private handoffs = new Map<Character, { start: BonePose[]; reset: BonePose[]; previous: BonePose[]; target: BonePose[]; contacts?: Map<string, Vector3>; elapsed: number; lastElapsed: number }>();
  private removeHandoffObserver: () => void;
  private removeSupportObserver: () => void;
  onHandoff: ((model: Character, groundAnchor: Vector3) => void) | null = null;
  constructor(private scene: Scene) {
    const observer = scene.onBeforeRenderObservable.add(() => this.blendHandoffs());
    this.removeHandoffObserver = () => scene.onBeforeRenderObservable.remove(observer);
    const support = scene.onAfterActiveMeshesEvaluationObservable.add(() => this.supportHandoffSkins());
    this.removeSupportObserver = () => scene.onAfterActiveMeshesEvaluationObservable.remove(support);
  }
  hit(model: Character, impulse: Vector3, fatal = false, impact: CharacterImpact = { kind: "impact", damage: 10, health: 100 }): void {
    if (model.root.isDisposed()) return;
    fatal ||= model.dead;
    if (fatal) model.dead = true;
    const regional = impact.region !== undefined;
    if (!regional) model.injury = injuryFromImpact(impact, model.injury);
    if (regional && !fatal && (model.bodyInjuries?.fallRemaining ?? 0) <= 0) return;
    let reaction = this.active.find(r => r.model === model) ?? this.frozen.get(model);
    const target = reaction?.target;
    if (reaction && !reaction.disposed) {
      reaction.fatal ||= fatal;
      reaction.physicalLife = Math.max(reaction.physicalLife, fatal ? INJURY_RULES.fatalPhysicalSeconds : regional ? model.bodyInjuries!.fallRemaining : INJURY_RULES.physicalSeconds);
      this.applyImpulse(reaction, impulse, impact);
      this.status(reaction);
      return;
    }
    this.handoffs.delete(model);
    // Restart from the current down/recovering pose, never from an upright target.
    if (reaction) this.remove(reaction);
    while (this.active.length >= INJURY_RULES.physicalBodyLimit) this.settle(this.active[0]);
    model.root.metadata = {
      ...model.root.metadata,
      ragdollActive: true,
      ragdollRecovering: false,
      ragdollHandoffActive: false,
    };
    model.skeleton.computeAbsoluteMatrices(true);
    model.skeleton.prepare(true);
    model.root.computeWorldMatrix(true);
    const recoveryTarget = target ?? this.capture(model);
    const { ragdoll, bones } = anatomicalRagdoll(model, this.scene);
    reaction = {
      model,
      ragdoll,
      bones,
      regional,
      life: 0,
      physicalLife: fatal ? INJURY_RULES.fatalPhysicalSeconds : regional ? model.bodyInjuries!.fallRemaining : INJURY_RULES.physicalSeconds,
      pelvis: model.root.position.clone(),
      fatal,
      recovering: false,
      start: [],
      target: recoveryTarget,
      disposed: false,
      removeDisposeObserver: () => {},
      removeSyncObserver: () => {},
    };
    this.active.push(reaction);
    ragdoll.pauseSync = true;
    const sync = this.scene.onBeforeRenderObservable.add(() => this.sync(reaction!));
    reaction.removeSyncObserver = () => this.scene.onBeforeRenderObservable.remove(sync);
    ragdoll.ragdoll();
    for (let i = 0; i < bones.length; i++) {
      const aggregate = ragdoll.getAggregate(i);
      aggregate.transformNode.metadata = {
        ...model.torso.metadata,
        ragdoll: true,
        ragdollModel: model,
      };
    }
    const entry = reaction,
      observer = model.root.onDisposeObservable.addOnce(() =>
        this.remove(entry),
      );
    entry.removeDisposeObserver = () => {
      model.root.onDisposeObservable.remove(observer);
    };
    this.applyImpulse(entry, impulse, impact, true);
    this.status(entry);
  }
  private sync(reaction: Reaction): void {
    if (reaction.disposed) return;
    const model = reaction.model;
    const rootBody = reaction.ragdoll.getAggregate(0).transformNode, rootBinding = reaction.bones[0];
    const rootRotation = rootBody.rotationQuaternion!.multiply(rootBinding.initialWorldRotation);
    reaction.pelvis.copyFrom(rootBody.position).subtractInPlace(rootBinding.offset.applyRotationQuaternion(rootRotation));
    model.root.position.x = reaction.pelvis.x;
    model.root.position.z = reaction.pelvis.z;
    const inverseRoot = Matrix.Invert(model.root.computeWorldMatrix(true));
    for (let i = 0; i < reaction.bones.length; i++) {
      const binding = reaction.bones[i], transform = reaction.ragdoll.getAggregate(i).transformNode;
      binding.bone.setRotationQuaternion(transform.rotationQuaternion!.multiply(binding.initialWorldRotation), Space.WORLD, model.root);
      if (i === 0) binding.bone.setAbsolutePosition(Vector3.TransformCoordinates(reaction.pelvis, inverseRoot));
      model.skeleton.computeAbsoluteMatrices(true);
    }
    model.skeleton.prepare(true);
    model.torso.computeWorldMatrix(true);
  }
  private capture(model: Character): BonePose[] {
    return model.skeleton.bones.map((bone) => ({
      bone,
      position: bone.getPosition().clone(),
      rotation: bone.getRotationQuaternion().clone(),
    }));
  }
  private applyImpulse(reaction: Reaction, impulse: Vector3, impact?: CharacterImpact, initial = false): void {
    const bounded = impulse.length() > 180 ? impulse.normalizeToNew().scale(180) : impulse;
    const totalMass = reaction.bones.reduce((sum, bone) => sum + bone.mass, 0);
    let hitIndex = reaction.bones.findIndex(bone => bone.region === (impact?.region ?? "torso"));
    if (impact?.point) {
      let closest = Infinity;
      reaction.bones.forEach((bone, i) => {
        if (impact.region && bone.region !== impact.region) return;
        const distance = Vector3.DistanceSquared(reaction.ragdoll.getAggregate(i).transformNode.position, impact.point!);
        if (distance < closest) { closest = distance; hitIndex = i; }
      });
    }
    for (let i = 0; i < reaction.bones.length; i++) {
      const body = reaction.ragdoll.getAggregate(i).body;
      body.applyImpulse(bounded.scale(reaction.bones[i].mass / totalMass * .75), body.transformNode.position);
    }
    const hitBody = reaction.ragdoll.getAggregate(Math.max(0, hitIndex)).body;
    const lever = impact?.point?.subtract(hitBody.transformNode.position) ?? Vector3.Zero();
    if (lever.length() > .18) lever.normalize().scaleInPlace(.18);
    hitBody.applyImpulse(bounded.scale(.25), hitBody.transformNode.position.add(lever));
    if (initial && reaction.regional && !reaction.fatal && impulse.lengthSquared() < .25) {
      const torso = reaction.model.jointPosition('chest').subtract(reaction.model.jointPosition('pelvis')).normalize();
      if (torso.y > .65) {
        // Loss of muscular balance must not leave a zero-impact casualty
        // mechanically perched in a squat. This internal impulse couple
        // tips the upper body without giving the whole actor linear velocity.
        const chestIndex = reaction.bones.findIndex(binding => binding.bone.name.endsWith('/chest'));
        const chest = reaction.ragdoll.getAggregate(chestIndex).body, pelvis = reaction.ragdoll.getAggregate(0).body;
        const buckle = reaction.model.root.forward.scale(8);
        chest.applyImpulse(buckle, chest.transformNode.position);
        pelvis.applyImpulse(buckle.negate(), pelvis.transformNode.position);
      }
    }
  }
  private status(reaction: Reaction): void {
    const model = reaction.model;
    model.root.metadata = {
      ...model.root.metadata,
      ragdollActive: true,
      ragdollRecovering: reaction.recovering,
      injuryStatus: model.dead ? "dead" : reaction.regional ? "down" : reaction.recovering ? "recovering" : model.injury?.remaining === null ? "incapacitated" : "knocked-down",
    };
  }
  update(dt: number): void {
    for (const [model, transition] of this.handoffs) {
      transition.elapsed += dt;
      const aligned = transition.target.length > 0 && transition.target.every(pose => Vector3.DistanceSquared(pose.position, pose.bone.getPosition()) < .0001 && Math.abs(Quaternion.Dot(pose.rotation, pose.bone.getRotationQuaternion())) > Math.cos(.025));
      if (model.root.isDisposed() || model.dead || (transition.elapsed >= HANDOFF_SECONDS && aligned)) {
        this.handoffs.delete(model);
        if (!model.root.isDisposed()) {
          model.root.metadata.ragdollHandoffActive = false;
          if (!model.dead) { model.animate(0, 0); model.applyInjuryPose(bodyInjuryEffects(model.bodyInjuries), 0, 0); }
        }
      }
    }
    for (const reaction of [...this.active, ...this.frozen.values()]) {
      const model = reaction.model;
      if (model.root.isDisposed()) { this.remove(reaction); continue; }
      if (!reaction.disposed) {
        this.sync(reaction);
        reaction.physicalLife -= dt;
      }
      reaction.fatal ||= model.dead;
      if (reaction.recovering) {
        reaction.life -= dt;
        const alpha = Math.max(0, Math.min(1, 1 - reaction.life / INJURY_RULES.recoverySeconds));
        const smooth = alpha * alpha * (3 - 2 * alpha);
        for (let i = 0; i < reaction.target.length; i++) {
          const target = reaction.target[i], start = reaction.start[i];
          target.bone.setPosition(Vector3.Lerp(start.position, target.position, smooth));
          target.bone.setRotationQuaternion(Quaternion.Slerp(start.rotation, target.rotation, smooth));
        }
        if (reaction.life <= 0) this.finishRecovery(reaction);
        continue;
      }
      if (reaction.regional && !reaction.fatal) {
        // The injury timer controls the earliest recovery, not the end of
        // gravity. A standing body must finish its fall before it can roll.
        if ((model.bodyInjuries?.fallRemaining ?? 0) <= 0 && this.readyToRoll(reaction)) this.handoff(reaction);
        continue;
      }
      if (!reaction.fatal && model.injury?.remaining != null) model.injury.remaining = Math.max(0, model.injury.remaining - dt);
      if (!reaction.disposed && reaction.physicalLife <= 0) this.settle(reaction);
      if (!reaction.fatal && model.injury?.remaining === 0) this.recover(reaction);
    }
  }
  private readyToRoll(reaction: Reaction): boolean {
    const model = reaction.model, pelvis = model.jointPosition('pelvis'), chest = model.jointPosition('chest');
    if (Math.abs(chest.subtract(pelvis).normalize().y) >= .55) return false;
    const physics = this.scene.getPhysicsEngine() as PhysicsEngineV2, hit = new PhysicsRaycastResult();
    const from = pelvis.add(new Vector3(0, .4, 0)), to = pelvis.subtract(new Vector3(0, 2, 0));
    let ignoreBody;
    // Havok builds without a multi-hit collector only return their nearest
    // result, even for an array query. Walk through this actor's own shapes.
    for (let count = 0; count < 16; count++) {
      physics.raycastToRef(from, to, hit, { shouldHitTriggers: false, ignoreBody });
      if (!hit.hasHit) return false;
      if (hit.body?.transformNode.metadata?.ragdollModel !== model) {
        const ground = hit.hitPointWorld.y;
        model.syncVisualPose();
        return hit.hitNormalWorld.y > .5 && pelvis.y - ground < .48 && chest.y - ground < .50 && skinSupportMinimum(model, Vector3.UpReadOnly, 'trunk') - ground < .06;
      }
      ignoreBody = hit.body;
      from.copyFrom(hit.hitPointWorld).y -= .002;
    }
    return false;
  }
  /** Release Havok bodies while keeping the exact fallen pose and injury timer. */
  private settle(reaction: Reaction): void {
    if (reaction.disposed) return;
    this.sync(reaction);
    const pose = this.capture(reaction.model);
    reaction.removeSyncObserver();
    reaction.ragdoll.dispose();
    reaction.disposed = true;
    for (const bone of pose) { bone.bone.setPosition(bone.position); bone.bone.setRotationQuaternion(bone.rotation); }
    this.active.splice(this.active.indexOf(reaction), 1);
    this.frozen.set(reaction.model, reaction);
    this.status(reaction);
  }
  private recover(reaction: Reaction): void {
    const model = reaction.model,
      pelvis = reaction.pelvis.clone();
    if (!reaction.disposed) this.settle(reaction);
    const rootBone = model.skeleton.bones[0];
    const worldRotation = rootBone.getRotationQuaternion(Space.WORLD, model.root).clone();
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
      forward = reaction.regional
        ? model.jointPosition('chest').subtract(pelvis)
        : model.root.getDirection(Vector3.Forward());
    if (forward.x * forward.x + forward.z * forward.z < .015) forward.copyFrom(model.root.getDirection(Vector3.Forward()));
    model.root.rotationQuaternion = null;
    model.root.rotation.set(0, Math.atan2(forward.x, forward.z), 0);
    model.root.scaling.setAll(1);
    model.root.position.set(pelvis.x, ground + 0.015, pelvis.z);
    model.root.computeWorldMatrix(true);
    rootBone.setRotationQuaternion(worldRotation, Space.WORLD, model.root);
    rootBone.setAbsolutePosition(
      Vector3.TransformCoordinates(
        pelvis,
        Matrix.Invert(model.root.getWorldMatrix()),
      ),
    );
    reaction.start = this.capture(model);
    reaction.life = INJURY_RULES.recoverySeconds;
    reaction.recovering = true;
    this.status(reaction);
  }
  private handoff(reaction: Reaction): void {
    if (reaction.fatal || reaction.model.dead) return;
    const model = reaction.model;
    this.recover(reaction);
    const groundAnchor = model.root.position.clone();
    this.remove(reaction);
    model.root.metadata = { ...model.root.metadata, ragdollActive: false, ragdollRecovering: false, ragdollHandoffActive: false, injuryStatus: bodyInjuryEffects(model.bodyInjuries).mode };
    for (const pose of reaction.target) { pose.bone.setPosition(pose.position); pose.bone.setRotationQuaternion(pose.rotation); }
    model.applyInjuryPose(bodyInjuryEffects(model.bodyInjuries), 0, 0);
    this.handoffs.set(model, { start: reaction.start, reset: reaction.target, previous: reaction.start.map(pose => ({ ...pose, rotation: pose.rotation.clone() })), target: [], elapsed: 0, lastElapsed: 0 });
    model.root.metadata.ragdollHandoffActive = true;
    for (const pose of reaction.start) { pose.bone.setPosition(pose.position); pose.bone.setRotationQuaternion(pose.rotation); }
    this.onHandoff?.(model, groundAnchor);
  }
  /** The locomotion owner produces the current crawl/rise target before render.
   * Blend from the actual physical pose, with no upright intermediate frame. */
  private blendHandoffs(): void {
    for (const [model, transition] of this.handoffs) {
      const contactNames = ['leftHand','rightHand','leftFoot','rightFoot'] as const;
      transition.contacts ??= new Map(contactNames.map(name => [name, model.jointPosition(name).subtract(model.root.position)]));
      // Generate the same canonical target the locomotion owner uses. Feeding
      // yesterday's partial IK pose into the next target can select a different
      // elbow branch and leave a large last-frame discontinuity.
      model.animate(0, 0);
      model.applyInjuryPose(bodyInjuryEffects(model.bodyInjuries), 0, 0);
      transition.target = this.capture(model);
      const targetContacts = new Map(contactNames.map(name => [name, model.jointPosition(name)]));
      const alpha = Math.min(1, transition.elapsed / HANDOFF_SECONDS), smooth = alpha * alpha * (3 - 2 * alpha);
      for (const start of transition.start) {
        const bone = start.bone, position = bone.getPosition().clone(), rotation = bone.getRotationQuaternion().clone();
        bone.setPosition(Vector3.Lerp(start.position, position, smooth));
        bone.setRotationQuaternion(Quaternion.Slerp(start.rotation, rotation, smooth));
      }
      const enter = Math.min(1, alpha / .2), release = Math.max(0, Math.min(1, (alpha - .8) / .2));
      const contactWeight = enter * enter * (3 - 2 * enter) * (1 - release * release * (3 - 2 * release));
      model.skeleton.computeAbsoluteMatrices(true); model.skeleton.prepare(true); model.syncVisualPose();
      const trunkMinimum = skinSupportMinimum(model, Vector3.UpReadOnly, 'trunk');
      const lower = Math.max(0, trunkMinimum - model.root.position.y - .025) * contactWeight;
      if (lower > 0) { const pelvis = model.skeleton.bones[0]; pelvis.setPosition(pelvis.getPosition().add(new Vector3(0, -lower, 0))); }
      const contactBlend = contactWeight;
      for (const side of [-1, 1] as const) {
        const prefix = side < 0 ? 'left' : 'right';
        const hand = Vector3.Lerp(transition.contacts.get(`${prefix}Hand`)!.add(model.root.position), targetContacts.get(`${prefix}Hand`)!, smooth);
        hand.y = Math.max(model.root.position.y + .095, hand.y + Math.sin(alpha * Math.PI) ** 2 * .22);
        const elbow = model.root.position.add(model.root.right.scale(side * .48)).addInPlace(model.root.forward.scale(.34 + .04 * smooth)); elbow.y = model.root.position.y + .35 - .20 * smooth;
        model.plantHand(side, hand, contactBlend, elbow);
        const foot = Vector3.Lerp(transition.contacts.get(`${prefix}Foot`)!.add(model.root.position), targetContacts.get(`${prefix}Foot`)!, smooth);
        foot.y = Math.max(model.root.position.y + .22, foot.y) + Math.sin(alpha * Math.PI) ** 2 * .30;
        const knee = model.root.position.add(model.root.right.scale(side * (.24 - .07 * smooth))).addInPlace(model.root.forward.scale(-.42 + .02 * smooth));
        const raisedKnee = Math.max(model.root.position.y + .20, (foot.y + model.jointPosition(`${prefix}Thigh`).y) * .5 + .12);
        knee.y = raisedKnee + (model.root.position.y + .10 - raisedKnee) * smooth;
        model.plantFoot(side, foot, contactBlend, knee, 'toe');
      }
      const rotationStep = Math.min(.36, Math.max(0, transition.elapsed - transition.lastElapsed) * 8.4);
      for (const previous of transition.previous) {
        const bone = previous.bone;
        // Contact IK can change its bend plane as a body rolls. Bound both
        // limb chains so a new knee or elbow solution cannot appear in one
        // displayed frame; the handoff remains active until it converges.
        if (!/(?:Arm|Forearm|Hand|Thigh|Calf|Foot)$/.test(bone.name)) continue;
        const desired = bone.getRotationQuaternion(), angle = 2 * Math.acos(Math.min(1, Math.abs(Quaternion.Dot(previous.rotation, desired))));
        if (angle > rotationStep) bone.setRotationQuaternion(Quaternion.Slerp(previous.rotation, desired, rotationStep / angle));
        previous.rotation.copyFrom(bone.getRotationQuaternion());
      }
      transition.lastElapsed = transition.elapsed;
      model.skeleton.computeAbsoluteMatrices(true); model.skeleton.prepare(true); model.torso.computeWorldMatrix(true);
    }
  }
  /** Correct the authored pelvis after retargeting so the actual surface has
   * a support contact during the middle of the roll. Keep this in the saved
   * bone pose, not a temporary root offset that disappears before a new hit. */
  private supportHandoffSkins(): void {
    for (const [model, transition] of this.handoffs) {
      const floor = model.root.position.y, alpha = Math.min(1, transition.elapsed / HANDOFF_SECONDS);
      const ramp = (value: number) => { const t = Math.max(0, Math.min(1, value / .2)); return t * t * (3 - 2 * t); };
      const contactWeight = ramp(alpha) * ramp(1 - alpha), pelvis = model.skeleton.bones[0];
      for (let iteration = 0; iteration < 3; iteration++) {
        const minimum = skinSupportMinimum(model);
        let correction = floor + .003 - minimum;
        if (!Number.isFinite(correction)) break;
        if (correction < 0) correction *= iteration === 0 ? contactWeight : 0;
        if (Math.abs(correction) < .00001) break;
        pelvis.setPosition(pelvis.getPosition().add(new Vector3(0, correction, 0)));
        model.skeleton.computeAbsoluteMatrices(true); model.skeleton.prepare(true); model.syncVisualPose();
      }
      for (const previous of transition.previous) previous.rotation.copyFrom(previous.bone.getRotationQuaternion());
    }
  }
  /** Explicit player respawn releases only that actor; NPC casualties are untouched. */
  resetCharacter(model: Character): void {
    const handoff = this.handoffs.get(model);
    if (handoff && !model.root.isDisposed()) for (const pose of handoff.reset) { pose.bone.setPosition(pose.position); pose.bone.setRotationQuaternion(pose.rotation); }
    this.handoffs.delete(model);
    const reaction = this.active.find(entry => entry.model === model) ?? this.frozen.get(model);
    if (reaction) {
      this.remove(reaction);
      if (!model.root.isDisposed()) for (const pose of reaction.target) { pose.bone.setPosition(pose.position); pose.bone.setRotationQuaternion(pose.rotation); }
    }
    if (model.root.isDisposed()) return;
    model.injury = null;
    model.root.metadata = { ...model.root.metadata, ragdollActive: false, ragdollRecovering: false, ragdollHandoffActive: false, injuryStatus: bodyInjuryEffects(model.bodyInjuries).mode };
  }
  private remove(reaction: Reaction): void {
    reaction.removeDisposeObserver();
    reaction.removeSyncObserver();
    if (!reaction.disposed) { reaction.ragdoll.dispose(); reaction.disposed = true; }
    const index = this.active.indexOf(reaction);
    if (index >= 0) this.active.splice(index, 1);
    this.frozen.delete(reaction.model);
  }
  private finishRecovery(reaction: Reaction): void {
    const model = reaction.model;
    if (model.dead) { reaction.fatal = true; reaction.recovering = false; this.status(reaction); return; }
    this.remove(reaction);
    model.injury = null;
    model.root.metadata = { ...model.root.metadata, ragdollActive: false, ragdollRecovering: false, ragdollHandoffActive: false, injuryStatus: "healthy" };
    for (const pose of reaction.target) { pose.bone.setPosition(pose.position); pose.bone.setRotationQuaternion(pose.rotation); }
  }
  /** Register a saved lying survivor without allocating a new physics ragdoll. */
  restore(model: Character): void {
    if (model.root.isDisposed()) return;
    const down = this.capture(model);
    const previous = this.active.find(reaction => reaction.model === model) ?? this.frozen.get(model);
    if (previous) this.remove(previous);
    for (const pose of down) { pose.bone.setPosition(pose.position); pose.bone.setRotationQuaternion(pose.rotation); }
    if (model.dead) return;
    if (model.bodyInjuries && !model.injury) {
      if (model.bodyInjuries.fallRemaining > 0) {
        this.hit(model, Vector3.Zero(), false, { region: 'torso', kind: 'impact', damage: 0, health: 100 });
      } else if (!bodyInjuryEffects(model.bodyInjuries).canStand) {
        model.skeleton.returnToRest(); const reset = this.capture(model);
        model.applyInjuryPose(bodyInjuryEffects(model.bodyInjuries), 0, 0);
        model.root.metadata = { ...model.root.metadata, ragdollActive: false, ragdollRecovering: false, ragdollHandoffActive: false, injuryStatus: bodyInjuryEffects(model.bodyInjuries).mode };
        this.handoffs.set(model, { start: down, reset, previous: down.map(pose => ({ ...pose, rotation: pose.rotation.clone() })), target: [], elapsed: 0, lastElapsed: 0 });
        model.root.metadata.ragdollHandoffActive = true;
        for (const pose of down) { pose.bone.setPosition(pose.position); pose.bone.setRotationQuaternion(pose.rotation); }
      }
      return;
    }
    if (!model.injury) return;
    model.skeleton.returnToRest();
    const target = this.capture(model);
    for (const pose of down) { pose.bone.setPosition(pose.position); pose.bone.setRotationQuaternion(pose.rotation); }
    model.root.computeWorldMatrix(true);
    model.skeleton.computeAbsoluteMatrices(true);
    const pelvis = model.skeleton.bones[0].getAbsolutePosition(model.root);
    // A restored entry never accesses ragdoll: all transitions respect disposed=true.
    const reaction: Reaction = { model, ragdoll: null as unknown as Ragdoll, bones: [], regional: false, life: 0, physicalLife: 0, pelvis, fatal: false,
      recovering: false, start: [], target, disposed: true, removeDisposeObserver() {}, removeSyncObserver() {} };
    this.frozen.set(model, reaction);
    this.status(reaction);
  }
  /** Ordinary player recovery preserves down survivors as well as fatal casualties. */
  reset(options: { preserveFatal?: boolean } = {}): void {
    if (options.preserveFatal) {
      for (const reaction of [...this.active]) this.settle(reaction);
      return;
    }
    for (const model of [...this.handoffs.keys()]) this.resetCharacter(model);
    for (const reaction of [...this.active, ...this.frozen.values()]) {
      const model = reaction.model;
      this.remove(reaction);
      if (model.root.isDisposed()) continue;
      model.injury = null;
      model.root.metadata = { ...model.root.metadata, ragdollActive: false, ragdollRecovering: false, ragdollHandoffActive: false, injuryStatus: "healthy" };
      for (const pose of reaction.target) { pose.bone.setPosition(pose.position); pose.bone.setRotationQuaternion(pose.rotation); }
    }
  }
  dispose(): void { this.reset(); this.removeHandoffObserver(); this.removeSupportObserver(); }
}
