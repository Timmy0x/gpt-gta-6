import {
  Color3,
  DynamicTexture,
  Mesh,
  MeshBuilder,
  PBRMaterial,
  PhysicsAggregate,
  PhysicsShapeType,
  PhysicsEngineV2,
  Quaternion,
  Vector3,
  type Scene,
  type ShadowGenerator,
} from "@babylonjs/core";
import { distance, lineBlocked, random } from "../core/math";
import type { WorldContract } from "../core/contracts";
import type { SavedProp } from "../core/Persistence";
interface Prop {
  id: string;
  mesh: Mesh;
  parts: Mesh[];
  physics: PhysicsAggregate;
  health: number;
  material: "wood" | "metal" | "glass";
  burning: number;
}
export class DamageSystem {
  props: Prop[] = [];
  destroyed = new Set<string>();
  debris: { mesh: Mesh; physics: PhysicsAggregate; life: number }[] = [];
  private rng = random(800);
  onBreak = (position: Vector3) => {};
  constructor(
    public scene: Scene,
    public shadows: ShadowGenerator,
    public world: WorldContract,
  ) {
    for (let i = 0; i < 18; i++)
      this.spawn(
        new Vector3(i < 8 ? 10 : -60, 0.55, -52 + i * 5),
        i % 3 === 0 ? "glass" : i % 2 ? "wood" : "metal",
        "street-prop-" + i,
      );
  }
  spawn(
    p: Vector3,
    material: "wood" | "metal" | "glass" = "wood",
    id = "creative-prop-" + Date.now(),
    rotation?: Quaternion,
  ) {
    const height = material === "glass" ? 2.25 : 1.1;
    const m = MeshBuilder.CreateBox(
      id,
      {
        width: material === "glass" ? 1.05 : 0.9,
        height,
        depth: material === "glass" ? 1.05 : 0.85,
      },
      this.scene,
    );
    m.position.copyFrom(p);
    if (rotation) m.rotationQuaternion = rotation.clone();
    m.position.y += (height - 1.1) / 2;
    const mat = new PBRMaterial(id + "-material", this.scene);
    mat.albedoColor = Color3.FromHexString(
      material === "wood"
        ? "#a38b66"
        : material === "metal"
          ? "#547970"
          : "#96c4c2",
    );
    mat.roughness = material === "glass" ? 0.18 : 0.79;
    mat.metallic = material === "metal" ? 0.2 : 0;
    if (material === "glass") mat.alpha = 0.28;
    m.material = mat;
    m.isVisible = false;
    const parts = this.buildPropGeometry(m, material, mat);
    const physics = new PhysicsAggregate(
      m,
      PhysicsShapeType.BOX,
      {
        mass: material === "metal" ? 55 : 18,
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
      health: material === "metal" ? 120 : 45,
      material,
      burning: 0,
    };
    m.metadata = { prop, cameraBlocker: true };
    for (const part of parts) part.metadata = { prop, cameraBlocker: true };
    this.shadows.addShadowCaster(m, true);
    this.props.push(prop);
    physics.body.setCollisionCallbackEnabled(true);
    physics.body.getCollisionObservable().add((e) => {
      if (e.impulse > 180)
        this.hit(prop, Math.min(75, e.impulse / 12), e.point || m.position);
    });
    return prop;
  }
  hit(prop: Prop, amount: number, point: Vector3) {
    if (prop.health <= 0) return;
    prop.health -= amount;
    prop.physics.body.applyImpulse(
      prop.mesh.position
        .subtract(point)
        .normalize()
        .scale(amount * 2),
      point,
    );
    if (prop.health <= 0) this.break(prop);
  }
  private break(prop: Prop) {
    const p = prop.mesh.position.clone();
    this.destroyed.add(prop.id);
    prop.physics.dispose();
    prop.mesh.setEnabled(false);
    for (const part of prop.parts) part.dispose();
    prop.parts = [];
    for (let i = 0; i < 5; i++) {
      if (this.debris.length >= 45) break;
      const m = MeshBuilder.CreateBox(
        "debris",
        {
          width: 0.15 + this.rng() * 0.35,
          height: 0.15,
          depth: 0.2 + this.rng() * 0.4,
        },
        this.scene,
      );
      m.position.copyFrom(
        p.add(
          new Vector3(
            (this.rng() - 0.5) * 0.8,
            this.rng() * 0.6,
            (this.rng() - 0.5) * 0.8,
          ),
        ),
      );
      m.material = prop.mesh.material;
      const physics = new PhysicsAggregate(
        m,
        PhysicsShapeType.BOX,
        { mass: 1.5, friction: 0.6, restitution: 0.2 },
        this.scene,
      );
      physics.body.applyImpulse(
        new Vector3(
          (this.rng() - 0.5) * 8,
          4 + this.rng() * 4,
          (this.rng() - 0.5) * 8,
        ),
        m.position,
      );
      this.debris.push({ mesh: m, physics, life: 18 });
    }
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
  explosion(position: Vector3, power = 240) {
    for (const prop of this.props) {
      const d = distance(position, prop.mesh.position);
      if (
        prop.health > 0 &&
        d < 14 &&
        !lineBlocked(position, prop.mesh.position, this.world.obstacles)
      ) {
        this.hit(prop, power * (1 - d / 14), position);
        if (prop.health > 0) prop.burning = 8;
      }
    }
    for (const body of (
      this.scene.getPhysicsEngine() as PhysicsEngineV2
    ).getBodies()) {
      const p = body.transformNode.position;
      const d = Vector3.Distance(p, position);
      if (d > 0 && d < 14 && !lineBlocked(position, p, this.world.obstacles))
        body.applyImpulse(
          p
            .subtract(position)
            .normalize()
            .scale(power * 12 * (1 - d / 14)),
          p,
        );
    }
  }
  update(dt: number, weather: string) {
    for (const prop of this.props)
      if (prop.health > 0 && prop.burning > 0) {
        prop.burning -= dt * (weather === "Rain" ? 5 : 1);
        this.hit(prop, dt * 12, prop.mesh.position);
        (prop.mesh.material as PBRMaterial).emissiveColor.set(0.8, 0.1, 0);
      }
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.life -= dt;
      if (d.life <= 0) {
        d.physics.dispose();
        d.mesh.dispose();
        this.debris.splice(i, 1);
      }
    }
  }
  restore(ids: string[]) {
    for (const id of ids) {
      const p = this.props.find((p) => p.id === id);
      if (p && p.health > 0) {
        p.health = 0;
        this.break(p);
      }
      this.destroyed.add(id);
    }
  }
  serialize(): SavedProp[] {
    return this.props.map((p) => ({
      id: p.id,
      x: p.mesh.position.x,
      y: p.mesh.position.y,
      z: p.mesh.position.z,
      rotation: (p.mesh.rotationQuaternion || Quaternion.Identity()).asArray(),
      material: p.material,
      health: p.health,
      burning: p.burning,
    }));
  }
  remove(prop: Prop) {
    if (prop.health > 0) prop.physics.dispose();
    this.shadows.removeShadowCaster(prop.mesh, true);
    prop.mesh.dispose(false, true);
    this.props = this.props.filter((p) => p !== prop);
    this.destroyed.delete(prop.id);
  }
  restoreState(saved: SavedProp[]) {
    for (const d of this.debris) {
      d.physics.dispose();
      d.mesh.dispose();
    }
    this.debris = [];
    for (const p of [...this.props]) this.remove(p);
    this.destroyed.clear();
    for (const s of saved) {
      const offset = s.material === "glass" ? 0.575 : 0;
      const p = this.spawn(
        new Vector3(s.x, s.y - offset, s.z),
        s.material,
        s.id,
        Quaternion.FromArray(s.rotation),
      );
      p.burning = s.burning;
      p.health = Math.max(0, s.health);
      if (p.health <= 0) this.break(p);
    }
  }
}
