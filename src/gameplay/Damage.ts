import {
  Color3,
  DynamicTexture,
  Mesh,
  MeshBuilder,
  PBRMaterial,
  PhysicsAggregate,
  PhysicsShapeType,
  PhysicsMotionType,
  Quaternion,
  Vector3,
  VertexBuffer,
  type Material,
  type PhysicsEngineV2,
  type Scene,
  type ShadowGenerator,
} from "@babylonjs/core";
import { random } from "../core/math";
import type { WorldContract, Obstacle } from "../core/contracts";
import type { SavedProp } from "../core/Persistence";
import {
  MATERIAL_RESPONSE,
  materialDamage,
  type PhysicalMaterial,
  type DamageKind,
} from "./combat/materials";
import { blastFalloff, obstructed } from "./combat/queries";
import { FireEffects } from "./combat/FireEffects";
import type { StreetObjectState } from "../world/StreetObjectSystem";
export type PropKind = "street" | "fence" | "gate";
export interface SerializableProp extends SavedProp {
  kind?: PropKind;
  vertices?: number[][];
}
export interface Prop {
  id: string;
  mesh: Mesh;
  parts: Mesh[];
  physics: PhysicsAggregate;
  health: number;
  material: PhysicalMaterial;
  burning: number;
  kind: PropKind;
  ownedMaterials: Material[];
  obstacle?: Obstacle;
}
export class DamageSystem {
  props: Prop[] = [];
  destroyed = new Set<string>();
  debris: {
    mesh: Mesh;
    physics: PhysicsAggregate;
    life: number;
    owner: string;
  }[] = [];
  readonly fire: FireEffects;
  private rng = random(800);
  private sequence = 0;
  private pendingHits: { prop: Prop; amount: number; point: Vector3 }[] = [];
  onBreak = (position: Vector3) => {};
  constructor(
    public scene: Scene,
    public shadows: ShadowGenerator,
    public world: WorldContract,
    seedStreetProps = true,
  ) {
    this.fire = new FireEffects(scene);
    if (world.streetObjects) {
      world.streetObjects.onBreak = position => this.onBreak(position);
      world.streetObjects.onFire = (id, position) => { if (position) this.fire.set(id, position); else this.fire.remove(id); };
    }
    if (seedStreetProps)
      for (let i = 0; i < 18; i++)
        this.spawn(
          new Vector3(i < 8 ? 10 : -60, 0.55, -52 + i * 5),
          i % 3 === 0 ? "glass" : i % 2 ? "wood" : "metal",
          "street-prop-" + i,
        );
  }
  spawn(
    p: Vector3,
    material: PhysicalMaterial = "wood",
    id = "creative-prop-" + Date.now() + "-" + ++this.sequence,
    rotation?: Quaternion,
    kind: PropKind = "street",
  ): Prop {
    if (this.props.some((prop) => prop.id === id))
      throw new Error("Duplicate prop ID: " + id);
    const barrier = kind !== "street",
      height = barrier ? 1.8 : material === "glass" ? 2.25 : 1.1,
      width = barrier ? 3.4 : material === "glass" ? 1.05 : 0.9,
      depth = barrier ? 0.18 : material === "glass" ? 1.05 : 0.85;
    const before = new Set(this.scene.materials);
    const m = MeshBuilder.CreateBox(id, { width, height, depth }, this.scene);
    m.position.copyFrom(p);
    m.position.y += (height - 1.1) / 2;
    if (rotation) m.rotationQuaternion = rotation.clone();
    const mat = new PBRMaterial(id + "-material", this.scene);
    mat.albedoColor = Color3.FromHexString(
      material === "wood"
        ? "#a38b66"
        : material === "metal"
          ? "#547970"
          : "#96c4c2",
    );
    mat.roughness = material === "glass" ? 0.18 : 0.79;
    mat.metallic = material === "metal" ? 0.5 : 0;
    if (material === "glass") mat.alpha = 0.28;
    m.material = mat;
    m.isVisible = false;
    const parts = barrier
      ? this.buildBarrier(m, kind, material, mat)
      : this.buildPropGeometry(m, material, mat);
    const physics = new PhysicsAggregate(
      m,
      PhysicsShapeType.BOX,
      {
        mass: barrier ? 0 : MATERIAL_RESPONSE[material].mass,
        friction: 0.65,
        restitution: 0.1,
      },
      this.scene,
    );
    const prop: Prop = {
      id,
      mesh: m,
      parts,
      physics,
      health: MATERIAL_RESPONSE[material].health * (barrier ? 1.6 : 1),
      material,
      burning: 0,
      kind,
      ownedMaterials: this.scene.materials.filter(
        (value) => !before.has(value),
      ),
    };
    m.metadata = { prop, cameraBlocker: true };
    for (const part of parts) {
      part.metadata = { prop, cameraBlocker: true };
      part.markVerticesDataAsUpdatable(VertexBuffer.PositionKind, true);
    }
    this.shadows.addShadowCaster(m, true);
    this.props.push(prop);
    if (barrier) {
      const yaw = rotation?.toEulerAngles().y ?? 0;
      prop.obstacle = {
        x: m.position.x,
        z: m.position.z,
        w: Math.abs(Math.cos(yaw)) * width + Math.abs(Math.sin(yaw)) * depth,
        d: Math.abs(Math.sin(yaw)) * width + Math.abs(Math.cos(yaw)) * depth,
        height,
        mesh: m,
      };
      this.world.obstacles.push(prop.obstacle);
    }
    physics.body.setCollisionCallbackEnabled(true);
    physics.body.getCollisionObservable().add((e) => {
      if (e.impulse > 180 && this.pendingHits.length < 64)
        this.pendingHits.push({
          prop,
          amount: Math.min(150, e.impulse / 12),
          point: e.point?.clone() ?? m.position.clone(),
        });
    });
    return prop;
  }
  spawnBarrier(
    position: Vector3,
    kind: "fence" | "gate" = "fence",
    material: PhysicalMaterial = "wood",
    heading = 0,
  ): Prop {
    return this.spawn(
      position.add(new Vector3(0, 0.55, 0)),
      material,
      undefined,
      Quaternion.RotationYawPitchRoll(heading, 0, 0),
      kind,
    );
  }
  private buildBarrier(
    root: Mesh,
    kind: PropKind,
    material: PhysicalMaterial,
    base: PBRMaterial,
  ): Mesh[] {
    const pieces: Mesh[] = [];
    const box = (
      name: string,
      x: number,
      y: number,
      w: number,
      h: number,
      d: number,
    ) => {
      const mesh = MeshBuilder.CreateBox(
        root.name + "/" + name,
        { width: w, height: h, depth: d },
        this.scene,
      );
      mesh.position.set(x, y, 0);
      mesh.material = base;
      pieces.push(mesh);
    };
    for (const x of [-1.62, 1.62]) box("post", x, 0, 0.14, 1.8, 0.18);
    for (const y of [-0.5, 0.5]) box("rail", 0, y, 3.18, 0.12, 0.14);
    const count = material === "glass" ? 3 : 15;
    for (let i = 0; i < count; i++)
      box(
        material === "glass" ? "glass-panel" : "picket",
        -1.48 + ((i + 0.5) * 2.96) / count,
        0,
        material === "glass" ? 0.94 : material === "metal" ? 0.042 : 0.155,
        1.57,
        material === "glass" ? 0.04 : 0.075,
      );
    if (kind === "gate") {
      box("latch", 1.12, 0.07, 0.35, 0.09, 0.22);
      for (const y of [-0.5, 0.5]) box("hinge", -1.5, y, 0.3, 0.17, 0.24);
    }
    const merged = Mesh.MergeMeshes(
      pieces,
      true,
      true,
      undefined,
      false,
      false,
    )!;
    merged.name = root.name + "/" + kind;
    merged.parent = root;
    merged.material = base;
    return [merged];
  }
  hit(
    prop: Prop,
    amount: number,
    point: Vector3,
    kind: DamageKind = "impact",
    direction?: Vector3,
  ): void {
    if (prop.health <= 0 || !this.props.includes(prop)) return;
    const applied = materialDamage(prop.material, amount, kind);
    if (applied <= 0) return;
    prop.health = Math.max(0, prop.health - applied);
    if (kind !== "fire") {
      const impulse =
        direction?.normalizeToNew() ??
        prop.mesh.position.subtract(point).normalize();
      if (prop.physics.body.getMotionType() === PhysicsMotionType.DYNAMIC)
        prop.physics.body.applyImpulse(
          impulse.scale(Math.min(220, applied * 2)),
          point,
        );
      this.deform(prop, point, Math.min(0.22, applied * 0.003), direction);
    }
    if (prop.health <= 0) this.break(prop);
  }
  private deform(
    prop: Prop,
    point: Vector3,
    strength: number,
    direction?: Vector3,
  ): void {
    const worldDirection =
      direction?.normalizeToNew() ??
      prop.mesh.position.subtract(point).normalize();
    for (const part of prop.parts) {
      const world = part.computeWorldMatrix(true),
        inverse = world.clone().invert(),
        localPoint = Vector3.TransformCoordinates(point, inverse),
        localDirection = Vector3.TransformNormal(worldDirection, inverse),
        positions = part.getVerticesData(VertexBuffer.PositionKind);
      if (!positions) continue;
      for (let i = 0; i < positions.length; i += 3) {
        const vertex = new Vector3(
            positions[i],
            positions[i + 1],
            positions[i + 2],
          ),
          weight = Math.max(0, 1 - Vector3.Distance(vertex, localPoint) / 0.85);
        if (weight > 0) {
          vertex.addInPlace(localDirection.scale(strength * weight));
          positions[i] = vertex.x;
          positions[i + 1] = vertex.y;
          positions[i + 2] = vertex.z;
        }
      }
      part.updateVerticesData(VertexBuffer.PositionKind, positions, true);
      part.refreshBoundingInfo();
    }
  }
  private break(prop: Prop): void {
    if (this.destroyed.has(prop.id)) return;
    prop.health = 0;
    this.destroyed.add(prop.id);
    prop.physics.dispose();
    prop.mesh.setEnabled(false);
    this.removeObstacle(prop);
    const p = prop.mesh.position.clone();
    // Fragments retain the material owner until all corresponding physics bodies have expired.
    for (let i = 0; i < (prop.kind === "street" ? 6 : 12); i++) {
      if (this.debris.length >= 60) this.disposeDebris(0);
      const mesh = MeshBuilder.CreateBox(
        "debris/" + prop.id,
        {
          width: prop.kind === "street" ? 0.16 + this.rng() * 0.25 : 0.12,
          height: prop.kind === "street" ? 0.12 : 0.45 + this.rng() * 0.6,
          depth: prop.material === "glass" ? 0.025 : 0.12,
        },
        this.scene,
      );
      mesh.position
        .copyFrom(p)
        .addInPlace(
          new Vector3(
            (this.rng() - 0.5) * (prop.kind === "street" ? 0.8 : 3),
            (this.rng() - 0.5) * 0.7,
            (this.rng() - 0.5) * 0.5,
          ),
        );
      mesh.material = prop.mesh.material;
      mesh.metadata = { combatEffect: true };
      mesh.isPickable = false;
      const physics = new PhysicsAggregate(
        mesh,
        PhysicsShapeType.BOX,
        {
          mass: prop.material === "glass" ? 0.35 : 1.5,
          friction: 0.65,
          restitution: 0.18,
        },
        this.scene,
      );
      physics.body.applyImpulse(
        new Vector3(
          (this.rng() - 0.5) * 6,
          2 + this.rng() * 4,
          (this.rng() - 0.5) * 6,
        ),
        mesh.position,
      );
      this.debris.push({ mesh, physics, life: 14, owner: prop.id });
    }
    if (prop.burning > 0) this.fire.set(prop.id, p);
    this.onBreak(p);
  }
  /** Original street-prop art; each material is merged to bound the extra draw calls. */
  private buildPropGeometry(
    root: Mesh,
    kind: "wood" | "metal" | "glass",
    base: PBRMaterial,
  ): Mesh[] {
    const batches = new Map<PBRMaterial, Mesh[]>();
    const makeMaterial = (
      name: string,
      color: string,
      roughness = 0.7,
      metallic = 0,
    ) => {
      const m = new PBRMaterial(root.name + "/" + name, this.scene);
      m.albedoColor = Color3.FromHexString(color);
      m.roughness = roughness;
      m.metallic = metallic;
      return m;
    };
    const dark = makeMaterial("dark-metal", "#3b4947", 0.52, 0.55);
    const trim = makeMaterial(
      "trim",
      kind === "wood" ? "#786b55" : "#b8c2b5",
      0.66,
      kind === "wood" ? 0.35 : 0.6,
    );
    const add = (m: Mesh, material: PBRMaterial) => {
      m.material = material;
      let batch = batches.get(material);
      if (!batch) {
        batch = [];
        batches.set(material, batch);
      }
      batch.push(m);
      return m;
    };
    const box = (
      name: string,
      x: number,
      y: number,
      z: number,
      w: number,
      h: number,
      d: number,
      material = base,
    ) => {
      const m = MeshBuilder.CreateBox(
        root.name + "/" + name,
        { width: w, height: h, depth: d },
        this.scene,
      );
      m.position.set(x, y, z);
      return add(m, material);
    };
    const cyl = (
      name: string,
      x: number,
      y: number,
      z: number,
      diameter: number,
      height: number,
      material = dark,
    ) => {
      const m = MeshBuilder.CreateCylinder(
        root.name + "/" + name,
        { diameter, height, tessellation: 12 },
        this.scene,
      );
      m.position.set(x, y, z);
      return add(m, material);
    };
    if (kind === "wood") {
      // Shipping crate: individual timber boards, open seams, corner battens and steel straps.
      box("dark-interior", 0, 0, 0, 0.84, 1.01, 0.8, trim);
      for (const side of [-1, 1]) {
        for (let plank = 0; plank < 5; plank++) {
          box(
            "face-board",
            0,
            -0.424 + plank * 0.212,
            side * 0.423,
            0.89,
            0.193,
            0.04,
          );
          box(
            "side-board",
            side * 0.446,
            -0.424 + plank * 0.212,
            0,
            0.04,
            0.193,
            0.81,
          );
        }
        box("top-board", side * 0.224, 0.531, 0, 0.426, 0.04, 0.84);
        box("steel-strap", side * 0.27, 0, -0.448, 0.043, 1.06, 0.012, dark);
        box("steel-strap", side * 0.27, 0, 0.448, 0.043, 1.06, 0.012, dark);
        box("steel-strap-top", side * 0.27, 0.558, 0, 0.043, 0.009, 0.91, dark);
        box("corner-batten", side * 0.405, 0, -0.455, 0.067, 1.1, 0.052);
        box("corner-batten", side * 0.405, 0, 0.455, 0.067, 1.1, 0.052);
        for (const yy of [-0.38, 0.38])
          for (const xx of [-0.27, 0.27])
            box("strap-rivet", xx, yy, side * 0.458, 0.018, 0.018, 0.012, trim);
      }
    } else if (kind === "metal") {
      // Municipal wheeled bin, with a hinged lid, handles, molded ribs and two rubber wheels.
      box("waste-bin-body", 0, -0.025, 0, 0.72, 0.91, 0.71);
      box("bin-bottom", 0, -0.47, 0, 0.63, 0.08, 0.63, dark);
      box("hinged-lid", 0, 0.464, -0.02, 0.88, 0.12, 0.84, dark);
      box("lid-lip", 0, 0.405, -0.412, 0.82, 0.045, 0.033, base);
      box("handle", 0, 0.39, 0.426, 0.46, 0.08, 0.05, dark);
      for (const side of [-1, 1]) {
        const wheel = cyl(
          "wheel",
          side * 0.36,
          -0.437,
          0.27,
          0.215,
          0.075,
          dark,
        );
        wheel.rotation.z = Math.PI / 2;
        const hub = cyl(
          "wheel-hub",
          side * 0.403,
          -0.437,
          0.27,
          0.085,
          0.018,
          trim,
        );
        hub.rotation.z = Math.PI / 2;
        box("handle-mount", side * 0.25, 0.345, 0.37, 0.06, 0.16, 0.13, base);
      }
      for (const x of [-0.23, 0, 0.23])
        box("molded-rib", x, -0.09, -0.363, 0.035, 0.71, 0.026, base);
      box("reflective-label", 0, 0.166, -0.381, 0.32, 0.155, 0.013, trim);
      box("label-stripe", 0, 0.166, -0.391, 0.22, 0.025, 0.012, dark);
    } else {
      // A glass phone kiosk: full-height framing, transparent panels, handset and directory.
      box("plinth", 0, -1.06, 0, 1.05, 0.13, 1.05, trim);
      box("kiosk-roof", 0, 1.066, 0, 1.07, 0.12, 1.07, dark);
      for (const sx of [-1, 1])
        for (const sz of [-1, 1])
          box(
            "frame-upright",
            sx * 0.49,
            0,
            sz * 0.49,
            0.065,
            2.14,
            0.065,
            dark,
          );
      for (const side of [-1, 1]) {
        box("glass-side", side * 0.493, -0.03, 0, 0.017, 1.82, 0.91, base);
        box("side-midrail", side * 0.503, -0.36, 0, 0.032, 0.033, 0.94, trim);
      }
      box("glass-back", 0, -0.03, 0.493, 0.91, 1.82, 0.017, base);
      box("front-transom", 0, 0.853, -0.49, 0.95, 0.22, 0.05, trim);
      box("telephone-housing", 0.12, 0.2, 0.34, 0.36, 0.62, 0.17, trim);
      box("telephone-keypad", 0.12, 0.12, 0.246, 0.18, 0.2, 0.015, dark);
      box("telephone-display", 0.12, 0.36, 0.246, 0.2, 0.07, 0.015, dark);
      box("handset", -0.16, 0.22, 0.265, 0.07, 0.31, 0.08, dark);
      box("handset-earpiece", -0.13, 0.36, 0.255, 0.14, 0.08, 0.115, dark);
      box("handset-mouthpiece", -0.13, 0.07, 0.255, 0.14, 0.08, 0.115, dark);
      box("handset-cord", -0.165, -0.11, 0.296, 0.018, 0.31, 0.022, dark);
      box("directory-shelf", 0, -0.34, 0.3, 0.52, 0.047, 0.32, dark);
      for (let row = 0; row < 4; row++)
        for (let col = 0; col < 3; col++)
          box(
            "keypad-button",
            0.069 + col * 0.05,
            0.173 - row * 0.045,
            0.232,
            0.024,
            0.022,
            0.008,
            trim,
          );
      if (
        typeof document !== "undefined" ||
        typeof OffscreenCanvas !== "undefined"
      ) {
        const texture = new DynamicTexture(
          root.name + "/telephone-sign",
          { width: 256, height: 64 },
          this.scene,
          true,
        );
        texture.drawText(
          "TELEPHONE",
          null,
          44,
          "bold 31px sans-serif",
          "#e9e4cf",
          "#3b5d59",
          true,
        );
        const signMat = makeMaterial("telephone-lettering", "#ffffff", 0.8);
        signMat.albedoTexture = texture;
        signMat.emissiveTexture = texture;
        signMat.emissiveColor.set(0.14, 0.14, 0.14);
        const sign = MeshBuilder.CreatePlane(
          root.name + "/telephone-lettering",
          { width: 0.88, height: 0.18 },
          this.scene,
        );
        sign.position.set(0, 0.855, -0.519);
        add(sign, signMat);
      }
    }
    const parts: Mesh[] = [];
    for (const [material, meshes] of batches) {
      const merged = Mesh.MergeMeshes(
        meshes,
        true,
        true,
        undefined,
        false,
        false,
      );
      if (!merged) continue;
      merged.name = root.name + "/" + kind + "-detail";
      merged.material = material;
      merged.parent = root;
      merged.isPickable = true;
      merged.receiveShadows = true;
      parts.push(merged);
    }
    return parts;
  }
  explosion(position: Vector3, power = 240): void {
    this.world.streetObjects?.explosion(position, power);
    // Resolve every exposure before destroying cover; one blast cannot propagate through a wall it just broke.
    const exposed = this.props.filter(
      (prop) =>
        prop.health > 0 &&
        Vector3.Distance(position, prop.mesh.position) < 14 &&
        !obstructed(this.scene, position, prop.mesh.position, {
          roots: [prop.mesh],
        }),
    );
    const physics = this.scene.getPhysicsEngine() as PhysicsEngineV2;
    const bodies = physics
      .getBodies()
      .filter(
        (body) =>
          !body.isDisposed &&
          !body.transformNode.metadata?.streetObject &&
          body.getMotionType() === PhysicsMotionType.DYNAMIC,
      )
      .map((body) => ({
        body,
        p: body.transformNode.getAbsolutePosition().clone(),
      }))
      .filter(
        ({ body, p }) =>
          Vector3.Distance(p, position) < 14 &&
          !obstructed(this.scene, position, p, { roots: [body.transformNode] }),
      );
    for (const prop of exposed) {
      const scale = blastFalloff(
        Vector3.Distance(position, prop.mesh.position),
      );
      this.hit(prop, power * scale, position, "blast");
      if (scale > 0.28) this.ignite(prop, 8);
    }
    for (const { body, p } of bodies) {
      if (body.isDisposed) continue;
      const delta = p.subtract(position),
        scale = blastFalloff(delta.length()),
        mass = body.getMassProperties().mass ?? 1;
      body.applyImpulse(
        delta
          .add(new Vector3(0, 0.65, 0))
          .normalize()
          .scale(Math.min(9000, power * 0.04 * mass) * scale),
        p,
      );
    }
  }
  ignite(prop: Prop, duration = 8): boolean {
    if (
      !MATERIAL_RESPONSE[prop.material].ignitable ||
      !this.props.includes(prop)
    )
      return false;
    prop.burning = Math.max(prop.burning, Math.min(30, duration));
    this.fire.set(prop.id, prop.mesh.position);
    return true;
  }
  extinguish(prop: Prop): void {
    prop.burning = 0;
    this.fire.remove(prop.id);
  }
  heatAt(position: Vector3): number {
    let heat = this.world.streetObjects?.heatAt(position) ?? 0;
    for (const prop of this.props)
      if (prop.burning > 0) {
        const d = Vector3.Distance(prop.mesh.position, position);
        if (
          d < 2 &&
          !obstructed(
            this.scene,
            prop.mesh.position.add(new Vector3(0, 0.5, 0)),
            position,
            { roots: [prop.mesh] },
          )
        )
          heat += 10 * (1 - d / 2);
      }
    return heat;
  }
  update(dt: number, weather: string): void {
    this.world.streetObjects?.update(dt, weather);
    const pending = this.pendingHits.splice(0);
    for (const hit of pending)
      this.hit(hit.prop, hit.amount, hit.point, "impact");
    for (const prop of this.props)
      if (prop.burning > 0) {
        prop.burning = Math.max(
          0,
          prop.burning - dt * (weather === "Rain" ? 5 : 1),
        );
        if (prop.burning > 0) {
          this.hit(prop, dt * 12, prop.mesh.position, "fire");
          this.fire.set(prop.id, prop.mesh.position);
        } else this.fire.remove(prop.id);
      }
    this.fire.update(dt);
    for (let i = this.debris.length - 1; i >= 0; i--) {
      this.debris[i].life -= dt;
      if (this.debris[i].life <= 0) this.disposeDebris(i);
    }
  }
  private disposeDebris(index: number): void {
    const item = this.debris[index];
    item.physics.dispose();
    item.mesh.dispose();
    this.debris.splice(index, 1);
  }
  hitStreetObject(object: StreetObjectState, amount: number, point: Vector3, kind: DamageKind, direction?: Vector3): void {
    this.world.streetObjects?.hit(object, amount, point, kind, direction);
  }
  private removeObstacle(prop: Prop): void {
    if (!prop.obstacle) return;
    const index = this.world.obstacles.indexOf(prop.obstacle);
    if (index >= 0) this.world.obstacles.splice(index, 1);
    prop.obstacle = undefined;
  }
  restore(ids: string[]): void {
    for (const id of ids) {
      const prop = this.props.find((value) => value.id === id);
      if (prop && prop.health > 0) this.break(prop);
      this.destroyed.add(id);
    }
  }
  serialize(): SerializableProp[] {
    return this.props.map((prop) => ({
      id: prop.id,
      x: prop.mesh.position.x,
      y: prop.mesh.position.y,
      z: prop.mesh.position.z,
      rotation: (
        prop.mesh.rotationQuaternion ??
        Quaternion.FromEulerVector(prop.mesh.rotation)
      ).asArray(),
      material: prop.material,
      kind: prop.kind,
      health: prop.health,
      burning: prop.burning,
      vertices: prop.parts.map((part) =>
        Array.from(part.getVerticesData(VertexBuffer.PositionKind) ?? []),
      ),
    }));
  }
  remove(prop: Prop): void {
    if (!this.props.includes(prop)) return;
    this.extinguish(prop);
    this.removeObstacle(prop);
    if (!prop.physics.body.isDisposed) prop.physics.dispose();
    for (let i = this.debris.length - 1; i >= 0; i--)
      if (this.debris[i].owner === prop.id) this.disposeDebris(i);
    this.shadows.removeShadowCaster(prop.mesh, true);
    prop.mesh.dispose();
    for (const material of prop.ownedMaterials) material.dispose(false, true);
    this.props = this.props.filter((value) => value !== prop);
    this.destroyed.delete(prop.id);
    this.pendingHits = this.pendingHits.filter((hit) => hit.prop !== prop);
  }
  restoreState(saved: SavedProp[]): void {
    for (const prop of [...this.props]) this.remove(prop);
    this.destroyed.clear();
    for (const state of saved) {
      const snapshot = state as SerializableProp,
        kind =
          snapshot.kind === "fence" || snapshot.kind === "gate"
            ? snapshot.kind
            : "street",
        offset =
          kind !== "street" ? 0.35 : state.material === "glass" ? 0.575 : 0;
      const prop = this.spawn(
        new Vector3(state.x, state.y - offset, state.z),
        state.material,
        state.id,
        Quaternion.FromArray(state.rotation),
        kind,
      );
      if (snapshot.vertices)
        for (let i = 0; i < prop.parts.length; i++) {
          const vertices = snapshot.vertices[i],
            current = prop.parts[i].getVerticesData(VertexBuffer.PositionKind);
          if (
            vertices &&
            current &&
            vertices.length === current.length &&
            vertices.every(Number.isFinite)
          ) {
            prop.parts[i].updateVerticesData(
              VertexBuffer.PositionKind,
              vertices,
              true,
            );
            prop.parts[i].refreshBoundingInfo();
          }
        }
      prop.health = Math.max(0, state.health);
      if (prop.health <= 0) this.break(prop);
      if (state.burning > 0) this.ignite(prop, state.burning);
    }
  }
  dispose(): void {
    for (const prop of [...this.props]) this.remove(prop);
    this.fire.dispose();
  }
}
