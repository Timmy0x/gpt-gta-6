import { PhysicsMotionType, Vector3, type Scene, type ShadowGenerator, type PhysicsEngineV2 } from "@babylonjs/core";
import type { RoadNode, WorldContract, WorldPopulationSite } from "../core/contracts";
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
import { hasCasualtyState, isDown, restoreCorpse, snapshotCasualty, validateCasualties, type PopulationCasualties, type Casualty, CASUALTY_LIMITS } from "./police/casualties";
import type { CharacterDamageKind, CharacterImpact } from "./combat/injuries";
import { bodyInjuryEffects } from './Injuries';
import { damageCharacter, recoverCharacter, type DamageContact } from './CharacterDamage';
import { NpcLocomotion } from './NpcLocomotion';
import { terminalApproachDistance, terminalSpeedLimit } from './TrafficRoute';
import { MovementQueries } from './MovementQueries';
import { CasualtyPlacement } from './CasualtyPlacement';
import { populationIdentitySeed } from '../world/miami/MiamiPopulationSites';
import { findGroundVehicleSpawn } from '../vehicles/spawnPlacement';

export const LOCAL_POPULATION_BUDGET = { pedestrians: 30, traffic: 12, totalAmbientVehicles: 48, spawnRadius: 115, pedestrianRetireRadius: 120, retireRadius: 180 } as const;
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
  idleRemaining?: number;
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
  private readonly residentSites = new Map<string, WorldPopulationSite>();
  private readonly residentIds = new Set<string>();
  private readonly retiredCasualties = new Map<string, Casualty>();
  private readonly ambientDrivers = new Map<Vehicle, string>();
  private readonly originalCarDamage = new Map<Vehicle, string>();
  private readonly preservedTrafficVehicles = new Set<string>();
  private residentQueries?: MovementQueries;
  private casualtyPlacement?: CasualtyPlacement;
  private residentTimer = 0;
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
    if (world.pedestrianSites?.length) {
      for (const site of world.pedestrianSites) this.residentSites.set(site.id, site);
      this.residentQueries = new MovementQueries(scene);
      this.casualtyPlacement = new CasualtyPlacement(scene);
      scene.onDisposeObservable.addOnce(() => this.residentQueries?.dispose());
    }
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
    if (world.pedestrianSpawns) for (const [i,p] of world.pedestrianSpawns.entries()) this.spawnPed(p.clone(),i,false,`miami-civilian-${i}`);
    else for (let i = 0; i < 30; i++) {
      const roadX = [-144, -72, 0, 72, 144][i % 5];
      const x = roadX + (i % 2 ? 11 : -11);
      const z = -170 + Math.floor(i / 5) * 63 + this.rng() * 12;
      this.spawnPed(new Vector3(x, 0, z), i, false);
    }
    for (const ped of this.pedestrians) {
      const site = this.residentSites.get(ped.id);
      if (site) { this.residentIds.add(ped.id); ped.target.copyFrom(site.target); }
    }
    // Keep original identities, then seed the new courts and park with persistent locals.
    // Their activity budget follows proximity so a growing map does not multiply AI work.
    for (const location of world.locations.filter(l => l.id.startsWith('inner-') && ['market', 'park', 'landmark'].includes(l.type))) {
      for (let i = 0; i < 3; i++) this.spawnPed(new Vector3(location.x + (i - 1) * .9, 0, location.z + 2), undefined, false, `${location.id}-civilian-${i}`);
    }
    const nodes = world.worldId ? world.roads.filter(node => distance(node,world.spawn)<160 && node.next.length>0) : world.roads;
    for (let i = 0; i < 12 && nodes.length; i++) {
      if (world.pedestrianSites?.length && this.vehicles.list.length >= LOCAL_POPULATION_BUDGET.totalAmbientVehicles) break;
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
      : /^(miami-local-|driver-miami-traffic-)/.test(id) ? populationIdentitySeed(id)
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
    ped.movement = new NpcLocomotion(this.scene, model, {ped}, this.player.boundary);
    this.pedestrians.push(ped);
    return ped;
  }
  private spawnDriver(node: RoadNode, police: boolean, i: number, stableId?: string) {
    const next = this.world.roads.find((n) => n.id === node.next[0]) || node;
    const heading = Math.atan2(next.x - node.x, next.z - node.z);
    const detailed = !police && i % 6 === 3 && this.vehicles.concept.ready
      && this.vehicles.list.filter(v => v.kind === "concept").length < DETAILED_CAR_LIMIT;
    const kind = police ? "police" : detailed ? "concept" : (["sedan", "suv", "truck", "coupe"][i % 4] as "sedan");
    let position = new Vector3(node.x, (node.y ?? 0) + 1, node.z);
    if (this.world.pedestrianSites?.length) {
      // The search's first forward sample lands exactly on this sourced lane.
      const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading));
      const clear = findGroundVehicleSpawn({scene:this.scene,kind,origin:position.subtract(forward.scale(6)),heading,
        obstacles:this.world.obstacles,vehicles:this.vehicles.list});
      if (!clear || distance(clear, node) > 2 || !this.world.hasGroundCoverage?.(clear.x, clear.z, 3.5)) return null;
      position = clear;
    }
    const v = this.vehicles.spawn(kind, position, heading, stableId);
    if (detailed) this.vehicles.setPaint(v, i < 6 ? "#51677D" : "#D9D9D2");
    const d = { v, target: next.id, previous: node.id, police, stuck: 0 };
    this.drivers.push(d);
    if (!police) {
      const ped = this.spawnPed(v.root.position, 100 + i, false, `driver-${v.id}`);
      ped.vehicleId = v.id;
      if (this.world.pedestrianSites?.length) {
        this.residentIds.add(ped.id); this.ambientDrivers.set(v, ped.id);
        this.originalCarDamage.set(v, JSON.stringify(this.vehicles.serialize(v).damage));
      }
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
      const origin=ped.model.root.position.clone(), physics=this.scene.getPhysicsEngine() as PhysicsEngineV2|null;
      const own=ped.movement?.controller?.shape, membership=own?.filterMembershipMask;
      if(own)own.filterMembershipMask=0;
      try {
        const support=physics?.raycast(origin.add(new Vector3(0,3,0)),origin.subtract(new Vector3(0,5,0)),{shouldHitTriggers:false});
        if(support?.hasHit && support.hitNormalWorld.y>.65 && Math.abs(support.hitPointWorld.y-origin.y)<3)
          ped.model.root.position.y = support.hitPointWorld.y + .35;
      } finally {if(own&&membership!==undefined)own.filterMembershipMask=membership;}
      ped.activity = "dead";
    }
    this.frighten(ped.model.root.position);
  }
  update(dt: number) {
    this.ticks += dt;
    const position = this.player.position;
    this.updateLocalPopulation(dt, position);
    for (const officer of this.officers) officer.health = recoverCharacter(officer.model, officer.health, dt, officer.role === 'patrol' ? 100 : officer.role === 'swat' ? 150 : 140);
    this.occupancy.update(dt);
    this.police.onCharacterHit = this.onCharacterHit;
    this.facility.onCharacterHit=this.onCharacterHit;
    this.facility.update(dt,this.policeEnabled);
    this.police.update(dt, this.drivers, this.policeEnabled,this.facility.observesSuspect);
    const trafficPeople = this.pedestrians.filter(ped => !ped.vehicleId && ped.health > 0 && ped.model.root.isEnabled()).map(ped => ped.model.root.position);
    if (!this.player.vehicle && this.player.deadTimer <= 0) trafficPeople.push(this.player.position);
    const roadNodes = new Map(this.world.roads.map(node => [node.id, node]));
    const nearbyCivilianDrivers = this.drivers.filter(d => !d.police && (!this.world.pedestrianSites?.length || distance(d.v.root.position, position) <= LOCAL_POPULATION_BUDGET.retireRadius));
    for (const d of this.drivers) {
      if (d.police || d.v.occupied) continue;
      if (this.world.pedestrianSites?.length && distance(d.v.root.position,position) > LOCAL_POPULATION_BUDGET.retireRadius) {
        this.vehicles.control(d.v,{throttle:0,steer:0,brake:1,handbrake:true,lift:0}); continue;
      }
      if (!this.occupancy.canDrive(d.v)) {
        this.vehicles.control(d.v, { throttle: 0, steer: 0, brake: 1, handbrake: true, lift: 0 });
        continue;
      }
      if (
        !d.police &&
        nearbyCivilianDrivers.indexOf(d) >= Math.floor(12 * this.trafficDensity)
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
      let target = roadNodes.get(d.target);
      if (!target) {
        d.stuck = 0;
        this.vehicles.control(d.v, { throttle: 0, steer: 0, brake: 1, handbrake: true, lift: 0 });
        continue;
      }
      // Keep a terminal as the target: there is no authored road beyond it.
      if (distance(p, target) < 9 && target.next.length > 0) {
        const options = target.next.filter((n) => n !== d.previous);
        d.previous = target.id;
        d.target =
          options[Math.floor(this.rng() * options.length)] ?? target.next[0];
        const nextTarget = roadNodes.get(d.target);
        if (!nextTarget) {
          d.stuck = 0;
          this.vehicles.control(d.v, { throttle: 0, steer: 0, brake: 1, handbrake: true, lift: 0 });
          continue;
        }
        target = nextTarget;
      }
      const terminalDistance = terminalApproachDistance(roadNodes, target, p);
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
      if (terminalDistance !== null) cruise = Math.min(cruise, terminalSpeedLimit(terminalDistance));
      // Waiting at a map endpoint is intentional, so never invent a reverse route.
      d.stuck = terminalDistance === null && Math.abs(d.v.speed) < 0.7 && cruise > 0 ? d.stuck + dt : 0;
      this.vehicles.control(d.v, {
        throttle: d.stuck > 6 ? -0.45 : Math.abs(d.v.speed) < cruise ? 0.65 : 0,
        steer: d.stuck > 6 ? -steer : steer,
        brake: cruise <= 0 ? 1 : Math.abs(d.v.speed) > cruise ? 0.75 : 0,
        handbrake: terminalDistance !== null && cruise <= 0 && Math.abs(d.v.speed) < .7,
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
        if (vehicle) { ped.model.root.setEnabled(!this.world.pedestrianSites?.length || vehicle.occupied || vehicle.controlLocked || distance(vehicle.root.position,position) <= LOCAL_POPULATION_BUDGET.retireRadius); continue; }
        delete ped.vehicleId;
        ped.formerDriver = true;
        ped.activity = ped.health > 0 ? 'walking' : 'dead';
        ped.home.copyFrom(ped.model.root.position);
        ped.target.copyFrom(ped.home);
      }
      // Older saves recorded health without a corpse pose/ledger.
      if(ped.health<=0&&!ped.model.dead){restoreCorpse(ped.model,snapshotCasualty(ped.id,ped.model));ped.activity="dead";ped.report=0;}
      const active = ped.creative || ped.formerDriver || hasCasualtyState(ped.model,ped.health) || ambient.has(ped);
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
      if (ped.idleRemaining) {
        ped.idleRemaining = Math.max(0, ped.idleRemaining - elapsed);
        if (ped.idleRemaining <= 0) ped.activity = 'walking';
      }
      if (distance(p, ped.target) < 1 && !ped.idleRemaining) {
        const site = this.residentSites.get(ped.id);
        ped.target = site ? (distance(p, site.target) < 1 ? site.position.clone() : site.target.clone())
          : ped.home.add(new Vector3(0, 0, (this.rng() - 0.5) * 55));
        ped.activity = ped.panic
          ? "fleeing"
          : this.rng() < 0.25
            ? "on phone"
            : "walking";
        if (ped.activity === "on phone") ped.idleRemaining = 3 + this.rng() * 6;
      }
      const stationary=this.residentSites.get(ped.id)?.stationary;
      let speed = ped.panic ? 4.2 : stationary || ped.activity === "on phone" ? 0.0 : 1.25;
      if(stationary&&!ped.panic)ped.activity="standing";
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
  /** Distant pristine activity retires; changed people retain their identity and injury state. */
  private updateLocalPopulation(dt: number, position: Vector3): void {
    if (!this.world.pedestrianSites?.length || !this.residentQueries) return;
    this.residentTimer -= dt;
    if (this.residentTimer > 0) return;
    this.residentTimer = .5;
    // Do not create bodies until the player's current support halo is ready.
    if (this.world.collisionReady?.(position) === false) return;
    for (const [vehicle, id] of this.ambientDrivers) {
      const ped = this.pedestrians.find(person => person.id === id);
      if (vehicle.root.isDisposed() || !this.vehicles.list.includes(vehicle)) {
        this.ambientDrivers.delete(vehicle); this.originalCarDamage.delete(vehicle); continue;
      }
      if (!ped || ped.formerDriver || !ped.vehicleId) {
        this.ambientDrivers.delete(vehicle); this.originalCarDamage.delete(vehicle); continue;
      }
      // Entry can be cancelled before the civilian is ejected. Keep the
      // original damage baseline and identity through that temporary handoff.
      if (vehicle.occupied || vehicle.controlLocked) continue;
      if (distance(vehicle.root.position, position) <= LOCAL_POPULATION_BUDGET.retireRadius) continue;
      // Damage, casualties, theft and ongoing door handoffs never vanish through culling.
      if (ped.health < 100 || hasCasualtyState(ped.model,ped.health) || this.changedAmbientCar(vehicle)) continue;
      this.occupancy.forget(vehicle);
      this.drivers = this.drivers.filter(driver => driver.v !== vehicle);
      this.removeResident(ped);
      this.vehicles.remove(vehicle);
      this.ambientDrivers.delete(vehicle); this.originalCarDamage.delete(vehicle);
    }
    for (const ped of [...this.pedestrians]) {
      if (!this.residentIds.has(ped.id) || ped.creative || ped.vehicleId) continue;
      const range=distance(ped.model.root.position, position);
      if (range <= LOCAL_POPULATION_BUDGET.retireRadius && (range <= LOCAL_POPULATION_BUDGET.pedestrianRetireRadius || !this.outsideView(ped.model.root.position))) continue;
      if (ped.health < 100 || hasCasualtyState(ped.model,ped.health))
        this.retiredCasualties.set(ped.id,snapshotCasualty(ped.id,ped.model,ped.health));
      else this.retiredCasualties.delete(ped.id);
      this.removeResident(ped);
    }
    const budget = Math.floor(LOCAL_POPULATION_BUDGET.pedestrians * clamp(this.density,0,1));
    const residentCount=this.pedestrians.filter(p => this.residentIds.has(p.id) && !p.vehicleId).length;
    let available = budget - residentCount;
    // Existing injuries and corpses are world state, independent of crowd density.
    let restorationAvailable=LOCAL_POPULATION_BUDGET.pedestrians-residentCount;
    if (restorationAvailable > 0) {
      // Cached casualties use their saved positions, never their original home.
      const dormant = [...this.retiredCasualties.values()].filter(entry => !entry.vehicleId
        && !this.pedestrians.some(ped => ped.id === entry.id) && distance(entry,position) <= LOCAL_POPULATION_BUDGET.spawnRadius)
        .sort((a,b)=>distance(a,position)-distance(b,position)||a.id.localeCompare(b.id));
      for (const entry of dormant) {
        if (restorationAvailable <= 0) break;
        const point = new Vector3(entry.x,entry.y,entry.z);
        const support=this.supportedResidentPoint(point,true);
        if (!support) continue;
        const lying=entry.fallen!==false || !bodyInjuryEffects(entry.bodyInjuries??null).canStand;
        if (lying ? !this.casualtyPlacement!.clear(entry,support.ground,support.body)
          : !this.residentQueries.clear(support.ground.add(new Vector3(0,.94,0)))) continue;
        const ped = this.spawnPed(point,undefined,false,entry.id);
        this.residentIds.add(ped.id);
        ped.health=entry.health??0; ped.activity=ped.health>0?'injured':'dead';
        ped.target.copyFrom(this.residentSites.get(ped.id)?.target??point);
        restoreCorpse(ped.model,entry);
        this.onCharacterRestored?.(ped.model);
        available--; restorationAvailable--;
      }
      const candidates = [...this.residentSites.values()].filter(site => !this.retiredCasualties.has(site.id)
        && !this.pedestrians.some(ped => ped.id===site.id) && distance(site.position,position)>=18
        && distance(site.position,position)<=LOCAL_POPULATION_BUDGET.spawnRadius && this.outsideView(site.position))
        .sort((a,b)=>distance(a.position,position)-distance(b.position,position)||a.id.localeCompare(b.id));
      // Spread allocations over time rather than creating a frame-sized crowd.
      let created=0;
      for (const site of candidates) {
        if (available<=0 || created>=3) break;
        const point = this.verifiedResidentPoint(site.position), target = this.verifiedResidentPoint(site.target);
        if (!point || !target || !this.residentQueries.path(point.add(new Vector3(0,.94,0)),target.add(new Vector3(0,.94,0)))) continue;
        if (this.pedestrians.some(ped => distance(ped.model.root.position,point)<2.5)) continue;
        const ped=this.spawnPed(point,undefined,false,site.id); this.residentIds.add(ped.id);
        ped.target.copyFrom(target); ped.home.copyFrom(point); if(site.stationary)ped.activity='standing';
        available--;created++;
      }
    }
    const trafficBudget=Math.floor(LOCAL_POPULATION_BUDGET.traffic*clamp(this.trafficDensity,0,1));
    const activeTraffic=this.drivers.filter(driver=>!driver.police&&distance(driver.v.root.position,position)<=LOCAL_POPULATION_BUDGET.retireRadius).length;
    if(activeTraffic>=trafficBudget || this.vehicles.list.length>=LOCAL_POPULATION_BUDGET.totalAmbientVehicles) return;
    const roadNodes = new Map(this.world.roads.map(node=>[node.id,node]));
    const lanes=this.world.roads.filter(node=>node.next.some(id=>roadNodes.has(id)) && distance(node,position)>=45
      && distance(node,position)<=105 && this.outsideView(new Vector3(node.x,node.y??position.y,node.z))
      && !this.vehicles.list.some(vehicle=>vehicle.id===`miami-traffic-${node.id}`)
      && !this.retiredCasualties.has(`driver-miami-traffic-${node.id}`))
      .sort((a,b)=>distance(a,position)-distance(b,position)||a.id-b.id);
    for(const node of lanes) if(this.spawnDriver(node,false,populationIdentitySeed(`miami-traffic-${node.id}`)%24,`miami-traffic-${node.id}`)) break;
  }
  private supportedResidentPoint(position: Vector3, cached=false) {
    if (!this.world.hasGroundCoverage?.(position.x,position.z,.45)) return null;
    const physics=this.scene.getPhysicsEngine() as PhysicsEngineV2;
    // Cached roots are ground anchors. Start just above that anchor, beneath
    // any low overhead structure, so an overhang is not mistaken for support.
    const support=physics.raycast(position.add(new Vector3(0,cached ? .15 : 3.5,0)),position.subtract(new Vector3(0,3.5,0)),{shouldHitTriggers:false});
    if(!support.hasHit || support.hitNormalWorld.y<=.65 || support.body?.getMotionType()!==PhysicsMotionType.STATIC
      || support.body.transformNode.metadata?.miamiKind==='building') return null;
    const ground=support.hitPointWorld.clone();
    if(Math.abs(ground.y-position.y)>2) return null;
    return {ground,body:support.body};
  }
  private verifiedResidentPoint(position:Vector3):Vector3|null{
    const support=this.supportedResidentPoint(position);
    return support&&this.residentQueries!.clear(support.ground.add(new Vector3(0,.94,0)))?support.ground:null;
  }
  private outsideView(position: Vector3): boolean {
    const camera=this.player.camera;
    if (!camera) return true;
    const cameraPosition=camera.globalPosition, delta=position.subtract(cameraPosition);
    if (delta.lengthSquared()<1) return false;
    return Vector3.Dot(delta.normalize(),camera.getForwardRay().direction)<.35;
  }
  private changedAmbientCar(vehicle: Vehicle): boolean {
    if (this.preservedTrafficVehicles.has(vehicle.id)) return true;
    const original=this.originalCarDamage.get(vehicle);
    const changed=vehicle.health<100 || !!original && original!==JSON.stringify(this.vehicles.serialize(vehicle).damage);
    if(changed)this.preservedTrafficVehicles.add(vehicle.id);
    return changed;
  }
  private removeResident(ped: Pedestrian): void {
    ped.movement?.pause(); ped.model.dispose();
    this.pedestrians=this.pedestrians.filter(person=>person!==ped);
  }
  get ambientStats() {
    return {sites:this.residentSites.size,residentPedestrians:this.pedestrians.filter(p=>this.residentIds.has(p.id)&&!p.vehicleId).length,
      cachedCasualties:[...this.retiredCasualties.keys()].filter(id=>!this.pedestrians.some(p=>p.id===id)).length,traffic:this.drivers.filter(d=>!d.police&&distance(d.v.root.position,this.player.position)<=LOCAL_POPULATION_BUDGET.retireRadius).length,
      preservedTrafficVehicles:this.preservedTrafficVehicles.size};
  }
  /** Player recovery clears pursuit, but only an explicit encounter reset revives the world. */
  reset(revive = true) {
    if (revive) this.retiredCasualties?.clear();
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
    const civilians = new Map(this.retiredCasualties);
    for (const ped of this.pedestrians) {
      const seat = ped.vehicleId && this.vehicles.list.find(vehicle => vehicle.id === ped.vehicleId);
      if (hasCasualtyState(ped.model,ped.health) || this.world.pedestrianSites?.length && (ped.health < 100 || !!seat && this.changedAmbientCar(seat)))
        civilians.set(ped.id,{...snapshotCasualty(ped.id,ped.model,ped.health),...(ped.vehicleId?{vehicleId:ped.vehicleId}:{})});
      else civilians.delete(ped.id);
    }
    if (civilians.size > CASUALTY_LIMITS.civilians) throw new Error('Civilian persistence budget exceeded');
    return {version:this.world.pedestrianSites?.length||civilians.size>60?4:3,civilians:[...civilians.values()].sort((a,b)=>a.id.localeCompare(b.id)),guards:this.facility.guards.filter(g=>hasCasualtyState(g.model,g.health)).map(g=>snapshotCasualty(g.id,g.model,g.health)),...this.police.serializeCasualties()};
  }
  restoreCasualties(value:unknown):boolean {
    if(!validateCasualties(value))return false;
    if (this.world.pedestrianSites?.length) {
      this.retiredCasualties.clear();
      for (const entry of value.civilians) this.retiredCasualties.set(entry.id, structuredClone(entry));
    }
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
        if(this.world.pedestrianSites?.length){this.residentIds.add(p.id);this.ambientDrivers.set(seat,p.id);this.preservedTrafficVehicles.add(seat.id);}
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
