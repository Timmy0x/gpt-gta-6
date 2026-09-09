import {
  Matrix,
  Mesh,
  PhysicsAggregate,
  PhysicsBody,
  PhysicsMotionType,
  PhysicsRaycastResult,
  PhysicsShapeBox,
  PhysicsShapeContainer,
  PhysicsShapeType,
  Quaternion,
  Vector3,
  VertexBuffer,
  VertexData,
  type PhysicsEngineV2,
  type PhysicsShape,
} from "@babylonjs/core";
import type {
  BuildContext,
  VehicleInput,
  VehicleKind,
} from "../core/contracts";
import {
  clamp,
  driveForce,
  frictionCircle,
  impactDamage,
  liftCoefficient,
  suspensionForce,
  VEHICLE_TUNING,
  type VehicleTuning,
} from "./handling";
import { createVehicleModel, type VehicleModel } from "./models";
import {
  validVehicleId,
  validateVehicleSnapshot,
  type LegacyVehicleSnapshot,
  type SerializableVehicle,
  type VehicleDamageState,
  type VectorTuple,
  type QuaternionTuple,
} from "./serialization";

const IDLE: VehicleInput = {
  throttle: 0,
  steer: 0,
  brake: 0,
  handbrake: false,
  lift: 0,
};
const UP = new Vector3(0, 1, 0),
  FORWARD = new Vector3(0, 0, 1),
  RIGHT = new Vector3(1, 0, 0);

export interface Vehicle {
  id: string;
  kind: VehicleKind;
  root: Mesh;
  body: PhysicsBody;
  speed: number;
  health: number;
  occupied: boolean;
  readonly heading: number;
  tuning: VehicleTuning;
  model: VehicleModel;
  input: VehicleInput;
  grounded: number;
  skidding: number;
  engineRunning: boolean;
  siren: boolean;
  /** Body-frame longitudinal velocity; negative while reversing. */
  forwardSpeed: number;
}

interface VehicleRuntime {
  vehicle: Vehicle;
  appearanceSeed: number;
  shapes: PhysicsShape[];
  lastVelocity: Vector3;
  crashCooldown: number;
  lastImpactSeverity: number;
  steering: number;
  rotorSpeed: number;
  originals: Map<Mesh, number[]>;
  wheelRoll: number;
}
interface Debris {
  aggregate: PhysicsAggregate;
  mesh: Mesh;
  life: number;
  owner: string;
}
interface PendingImpact {
  v: Vehicle;
  severity: number;
  impulseSpeed: number;
  point: Vector3;
}

/** Physics-only motion: controls apply forces/torques, never rewrite position or heading. */
export class VehicleSystem {
  readonly list: Vehicle[] = [];
  waterLevel = -0.35;
  wetness = 0;
  onCrash?: (vehicle: Vehicle, severity: number, point: Vector3) => void;
  private sequence = 0;
  private runtime = new Map<string, VehicleRuntime>();
  private debris: Debris[] = [];
  private impacts: PendingImpact[] = [];
  private ray = new PhysicsRaycastResult();
  private physics: PhysicsEngineV2;

  constructor(private ctx: BuildContext) {
    this.physics = ctx.scene.getPhysicsEngine() as PhysicsEngineV2;
  }

  spawn(
    kind: VehicleKind,
    position: Vector3,
    heading = 0,
    stableId?: string,
  ): Vehicle {
    if (!Number.isFinite(heading))
      throw new TypeError("Invalid vehicle heading");
    return this.createVehicle(
      kind,
      position,
      Quaternion.RotationAxis(UP, heading),
      stableId,
    );
  }

