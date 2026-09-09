import { Vector3, type Scene, type ShadowGenerator } from "@babylonjs/core";
import type { RoadNode, WorldContract } from "../core/contracts";
import { angleDelta, clamp, distance, lineBlocked, random } from "../core/math";
import { DETAILED_CAR_LIMIT } from "../vehicles/ConceptCar";
import type { Vehicle, VehicleSystem } from "../vehicles/VehicleSystem";
import { Character } from "./Character";
import type { Player } from "./Player";
import type { WantedSystem } from "./Wanted";
import { PoliceDirector, type Driver } from "./police/PoliceDirector";
import type { Officer } from "./police/Officer";
import { RestrictedFacility } from "./RestrictedFacility";
import { restoreCorpse, snapshotCasualty, validateCasualties, type PopulationCasualties } from "./police/casualties";
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
  readonly police: PoliceDirector;
  readonly facility: RestrictedFacility;
  private nextPedId = 0;
  onCharacterHit:
    | ((model: Character, impulse: Vector3, fatal: boolean) => void)
    | null = null;
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
    this.police = new PoliceDirector(
      scene,
      shadows,
      world,
      vehicles,
      player,
      wanted,
    );
    this.police.onArrest = () => this.onArrest();
    this.police.onMessage = (message) => this.onMessage(message);
    this.facility = new RestrictedFacility(scene,shadows,world,vehicles,player,wanted);
    this.facility.onArrest=()=>this.onArrest();
    this.facility.onMessage=(message)=>this.onMessage(message);
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
  spawnPed(
    p: Vector3,
    i = this.nextPedId++,
    creative = true,
    stableId?: string,
  ) {
    this.nextPedId = Math.max(this.nextPedId, i + 1);
    let id =
      stableId && /^[A-Za-z0-9_.:-]{1,96}$/.test(stableId)
        ? stableId
        : "ped-" + i;
    while (this.pedestrians.some((ped) => ped.id === id))
      id = "ped-" + this.nextPedId++;
    const appearance = /^ped-(\d+)$/.test(id)
      ? Number(id.slice(4))
      : [...id].reduce((sum, c) => sum + c.charCodeAt(0), 0);
    const model = new Character(
      this.scene,
      this.shadows,
      id,
      ["#b26759", "#e3d7ad", "#517e88", "#233e50", "#d09450", "#e0ddd3"][
        appearance % 6
      ],
      appearance % 3 === 0,
      undefined,
      { licensedCivilianSkin: appearance % 3 === 0 ? "female-adult-06" : "male-adult-03" },
    );
    model.position(p);
    const ped: Pedestrian = {
      id,
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
    const detailed = !police && i % 6 === 3 && this.vehicles.concept.ready
      && this.vehicles.list.filter(v => v.kind === "concept").length < DETAILED_CAR_LIMIT;
    const v = this.vehicles.spawn(
      police
        ? "police"
        : detailed ? "concept" : (["sedan", "suv", "truck", "coupe"][i % 4] as "sedan"),
      new Vector3(node.x, 1.0, node.z),
      heading,
    );
    if (detailed) this.vehicles.setPaint(v, i < 6 ? "#51677D" : "#D9D9D2");
    const d = { v, target: next.id, previous: node.id, police, stuck: 0 };
    this.drivers.push(d);
    return d;
  }
  witness(p: Vector3, range = 75) {
    return (
      this.pedestrians.some(
        (ped) =>
          ped.health > 0 &&
          ped.model.root.isEnabled() &&
          !ped.model.root.metadata?.ragdollActive &&
          distance(ped.model.root.position, p) < range &&
          !lineBlocked(ped.model.root.position, p, this.world.obstacles),
      ) ||
      this.officers.some(
        (o) =>
          o.health > 0 &&
          distance(o.position, p) < 100 &&
          !lineBlocked(o.position, p, this.world.obstacles),
      )
    );
  }
  frighten(p: Vector3) {
    for (const ped of this.pedestrians)
      if (ped.health > 0 && distance(p, ped.model.root.position) < 70) {
        ped.panic = 12;
        ped.activity = "fleeing";
        ped.target = ped.model.root.position.add(
          ped.model.root.position.subtract(p).normalize().scale(35),
        );
      }
  }
  hurtPed(ped: Pedestrian, damage: number) {
    if (ped.health <= 0 || !Number.isFinite(damage) || damage <= 0) return;
    ped.health = Math.max(0, ped.health - damage);
    if(ped.health<=0){ped.model.dead=true;ped.activity="dead";ped.report=0;}
    ped.panic = 20;
    const impulse = ped.model.root.position
      .subtract(this.player.position)
      .normalize()
      .scale(Math.min(10, damage * 0.15));
    impulse.y = 1.4;
    this.onCharacterHit?.(ped.model, impulse, ped.health <= 0);
    if (ped.health <= 0 && !this.onCharacterHit) {
      ped.model.root.rotation.z = Math.PI / 2;
      ped.model.root.position.y = 0.35;
      ped.activity = "dead";
    }
    this.frighten(ped.model.root.position);
  }
  update(dt: number) {
    this.ticks += dt;
    const position = this.player.position;
    this.police.onCharacterHit = this.onCharacterHit;
    this.facility.onCharacterHit=this.onCharacterHit;
    this.facility.update(dt,this.policeEnabled);
    this.police.update(dt, this.drivers, this.policeEnabled,this.facility.observesSuspect);
    for (const d of this.drivers) {
      if (d.police || d.v.occupied) continue;
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
        d.target =
          options[Math.floor(this.rng() * options.length)] ?? target.next[0];
        target = this.world.roads.find((n) => n.id === d.target) || target;
      }
      const tx = target.x,
        tz = target.z;
      const heading = Math.atan2(d.v.root.forward.x, d.v.root.forward.z);
      const error = angleDelta(heading, Math.atan2(tx - p.x, tz - p.z));
      const steer = clamp(error * 1.8, -1, 1);
      let cruise = 9 + (this.drivers.indexOf(d) % 5);
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
    }
    for (let i = 0; i < this.pedestrians.length; i++) {
      const ped = this.pedestrians[i];
      // Older saves recorded health without a corpse pose/ledger.
      if(ped.health<=0&&!ped.model.dead){restoreCorpse(ped.model,snapshotCasualty(ped.id,ped.model));ped.activity="dead";ped.report=0;}
      const active = ped.creative || i < 30 * this.density;
      ped.model.root.setEnabled(active);
      if (!active || ped.health <= 0 || ped.model.root.metadata?.ragdollActive)
        continue;
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
      if(ped.health<=0||ped.model.root.metadata?.ragdollActive)continue;
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
  /** Player recovery clears pursuit, but only an explicit encounter reset revives the world. */
  reset(revive = true) {
    this.police.reset(this.drivers,revive);
    this.facility.reset(revive);
    for (const p of this.pedestrians) {
      p.panic = 0;
      p.report = 0;
      if(revive){
        p.health = 100;p.model.dead=false;p.activity="walking";
        p.model.root.metadata={...p.model.root.metadata,ragdollActive:false,ragdollRecovering:false};
        p.model.skeleton.returnToRest();p.model.root.rotationQuaternion=null;p.model.root.rotation.z = 0;
        p.model.position(p.home);p.target=p.home.add(new Vector3(0,0,24));
      }
    }
  }
  serializeCasualties():PopulationCasualties {
    return {version:1,civilians:this.pedestrians.filter(p=>p.health<=0).slice(0,60).map(p=>snapshotCasualty(p.id,p.model)),guards:this.facility.guards.filter(g=>g.health<=0).map(g=>snapshotCasualty(g.id,g.model)),...this.police.serializeCasualties()};
  }
  restoreCasualties(value:unknown):boolean {
    if(!validateCasualties(value))return false;
    for(const entry of value.civilians){const p=this.pedestrians.find(p=>p.id===entry.id);if(!p)continue;p.health=0;p.activity="dead";p.panic=0;p.report=0;restoreCorpse(p.model,entry);}
    this.facility.restoreCasualties(value.guards);this.police.restoreCasualties(value.police,value.nextOfficerId);return true;
  }
  get officers() {
    return [...this.police.officers,...this.facility.guards];
  }
  hurtOfficer(officer: Officer, damage: number) {
    if(this.facility.guards.includes(officer)){this.facility.onCharacterHit=this.onCharacterHit;this.facility.hurtGuard(officer,damage);return;}
    this.police.onCharacterHit = this.onCharacterHit;
    this.police.hurtOfficer(officer, damage);
  }
  resist(seconds = 12) {
    this.police.resist(seconds);
    this.facility.resist(seconds);
  }
  get policeStats() {
    return this.police.stats;
  }
  get arrestProgress() {
    return Math.max(this.police.arrestProgress,this.facility.arrestProgress);
  }
}
