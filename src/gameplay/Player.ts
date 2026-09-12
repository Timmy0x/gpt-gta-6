import {
  CharacterSupportedState,
  PhysicsCharacterController,
  Quaternion,
  Ray,
  UniversalCamera,
  Vector3,
  type PhysicsEngineV2,
  type PhysicsShape,
  type Scene,
  type ShadowGenerator,
} from "@babylonjs/core";
import type { Input } from "../core/Input";
import { angleDelta, clamp } from "../core/math";
import { Swimming, type SwimWater } from "./Swimming";
import { SwimAnimation } from "./SwimAnimation";
import { WorldBoundary } from "../world/WorldBoundary";
import { Character } from "./Character";
import { poseVehicleEntrant, VEHICLE_INTERACTION_TIMING as INTERACTION } from './VehicleInteractionPose';
import type { Vehicle } from "../vehicles/VehicleSystem";
import { openVehicleDoor } from "../vehicles/VehicleEquipment";
import { MovementQueries } from "./MovementQueries";
import { turnWeaponHeading, WEAPON_ARM_CONE, WEAPON_FIRE_CONE } from "./WeaponFacing";
import { EJECTION_SECONDS, VehicleOccupancy, parkedVehicleInput, vehicleSeatOffset, vehicleSeatPose } from "./VehicleOccupancy";
import { blockedCrawlEffects, bodyInjuryEffects, cloneBodyInjuries, type BodyInjuryState } from './Injuries';
import { damageCharacter, recoverCharacter, type DamageContact } from './CharacterDamage';
import type { CharacterImpact } from './combat/injuries';
import { CrawlingCollider } from './CrawlingCollider';
export class Player {
  controller: PhysicsCharacterController;
  model: Character;
  camera: UniversalCamera;
  vehicle: Vehicle | null = null;
  health = 100;
  armor = 50;
  name = "Jason";
  yaw = 0;
  pitch = 0.08;
  heading = 0;
  speed = 0;
  swimming = false;
  readonly swim = new Swimming();
  readonly swimAnimation = new SwimAnimation();
  water?: SwimWater;
  readonly boundary = new WorldBoundary();
  crouched = false;
  god = false;
  noclip = false;
  deadTimer = 0;
  aim = false;
  weaponRaised = false;
  weaponAvailable = true;
  weaponInputBlocked = false;
  scopeMagnification = 1;
  driveByActive = false;
  weaponFacingReady = false;
  private weaponHold = 0;
  queries: MovementQueries;
  interactionMessage = "";
  transitioning = false;
  readonly occupancy = new VehicleOccupancy();
  vehiclePhase: 'on-foot' | 'approaching' | 'ejecting-driver' | 'entering' | 'seated' | 'exiting' = 'on-foot';
  climbing = false;
  private mountTime = 0;
  private mountDoorOpened = false;
  private mountHeading = 0;
  private mountStart = Vector3.Zero();
  private mountDoor = Vector3.Zero();
  private exitDestination: Vector3 | null = null;
  private ejectDestination: Vector3 | null = null;
  private mountSide: -1 | 1 = -1;
  private climbPath: Vector3[] = [];
  private climbTime = 0;
  private hitTime = 0;
  private velocity = Vector3.Zero();
  private previous = Vector3.Zero();
  private cameraTarget = Vector3.Zero();
  private crawlCollider: CrawlingCollider;
  private fallCollisionFilters: {shape: PhysicsShape; membership: number}[] | null = null;
  onCharacterHit: ((model: Character, impulse: Vector3, fatal: boolean, impact: CharacterImpact) => void) | null = null;
  constructor(
    public scene: Scene,
    public shadows: ShadowGenerator,
    public input: Input,
    spawn: Vector3,
  ) {
    this.crawlCollider = new CrawlingCollider(scene);
    this.queries = new MovementQueries(scene, () => this.crawlCollider.queryExclusions(this.controller));
    const existingBodies = new Set((scene.getPhysicsEngine() as PhysicsEngineV2).getBodies());
    this.controller = new PhysicsCharacterController(
      spawn,
      { capsuleHeight: 1.8, capsuleRadius: 0.32 },
      scene,
    );
    this.controller.maxStepHeight = 0.36;
    this.controller.characterMass = 80;
    this.controller.characterStrength = 1600;
    this.model = new Character(scene, shadows, "Jason", "#d8d3c5", false, undefined, { licensedPlayerSkin: true });
    for (const body of (scene.getPhysicsEngine() as PhysicsEngineV2).getBodies())
      if (!existingBodies.has(body)) body.transformNode.metadata = {...body.transformNode.metadata, characterOwner: this};
    this.model.parts.forEach(mesh => mesh.metadata = {...mesh.metadata, characterOwner: this});
    this.previous.copyFrom(spawn);
    this.camera = new UniversalCamera(
      "third-person",
      spawn.add(new Vector3(0, 3, -7)),
      scene,
    );
    this.camera.minZ = 0.12;
    this.camera.maxZ = 1500;
    this.camera.fov = 0.88;
    this.camera.inputs.clear();
    scene.activeCamera = this.camera;
  }
  get position() {
    return this.vehicle
      ? this.vehicle.root.position
      : this.controller.getPosition();
  }
  get canDrive() { return this.deadTimer <= 0 && bodyInjuryEffects(this.model.bodyInjuries).canStand; }
  switchCharacter(force = false) {
    if (!force && (this.model.root.metadata?.ragdollActive || !bodyInjuryEffects(this.model.bodyInjuries).canStand)) return;
    const injuries = this.model.bodyInjuries ? cloneBodyInjuries(this.model.bodyInjuries) : null;
    this.name = this.name === "Jason" ? "Lucia" : "Jason";
    this.model.dispose();
    this.model = new Character(
      this.scene,
      this.shadows,
      this.name,
      this.name === "Lucia" ? "#8d283b" : "#d8d3c5",
      this.name === "Lucia",
      undefined,
      { licensedPlayerSkin: true },
    );
    this.model.bodyInjuries = injuries;
    this.model.parts.forEach(mesh => mesh.metadata = {...mesh.metadata, characterOwner: this});
    if (this.vehicle && !this.transitioning) this.attachSeat();
  }
  teleport(p: Vector3) {
    this.climbPath = [];
    this.climbing = false;
    this.controller.setPosition(p);
    this.controller.setVelocity(Vector3.Zero());
    this.previous.copyFrom(p);
    this.swim.update(p, this.water, 0);
    this.swimming = this.swim.active;
    this.swimAnimation.reset();
  }
  enter(v: Vehicle) {
    this.interactionMessage = "";
    if (this.vehicle || this.transitioning || this.deadTimer > 0) return false;
    if (!bodyInjuryEffects(this.model.bodyInjuries).canStand) { this.interactionMessage = 'Unable to enter while down.'; return false; }
    if (Math.abs(v.speed) > 5) {
      this.interactionMessage = "Wait for the vehicle to slow down.";
      return false;
    }
    const from = this.position.clone();
    const driver = this.occupancy.get(v);
    const driverSide: -1 | 1 = vehicleSeatOffset(v).x > 0 ? 1 : -1;
    this.mountSide = Vector3.Dot(from.subtract(v.root.position), v.root.right) < 0 ? -1 : 1;
    if (driver && this.mountSide !== driverSide) {
      this.interactionMessage = driverSide < 0 ? "Driver's door · left" : "Driver's door · right";
      return false;
    }
    if (driver && (!driver.alive() || driver.model.root.metadata?.ragdollActive)) {
      this.interactionMessage = "The driver is incapacitated. Use another vehicle.";
      return false;
    }
    this.ejectDestination = driver ? this.safeExit(v, driverSide) : null;
    if (driver && !this.ejectDestination) {
      this.interactionMessage = "The driver's door is blocked.";
      return false;
    }
    const destination = v.root.position.add(new Vector3(0, 0.8, 0));
    const obstruction = this.scene
      .getPhysicsEngine()!
      .raycast(from, destination, { ignoreBody: v.body });
    if (
      obstruction.hasHit &&
      obstruction.hitDistance < Vector3.Distance(from, destination) - 0.2
    ) {
      this.interactionMessage =
        "The door is blocked. Approach from the other side.";
      return false;
    }
    this.vehicle = v;
    this.mountDoorOpened = false;
    v.occupied = true;
    v.controlLocked = true;
    v.input = parkedVehicleInput(v);
    this.mountStart.copyFrom(this.model.root.position);
    this.mountHeading = this.model.root.rotation.y;
    const entry = v.root.position.add(v.root.right.scale(this.mountSide * (v.tuning.width / 2 + .48)));
    entry.y = this.mountStart.y;
    // Stand beside the opening: both hands must reach the seated driver's upper body.
    entry.addInPlace(v.root.forward.scale(-.20));
    this.mountDoor.copyFrom(entry);
    this.mountTime = 0;
    this.transitioning = true;
    this.vehiclePhase = 'approaching';
    this.crouched = false;
    this.controller.setPosition(new Vector3(0, -100, 0));
    this.controller.setVelocity(Vector3.Zero());
    this.yaw = Math.atan2(v.root.forward.x, v.root.forward.z);
    return true;
  }
  private seatOffset() {
    return vehicleSeatOffset(this.vehicle!);
  }
  private attachSeat() {
    this.model.root.parent = this.vehicle!.root;
    this.model.root.position.copyFrom(this.seatOffset());
    this.model.root.rotation.set(0, 0, 0);
    this.model.root.rotationQuaternion = Quaternion.Identity();
    this.model.root.setEnabled(true);
  }
  /** Saved occupants resume in their supported seat, including incapacitated survivors. */
  restoreSeat(vehicle: Vehicle): void {
    this.vehicle = vehicle;
    this.vehiclePhase = 'seated'; this.transitioning = false;
    this.climbing = false; this.climbPath = [];
    this.restoreFallCollision();
    this.controller.setPosition(new Vector3(0, -100, 0));
    this.controller.setVelocity(Vector3.Zero());
    vehicle.occupied = true; vehicle.controlLocked = false;
    vehicle.input = parkedVehicleInput(vehicle);
    this.heading = this.yaw = vehicle.heading;
    this.attachSeat();
    this.model.pose('seated', 1, vehicleSeatPose(vehicle));
    this.model.applySeatedInjuryPose(bodyInjuryEffects(this.model.bodyInjuries));
  }
  exit(force = false) {
    if (!this.vehicle) return true;
    const v = this.vehicle;
    this.interactionMessage = "";
    if (!force && (this.model.dead || !bodyInjuryEffects(this.model.bodyInjuries).canStand)) {
      this.interactionMessage = "Unable to exit while down.";
      return false;
    }
    if (!force && this.transitioning) {
      this.interactionMessage = "Finish entering or exiting first.";
      return false;
    }
    if (!force && Math.abs(v.speed) > 10) {
      this.interactionMessage = "Slow down before exiting.";
      return false;
    }
    let p = this.safeExit(v);
    if (!p && !force) {
      this.interactionMessage = "No safe exit here. Move away from the obstruction.";
      return false;
    }
    p ??= v.root.position.add(new Vector3(v.tuning.width + 1, 1.5, 0));
    v.input = parkedVehicleInput(v);
    if (force) { this.finishExit(v, p); return true; }
    this.mountSide = Vector3.Dot(p.subtract(v.root.position), v.root.right) < 0 ? -1 : 1;
    this.mountDoorOpened = false;
    this.model.root.computeWorldMatrix(true);
    this.mountStart.copyFrom(this.model.root.getAbsolutePosition());
    this.model.root.parent = null;
    this.model.root.position.copyFrom(this.mountStart);
    this.model.root.rotationQuaternion = null;
    this.model.root.rotation.y = v.heading;
    this.exitDestination = p;
    this.mountTime = 0;
    this.vehiclePhase = 'exiting';
    this.transitioning = true;
    v.controlLocked = true;
    return true;
  }

