import {
  Color3,
  Mesh,
  MeshBuilder,
  Ray,
  Vector3,
  type Scene,
} from "@babylonjs/core";
import type { Player } from "./Player";
import type { Population } from "./Population";
import type { DamageSystem } from "./Damage";
import type { VehicleSystem } from "../vehicles/VehicleSystem";
import type { WantedSystem } from "./Wanted";
import { lineBlocked } from "../core/math";
export class Combat {
  weapon = 0;
  ammo = 12;
  reserve = 180;
  cooldown = 0;
  reloadTime = 0;
  unlimited = false;
  shots = 0;
  onSound = (type: string, p: Vector3) => {};
  onMessage = (s: string) => {};
  weapons = [
    { name: "Pistol", capacity: 12, delay: 0.27, damage: 32 },
    { name: "SMG", capacity: 30, delay: 0.085, damage: 19 },
    { name: "Grenade", capacity: 3, delay: 1.3, damage: 120 },
  ];
  effects: { mesh: Mesh; life: number; boom?: Vector3 }[] = [];
  constructor(
    public scene: Scene,
    public player: Player,
    public population: Population,
    public damage: DamageSystem,
    public vehicles: VehicleSystem,
    public wanted: WantedSystem,
  ) {}
  select(index: number) {
    if (index !== this.weapon) {
      this.weapon = index;
      this.ammo = 0;
      this.reloadTime = 0.7;
    }
  }
  reload() {
    if (this.reserve > 0 && this.ammo < this.weapons[this.weapon].capacity)
      this.reloadTime = 1.5;
  }
  update(dt: number) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.reloadTime > 0) {
      this.reloadTime -= dt;
      if (this.reloadTime <= 0) {
        const count = Math.min(
          this.weapons[this.weapon].capacity - this.ammo,
          this.reserve,
        );
        this.ammo += count;
        if (!this.unlimited) this.reserve -= count;
      }
    }
    if (
      this.player.input.mouseDown &&
      this.player.deadTimer <= 0 &&
      !this.player.vehicle
    )
      this.fire();
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      e.life -= dt;
      if (e.life <= 0) {
        if (e.boom) this.explode(e.boom);
        e.mesh.dispose();
        this.effects.splice(i, 1);
      }
    }
  }
  fire() {
    if (this.cooldown > 0 || this.reloadTime > 0) return;
    if (this.ammo <= 0) {
      this.reload();
      return;
    }
    if (!this.unlimited) this.ammo--;
    this.cooldown = this.weapons[this.weapon].delay;
    this.shots++;
    const p = this.player.position;
    const origin = this.player.camera.position.clone();
    const forward = new Vector3(
      Math.sin(this.player.yaw) * Math.cos(this.player.pitch),
      -Math.sin(this.player.pitch) * 0.4,
      Math.cos(this.player.yaw) * Math.cos(this.player.pitch),
    ).normalize();
    const ray = this.player.camera.getForwardRay(180);
    const result = this.scene.pickWithRay(
      ray,
      (m) =>
        m.isEnabled() &&
        m.isPickable &&
        !m.isDescendantOf(this.player.model.root) &&
        m.name !== "ocean",
    );
    const hit = result?.pickedPoint || origin.add(forward.scale(100));
    this.onSound("shot", p);
    this.wanted.crime(
      this.weapon === 2 ? 90 : 30,
      p,
      this.population.witness(p),
    );
    this.population.frighten(p);
    if (this.weapon === 2) {
      const at = p.add(forward.scale(14));
      at.y = 0.7;
      const grenade = MeshBuilder.CreateSphere(
        "grenade",
        { diameter: 0.16 },
        this.scene,
      );
      grenade.position.copyFrom(at);
      this.effects.push({ mesh: grenade, life: 1.4, boom: at });
      return;
    }
    const start = p.add(new Vector3(0.25, 0.55, 0.2));
    const tracer = MeshBuilder.CreateLines(
      "tracer",
      { points: [start, hit] },
      this.scene,
    );
    tracer.color = new Color3(1, 0.82, 0.4);
    tracer.isPickable = false;
    this.effects.push({ mesh: tracer, life: 0.065 });
    const meta = result?.pickedMesh?.metadata;
    if (meta?.ped) {
      this.population.hurtPed(meta.ped, this.weapons[this.weapon].damage);
      this.wanted.crime(80, p, this.population.witness(p));
    }
    if (meta?.prop)
      this.damage.hit(meta.prop, this.weapons[this.weapon].damage, hit);
    const v = this.vehicles.list.find(
      (v) =>
        result?.pickedMesh === v.root ||
        result?.pickedMesh?.isDescendantOf(v.root),
    );
    if (v) this.vehicles.damage(v, this.weapons[this.weapon].damage * 0.5, hit);
    this.player.pitch -= this.weapon === 0 ? 0.012 : 0.008;
  }
  explode(p: Vector3) {
    this.damage.explosion(p);
    this.onSound("explosion", p);
    for (const v of this.vehicles.list) {
      const d = Vector3.Distance(v.root.position, p);
      if (
        d < 14 &&
        !lineBlocked(p, v.root.position, this.population.world.obstacles)
      )
        this.vehicles.damage(v, 130 * (1 - d / 14), p);
    }
    for (const ped of this.population.pedestrians) {
      const d = Vector3.Distance(ped.model.root.position, p);
      if (
        d < 12 &&
        !lineBlocked(
          p,
          ped.model.root.position,
          this.population.world.obstacles,
        )
      )
        this.population.hurtPed(ped, 120 * (1 - d / 12));
    }
    if (
      Vector3.Distance(p, this.player.position) < 10 &&
      !lineBlocked(p, this.player.position, this.population.world.obstacles)
    )
      this.player.hurt(
        70 * (1 - Vector3.Distance(p, this.player.position) / 10),
      );
    const flash = MeshBuilder.CreateSphere(
      "explosion",
      { diameter: 6, segments: 10 },
      this.scene,
    );
    flash.position.copyFrom(p);
    flash.visibility = 0.45;
    flash.isPickable = false;
    this.effects.push({ mesh: flash, life: 0.18 });
  }
}