  private createVehicle(
    kind: VehicleKind,
    position: Vector3,
    rotation: Quaternion,
    stableId?: string,
    appearanceSeed?: number,
  ): Vehicle {
    if (
      !Object.hasOwn(VEHICLE_TUNING, kind) ||
      ![position.x, position.y, position.z].every(Number.isFinite)
    )
      throw new TypeError("Invalid vehicle spawn");
    if (stableId !== undefined && !validVehicleId(stableId))
      throw new TypeError("Invalid vehicle ID");
    if (stableId !== undefined && this.runtime.has(stableId))
      throw new Error(`Vehicle ID already exists: ${stableId}`);
    let id: string;
    do {
      id = stableId ?? `vehicle-${this.sequence + 1}`;
      this.sequence++;
    } while (this.runtime.has(id));
    const seed = appearanceSeed ?? this.sequence,
      t = VEHICLE_TUNING[kind],
      model = createVehicleModel(this.ctx, kind, this.sequence, seed),
      root = model.root;
    root.name = id;
    root.metadata.vehicleId = id;
    root.position.copyFrom(position);
    root.rotationQuaternion = rotation.clone();
    root.computeWorldMatrix(true);
    const body = new PhysicsBody(
      root,
      PhysicsMotionType.DYNAMIC,
      false,
      this.ctx.scene,
    );
    // Separate fuselage/chassis, roof, and wing proxies preserve clearances and allow rollovers.
    const height =
      kind === "helicopter"
        ? 1.8
        : kind === "plane"
          ? 0.95
          : kind === "boat"
            ? 0.8
            : t.height;
    const length =
      kind === "helicopter" ? 4.6 : kind === "plane" ? 3.8 : t.length;
    const shape = new PhysicsShapeContainer(this.ctx.scene),
      shapes: PhysicsShape[] = [shape];
    const addShape = (center: Vector3, extents: Vector3) => {
      const part = new PhysicsShapeBox(
        center,
        Quaternion.Identity(),
        extents,
        this.ctx.scene,
      );
      part.material = { friction: 0.38, restitution: 0.055 };
      shape.addChild(part);
      shapes.push(part);
    };
    addShape(
      new Vector3(
        0,
        kind === "helicopter" ? 0.14 : 0,
        kind === "helicopter" ? -0.1 : kind === "plane" ? 0.7 : 0,
      ),
      new Vector3(t.width, height, length),
    );
    if (["coupe", "sedan", "police", "suv", "truck"].includes(kind)) {
      const tall = kind === "suv" || kind === "truck";
      addShape(
        new Vector3(0, tall ? 0.85 : 0.62, kind === "truck" ? 0.63 : 0),
        new Vector3(
          t.width * 0.77,
          tall ? 0.8 : 0.62,
          kind === "truck" ? 1.48 : 2.2,
        ),
      );
    }
    if (kind === "plane") {
      addShape(new Vector3(0, 0.1, -0.15), new Vector3(10.5, 0.15, 1.0));
      addShape(new Vector3(0, 0.2, -2.55), new Vector3(0.65, 0.35, 2.9));
      addShape(new Vector3(0, 0.05, 2.9), new Vector3(0.7, 0.6, 1.6));
    }
    if (kind === "helicopter") {
      addShape(new Vector3(0, 0.31, -3.56), new Vector3(0.42, 0.5, 3.1));
      for (const side of [-1, 1])
        addShape(
          new Vector3(side * 0.92, -0.79, 0.1),
          new Vector3(0.11, 0.11, 3.3),
        );
    }
    body.shape = shape;
    // Mildly lowered centre of mass makes road handling forgiving but permits physical rollover.
    body.setMassProperties({
      mass: t.mass,
      centerOfMass: new Vector3(0, -0.1, 0),
    });
    body.setLinearDamping(0.035);
    body.setAngularDamping(kind === "helicopter" ? 0.75 : 0.38);
    body.setCollisionCallbackEnabled(true);
    const v: Vehicle = {
      id,
      kind,
      root,
      body,
      speed: 0,
      health: 100,
      occupied: false,
      get heading() {
        const f = root.getDirection(FORWARD);
        return Math.atan2(f.x, f.z);
      },
      tuning: t,
      model,
      input: { ...IDLE },
      grounded: 0,
      skidding: 0,
      engineRunning: true,
      siren: false,
      forwardSpeed: 0,
    };
    const originals = new Map<Mesh, number[]>();
    for (const panel of model.panels) {
      const positions = panel.getVerticesData(VertexBuffer.PositionKind);
      if (positions) originals.set(panel, Array.from(positions));
    }
    const runtime: VehicleRuntime = {
      vehicle: v,
      appearanceSeed: seed,
      shapes,
      lastVelocity: Vector3.Zero(),
      crashCooldown: 0,
      lastImpactSeverity: 0,
      steering: 0,
      rotorSpeed: 0,
      originals,
      wheelRoll: 0,
    };
    this.runtime.set(v.id, runtime);
    this.list.push(v);
    body.getCollisionObservable().add((event) => {
      if (!event.point || !event.normal) return;
      const other =
        event.collider === body ? event.collidedAgainst : event.collider;
      const otherVelocity = this.list.find(
        (candidate) => candidate.body === other,
      );
      const relative = runtime.lastVelocity.subtract(
        otherVelocity
          ? this.runtime.get(otherVelocity.id)!.lastVelocity
          : Vector3.Zero(),
      );
      const closingSpeed = Math.abs(Vector3.Dot(relative, event.normal));
      if (
        runtime.crashCooldown > 0 &&
        closingSpeed < runtime.lastImpactSeverity + 2
      )
        return;
      // A manifold can report several contacts in one step. Accumulate their impulses before
      // applying the cooldown; otherwise the first tiny corner contact hides the main crash.
      if (closingSpeed > 2.2 && event.impulse > 1) {
        const existing = this.impacts.find((hit) => hit.v === v);
        if (existing) {
          existing.impulseSpeed += event.impulse / t.mass;
          if (closingSpeed > existing.severity) {
            existing.severity = closingSpeed;
            existing.point.copyFrom(event.point);
          }
        } else
          this.impacts.push({
            v,
            severity: closingSpeed,
            impulseSpeed: event.impulse / t.mass,
            point: event.point.clone(),
          });
      }
    });
    return v;
  }