  private safeExit(v: Vehicle, side?: -1 | 1): Vector3 | null {
    // The entrant is deliberately beside the ejection path. Exclude only their
    // own capsule from these synchronous queries, then restore normal contacts.
    const shape = this.controller.shape;
    const membership = shape.filterMembershipMask;
    shape.filterMembershipMask = 0;
    try { return this.findSafeExit(v, side); }
    finally { shape.filterMembershipMask = membership; }
  }

  private findSafeExit(v: Vehicle, side?: -1 | 1): Vector3 | null {
    // Land behind the front door swing so its physical panel can open beside the
    // actor. Both sides first, then the rear; world obstacles remain swept.
    const doorLandingZ = v.model.doors.length ? -.65 : 0;
    const candidates = side ? [new Vector3(side * (v.tuning.width / 2 + .7), 0, -.65)] : [
      new Vector3(-v.tuning.width / 2 - 0.62, 0, doorLandingZ),
      new Vector3(v.tuning.width / 2 + 0.62, 0, doorLandingZ),
      new Vector3(0, 0, -v.tuning.length / 2 - 0.65),
    ];
    for (const local of candidates) {
      const offset = v.root.right
        .scale(local.x)
        .add(v.root.forward.scale(local.z));
      const candidate = v.root.position.add(offset);
      const ground = this.queries.ground(candidate, 1.5, 3, v.body);
      if (ground && ground.y > v.root.position.y + 0.45) continue;
      const water = this.water?.surfaceHeight(candidate.x, candidate.z);
      if (water != null && this.water!.depthAt(candidate.x, candidate.z) > 1.3 && candidate.y < water + 2)
        candidate.y = water - .45;
      else if (ground) candidate.y = ground.y + 0.94;
      else continue;
      const start = new Vector3(
        v.root.position.x,
        candidate.y,
        v.root.position.z,
      );
      if (
        this.queries.clear(candidate) &&
        this.queries.path(start, candidate, v.body)
      ) {
        return candidate;
      }
    }
    return null;
  }

