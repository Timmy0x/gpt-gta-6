import {
  Color3,
  Mesh,
  MeshBuilder,
  PBRMaterial,
  Vector3,
  type PhysicsBody,
  type Scene,
} from "@babylonjs/core";
import type { Player } from "./Player";
import type { Population } from "./Population";
import type { DamageSystem } from "./Damage";
import type { VehicleSystem } from "../vehicles/VehicleSystem";
import type { WantedSystem } from "./Wanted";
import {
  blastFalloff,
  castSegment,
  muzzleShot,
  obstructed,
  type CombatHit,
  type QueryExclusions,
} from "./combat/queries";
import { HeldWeapon, WeaponInventory, WEAPON_SPECS } from "./combat/Weapons";
import { ProjectileSystem } from "./combat/Projectiles";
import { RagdollReactions } from "./combat/RagdollReactions";

export class Combat {
  readonly inventory = new WeaponInventory();
  readonly held: HeldWeapon;
  readonly projectiles: ProjectileSystem;
  readonly reactions: RagdollReactions;
  get weapon() {
    return this.inventory.selected;
  }
  set weapon(value: number) {
    this.inventory.select(value);
  }
  get ammo() {
    return this.inventory.ammo;
  }
  set ammo(value: number) {
    this.inventory.ammo = value;
  }
  get reserve() {
    return this.inventory.reserve;
  }
  set reserve(value: number) {
    this.inventory.reserve = value;
  }
  get reloadTime() {
    return this.inventory.reloadRemaining;
  }
  set reloadTime(value: number) {
    this.inventory.reloadRemaining = Math.max(0, value);
  }
  get unlimited() {
    return this.inventory.unlimited;
  }
  set unlimited(value: boolean) {
    this.inventory.unlimited = value;
  }
  cooldown = 0;
  shots = 0;
  weapons = WEAPON_SPECS;
  onSound = (type: string, p: Vector3) => {};
  onMessage = (message: string) => {};
  effects: { mesh: Mesh; life: number; duration: number; expand?: number }[] =
    [];
  private flashMaterial: PBRMaterial;
  private impactMaterial: PBRMaterial;
  private heatTimer = 0;
  private disposed = false;
  constructor(
    public scene: Scene,
    public player: Player,
    public population: Population,
    public damage: DamageSystem,
    public vehicles: VehicleSystem,
    public wanted: WantedSystem,
  ) {
    this.held = new HeldWeapon(scene);
    this.projectiles = new ProjectileSystem(scene);
    this.reactions = new RagdollReactions(scene);
    this.flashMaterial = new PBRMaterial("combat/flash", scene);
    this.flashMaterial.unlit = true;
    this.flashMaterial.albedoColor.set(1, 0.61, 0.09);
    this.flashMaterial.emissiveColor.set(1, 0.34, 0.025);
    this.flashMaterial.alpha = 0.78;
    this.impactMaterial = new PBRMaterial("combat/impact", scene);
    this.impactMaterial.unlit = true;
    this.impactMaterial.albedoColor = Color3.FromHexString("#c8b59e");
    this.projectiles.onDetonate = (position) => this.explode(position);
    this.projectiles.onBounce = (position) => this.onSound("impact", position);
    this.population.onCharacterHit = (model, impulse, fatal, impact) =>
      this.reactions.hit(model, impulse.scale(5), fatal, impact);
    this.population.onCharacterRestored = model => this.reactions.restore(model);
    scene.onDisposeObservable.addOnce(() => this.dispose());
  }
  select(index: number): void {
    if (this.inventory.select(index)) {
      this.cooldown = Math.max(this.cooldown, 0.15);
      this.onSound("equip", this.player.position);
    }
  }
  reload(): void {
    if (this.inventory.reload()) this.onSound("reload", this.player.position);
  }
  private available(): boolean {
    return (
      this.player.deadTimer <= 0 &&
      !this.player.vehicle &&
      !this.player.transitioning &&
      !this.player.swimming &&
      !this.player.climbing
    );
  }
  private ownBody = (body: PhysicsBody): boolean =>
    !!body.transformNode.metadata?.officer ||
    body.transformNode.name !== "CCTransformNode" ||
    Vector3.DistanceSquared(body.transformNode.position, this.player.position) >
      0.64;
  private exclusions(): QueryExclusions {
    return { roots: [this.player.model.root], bodyFilter: this.ownBody };
  }
  update(dt: number, allowInput = true): void {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.inventory.update(dt);
    this.held.update(
      this.player.model,
      this.weapon,
      this.available(),
      dt,
      this.reloadTime > 0,
    );
    if (allowInput && this.player.input.mouseDown && this.available()) this.fire();
    this.projectiles.update(dt);
    this.reactions.update(dt);
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const effect = this.effects[i];
      effect.life -= dt;
      if (effect.life <= 0) {
        effect.mesh.dispose();
        this.effects.splice(i, 1);
      } else {
        if (effect.expand)
          effect.mesh.scaling.setAll(
            1 + (1 - effect.life / effect.duration) * effect.expand,
          );
        effect.mesh.visibility = Math.min(
          1,
          (effect.life / effect.duration) * 2,
        );
      }
    }
    const heat = this.damage.heatAt(this.player.position);
    if (heat > 0) this.player.hurt(heat * dt);
    this.heatTimer -= dt;
    if (this.heatTimer <= 0) {
      this.heatTimer = 1;
      for (const ped of this.population.pedestrians) {
        if (ped.health <= 0) continue;
        const value = this.damage.heatAt(
          ped.model.root.position.add(new Vector3(0, 0.9, 0)),
        );
        if (value > 0) this.population.hurtPed(ped, value, "fire");
      }
      for (const officer of this.population.officers) {
        if (officer.health <= 0) continue;
        const value = this.damage.heatAt(
          officer.model.root.position.add(new Vector3(0, 0.9, 0)),
        );
        if (value > 0) this.population.hurtOfficer(officer, value, "fire");
      }
    }
  }
  fire(): void {
    if (!this.available() || this.cooldown > 0 || this.reloadTime > 0) return;
    if (this.player.weaponFacingReady === false) return;
    if (!this.inventory.consume()) return;
    const spec = this.weapons[this.weapon],
      p = this.player.position;
    this.cooldown = spec.delay;
    this.shots++;
    this.held.update(this.player.model, this.weapon, true, 0, false);
    const ray = this.player.camera.getForwardRay(spec.range),
      muzzle = this.held.muzzle(),
      options = this.exclusions();
    this.population.resist(12);
    this.population.frighten(p);
    this.wanted.crime(
      this.weapon === 2 ? 90 : 30,
      p,
      this.population.witness(p),
    );
    this.onSound(this.weapon === 2 ? "throw" : "shot", p);
    if (this.weapon === 2) {
      const desired = p
          .add(new Vector3(0, 0.62, 0))
          .add(ray.direction.scale(0.45)),
        blocked = castSegment(
          this.scene,
          p.add(new Vector3(0, 0.55, 0)),
          desired,
          options,
        ),
        origin = blocked
          ? blocked.point.subtract(ray.direction.scale(0.12))
          : desired;
      this.projectiles.throw(
        origin,
        ray.direction
          .scale(17)
          .add(new Vector3(0, 5.2, 0))
          .add(this.player.controller.getVelocity().scale(0.7)),
      );
      return;
    }
    const shot = muzzleShot(
      this.scene,
      ray.origin,
      ray.direction,
      muzzle,
      spec.range,
      options,
    );
    const tracer = MeshBuilder.CreateLines(
      "bullet-tracer",
      { points: [muzzle, shot.end] },
      this.scene,
    );
    tracer.color = new Color3(1, 0.82, 0.4);
    this.addEffect(tracer, 0.065);
    this.flash(muzzle, 0.11, 0.06);
    this.held.recoil();
    this.player.pitch = Math.max(-1.1, this.player.pitch - spec.recoil);
    if (shot.hit) {
      this.impact(shot.hit, ray.direction);
      this.applyHit(shot.hit, spec.damage, ray.direction, "projectile");
    }
  }
  melee(): boolean {
    if (!this.available() || this.cooldown > 0 || this.reloadTime > 0)
      return false;
    this.cooldown = 0.62;
    this.population.resist(12);
    this.onSound("melee", this.player.position);
    this.held.recoil();
    const origin = this.player.position.add(new Vector3(0, 0.35, 0)),
      forward = this.player.camera.getForwardRay().direction;
    forward.y = 0;
    forward.normalize();
    let hit: CombatHit | null = null;
    for (const angle of [0, -0.22, 0.22]) {
      const direction = new Vector3(
          forward.x * Math.cos(angle) + forward.z * Math.sin(angle),
          0,
          forward.z * Math.cos(angle) - forward.x * Math.sin(angle),
        ),
        candidate = castSegment(
          this.scene,
          origin,
          origin.add(direction.scale(1.7)),
          this.exclusions(),
        );
      if (candidate && (!hit || candidate.distance < hit.distance))
        hit = candidate;
    }
    if (!hit) return false;
    this.applyHit(hit, 35, forward, "melee");
    this.impact(hit, forward);
    this.wanted.crime(
      45,
      this.player.position,
      this.population.witness(this.player.position),
    );
    return true;
  }
  private applyHit(
    hit: CombatHit,
    amount: number,
    direction: Vector3,
    kind: "projectile" | "melee",
  ): void {
    const meta = hit.mesh?.metadata ?? hit.body?.transformNode.metadata;
    if (meta?.ped) {
      this.population.hurtPed(meta.ped, amount, kind);
      this.wanted.crime(
        80,
        this.player.position,
        this.population.witness(this.player.position),
      );
    } else if (meta?.officer) this.population.hurtOfficer(meta.officer, amount, kind);
    else if (meta?.prop)
      this.damage.hit(meta.prop, amount, hit.point, kind, direction);
    else {
      const vehicle = this.vehicles.list.find(
        (v) =>
          hit.mesh === v.root ||
          hit.mesh?.isDescendantOf(v.root) ||
          hit.body?.transformNode === v.root,
      );
      if (vehicle) this.vehicles.damage(vehicle, amount * 0.5, hit.point);
      else if (hit.body && !hit.body.isDisposed)
        hit.body.applyImpulse(direction.scale(amount * 0.4), hit.point);
    }
  }
  explode(position: Vector3): void {
    const exposed = (
      target: Vector3,
      root: Mesh | import("@babylonjs/core").TransformNode,
    ) =>
      !obstructed(this.scene, position, target, {
        roots: [root],
        bodyFilter: this.ownBody,
      });
    // Snapshot line of sight before any object or vehicle is destroyed by this explosion.
    const vehicles = this.vehicles.list.filter(
      (vehicle) =>
        Vector3.Distance(vehicle.root.position, position) < 14 &&
        exposed(vehicle.root.position, vehicle.root),
    );
    const peds = this.population.pedestrians.filter(
      (ped) =>
        ped.health > 0 &&
        Vector3.Distance(ped.model.root.position, position) < 12 &&
        exposed(
          ped.model.root.position.add(new Vector3(0, 0.9, 0)),
          ped.model.root,
        ),
    );
    const officers = this.population.officers.filter(
      (officer) =>
        officer.health > 0 &&
        Vector3.Distance(officer.model.root.position, position) < 12 &&
        exposed(
          officer.model.root.position.add(new Vector3(0, 0.9, 0)),
          officer.model.root,
        ),
    );
    const playerExposed =
      Vector3.Distance(position, this.player.position) < 10 &&
      exposed(this.player.position, this.player.model.root);
    this.damage.explosion(position);
    this.onSound("explosion", position);
    this.population.frighten(position);
    for (const vehicle of vehicles)
      this.vehicles.damage(
        vehicle,
        150 * blastFalloff(Vector3.Distance(vehicle.root.position, position)),
        position,
      );
    for (const ped of peds)
      this.population.hurtPed(
        ped,
        150 *
          blastFalloff(Vector3.Distance(ped.model.root.position, position), 12),
        "explosion",
      );
    for (const officer of officers)
      this.population.hurtOfficer(
        officer,
        150 *
          blastFalloff(
            Vector3.Distance(officer.model.root.position, position),
            12,
          ),
        "explosion",
      );
    if (playerExposed)
      this.player.hurt(
        95 * blastFalloff(Vector3.Distance(position, this.player.position), 10),
      );
    this.flash(position, 1.5, 0.38, 4);
  }
  private addEffect(mesh: Mesh, life: number, expand?: number): void {
    mesh.isPickable = false;
    mesh.metadata = { combatEffect: true };
    while (this.effects.length >= 48) this.effects.shift()!.mesh.dispose();
    this.effects.push({ mesh, life, duration: life, expand });
  }
  private flash(
    position: Vector3,
    size: number,
    life: number,
    expand?: number,
  ): void {
    const mesh = MeshBuilder.CreateSphere(
      "combat-flash",
      { diameter: size, segments: 6 },
      this.scene,
    );
    mesh.position.copyFrom(position);
    mesh.material = this.flashMaterial;
    this.addEffect(mesh, life, expand);
  }
  private impact(hit: CombatHit, direction: Vector3): void {
    const mesh = MeshBuilder.CreateSphere(
      "impact-dust",
      { diameter: 0.1, segments: 5 },
      this.scene,
    );
    mesh.position.copyFrom(hit.point).addInPlace(direction.scale(-0.025));
    mesh.material = this.impactMaterial;
    this.addEffect(mesh, 0.19, 2);
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.population.onCharacterHit = null;
    this.population.onCharacterRestored = null;
    this.held.dispose();
    this.projectiles.dispose();
    this.reactions.dispose();
    for (const effect of this.effects) effect.mesh.dispose();
    this.effects = [];
    this.flashMaterial.dispose();
    this.impactMaterial.dispose();
  }
}
