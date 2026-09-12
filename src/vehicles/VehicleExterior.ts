import {
  HavokPlugin, Matrix, Mesh, PhysicsShapeBox, PhysicsShapeContainer, PhysicsShapeCylinder, ProximityCastResult,
  Quaternion, Vector3, type PhysicsShape, type Scene, type TransformNode,
} from "@babylonjs/core";
import type { Vehicle } from "./VehicleSystem";
import type { DoorVisual, WheelVisual } from "./models";
import { ROAD_CAR_KINDS } from "./RoadCarCatalog";
import { applyDoorPose } from './DoorPose';

/** A deliberate clearance below a ray-supported wheel, not a replacement suspension. */
export const WHEEL_COLLISION_INSET = 0.025;
const ROAD_KINDS = new Set<string>([...ROAD_CAR_KINDS, "concept", "motorcycle"]);

interface Component {
  node: TransformNode;
  mesh?: Mesh;
  wheel?: WheelVisual;
  wheelCenter?: Vector3;
  wheelWidth?: number;
  shape: PhysicsShape;
  enabled: boolean;
  position: Vector3;
  rotation: Quaternion;
  scale: Vector3;
}

function descendants(mesh: Mesh): Mesh[] {
  return [mesh, ...mesh.getChildMeshes().filter((child): child is Mesh => child instanceof Mesh)]
    .filter(child => child.getTotalVertices() > 0);
}

/** Narrow moving parts belong to the chassis body: no self-contact or extra entry exclusions. */
export class VehicleExterior {
  private readonly components: Component[] = [];
  private readonly baseCount: number;
  private readonly owned: PhysicsShape[] = [];
  private readonly inverse = Matrix.Identity();
  private readonly relative = Matrix.Identity();
  private readonly position = Vector3.Zero();
  private readonly scale = Vector3.One();
  private readonly meshScale = Vector3.One();
  private readonly rotation = Quaternion.Identity();
  private readonly doorQueries = new Map<DoorVisual, PhysicsShapeContainer>();
  private readonly proximityInput = new ProximityCastResult();
  private readonly proximityHit = new ProximityCastResult();
  private readonly plugin: HavokPlugin;
  private box?: PhysicsShapeBox;
  private disposed = false;

  constructor(private vehicle: Vehicle, private container: PhysicsShapeContainer, scene: Scene) {
    this.plugin = scene.getPhysicsEngine()!.getPhysicsPlugin() as HavokPlugin;
    this.baseCount = container.getNumChildren();
    if (!ROAD_KINDS.has(vehicle.kind)) return;
    const box = new PhysicsShapeBox(Vector3.Zero(), Quaternion.Identity(), Vector3.One(), scene);
    this.box = box;
    const cylinder = new PhysicsShapeCylinder(new Vector3(-0.5, 0, 0), new Vector3(0.5, 0, 0), 1, scene);
    box.material = { friction: 0.38, restitution: 0.055 };
    cylinder.material = { friction: 0.25, restitution: 0.035 };
    this.owned.push(box, cylinder);
    for (const door of vehicle.model.doors) {
      const query = new PhysicsShapeContainer(scene);
      this.doorQueries.set(door, query);
      this.owned.push(query);
    }
    const meshes = new Set<Mesh>();
    for (const door of vehicle.model.doors) for (const mesh of descendants(door.mesh)) meshes.add(mesh);
    for (const bumper of vehicle.model.bumpers) for (const mesh of descendants(bumper)) meshes.add(mesh);
    // Include independently authored mirrors, too; most mirrors are already door children.
    for (const mesh of vehicle.root.getChildMeshes()) if (mesh instanceof Mesh && /mirror/i.test(mesh.name) && mesh.getTotalVertices()) meshes.add(mesh);
    for (const mesh of meshes) this.components.push({ node: mesh, mesh, shape: box, enabled: false,
      position: Vector3.Zero(), rotation: Quaternion.Identity(), scale: Vector3.Zero() });
    for (const wheel of vehicle.model.wheels) {
      wheel.pivot.computeWorldMatrix(true);
      const inverse = Matrix.Invert(wheel.pivot.getWorldMatrix());
      const minimum = new Vector3(Infinity, Infinity, Infinity), maximum = new Vector3(-Infinity, -Infinity, -Infinity);
      for (const mesh of wheel.pivot.getChildMeshes()) {
        if (!mesh.getTotalVertices()) continue;
        const matrix = mesh.computeWorldMatrix(true).multiply(inverse);
        for (const corner of mesh.getBoundingInfo().boundingBox.vectors) {
          const point = Vector3.TransformCoordinates(corner, matrix);
          minimum.minimizeInPlace(point); maximum.maximizeInPlace(point);
        }
      }
      this.components.push({ node: wheel.pivot, wheel, shape: cylinder, enabled: false,
        wheelCenter: minimum.add(maximum).scale(0.5), wheelWidth: maximum.x - minimum.x,
        position: Vector3.Zero(), rotation: Quaternion.Identity(), scale: Vector3.Zero() });
    }
    // Keep the established chassis mass, COM and inertia when an animated compound changes.
    // Babylon recomputes unspecified mass properties each time body.shape is assigned.
    vehicle.body.setMassProperties(vehicle.body.getMassProperties());
    this.update();
  }

