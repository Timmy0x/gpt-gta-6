import {
  Color3,
  Mesh,
  MeshBuilder,
  PBRMaterial,
  PhysicsAggregate,
  PhysicsShapeType,
  Vector3,
  type Scene,
} from "@babylonjs/core";
import { castSegment } from "./queries";

export interface Grenade {
  mesh: Mesh;
  physics: PhysicsAggregate;
  fuse: number;
  age: number;
}
/** Grenades are real rigid bodies; a predictive impulse sweep guards small bodies against thin walls. */
export class ProjectileSystem {
  readonly grenades: Grenade[] = [];
  onDetonate = (position: Vector3) => {};
  onBounce = (position: Vector3) => {};
  private material: PBRMaterial;
  private bounces: Vector3[] = [];
  private serial = 0;
  constructor(private scene: Scene) {
    this.material = new PBRMaterial("grenades/olive-steel", scene);
    this.material.albedoColor = Color3.FromHexString("#566644");
    this.material.metallic = 0.55;
    this.material.roughness = 0.52;
  }
  throw(origin: Vector3, velocity: Vector3, fuse = 2.4): Grenade {
    const mesh = MeshBuilder.CreateSphere(
      `grenade-${++this.serial}`,
      { diameter: 0.15, segments: 8 },
      this.scene,
    );
    mesh.position.copyFrom(origin);
    mesh.material = this.material;
    mesh.metadata = { combatEffect: true };
    const physics = new PhysicsAggregate(
      mesh,
      PhysicsShapeType.SPHERE,
      { mass: 0.45, radius: 0.075, friction: 0.7, restitution: 0.48 },
      this.scene,
    );
    physics.body.setLinearVelocity(velocity);
    physics.body.setAngularVelocity(new Vector3(8, 3, 5));
    physics.body.setAngularDamping(0.4);
    const grenade = { mesh, physics, fuse: Math.max(0.15, fuse), age: 0 };
    this.grenades.push(grenade);
    physics.body.setCollisionCallbackEnabled(true);
    physics.body.getCollisionObservable().add((event) => {
      if (event.impulse > 0.6 && this.bounces.length < 12)
        this.bounces.push(event.point?.clone() ?? mesh.position.clone());
    });
    while (this.grenades.length > 12) this.remove(this.grenades[0]);
    return grenade;
  }
  update(dt: number): void {
    for (const position of this.bounces.splice(0)) this.onBounce(position);
    for (const grenade of [...this.grenades]) {
      grenade.age += dt;
      grenade.fuse -= dt;
      if (grenade.fuse <= 0) {
        const position = grenade.mesh.position.clone();
        this.remove(grenade);
        this.onDetonate(position);
        continue;
      }
      const body = grenade.physics.body,
        velocity = body.getLinearVelocity(),
        speed = velocity.length();
      if (speed < 1) continue;
      const direction = velocity.scale(1 / speed),
        end = grenade.mesh.position.add(direction.scale(speed * dt + 0.075));
      const hit = castSegment(this.scene, grenade.mesh.position, end, {
        roots: [grenade.mesh],
        bodies: new Set([body]),
        softTargets: false,
      });
      if (hit) {
        const normal = hit.normal.normalizeToNew();
        if (Vector3.Dot(normal, velocity) > 0) normal.negateInPlace();
        const closing = -Vector3.Dot(velocity, normal);
        if (closing > 0)
          body.applyImpulse(
            normal.scale(closing * 0.45 * 1.48),
            grenade.mesh.position,
          );
      }
    }
  }
  private remove(grenade: Grenade): void {
    const index = this.grenades.indexOf(grenade);
    if (index < 0) return;
    grenade.physics.dispose();
    grenade.mesh.dispose();
    this.grenades.splice(index, 1);
  }
  dispose(): void {
    for (const grenade of [...this.grenades]) this.remove(grenade);
    this.bounces = [];
    this.material.dispose();
  }
}
