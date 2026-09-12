import { PhysicsShapeCapsule, PhysicsShapeContainer, Quaternion, Vector3, type PhysicsCharacterController, type Scene } from '@babylonjs/core';

/** A real, metre-scale horizontal Havok capsule covers the entire prone body.
 * It is reusable across stance changes and rotates inside a compound because
 * Babylon's character controller keeps its own body orientation fixed. */
export class CrawlingCollider {
  static readonly height = .64;
  private container?: PhysicsShapeContainer;
  private capsule?: PhysicsShapeCapsule;
  private heading = NaN;
  private disposed = false;
  constructor(private scene: Scene) { scene.onDisposeObservable.addOnce(() => this.dispose()); }
  get shape() { return this.container; }
  queryExclusions(controller?: PhysicsCharacterController | null) {
    return controller?.shape === this.container && this.capsule ? [this.container!, this.capsule] : controller?.shape;
  }
  apply(controller: PhysicsCharacterController, heading: number): void {
    if (!this.container) {
      this.container = new PhysicsShapeContainer(this.scene);
      this.capsule = new PhysicsShapeCapsule(new Vector3(0, 0, -.58), new Vector3(0, 0, .58), CrawlingCollider.height / 2, this.scene);
    }
    if (!Number.isFinite(this.heading) || Math.abs(Math.atan2(Math.sin(heading - this.heading), Math.cos(heading - this.heading))) > .015) {
      if (this.container.getNumChildren()) this.container.removeChild(0);
      this.container.addChild(this.capsule!, Vector3.Zero(), Quaternion.RotationYawPitchRoll(heading, 0, 0));
      this.heading = heading;
    }
    if (controller.shape !== this.container)
      controller.setShapeOptions({shape: this.container, capsuleHeight: CrawlingCollider.height, capsuleRadius: CrawlingCollider.height / 2});
    controller.maxStepHeight = .10;
  }
  dispose(): void {
    if (this.disposed) return; this.disposed = true;
    this.container?.dispose(); this.capsule?.dispose();
  }
}