  get componentCount(): number { return this.components.filter(component => component.enabled).length; }

  /** Motor-driven doors stop at nearby bodies instead of injecting overlap into the chassis. */
  limitDoorAngle(door: DoorVisual, proposed: number): number {
    const query = this.doorQueries.get(door);
    const original = door.angle;
    if (!query || !door.mesh.isEnabled() || Math.abs(proposed - original) < 1e-7) return proposed;
    // One reusable compound includes the currently enabled panel, glass, handle and mirror.
    for (let i = query.getNumChildren() - 1; i >= 0; i--) query.removeChild(i);
    const inverse = Matrix.Invert(door.mesh.computeWorldMatrix(true));
    for (const mesh of descendants(door.mesh)) {
      if (!mesh.isEnabled()) continue;
      const relative = mesh.computeWorldMatrix(true).multiply(inverse);
      const bounds = mesh.getBoundingInfo().boundingBox;
      const scale = Vector3.One(), rotation = Quaternion.Identity();
      relative.decompose(scale, rotation);
      scale.multiplyInPlace(bounds.extendSize).scaleInPlace(2);
      // 1 cm clearance also covers the small sampled rotation between query poses.
      scale.set(Math.max(.01, Math.abs(scale.x)) + .02, Math.max(.01, Math.abs(scale.y)) + .02, Math.max(.01, Math.abs(scale.z)) + .02);
      query.addChild(this.box!, Vector3.TransformCoordinates(bounds.center, relative), rotation, scale);
    }
    const position = Vector3.Zero(), rotation = Quaternion.Identity();
    const separation = (angle: number) => {
      applyDoorPose(door, angle);
      door.mesh.computeWorldMatrix(true).decompose(undefined, rotation, position);
      this.plugin.shapeProximity({ shape: query, position, rotation, maxDistance: 0,
        shouldHitTriggers: false, ignoreBody: this.vehicle.body }, this.proximityInput, this.proximityHit);
      return this.proximityHit.hasHit ? this.proximityHit.hitDistance : 0;
    };
    let accepted = original, clearance = separation(original);
    const steps = Math.ceil(Math.abs(proposed - original) / .004);
    for (let i = 1; i <= steps; i++) {
      const candidate = original + (proposed - original) * i / steps;
      const next = separation(candidate);
      if (next < -.001 && next < clearance - .0001) break;
      accepted = candidate;
      clearance = next;
    }
    applyDoorPose(door, original);
    door.mesh.computeWorldMatrix(true);
    return accepted;
  }

