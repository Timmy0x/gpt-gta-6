import {
  Matrix, Mesh, PhysicsBody, PhysicsMotionType, PhysicsShapeBox, PhysicsShapeContainer, PhysicsShapeCylinder,
  Quaternion, Vector3, type AbstractMesh, type Observer, type Scene, type ShadowGenerator,
} from "@babylonjs/core";
import type { Obstacle } from "../core/contracts";
import { StreetObjectGeometry } from "./StreetObjectGeometry";
import { materialDamage, type DamageKind } from "../gameplay/combat/materials";
import { blastFalloff, obstructed } from "../gameplay/combat/queries";
import { RESIDENCY_LIMITS } from "./ChunkResidency";
import { validateStreetObjects, type SavedStreetObject, type StreetObjectDefinition, type StreetRotation, type StreetVector } from "./StreetObjectRecords";

export interface StreetObjectState {
  definition: StreetObjectDefinition;
  health: number;
  burning: number;
  fallen: boolean;
  changed: boolean;
  position: Vector3;
  rotation: Quaternion;
  velocity: Vector3;
  angularVelocity: Vector3;
  root?: Mesh;
  body?: PhysicsBody;
  shape?: PhysicsShapeContainer;
  parts: Set<Mesh>;
  obstacle: Obstacle;
  light?: Vector3;
  quiet: number;
}