  serialize(v: Vehicle): SerializableVehicle {
    const runtime = this.runtime.get(v.id);
    if (!runtime || runtime.vehicle !== v)
      throw new Error("Cannot serialize a removed vehicle");
    const position = v.root.position,
      rotation =
        v.root.rotationQuaternion ??
        Quaternion.FromEulerVector(v.root.rotation);
    const damage: VehicleDamageState = {
      schemaVersion: 1,
      panels: v.model.panels.map((panel, slot) => ({
        slot,
        vertices: Array.from(
          panel.getVerticesData(VertexBuffer.PositionKind) ?? [],
        ),
        enabled: panel.isEnabled(),
      })),
      tiresDamaged: v.model.wheels.map((wheel) => wheel.damaged),
      windowsEnabled: v.model.windows.map((mesh) => mesh.isEnabled()),
      lightsEnabled: v.model.lights.map((mesh) => mesh.isEnabled()),
      bumpersEnabled: v.model.bumpers.map((mesh) => mesh.isEnabled()),
    };
    return {
      schemaVersion: 1,
      id: v.id,
      kind: v.kind,
      x: position.x,
      y: position.y,
      z: position.z,
      heading: v.heading,
      health: v.health,
      rotationQuaternion: rotation.asArray() as QuaternionTuple,
      linearVelocity: v.body.getLinearVelocity().asArray() as VectorTuple,
      angularVelocity: v.body.getAngularVelocity().asArray() as VectorTuple,
      engineRunning: v.engineRunning,
      siren: v.siren,
      rotorSpeed: runtime.rotorSpeed,
      appearanceSeed: runtime.appearanceSeed,
      damage,
    };
  }

  /** Explicit restore replaces an existing matching ID; ordinary spawn never does. */
  restore(snapshot: SerializableVehicle | LegacyVehicleSnapshot): Vehicle {
    const state = validateVehicleSnapshot(snapshot),
      existing = state.id
        ? this.list.find((v) => v.id === state.id)
        : undefined;
    const rotation = state.rotationQuaternion
      ? Quaternion.FromArray(state.rotationQuaternion)
      : Quaternion.RotationAxis(UP, state.heading);
    // Build and validate under a temporary unique ID before removing the old entity. A corrupt
    // component layout must leave the living vehicle intact, including its Havok body.
    const v = this.createVehicle(
      state.kind,
      new Vector3(state.x, state.y, state.z),
      rotation,
      existing ? undefined : state.id,
      state.appearanceSeed,
    );
    try {
      if (state.damage) this.restoreDamage(v, state.damage);
      v.health = state.health;
      v.engineRunning = state.engineRunning;
      v.siren = state.siren;
      const linear = Vector3.FromArray(state.linearVelocity),
        angular = Vector3.FromArray(state.angularVelocity);
      v.body.setLinearVelocity(linear);
      v.body.setAngularVelocity(angular);
      v.speed = Math.hypot(linear.x, linear.z);
      v.forwardSpeed = Vector3.Dot(linear, v.root.getDirection(FORWARD));
      const runtime = this.runtime.get(v.id)!;
      runtime.lastVelocity.copyFrom(linear);
      runtime.rotorSpeed = state.rotorSpeed;
      if (existing) {
        this.remove(existing);
        this.runtime.delete(v.id);
        v.id = state.id!;
        v.root.name = v.id;
        v.root.metadata.vehicleId = v.id;
        this.runtime.set(v.id, runtime);
      }
      return v;
    } catch (error) {
      this.remove(v);
      throw error;
    }
  }