  private finishExit(v: Vehicle, p: Vector3) {
    this.heading = this.model.root.rotation.y;
    this.model.root.parent = null;
    this.model.root.rotationQuaternion = null;
    this.transitioning = false;
    this.vehiclePhase = 'on-foot';
    this.exitDestination = null;
    this.ejectDestination = null;
    this.controller.setShapeOptions(
      { capsuleHeight: 1.8, capsuleRadius: 0.32 },
      false,
    );
    this.teleport(p);
    v.occupied = false;
    v.controlLocked = false;
    // Stop feeding the last driver's throttle after leaving the seat.
    v.input = parkedVehicleInput(v);
    this.vehicle = null;
    this.model.root.setEnabled(true);
  }
  hurt(amount: number, ignoreArmor = false, contact: DamageContact & {kind?: CharacterImpact['kind']} = {}) {
    if (this.god || this.deadTimer > 0) return;
    this.hitTime = 0.35;
    const result = damageCharacter(this.model, this.health, amount, contact.kind ?? 'impact', contact, ignoreArmor ? 0 : this.armor);
    this.health = result.health;
    if (!ignoreArmor) this.armor = result.armor;
    if (!this.vehicle && !this.swimming && !this.transitioning) this.onCharacterHit?.(this.model, result.impulse, this.health <= 0, result.impact);
    // Police, fire and crashes can damage us after this frame's movement
    // update. Exclude the controller before the very first ragdoll step.
    if (!this.vehicle && this.model.root.metadata?.ragdollActive) this.suspendFallCollision();
    if (this.health <= 0) this.deadTimer = 4;
  }
  /** Physical falls hand back one ground anchor without clearing regional injuries. */
  resumeFromFall(groundAnchor: Vector3): void {
    this.restoreFallCollision();
    this.heading = this.model.root.rotationQuaternion?.toEulerAngles().y ?? this.model.root.rotation.y;
    this.controller.setShapeOptions({capsuleHeight: 1.8, capsuleRadius: .32}, false);
    this.controller.setPosition(groundAnchor.add(new Vector3(0, .94, 0)));
    this.controller.setVelocity(Vector3.Zero());
    this.previous.copyFrom(this.controller.getPosition());
  }
  restoreBodyState(state: BodyInjuryState | null, postureHeight = 1.8): void {
    this.restoreFallCollision();
    this.model.bodyInjuries = state ? cloneBodyInjuries(state) : null;
    this.model.dead = false; this.model.injury = null;
    this.model.root.metadata = {...this.model.root.metadata, ragdollActive: false, ragdollRecovering: false, ragdollHandoffActive: false};
    this.model.skeleton.returnToRest();
    if (postureHeight < .9 && state) this.crawlCollider.apply(this.controller, this.heading);
    else this.controller.setShapeOptions({capsuleHeight: postureHeight, capsuleRadius: .32});
    this.previous.copyFrom(this.controller.getPosition());
  }
  private restoreFallCollision(): void {
    this.fallCollisionFilters?.forEach(({shape, membership}) => shape.filterMembershipMask = membership);
    this.fallCollisionFilters = null;
  }
  private suspendFallCollision(): void {
    if (!this.fallCollisionFilters) {
      const own = this.crawlCollider.queryExclusions(this.controller)!;
      this.fallCollisionFilters = (Array.isArray(own) ? own : [own]).map(shape => ({shape, membership: shape.filterMembershipMask}));
      this.fallCollisionFilters.forEach(({shape}) => shape.filterMembershipMask = 0);
    }
    this.controller.setVelocity(Vector3.Zero());
  }
  update(dt: number) {
    this.health = recoverCharacter(this.model, this.health, dt);
    let injuries = bodyInjuryEffects(this.model.bodyInjuries);
    if (!this.vehicle && this.model.root.metadata?.ragdollActive) {
      this.suspendFallCollision();
      this.speed = 0; this.aim = this.weaponRaised = this.weaponFacingReady = false;
      return;
    }
    this.previous.copyFrom(this.controller.getPosition());
    if (!this.vehicle) {
      const recovery = this.boundary.recovery(this.position, .94, .34);
      if (recovery) this.teleport(recovery.position);
    }
    this.aim = this.deadTimer <= 0 && injuries.canAim && !this.weaponInputBlocked && this.input.aim;
    const canRaise = injuries.canAim && this.weaponAvailable && !this.weaponInputBlocked && this.deadTimer <= 0 && !this.vehicle && !this.transitioning && !this.climbing && !this.swimming;
    this.weaponHold = canRaise && (this.input.aim || this.input.mouseDown) ? 0.65 : Math.max(0, this.weaponHold - dt);
    this.weaponRaised = canRaise && this.weaponHold > 0;
    this.weaponFacingReady = false;
    if (this.deadTimer > 0) {
      this.climbPath = [];
      this.climbing = false;
    }
    this.hitTime = Math.max(0, this.hitTime - dt);
    if (this.vehicle) {
      this.swim.update(this.position, undefined, dt);
      this.swimming = false;
      this.swimAnimation.reset();
      this.model.root.rotation.x = this.model.root.rotation.z = 0;
    }
    if (this.vehicle) {
      const vehicle = this.vehicle;
      this.speed = 0;
      this.model.animate(dt, 0);
      this.mountTime += dt;
      const pose = vehicleSeatPose(vehicle);
      if (this.vehiclePhase === 'approaching') {
        if (!this.mountDoorOpened && this.mountTime >= INTERACTION.doorReach) {
          openVehicleDoor(vehicle, this.mountSide, (this.ejectDestination ? INTERACTION.ejection + INTERACTION.handoff : 0) + INTERACTION.enter + .6);
          this.mountDoorOpened = true;
        }
        if (this.mountTime >= INTERACTION.approach) {
          this.mountStart.copyFrom(this.mountDoor);
          this.mountTime = 0;
          if (this.ejectDestination && this.occupancy.beginEjection(vehicle, this.ejectDestination.subtract(new Vector3(0, .94, 0))))
            this.vehiclePhase = 'ejecting-driver';
          else this.vehiclePhase = 'entering';
        }
      } else if (this.vehiclePhase === 'ejecting-driver') {
        this.model.pose('mount', .28, pose);
        if (this.mountTime >= EJECTION_SECONDS + INTERACTION.handoff) {
          this.vehiclePhase = 'entering';
          this.mountTime = 0;
        }
      } else if (this.vehiclePhase === 'entering') {
        this.model.pose('mount', Math.min(1, this.mountTime / INTERACTION.enter), pose);
        if (this.mountTime >= INTERACTION.enter) {
          this.transitioning = false;
          this.vehiclePhase = 'seated';
          vehicle.controlLocked = false;
          this.attachSeat();
        }
      } else if (this.vehiclePhase === 'exiting') {
        if (!this.mountDoorOpened && this.mountTime >= .13) {
          openVehicleDoor(vehicle, this.mountSide, INTERACTION.exit + .35);
          this.mountDoorOpened = true;
        }
        this.model.pose('mount', 1 - Math.min(1, this.mountTime / INTERACTION.exit), pose);
        if (this.mountTime >= INTERACTION.exit) {
          const destination = this.exitDestination!;
          if (this.queries.clear(destination) && this.queries.path(new Vector3(vehicle.root.position.x, destination.y, vehicle.root.position.z), destination, vehicle.body))
            this.finishExit(vehicle, destination);
          else {
            this.interactionMessage = 'The exit became blocked. Move the vehicle and try again.';
            this.vehiclePhase = 'seated';
            this.transitioning = false;
            this.exitDestination = null;
            vehicle.controlLocked = false;
            this.attachSeat();
          }
        }
      } else {
        this.model.pose('seated', 1, pose);
        this.model.applySeatedInjuryPose(injuries);
        if (!injuries.canStand) vehicle.input = parkedVehicleInput(vehicle);
      }
      return;
    }
    this.swim.update(this.position, this.water, dt);
    this.swimming = this.swim.active;
    if (injuries.mode === 'recovering' && this.controller.shape === this.crawlCollider.shape) {
      const standing = this.position.add(new Vector3(0, .9 - this.controller.footOffset, 0));
      if (!this.queries.clear(standing)) { this.model.bodyInjuries!.riseRemaining = 3; injuries = blockedCrawlEffects(injuries); }
    }
    const remainProne = !this.swimming && (injuries.mode === 'crawling' || injuries.mode === 'down' || injuries.mode === 'recovering' && !this.queries.clear(this.position.add(new Vector3(0, .9 - this.controller.footOffset, 0))));
    let crouch = !this.swimming && this.input.down("crouch");
    if (
      !crouch &&
      this.crouched &&
      !this.queries.clear(this.position.add(new Vector3(0, 0.25, 0)))
    )
      crouch = true;
    this.crouched = crouch;
    const h = this.crouched ? 1.3 : 1.8;
    if (remainProne) this.crawlCollider.apply(this.controller, this.heading);
    else if (this.controller.shapeOptions.capsuleHeight !== h || this.controller.shape === this.crawlCollider.shape) {
      this.controller.setShapeOptions({
        capsuleHeight: h,
        capsuleRadius: 0.32,
      });
      this.controller.maxStepHeight = .36;
    }
    const x = this.input.axis("x"),
      z = this.input.axis("y");
    const move = new Vector3(
      x * Math.cos(this.yaw) + z * Math.sin(this.yaw),
      0,
      z * Math.cos(this.yaw) - x * Math.sin(this.yaw),
    );
    if (move.lengthSquared() > 1) move.normalize();
    const targetSpeed = this.swimming
      ? this.input.down("sprint") ? 2.8 : 1.8
      : this.crouched
        ? 1.65
        : this.input.down("sprint") && injuries.canSprint
          ? 7.1
          : 3.7;
    move.scaleInPlace(this.deadTimer > 0 || this.model.root.metadata?.ragdollHandoffActive ? 0 : Math.min(targetSpeed * injuries.speedScale, injuries.maxSpeed));
    if (remainProne && move.lengthSquared() > .0001) {
      const intended = Math.atan2(move.x, move.z), turn = angleDelta(this.heading, intended);
      this.heading += clamp(turn, -dt * 2.8, dt * 2.8);
      const speed = move.length() * Math.max(0, Math.cos(angleDelta(this.heading, intended)));
      move.set(Math.sin(this.heading) * speed, 0, Math.cos(this.heading) * speed);
      this.crawlCollider.apply(this.controller, this.heading);
    }
    const surface = this.controller.checkSupport(dt, new Vector3(0, -1, 0));
    const grounded =
      surface.supportedState === CharacterSupportedState.SUPPORTED;
    if (this.climbPath.length) {
      this.climbTime -= dt;
      const target = this.climbPath[0];
      const delta = target.subtract(this.position);
      if (this.climbTime <= 0) this.climbPath = [];
      else if (
        delta.length() < 0.07 ||
        (this.climbPath.length === 1 && grounded && delta.length() < 0.18)
      )
        this.climbPath.shift();
      else {
        this.controller.setVelocity(
          this.boundary.limitVelocity(this.position, delta.normalize().scale(Math.min(3.6, delta.length() / dt)), dt, .34),
        );
        this.controller.integrate(dt, surface, Vector3.Zero());
      }
      this.climbing = this.climbPath.length > 0;
      this.speed = 0;
      this.model.animate(dt, 0);
      this.model.pose("climb");
      return;
    }
    const last = this.controller.getVelocity();
    this.velocity.set(
      move.x,
      grounded ? Math.max(last.y, 0) : last.y - 9.81 * dt,
      move.z,
    );
    if (
      this.input.take("jump") &&
      this.deadTimer <= 0 &&
      injuries.canJump &&
      grounded && !this.swimming
    ) {
      const mantle =
        !this.crouched &&
        !this.swimming &&
        this.queries.mantle(
          this.position,
          this.speed > 0.1 ? this.heading : this.yaw,
        );
      if (mantle) {
        this.climbPath = [mantle.top, mantle.across, mantle.end];
        this.climbing = true;
        this.climbTime = 2;
      } else this.velocity.y = 5.7;
    }
    if (this.swimming) {
      this.velocity.y = this.swim.verticalVelocity(this.position, last.y, z, this.pitch, this.input.down("jump"), this.input.down("crouch"), dt);
      if (this.swim.breath <= 0) this.hurt(8 * dt, true);
    }
    if (this.noclip) {
      this.velocity.y =
        (Number(this.input.down("jump")) - Number(this.input.down("crouch"))) *
        (this.deadTimer > 0 ? 0 : 12);
      this.controller.setPosition(
        this.position.add(this.boundary.limitVelocity(this.position, this.velocity.scale(3), dt, .34).scale(dt)),
      );
    } else {
      this.controller.setVelocity(this.boundary.limitVelocity(this.position, this.velocity, dt, .34));
      this.controller.integrate(
        dt,
        surface,
        this.swimming ? Vector3.Zero() : new Vector3(0, -9.81, 0),
      );
    }
    this.speed = Math.hypot(this.position.x - this.previous.x, this.position.z - this.previous.z) / Math.max(.001, dt);
    if (move.lengthSquared() > .01 && !this.weaponRaised && !remainProne)
      this.heading +=
        angleDelta(this.heading, Math.atan2(move.x, move.z)) *
        Math.min(1, dt * 14);
    if (this.weaponRaised) {
      const forward = this.camera.getForwardRay().direction;
      this.heading = turnWeaponHeading(this.heading, Math.atan2(forward.x, forward.z), dt);
    }
    this.model.root.rotation.y = this.heading;
    this.model.animate(dt, this.speed, this.weaponRaised, this.crouched);
    if (!this.swimming) this.model.applyInjuryPose(injuries, dt, this.speed);
    this.swimAnimation.update(dt, this.swimming && !this.noclip, this.speed, this.swim.submerged, this.velocity.y);
    if (this.swimming) this.model.swimPose(this.swimAnimation.phase, this.swimAnimation.stroke, this.swim.submerged);
    else if (this.hitTime > 0 && injuries.mode === 'healthy') this.model.pose("hit", this.hitTime / 0.35);
    this.alignWeaponPose();
    const recovery = this.boundary.recovery(this.position, .94, .34);
    if (recovery) this.teleport(recovery.position);
  }
  render(dt: number, alpha = 1, allowLook = true) {
    const sensitivity = 1 / Math.max(1, this.scopeMagnification);
    const targetFov = 2 * Math.atan(Math.tan(.88 / 2) / Math.max(1, this.scopeMagnification));
    this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 14);
    if (allowLook) {
      this.yaw +=
        (this.input.dx * 0.0025 + (this.input.gamepad?.axes[2] || 0) * dt * 2.2) * sensitivity;
      this.pitch = clamp(
        this.pitch +
          (this.input.dy * 0.002 +
          (this.input.gamepad?.axes[3] || 0) * dt * 1.5) * sensitivity,
        -0.5,
        1.1,
      );
    }
    const physicallyDown = !!this.model.root.metadata?.ragdollActive;
    const p = physicallyDown ? this.model.jointPosition('pelvis') : this.position;
    if (!this.vehicle && !physicallyDown) {
      this.model.root.position.copyFrom(Vector3.Lerp(this.previous, p, alpha));
      this.model.root.position.y -= this.controller.footOffset;
      const swim = this.swimAnimation;
      this.model.root.rotation.set(swim.pitch, this.heading, swim.roll);
      if (swim.blend > .001) {
        const rotation = Quaternion.RotationYawPitchRoll(this.heading, swim.pitch, swim.roll);
        const pelvis = this.model.skeleton.bones[0].getPosition().clone();
        pelvis.y *= this.model.root.scaling.y;
        pelvis.rotateByQuaternionToRef(rotation, pelvis);
        const anchor = Vector3.Lerp(this.previous, p, alpha);
        anchor.y += this.swim.submerged ? .02 : .1 + swim.stroke * .08;
        const origin = anchor.subtract(pelvis);
        Vector3.LerpToRef(this.model.root.position, origin, swim.blend, this.model.root.position);
      }
    } else if (this.vehicle && this.transitioning) {
      this.vehicle.root.computeWorldMatrix(true);
      const seat = Vector3.TransformCoordinates(
        this.seatOffset(),
        this.vehicle.root.getWorldMatrix(),
      );
      if (this.vehiclePhase !== 'on-foot' && this.vehiclePhase !== 'seated') {
        const duration = this.vehiclePhase === 'approaching' ? INTERACTION.approach : this.vehiclePhase === 'ejecting-driver' ? EJECTION_SECONDS + INTERACTION.handoff : this.vehiclePhase === 'entering' ? INTERACTION.enter : INTERACTION.exit;
        const destination = this.vehiclePhase === 'exiting' ? this.exitDestination!.subtract(new Vector3(0, .94, 0)) : seat;
        poseVehicleEntrant(this.model, this.vehicle, this.vehiclePhase, this.mountTime / duration, this.mountStart, this.mountDoor, destination, this.mountSide, vehicleSeatPose(this.vehicle), this.occupancy.get(this.vehicle)?.model, this.mountHeading);
      }
    }
    if (
      allowLook &&
      this.vehicle && !this.aim &&
      Math.abs(this.vehicle.speed) > 2 &&
      Math.abs(this.input.dx) < 0.1 &&
      Math.abs(this.input.gamepad?.axes[2] || 0) < 0.08
    ) {
      const forward = this.vehicle.root.forward;
      this.yaw +=
        angleDelta(this.yaw, Math.atan2(forward.x, forward.z)) * dt * 1.7;
    }
    const target = p.add(new Vector3(0, this.vehicle ? 1.2 : 0.64, 0));
    const range = this.vehicle ? this.driveByActive ? 3.8 : 8.4 : this.aim ? 2.1 : 5.0;
    let desired = target.add(
      new Vector3(
        -Math.sin(this.yaw) * Math.cos(this.pitch) * range,
        Math.sin(this.pitch) * range + 0.45,
        -Math.cos(this.yaw) * Math.cos(this.pitch) * range,
      ),
    );
    if (this.aim)
      desired.addInPlace(
        new Vector3(Math.cos(this.yaw) * 0.65, 0, -Math.sin(this.yaw) * 0.65),
      );
    const delta = desired.subtract(target);
    const hit = this.scene.pickWithRay(
      new Ray(target, delta.normalizeToNew(), delta.length()),
      (m) => !!m.metadata?.cameraBlocker,
    );
    if (hit?.hit && hit.pickedPoint)
      desired = hit.pickedPoint.subtract(delta.normalizeToNew().scale(0.3));
    this.camera.position = Vector3.Lerp(
      this.camera.position,
      desired,
      1 - Math.exp(-dt * 12),
    );
    this.cameraTarget.copyFrom(target);
    this.camera.setTarget(this.cameraTarget);
    if (this.scopeMagnification > 1 && !this.vehicle) {
      const direction = new Vector3(Math.sin(this.yaw) * Math.cos(this.pitch), -Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch));
      const eye = p.add(new Vector3(0, .62, 0));
      this.camera.position.copyFrom(eye.add(direction.scale(.06)));
      this.camera.setTarget(eye.add(direction.scale(100)));
    }
    this.alignWeaponPose();
  }
  private alignWeaponPose(): void {
    this.weaponFacingReady = false;
    if (!this.weaponRaised || this.vehicle || this.transitioning || this.climbing || this.swimming || this.deadTimer > 0) return;
    const forward = this.camera.getForwardRay().direction;
    const error = Math.abs(angleDelta(this.heading, Math.atan2(forward.x, forward.z)));
    if (error <= WEAPON_ARM_CONE) this.model.aimToward(forward);
    this.weaponFacingReady = error <= WEAPON_FIRE_CONE;
  }
}
