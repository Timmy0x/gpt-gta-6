import { Vector3, type Scene, type ShadowGenerator } from "@babylonjs/core";
import type { RoadNode, WorldContract } from "../core/contracts";
import { angleDelta, clamp, distance, lineBlocked, random } from "../core/math";
import type { Vehicle, VehicleSystem } from "../vehicles/VehicleSystem";
import { Character } from "./Character";
import type { Player } from "./Player";
import type { WantedSystem } from "./Wanted";
interface Driver {
  v: Vehicle;
  target: number;
  previous: number;
  police: boolean;
  stuck: number;
}
export interface Pedestrian {
  id: string;
  model: Character;
  target: Vector3;
  health: number;
  panic: number;
  report: number;
  activity: string;
  home: Vector3;
  creative: boolean;
}
export class Population {
  drivers: Driver[] = [];
  pedestrians: Pedestrian[] = [];
  density = 1;
  trafficDensity = 1;
  policeEnabled = true;
  private rng = random(417);
  private ticks = 0;
  private spawnTimer = 0;
  private arrest = 0;
  onArrest = () => {};
  onMessage = (s: string) => {};
  constructor(
    public scene: Scene,
    public shadows: ShadowGenerator,
    public world: WorldContract,
    public vehicles: VehicleSystem,
    public player: Player,
    public wanted: WantedSystem,
  ) {
    for (let i = 0; i < 30; i++) {
      const roadX = [-144, -72, 0, 72, 144][i % 5];
      const x = roadX + (i % 2 ? 11 : -11);
      const z = -170 + Math.floor(i / 5) * 63 + this.rng() * 12;
      this.spawnPed(new Vector3(x, 0, z), i, false);
    }
    const nodes = world.roads;
    for (let i = 0; i < 12 && nodes.length; i++) {
      const node = nodes[Math.floor((i * nodes.length) / 12)];
      if (distance(node, world.spawn) < 16) continue;
      this.spawnDriver(node, false, i);
    }
  }
  spawnPed(p: Vector3, i = this.pedestrians.length, creative = true) {
    const model = new Character(
      this.scene,
      this.shadows,
      "ped-" + i,
      ["#b26759", "#e3d7ad", "#517e88", "#233e50", "#d09450", "#e0ddd3"][i % 6],
      i % 3 === 0,
    );
    model.position(p);
    const ped: Pedestrian = {
      id: "ped-" + i,
      model,
      target: p.add(new Vector3(0, 0, 24)),
      health: 100,
      panic: 0,
      report: 0,
      activity: "walking",
      home: p.clone(),
      creative,
    };
    model.parts.forEach((m) => (m.metadata = { ped }));
    this.pedestrians.push(ped);
    return ped;
  }
  private spawnDriver(node: RoadNode, police: boolean, i: number) {
    const next = this.world.roads.find((n) => n.id === node.next[0]) || node;
    const heading = Math.atan2(next.x - node.x, next.z - node.z);
    const v = this.vehicles.spawn(
      police
        ? "police"
        : (["sedan", "suv", "truck", "coupe"][i % 4] as "sedan"),
      new Vector3(node.x, 1.0, node.z),
      heading,
    );
    const d = { v, target: next.id, previous: node.id, police, stuck: 0 };
    this.drivers.push(d);
    return d;
  }
  witness(p: Vector3, range = 75) {
    return (
      this.pedestrians.some(
        (ped) =>
          ped.health > 0 &&
          distance(ped.model.root.position, p) < range &&
          !lineBlocked(ped.model.root.position, p, this.world.obstacles),
      ) ||
      this.drivers.some(
        (d) =>
          d.police &&
          distance(d.v.root.position, p) < 100 &&
          !lineBlocked(d.v.root.position, p, this.world.obstacles),
      )
    );
  }
  frighten(p: Vector3) {
    for (const ped of this.pedestrians)
      if (distance(p, ped.model.root.position) < 70) {
        ped.panic = 12;
        ped.activity = "fleeing";
        ped.target = ped.model.root.position.add(
          ped.model.root.position.subtract(p).normalize().scale(35),
        );
      }
  }
  hurtPed(ped: Pedestrian, damage: number) {
    ped.health = Math.max(0, ped.health - damage);
    ped.panic = 20;
    if (ped.health <= 0) {
      ped.model.root.rotation.z = Math.PI / 2;
      ped.model.root.position.y = 0.35;
      ped.activity = "injured";
    }
    this.frighten(ped.model.root.position);
  }
  update(dt: number) {
    this.ticks += dt;
    this.spawnTimer -= dt;
    const position = this.player.position;
    const police = this.drivers.filter((d) => d.police && !d.v.occupied);
    let seen = false;
    for (const d of police) {
      const range = this.wanted.stars > 2 ? 125 : 90;
      if (
        distance(d.v.root.position, position) < range &&
        !lineBlocked(d.v.root.position, position, this.world.obstacles) &&
        this.wanted.recognizes(
          position,
          this.player.vehicle?.id || null,
          this.player.name,
        )
      ) {
        seen = true;
        break;
      }
    }
    this.wanted.update(
      dt,
      position,
      seen,
      this.player.vehicle?.id || null,
      this.player.name,
    );
    const desiredPolice = this.policeEnabled
      ? Math.min(8, this.wanted.stars * 2)
      : 0;
    if (police.length < desiredPolice && this.spawnTimer <= 0) {
      const nodes = this.world.roads.filter(
        (n) => distance(n, position) > 90 && distance(n, position) < 210,
      );
      const node = nodes[Math.floor(this.rng() * nodes.length)];
      if (node) this.spawnDriver(node, true, 0);
      this.spawnTimer = 3;
    }
    for (const d of this.drivers) {
      if (d.v.occupied) continue;
      if (
        !d.police &&
        this.drivers.indexOf(d) > Math.floor(12 * this.trafficDensity)
      ) {
        this.vehicles.control(d.v, {
          throttle: 0,
          steer: 0,
          brake: 1,
          handbrake: false,
          lift: 0,
        });
        continue;
      }
      const p = d.v.root.position;
      let target = this.world.roads.find((n) => n.id === d.target);
      if (!target) continue;
      if (distance(p, target) < 9) {
        const options = target.next.filter((n) => n !== d.previous);
        d.previous = target.id;
        if (d.police && this.wanted.stars) {
          const goal = this.wanted.lastKnown;
          options.sort(
            (a, b) =>
              distance(this.world.roads.find((n) => n.id === a)!, goal) -
              distance(this.world.roads.find((n) => n.id === b)!, goal),
          );
          d.target = options[0] ?? target.next[0];
        } else
          d.target =
            options[Math.floor(this.rng() * options.length)] ?? target.next[0];
        target = this.world.roads.find((n) => n.id === d.target) || target;
      }
      let tx = target.x,
        tz = target.z;
      const pursuit = d.police && this.wanted.stars > 0;
      if (
        pursuit &&
        distance(p, this.wanted.lastKnown) < 40 &&
        !lineBlocked(p, this.wanted.lastKnown, this.world.obstacles)
      ) {
        tx = this.wanted.lastKnown.x;
        tz = this.wanted.lastKnown.z;
      }
      const heading = Math.atan2(d.v.root.forward.x, d.v.root.forward.z);
      const error = angleDelta(heading, Math.atan2(tx - p.x, tz - p.z));
      const steer = clamp(error * 1.8, -1, 1);
      let cruise = pursuit
        ? 18 + this.wanted.stars * 2
        : 9 + (this.drivers.indexOf(d) % 5);
      if (Math.abs(error) > 0.4) cruise = Math.min(cruise, 5);
      for (const other of this.vehicles.list) {
        if (other === d.v) continue;
        const delta = other.root.position.subtract(p);
        const forward = d.v.root.forward;
        if (
          delta.length() < 10 &&
          Vector3.Dot(delta.normalizeToNew(), forward) > 0.85
        ) {
          cruise = 0;
          break;
        }
      }
      // Deterministic alternating 10 second signal phases on the authored orthogonal grid.
      if (
        !pursuit &&
        distance(p, target) < 21 &&
        Math.abs(tx - p.x) > Math.abs(tz - p.z) !==
          (Math.floor(this.ticks / 10) % 2 === 0)
      )
        cruise = 0;
      d.stuck = Math.abs(d.v.speed) < 0.7 && cruise > 0 ? d.stuck + dt : 0;
      this.vehicles.control(d.v, {
        throttle: d.stuck > 6 ? -0.45 : Math.abs(d.v.speed) < cruise ? 0.65 : 0,
        steer: d.stuck > 6 ? -steer : steer,
        brake: Math.abs(d.v.speed) > cruise + 1 ? 0.75 : 0,
        handbrake: false,
        lift: 0,
      });
      if (d.stuck > 8) d.stuck = 0;
      if (pursuit && distance(p, position) < 9) {
        if (this.player.vehicle && Math.abs(this.player.vehicle.speed) > 1.5)
          this.arrest = 0;
        else this.arrest += dt / police.length;
        if (this.arrest > 4) {
          this.arrest = 0;
          this.onArrest();
        }
        if (
          this.wanted.stars >= 3 &&
          distance(p, position) > 4 &&
          this.ticks % 1 < dt
        )
          this.player.hurt(this.wanted.stars * 1.6);
      }
    }
    if (!seen) this.arrest = 0;
    for (let i = 0; i < this.pedestrians.length; i++) {
      const ped = this.pedestrians[i];
      const active = ped.creative || i < 30 * this.density;
      ped.model.root.setEnabled(active);
      if (!active || ped.health <= 0) continue;
      const p = ped.model.root.position;
      ped.panic = Math.max(0, ped.panic - dt);
      const far = distance(p, position) > 150;
      if (far && Math.floor(this.ticks * 60) % 6 !== 0) continue;
      const elapsed = far ? dt * 6 : dt;
      if (distance(p, ped.target) < 1) {
        ped.target = ped.home.add(new Vector3(0, 0, (this.rng() - 0.5) * 55));
        ped.activity = ped.panic
          ? "fleeing"
          : this.rng() < 0.25
            ? "on phone"
            : "walking";
      }
      let speed = ped.panic ? 4.2 : ped.activity === "on phone" ? 0.0 : 1.25;
      const direction = ped.target.subtract(p);
      direction.y = 0;
      direction.normalize();
      for (const v of this.vehicles.list) {
        const dist = distance(v.root.position, p);
        if (dist < 5 && Math.abs(v.speed) > 3) {
          ped.panic = 8;
          speed = 4.2;
          direction.copyFrom(p.subtract(v.root.position).normalize());
          if (dist < 1.6 && Math.abs(v.speed) > 5) {
            this.hurtPed(ped, Math.abs(v.speed) * 6);
            if (v.occupied)
              this.wanted.crime(90, position, this.witness(position));
          }
        }
      }
      const next = p.add(direction.scale(speed * elapsed));
      if (
        !this.world.obstacles.some(
          (o) =>
            Math.abs(next.x - o.x) < o.w / 2 + 0.4 &&
            Math.abs(next.z - o.z) < o.d / 2 + 0.4,
        )
      )
        p.copyFrom(next);
      else ped.target = ped.home.clone();
      ped.model.root.rotation.y = Math.atan2(direction.x, direction.z);
      ped.model.animate(elapsed, speed);
    }
  }
  reset() {
    for (const d of this.drivers.filter((d) => d.police))
      this.vehicles.remove(d.v);
    this.drivers = this.drivers.filter((d) => !d.police);
    this.wanted.setLevel(0, this.player.position);
    for (const p of this.pedestrians) {
      p.health = 100;
      p.panic = 0;
      p.model.root.rotation.z = 0;
      p.model.position(p.home);
    }
  }
  get arrestProgress() {
    return this.arrest / 4;
  }
}
