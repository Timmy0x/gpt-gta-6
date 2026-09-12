import { CharacterSupportedState, PhysicsCharacterController, Vector3, type PhysicsEngineV2, type Scene } from '@babylonjs/core';
import type { Character } from './Character';
import { blockedCrawlEffects, type BodyInjuryEffects } from './Injuries';
import { CrawlingCollider } from './CrawlingCollider';
import { MovementQueries } from './MovementQueries';

/** Nearby civilian movement collides through the same Havok controller as the player. */
export class NpcLocomotion {
  controller: PhysicsCharacterController | null = null;
  private crawl: CrawlingCollider;
  private queries?: MovementQueries;
  private disposed = false;
  constructor(private scene: Scene, private model: Character, private metadata: Record<string, unknown>) {
    this.crawl = new CrawlingCollider(scene);
    model.root.onDisposeObservable.addOnce(() => this.dispose());
  }
  pause(): void { this.controller?.dispose(); this.controller = null; }
  move(dt: number, direction: Vector3, speed: number, effects: BodyInjuryEffects): number {
    if (this.disposed) return 0;
    if (!this.controller) {
      this.queries ??= new MovementQueries(this.scene, () => this.crawl.queryExclusions(this.controller));
      const physics = this.scene.getPhysicsEngine() as PhysicsEngineV2, old = new Set(physics.getBodies());
      this.controller = new PhysicsCharacterController(this.model.root.position.add(new Vector3(0, .94, 0)), {capsuleHeight: 1.8, capsuleRadius: .29}, this.scene);
      this.controller.characterMass = 75; this.controller.characterStrength = 700; this.controller.maxStepHeight = .32;
      for (const body of physics.getBodies()) if (!old.has(body)) body.transformNode.metadata = {...body.transformNode.metadata, ...this.metadata};
    }
    const controller = this.controller;
    if (this.model.root.metadata?.ragdollHandoffActive) speed = 0;
    if (direction.lengthSquared() > .001 && !this.model.root.metadata?.ragdollHandoffActive) {
      const yaw = this.model.root.rotation.y, desired = Math.atan2(direction.x, direction.z);
      const delta = Math.atan2(Math.sin(desired - yaw), Math.cos(desired - yaw));
      this.model.root.rotation.y += Math.max(-dt * 4, Math.min(dt * 4, delta));
    }
    const needsProne = effects.mode === 'crawling' || effects.mode === 'down';
    if (needsProne) this.crawl.apply(controller, this.model.root.rotation.y);
    else if (controller.shape === this.crawl.shape) {
      const standing = controller.getPosition().add(new Vector3(0, .9 - controller.footOffset, 0));
      if (this.queries!.clear(standing)) { controller.setShapeOptions({capsuleHeight: 1.8, capsuleRadius: .29}); controller.maxStepHeight = .32; }
      else { if (this.model.bodyInjuries) this.model.bodyInjuries.riseRemaining = 3; effects = blockedCrawlEffects(effects); speed = effects.maxSpeed; }
    }
    const support = controller.checkSupport(dt, Vector3.Down()), previous = controller.getVelocity();
    const grounded = support.supportedState === CharacterSupportedState.SUPPORTED;
    const crawling = effects.mode === 'crawling' || effects.mode === 'down';
    const alongBody = Math.max(0, Vector3.Dot(direction, this.model.root.forward));
    const travel = crawling ? this.model.root.forward.scale(speed * alongBody) : direction.scale(speed);
    controller.setVelocity(new Vector3(travel.x, grounded ? Math.max(previous.y, 0) : previous.y - 9.81 * dt, travel.z));
    const start = controller.getPosition().clone();
    controller.integrate(dt, support, new Vector3(0, -9.81, 0));
    this.model.root.position.copyFrom(controller.getPosition()).y -= controller.footOffset;
    const actualSpeed = Math.hypot(controller.getPosition().x - start.x, controller.getPosition().z - start.z) / Math.max(.001, dt);
    this.model.animate(dt, actualSpeed); this.model.applyInjuryPose(effects, dt, actualSpeed);
    return actualSpeed;
  }
  dispose(): void { if (this.disposed) return; this.disposed = true; this.pause(); this.queries?.dispose(); this.crawl.dispose(); }
}