  /** Call after suspension/door visuals, before the fixed Havok step. No shapes are allocated here. */
  update(): void {
    if (this.disposed || !this.components.length) return;
    this.vehicle.root.computeWorldMatrix(true).invertToRef(this.inverse);
    let changed = false;
    for (const component of this.components) {
      const enabled = !component.node.isDisposed() && component.node.isEnabled();
      if (enabled !== component.enabled) changed = true;
      component.enabled = enabled;
      if (!enabled) continue;
      component.node.computeWorldMatrix(true).multiplyToRef(this.inverse, this.relative);
      this.relative.decompose(this.meshScale, this.rotation, this.position);
      if (component.mesh) {
        const bounds = component.mesh.getBoundingInfo().boundingBox;
        Vector3.TransformCoordinatesToRef(bounds.center, this.relative, this.position);
        this.scale.copyFrom(bounds.extendSize).scaleInPlace(2).multiplyInPlace(this.meshScale);
        this.scale.set(Math.max(0.01, Math.abs(this.scale.x)), Math.max(0.01, Math.abs(this.scale.y)), Math.max(0.01, Math.abs(this.scale.z)));
      } else {
        Vector3.TransformCoordinatesToRef(component.wheelCenter!, this.relative, this.position);
        const radius = (component.wheel!.radius ?? this.vehicle.tuning.wheelRadius) * (component.wheel!.damaged ? 0.75 : 1) - WHEEL_COLLISION_INSET;
        this.scale.set(component.wheelWidth!, radius, radius);
      }
      if (Vector3.DistanceSquared(component.position, this.position) > 1e-8
        || Vector3.DistanceSquared(component.scale, this.scale) > 1e-8
        || Math.abs(Quaternion.Dot(component.rotation, this.rotation)) < 1 - 1e-8) changed = true;
      component.position.copyFrom(this.position);
      component.rotation.copyFrom(this.rotation);
      component.scale.copyFrom(this.scale);
    }
    if (!changed) return;
    // The public Babylon API has no child-transform setter. Reuse the two primitive
    // shapes and replace child instances only when local dimensions/poses change.
    for (let index = this.container.getNumChildren() - 1; index >= this.baseCount; index--) this.container.removeChild(index);
    for (const component of this.components) if (component.enabled)
      this.container.addChild(component.shape, component.position, component.rotation, component.scale);
    this.vehicle.body.shape = this.container;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (let index = this.container.getNumChildren() - 1; index >= this.baseCount; index--) this.container.removeChild(index);
    for (const shape of [...this.owned].reverse()) shape.dispose();
  }
}

/** Detached assemblies retain their enabled glazing/mirrors instead of one door-panel box. */
export function detachedComponentShape(root: Mesh, scene: Scene): { shape: PhysicsShapeContainer; owned: PhysicsShape[] } {
  const shape = new PhysicsShapeContainer(scene);
  const box = new PhysicsShapeBox(Vector3.Zero(), Quaternion.Identity(), Vector3.One(), scene);
  box.material = { friction: 0.65, restitution: 0.15 };
  const inverse = Matrix.Invert(root.computeWorldMatrix(true));
  for (const mesh of descendants(root)) {
    if (!mesh.isEnabled()) continue;
    const relative = mesh.computeWorldMatrix(true).multiply(inverse);
    const bounds = mesh.getBoundingInfo().boundingBox;
    const center = Vector3.TransformCoordinates(bounds.center, relative);
    const rotation = Quaternion.Identity(), scale = Vector3.One();
    relative.decompose(scale, rotation);
    scale.multiplyInPlace(bounds.extendSize).scaleInPlace(2);
    scale.set(Math.max(.01, Math.abs(scale.x)), Math.max(.01, Math.abs(scale.y)), Math.max(.01, Math.abs(scale.z)));
    shape.addChild(box, center, rotation, scale);
  }
  return { shape, owned: [shape, box] };
}
