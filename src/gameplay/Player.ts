import {
  CharacterSupportedState,
  PhysicsCharacterController,
  Quaternion,
  Ray,
  UniversalCamera,
  Vector3,
  type Scene,
  type ShadowGenerator,
} from "@babylonjs/core";
import type { Input } from "../core/Input";
import { angleDelta, clamp } from "../core/math";
import { Character } from "./Character";
import type { Vehicle } from "../vehicles/VehicleSystem";
import { openVehicleDoor } from "../vehicles/VehicleEquipment";
import { MovementQueries } from "./MovementQueries";
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
  crouched = false;
  god = false;
  noclip = false;
  deadTimer = 0;
  aim = false;
  queries: MovementQueries;
  interactionMessage = "";
  transitioning = false;
  climbing = false;
  private mountTime = 0;
  private mountStart = Vector3.Zero();
  private climbPath: Vector3[] = [];
  private climbTime = 0;
  private hitTime = 0;
  private velocity = Vector3.Zero();
  private previous = Vector3.Zero();
  private cameraTarget = Vector3.Zero();
  constructor(
    public scene: Scene,
    public shadows: ShadowGenerator,
    public input: Input,
    spawn: Vector3,
  ) {
    this.queries = new MovementQueries(scene);
    this.controller = new PhysicsCharacterController(
      spawn,
      { capsuleHeight: 1.8, capsuleRadius: 0.32 },
      scene,
    );
    this.controller.maxStepHeight = 0.36;
    this.controller.characterMass = 80;
    this.controller.characterStrength = 1600;
    this.model = new Character(scene, shadows, "Jason", "#d8d3c5", false, undefined, { licensedPlayerSkin: true });
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
  switchCharacter() {
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
    if (this.vehicle && !this.transitioning) this.attachSeat();
  }
  teleport(p: Vector3) {
    this.climbPath = [];
    this.climbing = false;
    this.controller.setPosition(p);
    this.controller.setVelocity(Vector3.Zero());
    this.previous.copyFrom(p);
  }
  enter(v: Vehicle) {
    this.interactionMessage = "";
    if (this.vehicle || this.transitioning || this.deadTimer > 0) return false;
    if (Math.abs(v.speed) > 5) {
      this.interactionMessage = "Wait for the vehicle to slow down.";
      return false;
    }
    const from = this.position.clone();
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
    openVehicleDoor(v, Vector3.Dot(from.subtract(v.root.position), v.root.right) < 0 ? -1 : 1);
    v.occupied = true;
    this.mountStart.copyFrom(this.model.root.position);
    this.mountTime = 0;
    this.transitioning = true;
    this.crouched = false;
    this.controller.setPosition(new Vector3(0, -100, 0));
    this.controller.setVelocity(Vector3.Zero());
    this.yaw = Math.atan2(v.root.forward.x, v.root.forward.z);
    return true;
  }
  private seatOffset() {
    const v = this.vehicle!;
    if (v.model.seat) return v.model.seat.clone();
    if (v.kind === "motorcycle") return new Vector3(0, -0.7, -0.18);
    if (v.kind === "boat") return new Vector3(-0.42, -0.3, -0.28);
    if (v.kind === "plane") return new Vector3(-v.tuning.width * 0.21, -0.78, -0.03);
    if (v.kind === "helicopter") return new Vector3(-v.tuning.width * 0.21, -0.8, 0.55);
    return new Vector3(
      -v.tuning.width * 0.21,
      ["suv", "truck"].includes(v.kind)
        ? -0.7
        : ["coupe", "sedan", "police"].includes(v.kind)
          ? -0.92
          : -0.65,
      -0.03,
    );
  }
  private attachSeat() {
    this.model.root.parent = this.vehicle!.root;
    this.model.root.position.copyFrom(this.seatOffset());
    this.model.root.rotation.set(0, 0, 0);
    this.model.root.rotationQuaternion = Quaternion.Identity();
    this.model.root.setEnabled(true);
  }
  exit(force = false) {
    if (!this.vehicle) return true;
    const v = this.vehicle;
    this.interactionMessage = "";
    if (!force && Math.abs(v.speed) > 10) {
      this.interactionMessage = "Slow down before exiting.";
      return false;
    }
    let p: Vector3 | null = null;
    // Both doors first, then the rear. Sweep against world geometry while ignoring the source car.
    for (const local of [
      new Vector3(-v.tuning.width / 2 - 0.62, 0, 0),
      new Vector3(v.tuning.width / 2 + 0.62, 0, 0),
      new Vector3(0, 0, -v.tuning.length / 2 - 0.65),
    ]) {
      const offset = v.root.right
        .scale(local.x)
        .add(v.root.forward.scale(local.z));
      const candidate = v.root.position.add(offset);
      const ground = this.queries.ground(candidate, 1.5, 3, v.body);
      if (ground && ground.y > v.root.position.y + 0.45) continue;
      if (ground) candidate.y = ground.y + 0.94;
      else if (candidate.x > 210 && candidate.y < 2) candidate.y = 0.7;
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
        p = candidate;
        break;
      }
    }
    if (!p && !force) {
      this.interactionMessage =
        "No safe exit here. Move away from the obstruction.";
      return false;
    }
    p ??= v.root.position.add(new Vector3(v.tuning.width + 1, 1.5, 0));
    if (!force) openVehicleDoor(v, Vector3.Dot(p.subtract(v.root.position), v.root.right) < 0 ? -1 : 1, 1.1);
    this.model.root.parent = null;
    this.model.root.rotationQuaternion = null;
    this.transitioning = false;
    this.controller.setShapeOptions(
      { capsuleHeight: 1.8, capsuleRadius: 0.32 },
      false,
    );
    this.teleport(p);
    v.occupied = false;
    this.vehicle = null;
    this.model.root.setEnabled(true);
    return true;
  }
  hurt(amount: number) {
    if (this.god || this.deadTimer > 0) return;
    this.hitTime = 0.35;
    const absorbed = Math.min(this.armor, amount * 0.55);
    this.armor -= absorbed;
    this.health = Math.max(0, this.health - amount + absorbed);
    if (this.health <= 0) this.deadTimer = 4;
  }
  update(dt: number) {
    this.previous.copyFrom(this.controller.getPosition());
    this.aim = this.deadTimer <= 0 && this.input.aim;
    if (this.deadTimer > 0) {
      this.climbPath = [];
      this.climbing = false;
    }
    this.hitTime = Math.max(0, this.hitTime - dt);
    if (this.vehicle) {
      this.speed = 0;
      this.model.animate(dt, 0);
      this.mountTime = Math.min(0.65, this.mountTime + dt);
      this.model.pose(
        this.transitioning ? "mount" : "seated",
        this.mountTime / 0.65,
        this.vehicle.kind === "motorcycle" ? "rider" : this.vehicle.kind === "concept" ? "reclined" : ["coupe", "sedan", "police", "boat"].includes(this.vehicle.kind) ? "low" : "upright",
      );
      if (this.mountTime >= 0.65 && this.transitioning) {
        this.transitioning = false;
        this.attachSeat();
      }
      return;
    }
    let crouch = this.input.down("crouch");
    if (
      !crouch &&
      this.crouched &&
      !this.queries.clear(this.position.add(new Vector3(0, 0.25, 0)))
    )
      crouch = true;
    this.crouched = crouch;
    const h = this.crouched ? 1.3 : 1.8;
    if (this.controller.shapeOptions.capsuleHeight !== h)
      this.controller.setShapeOptions({
        capsuleHeight: h,
        capsuleRadius: 0.32,
      });
    const x = this.input.axis("x"),
      z = this.input.axis("y");
    const move = new Vector3(
      x * Math.cos(this.yaw) + z * Math.sin(this.yaw),
      0,
      z * Math.cos(this.yaw) - x * Math.sin(this.yaw),
    );
    if (move.lengthSquared() > 1) move.normalize();
    this.swimming = this.position.x > 210 && this.position.y < 1.3;
    const targetSpeed = this.swimming
      ? 3.3
      : this.crouched
        ? 1.65
        : this.input.down("sprint")
          ? 7.1
          : 3.7;
    move.scaleInPlace(this.deadTimer > 0 ? 0 : targetSpeed);
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
          delta.normalize().scale(Math.min(3.6, delta.length() / dt)),
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
      (grounded || this.swimming)
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
    if (this.swimming) this.velocity.y = (0.65 - this.position.y) * 3;
    if (this.noclip) {
      this.velocity.y =
        (Number(this.input.down("jump")) - Number(this.input.down("crouch"))) *
        (this.deadTimer > 0 ? 0 : 12);
      this.controller.setPosition(
        this.position.add(this.velocity.scale(dt * 3)),
      );
    } else {
      this.controller.setVelocity(this.velocity);
      this.controller.integrate(
        dt,
        surface,
        this.swimming ? Vector3.Zero() : new Vector3(0, -9.81, 0),
      );
    }
    this.speed = Math.hypot(move.x, move.z);
    if (this.speed > 0.1)
      this.heading +=
        angleDelta(this.heading, Math.atan2(move.x, move.z)) *
        Math.min(1, dt * 14);
    if (this.aim) this.heading = this.yaw;
    this.model.root.rotation.y = this.heading;
    this.model.animate(dt, this.speed, this.aim, this.crouched);
    if (this.swimming) this.model.pose("swim", this.model.phase);
    else if (this.hitTime > 0) this.model.pose("hit", this.hitTime / 0.35);
    if (this.aim && !this.swimming) this.model.aimToward(this.camera.getForwardRay().direction);
    if (this.position.y < -15) this.teleport(new Vector3(6, 1.2, -28));
  }
  render(dt: number, alpha = 1, allowLook = true) {
    if (allowLook) {
      this.yaw +=
        this.input.dx * 0.0025 + (this.input.gamepad?.axes[2] || 0) * dt * 2.2;
      this.pitch = clamp(
        this.pitch +
          this.input.dy * 0.002 +
          (this.input.gamepad?.axes[3] || 0) * dt * 1.5,
        -0.5,
        1.1,
      );
    }
    const p = this.position;
    if (!this.vehicle) {
      this.model.root.position.copyFrom(Vector3.Lerp(this.previous, p, alpha));
      this.model.root.position.y -= this.crouched ? 0.65 : 0.9;
    } else if (this.transitioning) {
      this.vehicle.root.computeWorldMatrix(true);
      const seat = Vector3.TransformCoordinates(
        this.seatOffset(),
        this.vehicle.root.getWorldMatrix(),
      );
      const t = this.mountTime / 0.65;
      this.model.root.position.copyFrom(
        Vector3.Lerp(this.mountStart, seat, t * t * (3 - 2 * t)),
      );
      this.model.root.rotation.y = this.yaw;
    }
    if (
      allowLook &&
      this.vehicle &&
      Math.abs(this.vehicle.speed) > 2 &&
      Math.abs(this.input.dx) < 0.1 &&
      Math.abs(this.input.gamepad?.axes[2] || 0) < 0.08
    ) {
      const forward = this.vehicle.root.forward;
      this.yaw +=
        angleDelta(this.yaw, Math.atan2(forward.x, forward.z)) * dt * 1.7;
    }
    const target = p.add(new Vector3(0, this.vehicle ? 1.2 : 0.64, 0));
    const range = this.vehicle ? 8.4 : this.aim ? 2.1 : 5.0;
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
    if (this.aim && !this.vehicle && !this.transitioning && !this.climbing && !this.swimming)
      this.model.aimToward(this.camera.getForwardRay().direction);
  }
}
