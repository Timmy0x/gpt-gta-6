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
import { VehicleOccupancy } from './VehicleOccupancy';
import { hasCasualtyState, isDown, restoreCorpse, snapshotCasualty, validateCasualties, type PopulationCasualties } from "./police/casualties";
import type { CharacterDamageKind, CharacterImpact } from "./combat/injuries";
import { bodyInjuryEffects } from './Injuries';
import { damageCharacter, recoverCharacter, type DamageContact } from './CharacterDamage';
import { NpcLocomotion } from './NpcLocomotion';
export interface Pedestrian {
  id: string;
  model: Character;
  target: Vector3;
  health: number;
  movement?: NpcLocomotion;
  panic: number;
  report: number;
  activity: string;
  home: Vector3;
  creative: boolean;
  /** Visible civilian crew remain hittable; occupancy owns their pose until dismount. */
  vehicleId?: string;
  formerDriver?: boolean;
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
  readonly occupancy: VehicleOccupancy;
  private nextPedId = 0;
  onCharacterHit:
    | ((model: Character, impulse: Vector3, fatal: boolean, impact: CharacterImpact) => void)
    | null = null;
  onCharacterRestored: ((model: Character) => void) | null = null;
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
    // Simulation fixtures may provide only a lightweight Player view.
    this.occupancy = player.occupancy ?? new VehicleOccupancy();
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
    // Keep original identities, then seed the new courts and park with persistent locals.
    // Their activity budget follows proximity so a growing map does not multiply AI work.
    for (const location of world.locations.filter(l => l.id.startsWith('inner-') && ['market', 'park', 'landmark'].includes(l.type))) {
      for (let i = 0; i < 3; i++) this.spawnPed(new Vector3(location.x + (i - 1) * .9, 0, location.z + 2), undefined, false, `${location.id}-civilian-${i}`);
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
    ped.movement = new NpcLocomotion(this.scene, model, {ped});
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
    if (!police) {
      const ped = this.spawnPed(v.root.position, 100 + i, false, `driver-${v.id}`);
      ped.vehicleId = v.id;
      ped.activity = 'driving';
      this.occupancy.register(v, ped.model,
        () => ped.health > 0 && !ped.model.dead,
        position => this.adoptFormerDriver(ped, v, position));
    }
    return d;
  }
  private adoptFormerDriver(ped: Pedestrian, vehicle: Vehicle, position: Vector3) {
    this.drivers = this.drivers.filter(driver => driver.v !== vehicle);
    delete ped.vehicleId;
    ped.formerDriver = true;
    ped.model.position(position);
    ped.home.copyFrom(position);
    if (ped.health <= 0 || !bodyInjuryEffects(ped.model.bodyInjuries).canStand) {
      ped.activity = ped.health <= 0 ? 'dead' : 'injured';
      if (ped.model.bodyInjuries) ped.model.bodyInjuries.fallRemaining = 1.2;
      this.onCharacterHit?.(ped.model, Vector3.Zero(), ped.health <= 0, {kind:'impact',damage:0,health:ped.health,region:'torso'});
      return;
    }
    ped.panic = 18;
    ped.activity = 'fleeing';
    const away = position.subtract(vehicle.root.position); away.y = 0;
    if (away.lengthSquared() < .1) away.copyFrom(vehicle.root.right.scale(-1));
    ped.target = position.add(away.normalize().scale(35));
    this.wanted.crime(40, vehicle.root.position, true);
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
    this.occupancy.frighten(p);
    for (const ped of this.pedestrians)
      if (ped.health > 0 && distance(p, ped.model.root.position) < 70) {
        ped.panic = 12;
        ped.activity = "fleeing";
        ped.target = ped.model.root.position.add(
          ped.model.root.position.subtract(p).normalize().scale(35),
        );
      }
  }
  hurtPed(ped: Pedestrian, damage: number, kind: CharacterDamageKind = "impact", contact: DamageContact = {}) {
    if (ped.health <= 0 || !Number.isFinite(damage) || damage <= 0) return;
    const result = damageCharacter(ped.model, ped.health, damage, kind, contact);
    ped.health = result.health;
    if(ped.health<=0){ped.model.dead=true;ped.activity="dead";ped.report=0;}
    ped.panic = 20;
    const vehicle = this.vehicles.list.find(v => v.id === ped.vehicleId), occupant = vehicle && this.occupancy.get(vehicle);
    if (occupant?.state === 'driving') {
      ped.model.applySeatedInjuryPose(bodyInjuryEffects(ped.model.bodyInjuries));
      if (!this.occupancy.canDrive(vehicle!)) vehicle!.input = {throttle:0,steer:0,brake:1,handbrake:true,lift:0};
    } else this.onCharacterHit?.(ped.model, result.impulse, ped.health <= 0, result.impact);
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
    for (const officer of this.officers) officer.health = recoverCharacter(officer.model, officer.health, dt, officer.role === 'patrol' ? 100 : officer.role === 'swat' ? 150 : 140);
    this.occupancy.update(dt);
    this.police.onCharacterHit = this.onCharacterHit;
    this.facility.onCharacterHit=this.onCharacterHit;
    this.facility.update(dt,this.policeEnabled);
    this.police.update(dt, this.drivers, this.policeEnabled,this.facility.observesSuspect);
    const trafficPeople = this.pedestrians.filter(ped => !ped.vehicleId && ped.health > 0 && ped.model.root.isEnabled()).map(ped => ped.model.root.position);
    if (!this.player.vehicle && this.player.deadTimer <= 0) trafficPeople.push(this.player.position);
    for (const d of this.drivers) {
      if (d.police || d.v.occupied) continue;
      if (!this.occupancy.canDrive(d.v)) {
        this.vehicles.control(d.v, { throttle: 0, steer: 0, brake: 1, handbrake: true, lift: 0 });
        continue;
      }
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
      const frightened = (this.occupancy.get(d.v)?.panic ?? 0) > 0;
      let cruise = frightened ? 17 : 9 + (this.drivers.indexOf(d) % 5);
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
      // A person stepping into a slow traffic lane can stop a car and reach its door.
      for (const person of trafficPeople) {
        const delta = person.subtract(p), ahead = Vector3.Dot(delta, d.v.root.forward), across = Math.abs(Vector3.Dot(delta, d.v.root.right));
        if (ahead > 0 && ahead < Math.max(7, Math.abs(d.v.speed) * 1.15) && across < d.v.tuning.width / 2 + .65) { cruise = 0; break; }
      }
      // Deterministic alternating 10 second signal phases on the authored orthogonal grid.
      if (
        !frightened && distance(p, target) < 21 &&
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
    const ambient = new Set(this.pedestrians.filter(p => !p.creative && !p.formerDriver && !p.vehicleId)
      .sort((a, b) => distance(a.model.root.position, position) - distance(b.model.root.position, position))
      .slice(0, Math.floor(30 * this.density)));
    for (let i = 0; i < this.pedestrians.length; i++) {
      const ped = this.pedestrians[i];
      ped.health = recoverCharacter(ped.model, ped.health, dt);
      // A driver is already animated by occupancy; combat still sees the same Pedestrian.
      if (ped.vehicleId) {
        ped.movement?.pause();
        const vehicle = this.vehicles.list.find(v => v.id === ped.vehicleId);
        if (vehicle) { ped.model.root.setEnabled(true); continue; }
        delete ped.vehicleId;
        ped.formerDriver = true;
        ped.activity = ped.health > 0 ? 'walking' : 'dead';
        ped.home.copyFrom(ped.model.root.position);
        ped.target.copyFrom(ped.home);
      }
      // Older saves recorded health without a corpse pose/ledger.
      if(ped.health<=0&&!ped.model.dead){restoreCorpse(ped.model,snapshotCasualty(ped.id,ped.model));ped.activity="dead";ped.report=0;}
      const active = ped.creative || ped.formerDriver || ambient.has(ped);
      ped.model.root.setEnabled(active);
      if (!active || ped.health <= 0 || ped.model.root.metadata?.ragdollActive) {
        ped.movement?.pause(); continue;
      }
      const p = ped.model.root.position;
      ped.panic = Math.max(0, ped.panic - dt);
      const far = distance(p, position) > 150;
      // Streamed collision is resident around the player. Do not leave a
      // controller falling through an unloaded distant street.
      if (far) { ped.movement?.pause(); continue; }
      const elapsed = dt;
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
            this.hurtPed(ped, Math.abs(v.speed) * 6, 'impact', {point: v.root.position, direction: v.body.getLinearVelocity()});
            if (v.occupied)
              this.wanted.crime(90, position, this.witness(position));
          }
        }
      }
      if(ped.health<=0||ped.model.root.metadata?.ragdollActive){ped.movement?.pause();continue;}
      const injuries = bodyInjuryEffects(ped.model.bodyInjuries);
      speed = Math.min((injuries.canSprint ? speed : Math.min(speed, 1.25)) * injuries.speedScale, injuries.maxSpeed);
      if (injuries.mode !== 'healthy') ped.activity = injuries.mode === 'crawling' ? 'crawling' : 'injured';
      const actual = ped.movement?.move(elapsed, direction, speed, injuries) ?? 0;
      if (speed > .2 && actual < .05) ped.target = ped.home.clone();
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
        p.movement?.pause();p.health = 100;p.model.dead=false;p.model.injury=null;p.model.bodyInjuries=null;p.activity="walking";
        p.model.root.metadata={...p.model.root.metadata,ragdollActive:false,ragdollRecovering:false,ragdollHandoffActive:false};
        p.model.skeleton.returnToRest();p.model.root.rotationQuaternion=null;p.model.root.rotation.z = 0;
        p.model.position(p.home);p.target=p.home.add(new Vector3(0,0,24));
      }
    }
  }
  serializeCasualties():PopulationCasualties {
    return {version:3,civilians:this.pedestrians.filter(p=>hasCasualtyState(p.model,p.health)).slice(0,60).map(p=>({...snapshotCasualty(p.id,p.model,p.health),...(p.vehicleId?{vehicleId:p.vehicleId}:{})})),guards:this.facility.guards.filter(g=>hasCasualtyState(g.model,g.health)).map(g=>snapshotCasualty(g.id,g.model,g.health)),...this.police.serializeCasualties()};
  }
  restoreCasualties(value:unknown):boolean {
    if(!validateCasualties(value))return false;
    for (const entry of value.civilians) {
      const seat = entry.vehicleId && this.vehicles.list.find(v => v.id === entry.vehicleId);
      const p = this.pedestrians.find(p => p.id === entry.id) ?? (seat ? this.spawnPed(new Vector3(entry.x,entry.y,entry.z),undefined,false,entry.id) : null); if (!p) continue;
      p.movement?.pause(); p.health = entry.health ?? 0; p.activity = p.health > 0 ? 'injured' : 'dead'; p.panic = 0; p.report = 0;
      restoreCorpse(p.model, entry);
      if (seat) {
        const prior = this.vehicles.list.find(v => v.id === p.vehicleId);
        if (prior && prior !== seat) this.occupancy.forget(prior);
        if (this.occupancy.get(seat)?.model !== p.model) {
          this.occupancy.forget(seat);
          this.occupancy.register(seat,p.model,()=>p.health>0&&!p.model.dead,position=>this.adoptFormerDriver(p,seat,position));
        }
        p.vehicleId = seat.id; p.activity='driving'; this.occupancy.restoreSeat(seat);
        if(!this.drivers.some(d=>d.v===seat)){
          const node=this.world.roads.reduce<RoadNode|null>((closest,node)=>!closest||distance(seat.root.position,node)<distance(seat.root.position,closest)?node:closest,null);
          this.drivers.push({v:seat,target:node?.id??-1,previous:node?.id??-1,police:false,stuck:0});
        }
        continue;
      }
      if (p.vehicleId) {
        const previous = this.vehicles.list.find(v => v.id === p.vehicleId);
        if (previous) this.occupancy.forget(previous);
        delete p.vehicleId; p.formerDriver = true;
      }
      this.onCharacterRestored?.(p.model);
    }
    this.facility.restoreCasualties(value.guards);this.police.restoreCasualties(value.police,value.nextOfficerId,this.drivers);for(const o of this.officers)if(o.state!=='riding'&&hasCasualtyState(o.model,o.health))this.onCharacterRestored?.(o.model);return true;
  }
  get officers() {
    return [...this.police.officers,...this.facility.guards];
  }
  hurtOfficer(officer: Officer, damage: number, kind: CharacterDamageKind = "impact", contact: DamageContact = {}) {
    if(this.facility.guards.includes(officer)){this.facility.onCharacterHit=this.onCharacterHit;this.facility.hurtGuard(officer,damage,kind,contact);return;}
    this.police.onCharacterHit = this.onCharacterHit;
    this.police.hurtOfficer(officer, damage, kind, contact);
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