  private restoreDamage(v: Vehicle, state: VehicleDamageState): void {
    const m = v.model;
    if (
      state.panels.length !== m.panels.length ||
      state.tiresDamaged.length !== m.wheels.length ||
      state.windowsEnabled.length !== m.windows.length ||
      state.lightsEnabled.length !== m.lights.length ||
      state.bumpersEnabled.length !== m.bumpers.length
    )
      throw new TypeError("Vehicle damage layout does not match its model");
    for (const part of state.panels) {
      const mesh = m.panels[part.slot];
      if (
        !mesh ||
        part.vertices.length !==
          mesh.getVerticesData(VertexBuffer.PositionKind)?.length
      )
        throw new TypeError("Vehicle panel topology does not match its model");
      const windowSlot = m.windows.indexOf(mesh);
      if (windowSlot >= 0 && state.windowsEnabled[windowSlot] !== part.enabled)
        throw new TypeError("Inconsistent vehicle glazing state");
    }
    for (const part of state.panels) {
      const mesh = m.panels[part.slot],
        normals: number[] = [];
      VertexData.ComputeNormals(part.vertices, mesh.getIndices()!, normals);
      mesh.updateVerticesData(VertexBuffer.PositionKind, part.vertices);
      mesh.updateVerticesData(VertexBuffer.NormalKind, normals);
      mesh.refreshBoundingInfo();
      mesh.setEnabled(part.enabled);
    }
    state.tiresDamaged.forEach((damaged, i) => {
      const wheel = m.wheels[i];
      wheel.damaged = damaged;
      wheel.tire.scaling.set(damaged ? 0.68 : 1, 1, damaged ? 0.75 : 1);
    });
    state.windowsEnabled.forEach((enabled, i) =>
      m.windows[i].setEnabled(enabled),
    );
    state.lightsEnabled.forEach((enabled, i) =>
      m.lights[i].setEnabled(enabled),
    );
    state.bumpersEnabled.forEach((enabled, i) =>
      m.bumpers[i].setEnabled(enabled),
    );
  }

  control(v: Vehicle, input: VehicleInput): void {
    if (!this.owns(v)) return;
    v.input = {
      throttle: clamp(input.throttle, -1, 1),
      steer: clamp(input.steer, -1, 1),
      brake: clamp(input.brake, 0, 1),
      handbrake: input.handbrake,
      lift: clamp(input.lift, -1, 1),
    };
  }

