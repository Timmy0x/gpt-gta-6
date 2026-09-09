import { isDown } from "./casualties";
import type { CharacterDamageKind, CharacterImpact } from "../combat/injuries";
import {
  Ray,
  Frustum,
  MeshBuilder,
  PBRMaterial,
  Color3,
  SpotLight,
  Vector3,
  type Scene,
  type ShadowGenerator,
} from "@babylonjs/core";
import type { RoadNode, WorldContract } from "../../core/contracts";
import {
  angleDelta,
  clamp,
  distance,
  random,
  type Point2,
} from "../../core/math";
import type { Vehicle, VehicleSystem } from "../../vehicles/VehicleSystem";
import type { Character } from "../Character";
import type { Player } from "../Player";
import type { WantedSystem } from "../Wanted";
import { Officer, type OfficerRole } from "./Officer";
import { vehicleFootRoute } from "./vehicleFootRoute";
import {
  accessible,
  ARREST_SECONDS,
  clearSight,
  compliant,
  laneNext,
  OFFICER_LIMIT,
  responseFor,
} from "./rules";
import { lineBlocked } from "../../core/math";
import { CASUALTY_LIMITS, restoreCorpse, snapshotCasualty, type PoliceCasualty } from "./casualties";
export interface Driver {
  v: Vehicle;
  target: number;
  previous: number;
  police: boolean;
  stuck: number;
  assignment?: "patrol" | "swat" | "roadblock" | "air";
  recovery?: { anchor: Point2; timer: number; reverse: number; attempts: number; stranded: boolean };
  turn?: { at: number; next: number };
}
const STOP = { throttle: 0, steer: 0, brake: 1, handbrake: true, lift: 0 };
export class PoliceDirector {
  officers: Officer[] = [];
  resistance = 0;
  arrestProgress = 0;
  onArrest = () => {};
  onMessage = (_message: string) => {};
  onCharacterHit:
    | ((model: Character, impulse: Vector3, fatal: boolean, impact: CharacterImpact) => void)
    | null = null;
  private spawnTimer = 0;
  private nextOfficerId = 1;
  private rng = random(911);
  private elapsed = 0;
  private challengeTimer = 0;
  private clearTime = 0;
  private searchlight: SpotLight | null = null;
  private lastPlayer = Vector3.Zero();
  constructor(
    private scene: Scene,
    private shadows: ShadowGenerator,
    private world: WorldContract,
    private vehicles: VehicleSystem,
    private player: Player,
    private wanted: WantedSystem,
  ) {
    this.lastPlayer.copyFrom(player.position);
  }
  resist(seconds = 12) {
    this.resistance = Math.max(this.resistance, seconds);
    this.arrestProgress = 0;
  }
  hurtOfficer(officer: Officer, amount: number, kind: CharacterDamageKind = "impact") {
    if (
      !this.officers.includes(officer) ||
      officer.health <= 0 ||
      !Number.isFinite(amount) ||
      amount <= 0
    )
      return;
    officer.health = Math.max(0, officer.health - amount);
    if(officer.health<=0)officer.model.dead=true;
    this.resist();
    this.wanted.crime(
      officer.health <= 0 ? 150 : 80,
      this.player.position,
      true,
    );
    const impulse = officer.position
      .subtract(this.player.position)
      .normalize()
      .scale(Math.min(12, amount * 0.16));
    impulse.y = 1.5;
    if (this.onCharacterHit) {
      officer.state = "pursuit";
      this.onCharacterHit(officer.model, impulse, officer.health <= 0, { kind, damage: amount, health: officer.health });
    } else if (officer.health <= 0) {
      officer.model.root.rotation.z = Math.PI / 2;
      officer.model.root.position.y = 0.35;
    }
    if (officer.health <= 0) {
      officer.state = "injured";
      officer.controller?.dispose();
      officer.controller = null;
    }
  }
  /** No spawn inside camera frustum unless an actual structure occludes its whole sampled footprint. */
  private outsideView(point: Vector3) {
    const camera = this.scene.activeCamera;
    if (!camera) return true;
    const planes = Frustum.GetPlanes(camera.getTransformationMatrix());
    const eye = camera.globalPosition;
    return [
      new Vector3(0, 1, 0),
      new Vector3(5, 2.5, 0),
      new Vector3(-5, 2.5, 0),
      new Vector3(0, 2.5, 5),
      new Vector3(0, 2.5, -5),
    ].every((offset) => {
      const sample = point.add(offset);
      return (
        !Frustum.IsPointInFrustum(sample, planes) ||
        !clearSight(eye, sample, this.world.obstacles)
      );
    });
  }
  private spawnNode(drivers: Driver[], roadblock = false) {
    const p = this.player.position;
    const forward =
      this.player.vehicle?.root.forward ??
      new Vector3(
        Math.sin(this.player.heading),
        0,
        Math.cos(this.player.heading),
      );
    const candidates = this.world.roads.filter(
      (n) =>
        n.next.length &&
        distance(n, p) > 95 &&
        distance(n, p) < 245 &&
        accessible(n, this.world.obstacles, 3) &&
        !drivers.some((d) => distance(d.v.root.position, n) < 18) &&
        this.outsideView(new Vector3(n.x, 1, n.z)),
    );
    candidates.sort((a, b) =>
      roadblock
        ? Vector3.Dot(new Vector3(b.x - p.x, 0, b.z - p.z), forward) -
          Vector3.Dot(new Vector3(a.x - p.x, 0, a.z - p.z), forward)
        : distance(a, this.wanted.lastKnown) -
          distance(b, this.wanted.lastKnown),
    );
    return candidates[Math.floor(this.rng() * Math.min(4, candidates.length))];
  }
  private dispatch(
    drivers: Driver[],
    assignment: NonNullable<Driver["assignment"]>,
  ) {
    const node = this.spawnNode(drivers, assignment === "roadblock");
    if (!node) return false;
    (this.world as WorldContract&{ensureCollision?:(p:Vector3)=>void}).ensureCollision?.(new Vector3(node.x,1,node.z));
    const next = this.world.roads.find((n) => n.id === node.next[0]) ?? node;
    const heading =
      Math.atan2(next.x - node.x, next.z - node.z) +
      (assignment === "roadblock" ? Math.PI / 2 : 0);
    const v = this.vehicles.spawn(
      assignment === "air" ? "helicopter" : "police",
      new Vector3(node.x, assignment === "air" ? 1.8 : 1, node.z),
      heading,
    );
    v.siren = true;
    v.occupied = assignment === "air";
    for (const window of v.model.windows) window.visibility = 0.42; // Instance opacity reveals the real seated crew without changing shared materials.
    const d: Driver = {
      v,
      target: next.id,
      previous: node.id,
      police: true,
      stuck: 0,
      assignment,
    };
    drivers.push(d);
    const role: OfficerRole = assignment === "swat" ? "swat" : "patrol";
    const count = assignment === "swat" ? 2 : 1;
    for (
      let seat = 0;
      seat < count && this.officers.filter(o=>!isDown(o.model,o.health)).length < OFFICER_LIMIT && this.officers.length < OFFICER_LIMIT+CASUALTY_LIMITS.police;
      seat++
    )
      this.officers.push(
        new Officer(
          `officer-${this.nextOfficerId++}`,
          role,
          v.id,
          this.scene,
          this.shadows,
          seat,
        ),
      );
    if (assignment === "air") {
      this.searchlight = new SpotLight(
        "police-searchlight",
        v.root.position,
        new Vector3(0, -1, 0),
        0.75,
        2,
        this.scene,
      );
      this.searchlight.diffuse = new Color3(0.88, 0.93, 1);
      this.searchlight.intensity = 7;
      this.searchlight.range = 105;
    }
    if (assignment === "roadblock") {
      // Roadblock is a collidable vehicle driven by the same Havok system, never a visual-only barrier.
      const bar = MeshBuilder.CreateBox(
        `${v.id}/ROADBLOCK`,
        { width: 1.7, height: 0.24, depth: 0.05 },
        this.scene,
      );
      bar.parent = v.root;
      bar.position.set(0, 1.05, -1.9);
      const mat = new PBRMaterial(`${v.id}/roadblock-reflector`, this.scene);
      mat.albedoColor = new Color3(1, 0.55, 0.08);
      mat.emissiveColor = new Color3(0.2, 0.1, 0);
      bar.material = mat;
      bar.onDisposeObservable.addOnce(() => mat.dispose());
      this.vehicles.control(v, STOP);
    }
    this.onMessage(
      assignment === "swat"
        ? "Tactical response is arriving."
        : assignment === "roadblock"
          ? "Police are setting a roadblock."
          : assignment === "air"
            ? "Air support has been dispatched."
            : "Police are responding to the reported location.",
    );
    return true;
  }
  private sees(observer: Vector3, range: number) {
    const p = this.player.position;
    return (
      distance(observer, p) < range &&
      clearSight(
        observer,
        p.add(new Vector3(0, 0.45, 0)),
        this.world.obstacles,
      ) &&
      this.wanted.recognizes(
        p,
        this.player.vehicle?.id ?? null,
        this.player.name,
        distance(observer, p),
      )
    );
  }
  update(dt: number, drivers: Driver[], enabled: boolean, externalContact=false) {
    this.elapsed += dt;
    this.spawnTimer -= dt;
    this.challengeTimer -= dt;
    this.resistance = Math.max(0, this.resistance - dt);
    const position = this.player.position;
    this.updateCasualties(dt,position);
    const actualSpeed =
      distance(position, this.lastPlayer) / Math.max(dt, 0.001);
    this.lastPlayer.copyFrom(position);
    const profile = responseFor(this.wanted.stars);
    let seen = enabled&&externalContact;
    if (enabled && this.wanted.stars) {
      for (const o of this.officers)
        if (
          o.health > 0 &&
          !o.model.root.metadata?.ragdollActive &&
          this.sees(o.position.add(new Vector3(0, 0.65, 0)), profile.sight)
        ) {
          seen = true;
          break;
        }
      const air = drivers.find((d) => d.assignment === "air");
      if (
        air &&
        air.v.health > 0 &&
        air.v.root.position.y > 15 &&
        this.sees(air.v.root.position, 175)
      )
        seen = true;
    }
    this.wanted.update(
      dt,
      position,
      seen,
      this.player.vehicle?.id ?? null,
      this.player.name,
    );
    if (!enabled) {
      this.removeResponse(drivers,false);
      return;
    }
    this.clearTime = this.wanted.stars ? 0 : this.clearTime + dt;
    if (this.clearTime > 8 && drivers.some((d) => d.police)) {
      this.removeResponse(drivers,false);
      return;
    }
    const response = responseFor(this.wanted.stars);
    const counts = (kind: Driver["assignment"]) =>
      drivers.filter((d) => d.police && d.assignment === kind).length;
    if (
      this.wanted.stars &&
      this.spawnTimer <= 0 &&
      this.officers.filter(o=>!isDown(o.model,o.health)).length < OFFICER_LIMIT &&
      this.officers.filter(o=>isDown(o.model,o.health)).length < CASUALTY_LIMITS.police &&
      this.officers.length < OFFICER_LIMIT+CASUALTY_LIMITS.police
    ) {
      const assignment =
        counts("patrol") < response.patrol
          ? "patrol"
          : counts("swat") < response.swat
            ? "swat"
            : counts("roadblock") < response.roadblocks
              ? "roadblock"
              : response.helicopter && !counts("air")
                ? "air"
                : null;
      if (assignment) this.dispatch(drivers, assignment);
      this.spawnTimer = this.wanted.stars >= 3 ? 2.8 : 3.6;
    }
    for (const d of drivers.filter((d) => d.police)) this.drive(dt, d, drivers);
    let arresting = false;
    const threat = this.resistance > 0 || this.player.aim;
    const canArrest = compliant(
      this.player.vehicle?.speed ?? actualSpeed,
      threat,
      this.player.aim,
      this.player.deadTimer > 0,
    );
    for (const o of [...this.officers]) {
      o.fireTimer -= dt;
      o.flashTime = Math.max(0, o.flashTime - dt);
      o.flash.setEnabled(o.flashTime > 0);
      if (o.health <= 0) {
        continue;
      }
      if (o.model.root.metadata?.ragdollActive) {
        o.controller?.dispose();
        o.controller = null;
        continue;
      }
      const driver = drivers.find((d) => d.v.id === o.vehicleId);
      if (o.state === "riding" && driver) {
        const v = driver.v;
        const side = o.seat ? 0.45 : -0.45;
        o.model.root.position.copyFrom(
          v.root.position
            .add(v.root.right.scale(side))
            .add(v.root.forward.scale(v.kind === "helicopter" ? 0.8 : 0.1)),
        ).y -= 0.9;
        o.model.root.rotation.y = v.heading;
        o.model.animate(dt, 0, false, false);
        o.model.pose("seated");
        o.weapon.setEnabled(false);
        if (
          driver.assignment !== "air" &&
          Math.abs(v.speed) < 2.1 &&
          (driver.assignment === "roadblock" ||
            driver.recovery?.stranded ||
            ((!this.player.vehicle ||
              Math.abs(this.player.vehicle.speed) < 1.5) &&
              distance(v.root.position, this.wanted.lastKnown) < 25) ||
            v.health < 25)
        )
          this.dismount(o, v);
        continue;
      }
      if (!o.controller)
        o.dismount(o.model.root.position.add(new Vector3(0, 0.95, 0)));
      const p = o.position;
      (this.world as WorldContract&{ensureCollision?:(p:Vector3)=>void}).ensureCollision?.(p);
      const contact =
        this.wanted.stars > 0 &&
        this.sees(p.add(new Vector3(0, 0.6, 0)), profile.sight);
      const gap = distance(p, position);
      const inArrestRange = gap < (this.player.vehicle ? 4.3 : 2.65);
      if (contact && canArrest && inArrestRange) arresting = true;
      const aim = contact && (threat || gap < 13);
      const firing =
        contact &&
        threat &&
        gap < (o.role === "swat" ? 48 : 32) &&
        o.fireTimer <= 0 &&
        this.player.deadTimer <= 0;
      if (firing) {
        this.fire(o);
        o.fireTimer = o.role === "swat" ? 0.7 : 1.1;
        o.flashTime = 0.065;
        o.flash.setEnabled(true);
      }
      o.state = firing
        ? "firing"
        : contact && gap < 13
          ? "challenge"
          : this.wanted.phase === "search" || this.wanted.phase === "cooldown"
            ? "search"
            : "pursuit";
      if (contact && gap < 16 && this.challengeTimer <= 0) {
        this.onMessage("POLICE: Stop, lower your weapon and remain still.");
        this.challengeTimer = 8;
      }
      let goal: Point2 = this.wanted.lastKnown;
      if (contact) goal = { x: position.x, z: position.z };
      const returningToCar =
        !!this.player.vehicle &&
        Math.abs(this.player.vehicle.speed) > 3 &&
        !!driver &&
        driver.v.health > 25 &&
        distance(p, driver.v.root.position) < 45;
      if (returningToCar && driver) {
        const entry = driver.v.root.position.add(
          driver.v.root.right.scale(o.seat ? 2.5 : -2.5),
        );
        goal = entry;
        if (distance(p, entry) < 1.5 && Math.abs(driver.v.speed) < 1.5) {
          o.controller?.dispose();
          o.controller = null;
          o.state = "riding";
          continue;
        }
      } else if (!contact && distance(p, goal) < 5) {
        const node = this.world.roads
          .filter((n) => distance(n, this.wanted.lastKnown) < 60)
          .sort((a, b) => a.id - b.id)[
          (Number(o.id.split("-").at(-1)) + Math.floor(this.elapsed / 10)) %
            Math.max(
              1,
              this.world.roads.filter(
                (n) => distance(n, this.wanted.lastKnown) < 60,
              ).length,
            )
        ];
        if (node) goal = node;
      }
      const nearestLane = [...this.world.roads].sort(
        (a, b) => distance(a, goal) - distance(b, goal),
      )[0];
      if (nearestLane && distance(nearestLane, goal) > 55) goal = nearestLane;
      o.routeTimer -= dt;
      if (o.routeTimer <= 0) {
        o.path = vehicleFootRoute(p, goal, this.world.roads, this.world.obstacles, this.vehicles.list);
        o.routeTimer = 1 + o.seat * 0.12;
      }
      while (o.path.length && distance(p, o.path[0]) < .45) o.path.shift();
      const target = o.path[0];
      const direction = target
        ? new Vector3(target.x - p.x, 0, target.z - p.z).normalize()
        : Vector3.Zero();
      // Close contact stops at handcuff distance; officers do not push through the player's body.
      let speed =
        this.wanted.stars && target ? (o.role === "swat" ? 4.8 : 4.4) : 0;
      if (!returningToCar && contact && gap < (threat ? 9 : 2.2)) speed = 0;
      if (!speed && aim) direction.copyFrom(position.subtract(p));
      direction.y = 0;
      direction.normalize();
      o.move(dt, direction, speed, aim);
    }
    this.arrestProgress =
      arresting && seen && canArrest
        ? Math.min(1, this.arrestProgress + dt / ARREST_SECONDS)
        : 0;
    if (this.arrestProgress >= 1) {
      this.arrestProgress = 0;
      this.onArrest();
    }
    for (let i = drivers.length - 1; i >= 0; i--) {
      const d = drivers[i];
      if (!d.police || d.v === this.player.vehicle) continue;
      const crew = this.officers.filter((o) => o.vehicleId === d.v.id);
      if (
        crew.every((o) => isDown(o.model, o.health) && o.deadTime > 12) &&
        distance(d.v.root.position, position) > 70 &&
        this.outsideView(d.v.root.position)
      ) {
        this.vehicles.remove(d.v);
        drivers.splice(i, 1);
      }
    }
    // Remove orphaned rigs after a player deletes or commandeers their response vehicle.
    for (const o of [...this.officers])
      if (
        o.state === "riding" &&
        !drivers.some((d) => d.v.id === o.vehicleId)
      ) {
        o.dispose();
        this.officers.splice(this.officers.indexOf(o), 1);
      }
  }
  private fire(o: Officer) {
    const origin = o.position.add(new Vector3(0, 0.5, 0));
    const target = this.player.position.add(new Vector3(0, 0.35, 0));
    const delta = target.subtract(origin),
      length = delta.length();
    const hit = this.scene.pickWithRay(
      new Ray(origin, delta.normalize(), length),
      (m) => {
        if (m.metadata?.officer === o || !m.isEnabled()) return false;
        return !!(
          m.metadata?.cameraBlocker ||
          m.metadata?.prop ||
          m.metadata?.officer ||
          m.metadata?.vehicleId ||
          m.parent?.metadata?.vehicleId
        );
      },
    );
    const amount = o.role === "swat" ? 7 : 5;
    if (hit?.hit && hit.pickedMesh) {
      let node: import("@babylonjs/core").Node | null = hit.pickedMesh;
      while (node && !node.metadata?.vehicleId) node = node.parent;
      const vehicle = this.vehicles.list.find(
        (v) => v.id === node?.metadata?.vehicleId,
      );
      if (vehicle)
        this.vehicles.damage(vehicle, amount * 0.4, hit.pickedPoint ?? target);
      if (hit.distance < length - 0.8) return;
    }
    this.player.hurt(amount);
  }
  private updateCasualties(dt:number,position:Vector3){
    for(const officer of [...this.officers])if(isDown(officer.model,officer.health)){
      officer.deadTime+=dt;
      if(officer.deadTime>25&&distance(officer.position,position)>50&&this.outsideView(officer.position)){
        officer.dispose();this.officers.splice(this.officers.indexOf(officer),1);
      }
    }
  }
  private dismount(o: Officer, v: Vehicle) {
    for (const sign of [o.seat ? 1 : -1, o.seat ? -1 : 1]) {
      const p = v.root.position.add(v.root.right.scale(sign * 2.5));
      p.y = Math.max(1.15, p.y + 0.5);
      if (accessible(p, this.world.obstacles)) {
        o.dismount(p);
        return;
      }
    }
  }
  private drive(dt: number, d: Driver, drivers: Driver[]) {
    const v = d.v;
    if (this.player.vehicle === v) {
      v.siren = false;
      return;
    }
    const crew = this.officers.filter(
      (o) => o.vehicleId === v.id && o.health > 0 && o.state === "riding",
    );
    if (!crew.length || !v.health) {
      if (d.assignment === "air") v.occupied = false;
      this.vehicles.control(v, STOP);
      return;
    }
    const p = v.root.position,
      goal = this.wanted.lastKnown;
    if (d.assignment === "air") {
      const targetHeight = this.wanted.stars ? 58 : 3;
      const error = angleDelta(
        v.heading,
        Math.atan2(goal.x - p.x, goal.z - p.z),
      );
      this.vehicles.control(v, {
        throttle:
          p.y > 24 && distance(p, goal) > 35
            ? Math.max(0, Math.cos(error)) * 0.5
            : 0,
        steer: clamp(error * 0.9, -1, 1),
        brake: 0,
        handbrake: false,
        lift: clamp((targetHeight - p.y) * 0.15, -1, 1),
      });
      if (this.searchlight) {
        this.searchlight.position.copyFrom(p);
        this.searchlight.direction.copyFrom(
          new Vector3(goal.x - p.x, -p.y, goal.z - p.z).normalize(),
        );
      }
      return;
    }
    if (d.assignment === "roadblock" || !this.wanted.stars) {
      this.vehicles.control(v, STOP);
      return;
    }
    let target = this.world.roads.find((n) => n.id === d.target);
    if (!target) {
      this.vehicles.control(v, STOP);
      return;
    }
    // Approach/departure nodes are only 20 m apart. Advancing 10 m early cuts
    // across the sidewalk on sharp turns and can send a bumped car into a facade.
    if (distance(p, target) < 3.5) {
      d.previous = target.id;
      d.target = laneNext(target.id, goal, this.world.roads);
      target = this.world.roads.find((n) => n.id === d.target) ?? target;
    }
    const vehicleObstacles = this.world.obstacles.filter(o => o.height > 0.5).map(o => ({...o,w:o.w+2.6,d:o.d+2.6}));
    const clearDrive = (a: Point2,b: Point2) => !lineBlocked(a,b,vehicleObstacles);
    const close =
      distance(p, goal) < 38 &&
      clearDrive(p,goal);
    const tx = close ? goal.x : target.x,
      tz = close ? goal.z : target.z;
    const error = angleDelta(v.heading, Math.atan2(tx - p.x, tz - p.z));
    let cruise: number = responseFor(this.wanted.stars).speed;
    if (Math.abs(error) > 0.45) cruise = 6;
    if(d.turn?.at!==target.id)d.turn={at:target.id,next:laneNext(target.id,goal,this.world.roads)};
    const next = this.world.roads.find(n => n.id === d.turn!.next);
    if (next) {
      const turn = Math.abs(angleDelta(Math.atan2(target.x-p.x,target.z-p.z),Math.atan2(next.x-target.x,next.z-target.z)));
      if(turn>.55) cruise=Math.min(cruise,Math.sqrt(36+2*5*Math.max(0,distance(p,target)-3)));
    }
    if (
      (!this.player.vehicle || Math.abs(this.player.vehicle.speed) < 1.5) &&
      close &&
      distance(p, goal) < 20
    )
      cruise = 0;
    for (const other of this.vehicles.list) {
      if (other === v) continue;
      const delta = other.root.position.subtract(p);
      const gap = delta.length();
      if (gap < 9 && Vector3.Dot(delta.normalize(), v.root.forward) > 0.84)
        cruise = 0;
    }
    const recovery=d.recovery??= {anchor:{x:p.x,z:p.z},timer:0,reverse:0,attempts:0,stranded:false};
    if(recovery.stranded){this.vehicles.control(v,STOP);return;}
    if(recovery.reverse>0){
      recovery.reverse-=dt;
      this.vehicles.control(v,{throttle:-.42,steer:clamp(-error*1.6,-1,1),brake:Math.abs(v.forwardSpeed)>3.5?1:0,handbrake:false,lift:0});
      if(recovery.reverse<=0){
        // Rejoin a visible paved connector after backing out; continuing to aim
        // at the old waypoint can repeat the same collision indefinitely.
        const rejoin=this.world.roads.filter(n=>n.next.length&&distance(p,n)<65&&clearDrive(p,n)).sort((a,b)=>distance(p,a)-distance(p,b))[0];
        if(rejoin)d.target=rejoin.id;
        recovery.anchor={x:p.x,z:p.z};recovery.timer=0;
      }
      return;
    }
    recovery.timer+=dt;
    if(distance(p,recovery.anchor)>2){recovery.anchor={x:p.x,z:p.z};recovery.timer=0;}
    const parkedAtSuspect=close&&distance(p,goal)<20&&(!this.player.vehicle||Math.abs(this.player.vehicle.speed)<1.5);
    if(recovery.timer>3&&!parkedAtSuspect){
      recovery.attempts++;
      recovery.timer=0;
      if(recovery.attempts>=3){recovery.stranded=true;this.vehicles.control(v,STOP);return;}
      recovery.reverse=2.2;
    }
    d.stuck = recovery.timer;
    this.vehicles.control(v, {
      throttle: Math.abs(v.speed) < cruise ? 0.7 : 0,
      steer: clamp(error * 1.8, -1, 1),
      brake: Math.abs(v.speed) > cruise + 0.5 || cruise === 0 ? 1 : 0,
      handbrake: cruise === 0,
      lift: 0,
    });
    void drivers;
  }
  removeResponse(drivers: Driver[], removeCasualties = true) {
    for (const o of this.officers)if(removeCasualties||!isDown(o.model,o.health))o.dispose();
    this.officers = removeCasualties?[]:this.officers.filter(o=>isDown(o.model,o.health));
    for (let i = drivers.length - 1; i >= 0; i--)
      if (drivers[i].police) {
        if (drivers[i].v !== this.player.vehicle)
          this.vehicles.remove(drivers[i].v);
        else {
          drivers[i].v.siren = false;
        }
        drivers.splice(i, 1);
      }
    this.searchlight?.dispose();
    this.searchlight = null;
    this.arrestProgress = 0;
    this.resistance = 0;
    this.spawnTimer = 0;
  }
  reset(drivers: Driver[], revive = true) {
    this.removeResponse(drivers,revive);
    this.wanted.setLevel(0, this.player.position);
    this.lastPlayer.copyFrom(this.player.position);
  }
  serializeCasualties(){
    return {police:this.officers.filter(o=>isDown(o.model,o.health)&&o.role!=="military").slice(-CASUALTY_LIMITS.police).map(o=>({...snapshotCasualty(o.id,o.model,o.health),role:o.role as "patrol"|"swat"})),nextOfficerId:Math.max(this.nextOfficerId,...this.officers.map(o=>Number(o.id.slice(8))+1).filter(Number.isFinite))};
  }
  restoreCasualties(entries:PoliceCasualty[],nextOfficerId:number){
    for(const officer of [...this.officers])if(isDown(officer.model,officer.health)){officer.dispose();this.officers.splice(this.officers.indexOf(officer),1);}
    this.nextOfficerId=Math.max(this.nextOfficerId,nextOfficerId,...entries.map(e=>Number(e.id.slice(8))+1));
    for(const entry of entries.slice(-CASUALTY_LIMITS.police)){
      const officer=new Officer(entry.id,entry.role,"retired-response",this.scene,this.shadows);officer.health=entry.health??0;officer.state="injured";
      restoreCorpse(officer.model,entry);officer.weapon.setEnabled(false);this.officers.push(officer);
    }
  }
  get stats() {
    return {
      officers: this.officers.length,
      activeFoot: this.officers.filter(
        (o) => o.health > 0 && o.state !== "riding",
      ).length,
      swat: this.officers.filter((o) => o.role === "swat").length,
      resisting: this.resistance > 0,
      arrestProgress: this.arrestProgress,
    };
  }
}
