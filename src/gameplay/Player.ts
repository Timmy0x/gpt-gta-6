import {
  CharacterSupportedState,
  PhysicsCharacterController,
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
  private velocity = Vector3.Zero();
  private previous = Vector3.Zero();
  private cameraTarget = Vector3.Zero();
  constructor(
    public scene: Scene,
    public shadows: ShadowGenerator,
    public input: Input,
    spawn: Vector3,
  ) {
    this.controller = new PhysicsCharacterController(
      spawn,
      { capsuleHeight: 1.8, capsuleRadius: 0.32 },
      scene,
    );
    this.controller.maxStepHeight = 0.36;
    this.controller.characterMass = 80;
    this.controller.characterStrength = 1600;
    this.model = new Character(scene, shadows, "Jason", "#d8d3c5");
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
    );
    this.model.root.setEnabled(!this.vehicle);
  }
  teleport(p: Vector3) {
    this.controller.setPosition(p);
    this.controller.setVelocity(Vector3.Zero());
    this.previous.copyFrom(p);
  }
  enter(v: Vehicle) {
    this.vehicle = v;
    v.occupied = true;
    this.model.root.setEnabled(false);
    this.controller.setPosition(new Vector3(0, -100, 0));
    this.controller.setVelocity(Vector3.Zero());
    this.yaw = Math.atan2(v.root.forward.x, v.root.forward.z);
  }
  exit() {
    if (!this.vehicle) return;
    const v = this.vehicle;
    const right = v.root.right.scale(2.3);
    const p = v.root.position.add(right);
    p.y = Math.max(1.2, p.y + 1);
    this.teleport(p);
    v.occupied = false;
    this.vehicle = null;
    this.model.root.setEnabled(true);
  }
  hurt(amount: number) {
    if (this.god || this.deadTimer > 0) return;
    const absorbed = Math.min(this.armor, amount * 0.55);
    this.armor -= absorbed;
    this.health = Math.max(0, this.health - amount + absorbed);
    if (this.health <= 0) this.deadTimer = 4;
  }
  update(dt: number) {
    this.previous.copyFrom(this.controller.getPosition());
    this.aim = this.input.aim;
    if (this.vehicle) return;
    this.crouched = this.input.down("crouch");
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
    const last = this.controller.getVelocity();
    this.velocity.set(
      move.x,
      grounded ? Math.max(last.y, 0) : last.y - 9.81 * dt,
      move.z,
    );
    if (this.input.take("jump") && (grounded || this.swimming))
      this.velocity.y = 5.7;
    if (this.swimming) this.velocity.y = (0.65 - this.position.y) * 3;
    if (this.noclip) {
      this.velocity.y =
        (Number(this.input.down("jump")) - Number(this.input.down("crouch"))) *
        12;
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
    if (this.position.y < -15) this.teleport(new Vector3(6, 1.2, -28));
  }
  render(dt: number, alpha = 1) {
    this.yaw +=
      this.input.dx * 0.0025 + (this.input.gamepad?.axes[2] || 0) * dt * 2.2;
    this.pitch = clamp(
      this.pitch +
        this.input.dy * 0.002 +
        (this.input.gamepad?.axes[3] || 0) * dt * 1.5,
      -0.5,
      1.1,
    );
    const p = this.position;
    if (!this.vehicle) {
      this.model.root.position.copyFrom(Vector3.Lerp(this.previous, p, alpha));
      this.model.root.position.y -= this.crouched ? 0.65 : 0.9;
    }
    if (
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
  }
}