/** Authored furniture owns compact persistent state independently of disposable visual packages. */
export class StreetObjects {
  readonly objects = new Map<string, StreetObjectState>();
  private readonly box: PhysicsShapeBox;
  private readonly cylinder: PhysicsShapeCylinder;
  private readonly pending: { object: StreetObjectState; amount: number; point: Vector3; direction: Vector3 }[] = [];
  private position = Vector3.Zero();
  private anchors: Vector3[] = [];
  private readonly afterPhysics: Observer<Scene>;
  private disposed = false;
  private loads = 0;
  private releases = 0;
  private readonly geometry: StreetObjectGeometry;
  onBreak = (_position: Vector3) => {};
  onFire = (_id: string, _position: Vector3 | null) => {};
  constructor(private scene: Scene, private obstacles: Obstacle[], private lights: Vector3[], shadows?: ShadowGenerator) {
    this.geometry = new StreetObjectGeometry(scene, shadows, this.objects, object => this.makeRoot(object));
    this.box = new PhysicsShapeBox(Vector3.Zero(), Quaternion.Identity(), Vector3.One(), scene);
    this.cylinder = new PhysicsShapeCylinder(new Vector3(0, -.5, 0), new Vector3(0, .5, 0), 1, scene);
    this.box.material = this.cylinder.material = { friction: .65, restitution: .06 };
    this.afterPhysics = scene.onAfterPhysicsObservable.add(() => {
      for (const object of this.objects.values()) if (object.body && object.fallen) {
        object.position.copyFrom(object.root!.position);
        object.rotation.copyFrom(object.root!.rotationQuaternion!);
        object.velocity.copyFrom(object.body.getLinearVelocity());
        object.angularVelocity.copyFrom(object.body.getAngularVelocity());
        this.updateObstacle(object);
      }
    });
  }
  register(definitions: StreetObjectDefinition[]): void {
    for (const definition of definitions) {
      if (this.objects.has(definition.id)) throw new Error(`Duplicate authored object: ${definition.id}`);
      const obstacle: Obstacle = { x: definition.position[0], z: definition.position[2], w: .35, d: .35, height: 1 };
      const object: StreetObjectState = { definition, health: definition.health, burning: 0, fallen: false, changed: false,
        position: Vector3.FromArray(definition.position), rotation: Quaternion.Identity(), velocity: Vector3.Zero(), angularVelocity: Vector3.Zero(),
        parts: new Set(), obstacle, quiet: 0 };
      if (definition.light) object.light = this.lights.find(p => Vector3.DistanceSquared(p, Vector3.FromArray(definition.light!)) < .001);
      this.objects.set(definition.id, object);
      this.obstacles.push(obstacle);
      this.updateObstacle(object);
    }
    this.ensureCollision(this.position);
  }
  setActiveAnchors(anchors: Vector3[]): void { this.anchors = anchors; }
  private nearby(object: StreetObjectState, resident: boolean): boolean {
    const radius = resident ? RESIDENCY_LIMITS.collisionUnload : RESIDENCY_LIMITS.collisionLoad;
    return Vector3.DistanceSquared(this.position, object.position) < radius ** 2
      || this.anchors.some(p => Vector3.DistanceSquared(p, object.position) < (resident ? 150 : 90) ** 2);
  }
  ensureCollision(position: Vector3): void {
    if (this.disposed) return;
    this.position.copyFrom(position);
    for (const object of this.objects.values()) if (!object.body && this.nearby(object, false)) this.load(object);
  }
  updateResidency(position: Vector3): void {
    this.ensureCollision(position);
    // Retiring dynamic objects must retain their pose before structural support
    // disappears; static cleanup can safely stay spread across later frames.
    for (const object of this.objects.values()) if (object.body && object.fallen && !this.nearby(object, true)) this.release(object);
    let released = 0;
    for (const object of this.objects.values()) if (object.body && !this.nearby(object, true) && released++ < 24) this.release(object);
  }
  private makeRoot(object: StreetObjectState): Mesh {
    if (object.root) return object.root;
    const root = new Mesh(`${object.definition.id}/body`, this.scene);
    root.position.copyFrom(object.position);
    root.rotationQuaternion = object.rotation.clone();
    root.isVisible = false;
    root.metadata = { streetObject: object, material: object.definition.kind === "palm" ? "wood" : "metal", cameraBlocker: true };
    object.root = root;
    return root;
  }
  private load(object: StreetObjectState): void {
    const root = this.makeRoot(object);
    const compound = new PhysicsShapeContainer(this.scene);
    for (const part of object.definition.shapes) {
      const size = Vector3.FromArray(part.size);
      if (part.kind === "cylinder") { size.x *= .5; size.z *= .5; }
      compound.addChild(part.kind === "cylinder" ? this.cylinder : this.box, Vector3.FromArray(part.position), Quaternion.FromArray(part.rotation), size);
    }
    const body = new PhysicsBody(root, object.fallen ? PhysicsMotionType.DYNAMIC : PhysicsMotionType.STATIC, false, this.scene);
    body.shape = compound;
    body.setMassProperties({ mass: object.fallen ? object.definition.mass : 0 });
    body.setLinearDamping(.06); body.setAngularDamping(.15);
    if (object.fallen) { body.setLinearVelocity(object.velocity); body.setAngularVelocity(object.angularVelocity); }
    body.setCollisionCallbackEnabled(true);
    body.getCollisionObservable().add(event => {
      if (object.fallen || event.impulse < 240 || this.pending.length >= 64) return;
      const point = event.point?.clone() ?? root.position.clone();
      const direction = root.position.subtract(point); direction.y = 0;
      if (direction.lengthSquared() < .001) direction.copyFrom(event.normal ?? Vector3.Right());
      this.pending.push({ object, amount: Math.min(650, event.impulse / 20), point, direction: direction.normalize() });
    });
    object.body = body; object.shape = compound; this.loads++;
  }
  private release(object: StreetObjectState): void {
    if (object.body) this.releases++;
    if (object.body && object.fallen) {
      object.position.copyFrom(object.root!.position); object.rotation.copyFrom(object.root!.rotationQuaternion!);
      object.velocity.copyFrom(object.body.getLinearVelocity()); object.angularVelocity.copyFrom(object.body.getAngularVelocity());
    }
    object.body?.dispose(); object.shape?.dispose(); object.body = undefined; object.shape = undefined;
    if (!object.parts.size) { object.root?.dispose(); object.root = undefined; }
  }
  mount(meshes: readonly AbstractMesh[]): void { this.geometry.mount(meshes); }
  unmount(meshes: readonly AbstractMesh[]): void {
    this.geometry.unmount(meshes);
    // Collision and render residency can evict in either order.
    for (const object of this.objects.values()) if (object.root && !object.body && !object.parts.size) {
      object.root.dispose(); object.root = undefined;
    }
  }
  getStats() { return { objects: this.objects.size, residentBodies: [...this.objects.values()].filter(o => o.body).length, fallen: [...this.objects.values()].filter(o => o.fallen).length, colliderLoads: this.loads, colliderDisposals: this.releases, ...this.geometry.stats() }; }
  hit(object: StreetObjectState, amount: number, point: Vector3, kind: DamageKind = "impact", direction?: Vector3): void {
    if (this.objects.get(object.definition.id) !== object || !Number.isFinite(amount) || amount <= 0) return;
    const applied = materialDamage(object.definition.kind === "palm" ? "wood" : "metal", amount, kind);
    if (applied <= 0) return;
    object.changed = true;
    object.health = Math.max(0, object.health - applied);
    if (!object.body && kind !== "fire") this.load(object);
    if (object.health <= 0 && !object.fallen) {
      object.fallen = true; object.quiet = 0;
      object.body?.setMotionType(PhysicsMotionType.DYNAMIC);
      object.body?.setMassProperties({ mass: object.definition.mass });
      this.geometry.sync(object);
      if (object.light) { const index = this.lights.indexOf(object.light); if (index >= 0) this.lights.splice(index, 1); }
      for (const mesh of object.parts) if (mesh.metadata.streetEmitter) mesh.setEnabled(false);
      this.onBreak(object.position.clone());
    }
    if (object.fallen && object.body && kind !== "fire") {
      const away = direction?.normalizeToNew() ?? object.position.subtract(point).normalize();
      if (away.lengthSquared() < .01) away.set(1, 0, .25).normalize();
      const contact = point.clone(); contact.y = Math.max(contact.y, object.position.y + 1);
      object.body!.applyImpulse(away.scale(Math.min(2400, applied * 5)), contact);
    }
  }
  explosion(position: Vector3, power: number): void {
    const exposed = [...this.objects.values()].filter(o => o.body && Vector3.DistanceSquared(o.position, position) < 14 ** 2
      && !obstructed(this.scene, position, o.position.add(new Vector3(0, .8, 0)), { roots: [o.root!] }));
    for (const object of exposed) {
      const scale = blastFalloff(Vector3.Distance(object.position, position));
      this.hit(object, power * scale, position, "blast", object.position.subtract(position).add(new Vector3(0, .25, 0)));
      if (scale > .28 && object.definition.kind === "palm") { object.burning = Math.max(object.burning, 12); object.changed = true; }
    }
  }
  heatAt(position: Vector3): number {
    let heat = 0;
    for (const object of this.objects.values()) if (object.body && object.burning > 0) {
      const distance = Vector3.Distance(object.position, position);
      if (distance < 2 && !obstructed(this.scene, object.position.add(new Vector3(0, .5, 0)), position, { roots: [object.root!] }))
        heat += 10 * (1 - distance / 2);
    }
    return heat;
  }
  update(dt: number, weather: string): void {
    for (const hit of this.pending.splice(0)) this.hit(hit.object, hit.amount, hit.point, "impact", hit.direction);
    for (const object of this.objects.values()) {
      if (object.burning > 0) {
        object.burning = Math.max(0, object.burning - dt * (weather === "Rain" ? 5 : 1));
        if (object.burning > 0) { this.hit(object, dt * 12, object.position, "fire"); this.onFire(object.definition.id, object.position); }
        else this.onFire(object.definition.id, null);
      }
      if (object.body && object.fallen) {
        if (object.velocity.lengthSquared() < .015 && object.angularVelocity.lengthSquared() < .015) object.quiet += dt;
        else object.quiet = 0;
        // Havok sleeps resting dynamic bodies naturally, so later contacts can wake them.
      }
    }
  }
  private updateObstacle(object: StreetObjectState): void {
    const obstacle = object.obstacle;
    if (!object.fallen) {
      const trunk = object.definition.shapes[0];
      obstacle.x = object.position.x; obstacle.z = object.position.z;
      obstacle.w = Math.max(.4, trunk?.size[0] ?? .4); obstacle.d = Math.max(.4, trunk?.size[2] ?? .4);
      obstacle.height = Math.max(1, ...object.definition.shapes.map(s => s.position[1] + s.size[1] / 2));
      return;
    }
    const min = new Vector3(Infinity, Infinity, Infinity), max = new Vector3(-Infinity, -Infinity, -Infinity);
    const matrix = object.root?.computeWorldMatrix(true) ?? Matrix.Compose(Vector3.One(), object.rotation, object.position);
    // Conservative nav bounds follow the fallen trunk/housing; visual foliage remains flexible.
    for (const shape of object.definition.shapes) for (const y of [-1, 1]) {
      const local = new Vector3(0, y * shape.size[1] / 2, 0).applyRotationQuaternion(Quaternion.FromArray(shape.rotation)).addInPlace(Vector3.FromArray(shape.position));
      const p = Vector3.TransformCoordinates(local, matrix), r = Math.max(shape.size[0], shape.size[2]) / 2;
      min.minimizeInPlace(p.subtract(new Vector3(r, r, r))); max.maximizeInPlace(p.add(new Vector3(r, r, r)));
    }
    obstacle.x = (min.x + max.x) / 2; obstacle.z = (min.z + max.z) / 2;
    obstacle.w = max.x - min.x; obstacle.d = max.z - min.z; obstacle.height = Math.max(0, max.y);
  }
  serialize(): SavedStreetObject[] {
    return [...this.objects.values()].filter(o => o.changed).map(o => ({ id: o.definition.id, health: o.health, burning: o.burning, fallen: o.fallen,
      position: o.position.asArray() as StreetVector, rotation: o.rotation.asArray() as StreetRotation,
      velocity: o.velocity.asArray() as StreetVector, angularVelocity: o.angularVelocity.asArray() as StreetVector }));
  }
  restore(saved: SavedStreetObject[]): void {
    if (!validateStreetObjects(saved)) throw new Error("Invalid authored street-object state");
    const records = new Map(saved.map(s => [s.id, s]));
    for (const object of this.objects.values()) {
      const state = records.get(object.definition.id), resident = !!object.body;
      this.release(object);
      object.health = state ? Math.min(object.definition.health, state.health) : object.definition.health;
      object.burning = state?.burning ?? 0; object.fallen = state?.fallen ?? false; object.changed = !!state; object.quiet = 0;
      object.position.copyFrom(Vector3.FromArray(state?.position ?? object.definition.position));
      object.rotation.copyFrom(state ? Quaternion.FromArray(state.rotation).normalize() : Quaternion.Identity());
      object.velocity.copyFrom(state ? Vector3.FromArray(state.velocity) : Vector3.Zero());
      object.angularVelocity.copyFrom(state ? Vector3.FromArray(state.angularVelocity) : Vector3.Zero());
      if (object.root) { object.root.position.copyFrom(object.position); object.root.rotationQuaternion!.copyFrom(object.rotation); }
      if (resident || this.nearby(object, false)) this.load(object);
      this.geometry.sync(object);
      if (object.light) {
        const index = this.lights.indexOf(object.light);
        if (object.fallen && index >= 0) this.lights.splice(index, 1);
        else if (!object.fallen && index < 0) this.lights.push(object.light);
      }
      this.onFire(object.definition.id, null); this.updateObstacle(object);
    }
    this.pending.length = 0;
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.scene.onAfterPhysicsObservable.remove(this.afterPhysics);
    this.geometry.dispose();
    for (const object of this.objects.values()) {
      this.release(object);
      for (const mesh of object.parts) mesh.parent = null;
      object.parts.clear(); object.root?.dispose();
      const i = this.obstacles.indexOf(object.obstacle); if (i >= 0) this.obstacles.splice(i, 1);
      this.onFire(object.definition.id, null);
    }
    this.objects.clear(); this.box.dispose(); this.cylinder.dispose();
  }
}