  /** Call exactly once per fixed Havok step, in Scene.onBeforePhysicsObservable. */
  update(dt: number): void {
    if (dt <= 0 || !Number.isFinite(dt)) return;
    const pending = this.impacts.splice(0);
    for (const hit of pending)
      if (this.owns(hit.v)) {
        const runtime = this.runtime.get(hit.v.id)!;
        const velocityChange = runtime.lastVelocity
          .subtract(hit.v.body.getLinearVelocity())
          .length();
        const severity = Math.min(
            hit.severity,
            Math.max(hit.impulseSpeed * 2, velocityChange),
          ),
          amount = impactDamage(severity);
        if (amount > 0) {
          this.damage(hit.v, amount, hit.point);
          runtime.crashCooldown = 0.22;
          runtime.lastImpactSeverity = severity;
          this.onCrash?.(hit.v, severity, hit.point);
        }
      }
    for (const v of this.list) {
      const r = this.runtime.get(v.id)!;
      r.crashCooldown = Math.max(0, r.crashCooldown - dt);
      const velocity = v.body.getLinearVelocity(),
        angular = v.body.getAngularVelocity();
      v.root.computeWorldMatrix(true);
      const forward = v.root.getDirection(FORWARD).normalize(),
        right = v.root.getDirection(RIGHT).normalize(),
        up = v.root.getDirection(UP).normalize();
      v.speed = Math.hypot(velocity.x, velocity.z);
      v.forwardSpeed = Vector3.Dot(velocity, forward);
      v.skidding = 0;
      v.grounded = 0;
      r.steering += (v.input.steer - r.steering) * Math.min(1, dt * 9);
      if (v.kind === "boat")
        this.updateBoat(v, velocity, angular, forward, right, up, dt);
      else if (v.kind === "helicopter")
        this.updateHelicopter(v, velocity, angular, forward, up, r, dt);
      else {
        this.updateTires(v, r, velocity, angular, forward, right, up, dt);
        if (v.kind === "plane")
          this.updatePlane(v, velocity, angular, forward, right, up, r, dt);
        if (v.kind === "motorcycle") {
          // Rider balance is represented as an upright-assist torque; road contact still drives motion.
          const targetUp = new Vector3(
            -forward.z * r.steering * clamp(v.speed / 18, 0, 0.34),
            1,
            forward.x * r.steering * clamp(v.speed / 18, 0, 0.34),
          ).normalize();
          if (v.grounded > 0)
            v.body.applyTorque(
              Vector3.Cross(up, targetUp)
                .scale(tuningMass(v) * 16)
                .subtract(
                  new Vector3(angular.x, 0, angular.z).scale(tuningMass(v) * 3),
                ),
            );
        }
      }
      if (v.kind !== "boat" && v.kind !== "helicopter") {
        // Drag acts through the centre of mass; rolling resistance is handled at tire contact.
        v.body.applyForce(
          velocity.scale(-0.4 * velocity.length()),
          v.root.position,
        );
      }
      r.lastVelocity.copyFrom(velocity);
    }
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.life -= dt;
      if (d.life <= 0) {
        d.aggregate.dispose();
        d.mesh.dispose();
        this.debris.splice(i, 1);
      }
    }
  }

  private updateTires(
    v: Vehicle,
    r: VehicleRuntime,
    velocity: Vector3,
    angular: Vector3,
    forward: Vector3,
    right: Vector3,
    up: Vector3,
    dt: number,
  ): void {
    const t = v.tuning,
      wheels = v.model.wheels,
      input = v.input,
      matrix = v.root.getWorldMatrix();
    const steering =
      (r.steering * t.steering) / (1 + Math.abs(v.forwardSpeed) / 24);
    const engine =
      v.engineRunning && v.health > 0
        ? driveForce(input.throttle, v.forwardSpeed, t, v.health)
        : 0;
    const airbornePlane = v.kind === "plane";
    for (const wheel of wheels) {
      const anchor = Vector3.TransformCoordinates(wheel.local, matrix),
        rest = t.suspensionTravel + t.wheelRadius;
      const end = anchor.subtract(up.scale(rest));
      this.ray.reset(anchor, end);
      this.physics.raycastToRef(anchor, end, this.ray, {
        ignoreBody: v.body,
        shouldHitTriggers: false,
      });
      wheel.pivot.rotation.y = wheel.front ? steering : 0;
      if (!this.ray.hasHit || Vector3.Dot(this.ray.hitNormalWorld, up) < 0.25) {
        wheel.pivot.position.y = wheel.local.y - t.suspensionTravel;
        continue;
      }
      v.grounded++;
      const distance = this.ray.hitDistance,
        contact = this.ray.hitPointWorld.clone();
      const relative = contact.subtract(v.root.position),
        pointVelocity = velocity.add(Vector3.Cross(angular, relative));
      const compression = rest - distance;
      const support = suspensionForce(
        compression,
        Vector3.Dot(pointVelocity, up),
        t.mass,
        wheels.length,
        t,
      );
      v.body.applyForce(up.scale(support), anchor);
      wheel.pivot.position.y =
        wheel.local.y - (distance - t.wheelRadius) + (wheel.damaged ? -0.1 : 0);
      const tireForward = wheel.front
        ? forward.scale(Math.cos(steering)).add(right.scale(Math.sin(steering)))
        : forward;
      const tireRight = Vector3.Cross(up, tireForward).normalize();
      const lateralSpeed = Vector3.Dot(pointVelocity, tireRight),
        longSpeed = Vector3.Dot(pointVelocity, tireForward);
      const sideForce = (-lateralSpeed * t.mass) / (wheels.length * 0.105);
      const rolling = (-longSpeed * t.mass * 0.025) / wheels.length;
      const brakeStrength =
        ((input.handbrake && !wheel.front ? 1 : input.brake) * t.mass * 12) /
        wheels.length;
      const brake =
        -Math.sign(longSpeed) *
        Math.min(
          brakeStrength,
          (Math.abs(longSpeed) * t.mass) / (wheels.length * dt),
        );
      const drive = airbornePlane ? 0 : engine / wheels.length;
      const grip =
        t.grip *
        (1 - this.wetness * 0.26) *
        (wheel.damaged ? 0.4 : 1) *
        (input.handbrake && !wheel.front ? 0.45 : 1);
      const [side, long] = frictionCircle(
        sideForce,
        rolling + brake + drive,
        support,
        grip,
      );
      // Tire contact forces transmit both yaw and weight-transfer torque into the chassis.
      v.body.applyForce(
        tireRight.scale(side).add(tireForward.scale(long)),
        contact,
      );
      v.skidding = Math.max(
        v.skidding,
        Math.abs(lateralSpeed) + (input.handbrake ? v.speed * 0.2 : 0),
      );
      wheel.tire.rotation.x += (longSpeed * dt) / t.wheelRadius;
      wheel.rim.rotation.x = wheel.tire.rotation.x;
    }
    // Parking friction is an axle force, not a velocity/position override.
    if (
      Math.abs(input.throttle) < 0.01 &&
      input.brake === 0 &&
      v.grounded > 0 &&
      v.speed < 1
    ) {
      v.body.applyForce(
        new Vector3(-velocity.x, 0, -velocity.z).scale(t.mass * 3),
        v.root.position,
      );
    }
  }

  private updateBoat(
    v: Vehicle,
    velocity: Vector3,
    angular: Vector3,
    forward: Vector3,
    right: Vector3,
    up: Vector3,
    dt: number,
  ): void {
    const t = v.tuning,
      m = v.root.getWorldMatrix();
    let immersion = 0;
    for (const x of [-t.width * 0.34, t.width * 0.34])
      for (const z of [-t.length * 0.31, t.length * 0.31]) {
        const point = Vector3.TransformCoordinates(new Vector3(x, -0.36, z), m),
          depth = this.waterLevel - point.y;
        if (depth <= 0) continue;
        const pointVelocity = velocity.add(
          Vector3.Cross(angular, point.subtract(v.root.position)),
        );
        const buoyancy =
          (clamp(depth / 0.42, 0, 1.8) * t.mass * 9.81) / 4 -
          pointVelocity.y * t.mass * 0.6;
        v.body.applyForce(UP.scale(Math.max(0, buoyancy)), point);
        immersion += 0.25;
      }
    v.grounded = immersion > 0 ? 1 : 0;
    if (immersion === 0) return;
    const lateral = Vector3.Dot(velocity, right),
      long = Vector3.Dot(velocity, forward);
    const drag = right
      .scale(-lateral * t.mass * 1.8)
      .add(forward.scale(-long * Math.abs(long) * 23))
      .add(UP.scale(-velocity.y * t.mass * 0.45));
    v.body.applyForce(drag.scale(immersion), v.root.position);
    const prop = v.engineRunning
      ? driveForce(v.input.throttle, long, t, v.health) * immersion
      : 0;
    v.body.applyForce(
      forward.scale(prop),
      v.root.position.subtract(forward.scale(t.length * 0.35)),
    );
    v.body.applyTorque(
      UP.scale(
        v.input.steer * t.mass * clamp(Math.abs(long) / 3, 0.12, 1.5) * 2 -
          angular.y * t.mass * 2,
      ),
    );
    const balance = Vector3.Cross(up, UP)
      .scale(t.mass * 2)
      .subtract(new Vector3(angular.x, 0, angular.z).scale(t.mass * 2));
    v.body.applyTorque(balance);
    void dt;
  }

  private updateHelicopter(
    v: Vehicle,
    velocity: Vector3,
    angular: Vector3,
    forward: Vector3,
    up: Vector3,
    r: VehicleRuntime,
    dt: number,
  ): void {
    const t = v.tuning,
      input = v.input,
      working = v.occupied && v.engineRunning && v.health > 0;
    const targetRotor = working ? clamp(v.health / 45, 0.1, 1) : 0;
    r.rotorSpeed += (targetRotor - r.rotorSpeed) * Math.min(1, dt * 0.9);
    if (v.model.rotor) v.model.rotor.rotation.y += r.rotorSpeed * dt * 40;
    const horizontalForward = new Vector3(forward.x, 0, forward.z).normalize();
    // Tilt the rotor disk through torque, then thrust along its actual orientation.
    const desiredUp = UP.add(
      horizontalForward.scale(input.throttle * 0.32),
    ).normalize();
    const error = Vector3.Cross(up, desiredUp);
    const torque = error
      .scale(t.mass * 7)
      .subtract(new Vector3(angular.x, 0, angular.z).scale(t.mass * 3));
    torque.y = input.steer * t.mass * 2.0 - angular.y * t.mass * 1.25;
    v.body.applyTorque(torque.scale(r.rotorSpeed));
    const collective = clamp(
      1 + input.lift * 0.38 - velocity.y * 0.07,
      0.25,
      1.5,
    );
    v.body.applyForce(
      up.scale(t.mass * 9.81 * collective * r.rotorSpeed),
      v.root.position,
    );
    v.body.applyForce(velocity.scale(-t.mass * 0.17), v.root.position);
  }

  private updatePlane(
    v: Vehicle,
    velocity: Vector3,
    angular: Vector3,
    forward: Vector3,
    right: Vector3,
    up: Vector3,
    r: VehicleRuntime,
    dt: number,
  ): void {
    const t = v.tuning,
      input = v.input,
      speed = Math.max(0, Vector3.Dot(velocity, forward));
    const thrust = v.engineRunning
      ? Math.max(0, input.throttle) *
        t.engineForce *
        clamp(v.health / 70, 0.08, 1)
      : 0;
    v.body.applyForce(forward.scale(thrust), v.root.position);
    // The 16 m² wing uses an explicit v² lift law and angle-of-attack stall envelope.
    const aoa = Math.atan2(-Vector3.Dot(velocity, up), Math.max(speed, 1));
    const coefficient = liftCoefficient(aoa + 0.07),
      dynamicPressure = 0.5 * 1.225 * speed * speed;
    v.body.applyForce(
      up.scale(dynamicPressure * 16 * coefficient),
      v.root.position,
    );
    v.body.applyForce(
      velocity.scale(
        (-(0.035 + coefficient * coefficient * 0.06) * dynamicPressure * 16) /
          Math.max(velocity.length(), 1),
      ),
      v.root.position,
    );
    const authority = clamp(speed / 22, 0, 1),
      targetAoA = 0.025 + input.lift * 0.17;
    const worldAngular = right
      .scale((aoa - targetAoA) * t.mass * 40 * authority)
      .add(UP.scale(input.steer * t.mass * 0.9 * authority));
    // The trainer's stability assist trims toward a bounded angle of attack; it cannot create
    // lift below flying speed. Bank follows yaw input without imposing pitch toward the horizon.
    const bankTarget = UP.add(right.scale(-input.steer * 0.4)).normalize();
    worldAngular.addInPlace(
      forward.scale(
        Vector3.Dot(Vector3.Cross(up, bankTarget), forward) *
          t.mass *
          1.5 *
          authority,
      ),
    );
    worldAngular.subtractInPlace(angular.scale(t.mass * 4.2));
    v.body.applyTorque(worldAngular);
    r.rotorSpeed +=
      (clamp(input.throttle, 0, 1) - r.rotorSpeed) * Math.min(1, dt * 3);
    if (v.model.rotor) v.model.rotor.rotation.z += r.rotorSpeed * dt * 70;
  }

  damage(v: Vehicle, amount: number, point?: Vector3): void {
    if (amount <= 0 || !Number.isFinite(amount) || !this.owns(v)) return;
    v.health = clamp(v.health - amount, 0, 100);
    if (v.health === 0) v.engineRunning = false;
    const impact =
      point ??
      Vector3.TransformCoordinates(
        new Vector3(0, 0.1, v.tuning.length / 2),
        v.root.computeWorldMatrix(true),
      );
    const local = Vector3.TransformCoordinates(
      impact,
      Matrix.Invert(v.root.getWorldMatrix()),
    );
    for (const panel of v.model.panels) {
      if (!panel.isEnabled()) continue;
      const positions = panel.getVerticesData(VertexBuffer.PositionKind),
        indices = panel.getIndices();
      if (!positions || !indices) continue;
      let changed = false;
      for (let i = 0; i < positions.length; i += 3) {
        const vertex = new Vector3(
            positions[i],
            positions[i + 1],
            positions[i + 2],
          ),
          distance = Vector3.Distance(vertex, local);
        if (distance > 1.7) continue;
        const displacement =
          clamp(amount * 0.012, 0, 0.42) * (1 - distance / 1.7);
        const inward = vertex
          .subtract(local)
          .add(new Vector3(-local.x * 0.7, -0.18, -local.z * 0.25))
          .normalize();
        positions[i] += inward.x * displacement;
        positions[i + 1] += inward.y * displacement;
        positions[i + 2] += inward.z * displacement;
        changed = true;
      }
      if (changed) {
        const normals: number[] = [];
        VertexData.ComputeNormals(positions, indices, normals);
        panel.updateVerticesData(VertexBuffer.PositionKind, positions);
        panel.updateVerticesData(VertexBuffer.NormalKind, normals);
        panel.refreshBoundingInfo();
      }
    }
    if (amount > 11) {
      const windows = v.model.windows
        .filter((m) => m.isEnabled())
        .sort(
          (a, b) =>
            Vector3.DistanceSquared(a.getAbsolutePosition(), impact) -
            Vector3.DistanceSquared(b.getAbsolutePosition(), impact),
        );
      if (windows[0]) this.detach(v, windows[0], 2, 10);
    }
    for (const lamp of v.model.lights)
      if (
        Vector3.Distance(lamp.getAbsolutePosition(), impact) < 1.35 &&
        amount > 6
      )
        lamp.setEnabled(false);
    const closestWheel = [...v.model.wheels].sort(
      (a, b) =>
        Vector3.DistanceSquared(a.pivot.getAbsolutePosition(), impact) -
        Vector3.DistanceSquared(b.pivot.getAbsolutePosition(), impact),
    )[0];
    if (
      closestWheel &&
      (amount > 24 || v.health < 38) &&
      !closestWheel.damaged
    ) {
      closestWheel.damaged = true;
      closestWheel.tire.scaling.set(0.68, 1, 0.75);
    }
    if (v.health < 58 && amount > 9) {
      const bumper = v.model.bumpers
        .filter((m) => m.isEnabled())
        .sort(
          (a, b) =>
            Vector3.DistanceSquared(a.getAbsolutePosition(), impact) -
            Vector3.DistanceSquared(b.getAbsolutePosition(), impact),
        )[0];
      if (bumper) this.detach(v, bumper, 18, 26);
    }
  }

  private detach(v: Vehicle, part: Mesh, mass: number, lifetime: number): void {
    const world = part.computeWorldMatrix(true).clone(),
      position = new Vector3(),
      rotation = new Quaternion(),
      scaling = new Vector3();
    world.decompose(scaling, rotation, position);
    const clone = part.clone(`debris-${part.name}-${this.sequence}`, null);
    if (!clone) return;
    clone.parent = null;
    clone.position.copyFrom(position);
    clone.rotationQuaternion = rotation;
    clone.scaling.copyFrom(scaling);
    clone.metadata = { debris: true };
    part.setEnabled(false);
    clone.setEnabled(true);
    clone.computeWorldMatrix(true);
    const aggregate = new PhysicsAggregate(
      clone,
      PhysicsShapeType.BOX,
      { mass, friction: 0.65, restitution: 0.15 },
      this.ctx.scene,
    );
    aggregate.body.setLinearVelocity(
      v.body
        .getLinearVelocity()
        .add(
          new Vector3(
            (position.x - v.root.position.x) * 2,
            1.1,
            (position.z - v.root.position.z) * 2,
          ),
        ),
    );
    aggregate.body.setAngularVelocity(new Vector3(1, 0.4, 0.5));
    this.debris.push({ aggregate, mesh: clone, life: lifetime, owner: v.id });
    while (this.debris.length > 32) {
      const oldest = this.debris.shift()!;
      oldest.aggregate.dispose();
      oldest.mesh.dispose();
    }
  }

  repair(v: Vehicle): void {
    const runtime = this.runtime.get(v.id);
    if (!runtime || runtime.vehicle !== v) return;
    v.health = 100;
    v.engineRunning = true;
    for (const [panel, original] of runtime.originals) {
      panel.updateVerticesData(VertexBuffer.PositionKind, original);
      const normals: number[] = [];
      VertexData.ComputeNormals(original, panel.getIndices()!, normals);
      panel.updateVerticesData(VertexBuffer.NormalKind, normals);
      panel.refreshBoundingInfo();
    }
    for (const mesh of [
      ...v.model.windows,
      ...v.model.bumpers,
      ...v.model.lights,
    ])
      mesh.setEnabled(true);
    for (const wheel of v.model.wheels) {
      wheel.damaged = false;
      wheel.tire.scaling.setAll(1);
    }
  }

  /** Explicit creative recovery only: right the car and teleport it above the supporting surface. */
  recover(v: Vehicle, position?: Vector3): void {
    const runtime = this.runtime.get(v.id);
    if (!runtime || runtime.vehicle !== v) return;
    const target = position?.clone() ?? v.root.position.clone(),
      heading = v.heading;
    if (!position) {
      const from = target.add(new Vector3(0, 4, 0)),
        to = target.subtract(new Vector3(0, 30, 0));
      this.ray.reset(from, to);
      this.physics.raycastToRef(from, to, this.ray, {
        ignoreBody: v.body,
        shouldHitTriggers: false,
      });
      const ground = this.ray.hasHit ? this.ray.hitPointWorld.y : 0;
      target.y =
        v.kind === "boat"
          ? Math.max(this.waterLevel + 0.3, ground + 0.75)
          : ground + (v.kind === "helicopter" ? 1.25 : 1.05);
    }
    this.repair(v);
    v.input = { ...IDLE };
    v.speed = 0;
    v.forwardSpeed = 0;
    v.body.setLinearVelocity(Vector3.Zero());
    v.body.setAngularVelocity(Vector3.Zero());
    v.body.disablePreStep = false;
    v.root.position.copyFrom(target);
    v.root.rotationQuaternion = Quaternion.RotationAxis(UP, heading);
    v.root.computeWorldMatrix(true);
    runtime.lastVelocity.setAll(0);
    runtime.crashCooldown = 1;
    runtime.lastImpactSeverity = 100;
    this.ctx.scene.onAfterPhysicsObservable.addOnce(() => {
      if (this.owns(v)) v.body.disablePreStep = true;
    });
  }

  remove(v: Vehicle): void {
    const runtime = this.runtime.get(v.id);
    if (!runtime || runtime.vehicle !== v) return;
    this.impacts = this.impacts.filter((hit) => hit.v !== v);
    v.body.dispose();
    for (const shape of runtime.shapes) shape.dispose();
    this.ctx.shadows.removeShadowCaster(v.root, true);
    v.root.dispose();
    for (let i = this.debris.length - 1; i >= 0; i--)
      if (this.debris[i].owner === v.id) {
        this.debris[i].aggregate.dispose();
        this.debris[i].mesh.dispose();
        this.debris.splice(i, 1);
      }
    for (const material of v.model.materials) material.dispose();
    this.runtime.delete(v.id);
    const i = this.list.indexOf(v);
    if (i >= 0) this.list.splice(i, 1);
  }

  dispose(): void {
    for (const v of [...this.list]) this.remove(v);
    for (const d of this.debris) {
      d.aggregate.dispose();
      d.mesh.dispose();
    }
    this.debris = [];
  }

  private owns(v: Vehicle): boolean {
    return this.runtime.get(v.id)?.vehicle === v;
  }
}

function tuningMass(v: Vehicle): number {
  return v.tuning.mass;
}
