import { AssetContainer, LoadAssetContainerAsync, Matrix, Mesh, PBRMaterial, TransformNode, Vector3, VertexData } from "@babylonjs/core";
import type { BuildContext } from "../core/contracts";
import type { VehicleModel } from "./models";
import { LatticeDeformation } from "./LatticeDeformation";

type Part = { mesh: Mesh; group: string; origin: Vector3; panel: boolean; window: boolean; lamp: boolean };
const OFFSET = new Vector3(0, -0.6, -0.085);
export const CONCEPT_ASSETS = {
  game: { file: "car-lod1-batched.glb", hash: "17e0f6867d1992d2cbef00fbcd5079099480385f03bbbe084adc4024060a52a6" },
  source: { file: "car.glb", hash: "6923a315ac3656ddab95c281a8113055f0a4051ced2c35b35706fc1095d860ab" },
  simplified: { file: "car-lod1.glb", hash: "c4eb13e341f74c516f47f91f4a40d778a3c1ac8beaa1ed63543e993f6a04493c" },
} as const;
export const DETAILED_CAR_LIMIT = 6;
const WHEELS = ["WheelFrontL", "WheelFrontR", "WheelRearL", "WheelRearR"];
const DOORS = ["BodyDoorLColor1", "BodyDoorRColor1"];
const COVERS = ["BodyHood", "BodyRearPanelsColor1"];

function halfGeometry(source: VertexData, side: number): VertexData {
  const result = new VertexData(), remap = new Map<number, number>(), indices: number[] = [];
  const fields = [["positions", 3], ["normals", 3], ["tangents", 4], ["uvs", 2], ["uvs2", 2], ["colors", 4]] as const;
  for (const [field] of fields) if (source[field]) result[field] = [];
  for (let i = 0; i < source.indices!.length; i += 3) {
    const triangle = [source.indices![i], source.indices![i + 1], source.indices![i + 2]];
    if (triangle.reduce((sum, index) => sum + source.positions![index * 3], 0) * side < 0) continue;
    for (const original of triangle) {
      let mapped = remap.get(original);
      if (mapped === undefined) {
        mapped = remap.size; remap.set(original, mapped);
        for (const [field, stride] of fields) if (source[field]) for (let k = 0; k < stride; k++) (result[field] as number[]).push(source[field]![original * stride + k]);
      }
      indices.push(mapped);
    }
  }
  result.indices = indices;
  return result;
}

function cloneMaterial(source: PBRMaterial, name: string): PBRMaterial {
  const material = source.clone(name)!;
  const allocated = new Set(material.getActiveTextures());
  const copy = (from: object, to: object, keys: string[]) => {
    const a = from as Record<string, unknown>, b = to as Record<string, unknown>;
    for (const key of keys) if (key in a) b[key] = a[key];
  };
  copy(source, material, ["albedoTexture", "ambientTexture", "opacityTexture", "reflectionTexture", "emissiveTexture", "reflectivityTexture", "metallicTexture", "microSurfaceTexture", "bumpTexture", "lightmapTexture", "metallicReflectanceTexture", "reflectanceTexture", "environmentBRDFTexture"]);
  for (const key of ["clearCoat", "iridescence", "sheen", "subSurface", "anisotropy", "detailMap"] as const) {
    copy(source[key], material[key], ["texture", "textureRoughness", "bumpTexture", "tintTexture", "thicknessTexture", "refractionTexture", "refractionIntensityTexture", "translucencyIntensityTexture", "translucencyColorTexture"]);
  }
  const originals = new Set(source.getActiveTextures());
  for (const texture of allocated) if (!originals.has(texture)) texture.dispose();
  if (material.getActiveTextures().some(texture => !originals.has(texture))) {
    material.dispose(); throw new Error("Detailed car has an unsupported mutable texture channel");
  }
  return material;
}

/** Shared licensed game asset. Source variants are retained for offline visual comparisons. */
export class ConceptCarAssets {
  private container?: AssetContainer;
  private pending?: Promise<void>;
  private parts: Part[] = [];
  private origins = new Map<string, Vector3>();
  private disposed = false;
  constructor(private ctx: BuildContext, private source?: Uint8Array, private skipMaterials = false, private variant: keyof typeof CONCEPT_ASSETS = "game") {}
  get ready(): boolean { return !!this.container; }

  async prepare(): Promise<void> {
    if (this.disposed) throw new Error("Vehicle asset cache disposed");
    if (this.container) return;
    if (this.pending) return this.pending;
    this.pending = this.load().finally(() => { this.pending = undefined; });
    return this.pending;
  }

  private async load(): Promise<void> {
    await import("@babylonjs/loaders/glTF/index.js");
    const asset = CONCEPT_ASSETS[this.variant];
    let data = this.source;
    if (!data) {
      const response = await fetch(`/vehicles/concept/${asset.file}`, { signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error(`Detailed car download failed: HTTP ${response.status}`);
      data = new Uint8Array(await response.arrayBuffer());
    }
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(data)))).map(n => n.toString(16).padStart(2, "0")).join("");
    if (hash !== asset.hash) throw new Error("Detailed car asset integrity check failed");
    const container = await LoadAssetContainerAsync(data, this.ctx.scene, { pluginExtension: ".glb", name: asset.file, pluginOptions: { gltf: { createInstances: false, animationStartMode: 0, skipMaterials: this.skipMaterials } } });
    if (this.disposed) { container.dispose(); throw new Error("Vehicle asset cache disposed"); }
    try {
      const nodes = [...container.meshes, ...container.transformNodes];
      const groups = new Map(nodes.filter(n => [...WHEELS, ...DOORS, ...COVERS].includes(n.name)).map(n => [n.name, n]));
      for (const name of [...WHEELS, ...DOORS, ...COVERS]) {
        const node = groups.get(name);
        if (!node) throw new Error(`Detailed car missing ${name}`);
        node.computeWorldMatrix(true);
        this.origins.set(name, node.getAbsolutePosition().add(OFFSET));
      }
      // Capture all source transforms before flattening the hierarchy. VertexData.transform
      // preserves glTF handedness by reversing indices for negative-determinant transforms.
      const records = container.meshes.filter((mesh): mesh is Mesh => mesh instanceof Mesh && mesh.getTotalVertices() > 0).map(mesh => {
        const group = [...groups].find(([, node]) => mesh === node || mesh.isDescendantOf(node))?.[0] ?? "body";
        const world = mesh.computeWorldMatrix(true).clone();
        return { mesh, group, world };
      });
      for (const { mesh, group, world } of records) {
        const origin = this.origins.get(group)?.clone() ?? Vector3.Zero();
        const matrix = world.multiply(Matrix.Translation(OFFSET.x - origin.x, OFFSET.y - origin.y, OFFSET.z - origin.z));
        // The source front wheels are posed at 30 degrees. Remove only that steer;
        // authored roll/spoke orientation stays baked into each neutral axle frame.
        if (group.startsWith("WheelFront")) matrix.multiplyToRef(Matrix.RotationY(-Math.PI / 6), matrix);
        const data = VertexData.ExtractFromMesh(mesh, true, true);
        data.transform(matrix);
        mesh.makeGeometryUnique();
        data.applyToMesh(mesh, true);
        mesh.parent = null; mesh.position.setAll(0); mesh.rotation.setAll(0); mesh.rotationQuaternion = null; mesh.scaling.setAll(1);
        mesh.setEnabled(false);
        const panel = /^Body(?:Underside|RoofPanel|RearPanelsColor1|Pillars|PanelsColor2|Hood$|Door[LR]Color[12])/.test(mesh.name);
        const window = /(?:Window|Windshield)$|BodyWindowsRearSides/i.test(mesh.name), lamp = /Body(?:Headlights|Taillights)$/.test(mesh.name);
        if (lamp || mesh.name === "BodyWindowsRearSides") {
          for (const side of [-1, 1]) {
            const half = new Mesh(`${mesh.name}${side < 0 ? "L" : "R"}`, this.ctx.scene);
            halfGeometry(data, side).applyToMesh(half, true);
            half.material = mesh.material; half.setEnabled(false); container.meshes.push(half);
            this.parts.push({ mesh: half, group, origin, panel: false, window, lamp });
          }
        } else this.parts.push({ mesh, group, origin, panel, window, lamp });
      }
      container.removeAllFromScene();
      this.container = container;
    } catch (error) { container.dispose(); this.parts = []; this.origins.clear(); throw error; }
  }

  create(id: number): VehicleModel {
    if (!this.container || this.disposed) throw new Error("Detailed car assets are not ready");
    const { scene } = this.ctx, root = new Mesh(`vehicle-${id}`, scene);
    root.metadata = { vehicleId: `vehicle-${id}`, vehicleKind: "concept" };
    const model: VehicleModel = { root, panels: [], windows: [], bumpers: [], lights: [], wheels: [], doors: [], materials: [], seat: new Vector3(-0.50, -1.30, 0.10) };
    try {
    const materials = new Map<PBRMaterial, PBRMaterial>();
    for (const source of new Set(this.parts.map(part => part.mesh.material))) if (source instanceof PBRMaterial) {
      const role = /^Paint 1/.test(source.name) ? "paint" : source.name === "Headlight" ? "headlight" : source.name === "Brakelight" ? "taillight" : "concept";
      const material = cloneMaterial(source, `${role}-${id}-${source.name}`);
      if (role === "headlight" || role === "taillight") material.emissiveIntensity = 1;
      material.imageProcessingConfiguration = scene.imageProcessingConfiguration;
      // Scene color/transparency is sufficient for the shared road renderer. Disable costly
      // per-car refraction targets while keeping the source glass surface and normal maps.
      if (source.name === "Glass") { material.subSurface.isRefractionEnabled = false; material.alpha = 0.3; material.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND; material.backFaceCulling = false; }
      materials.set(source, material); model.materials.push(material);
    }
    const groups = new Map<string, TransformNode>();
    for (const [i, name] of WHEELS.entries()) {
      const pivot = new TransformNode(`concept-wheel-${id}-${i}`, scene);
      pivot.parent = root; pivot.position.copyFrom(this.origins.get(name)!);
      const local = pivot.position.clone(); local.y += 0.35;
      const rolling = new TransformNode(`concept-axle-${id}-${i}`, scene); rolling.parent = pivot;
      const tire = new Mesh(`concept-tire-${id}-${i}`, scene); tire.parent = rolling;
      const rim = new Mesh(`concept-rim-${id}-${i}`, scene); rim.parent = rolling;
      model.wheels.push({ pivot, tire, rim, rolling, local, front: i < 2, damaged: false });
      groups.set(name, pivot);
    }
    // Door roots use the actual exterior skin, so detachment computes a useful collision box.
    const copies = new Map<string, Mesh>();
    for (const part of this.parts) {
      const mesh = part.mesh.clone(`concept-${id}-${part.mesh.name}`, null, true)!;
      mesh.parent = root; mesh.setEnabled(true); mesh.isPickable = true; mesh.receiveShadows = true;
      mesh.metadata = root.metadata;
      mesh.material = materials.get(part.mesh.material as PBRMaterial) ?? null;
      copies.set(part.mesh.name, mesh);
      if (part.panel) model.panels.push(mesh);
      if (part.window) model.windows.push(mesh);
      if (part.lamp) { mesh.name = `${part.mesh.name.startsWith("BodyHeadlights") ? "headlight" : "taillight"}-${id}-${part.mesh.name.slice(-1)}`; model.lights.push(mesh); }
    }
    for (const [i, name] of DOORS.entries()) {
      const mesh = copies.get(name)!; mesh.position.copyFrom(this.origins.get(name)!);
      model.doors.push({ mesh, side: i === 0 ? -1 : 1, front: true, angle: 0, hold: 0 });
      groups.set(name, mesh);
    }
    for (const name of COVERS) {
      const mesh = copies.get(name)!; mesh.position.copyFrom(this.origins.get(name)!);
      model.bumpers.push(mesh); groups.set(name, mesh);
    }
    for (const part of this.parts) {
      const mesh = copies.get(part.mesh.name)!;
      if ([...DOORS, ...COVERS].includes(part.mesh.name)) continue;
      if (part.group.startsWith("Wheel")) {
        const wheel = model.wheels[WHEELS.indexOf(part.group)];
        const name = part.mesh.name;
        mesh.parent = /BrakePad/.test(name) ? wheel.pivot : /Rim/.test(name) ? wheel.rim : /BrakeDisc/.test(name) ? wheel.rolling! : wheel.tire;
      } else mesh.parent = groups.get(part.group) ?? root;
    }
    // Body/light origins were baked into vertices. Recenter lamps for point-local damage and beams.
    for (const lamp of model.lights) {
      const center = lamp.getBoundingInfo().boundingBox.center.clone();
      lamp.makeGeometryUnique(); lamp.bakeTransformIntoVertices(Matrix.Translation(-center.x, -center.y, -center.z)); lamp.position.copyFrom(center);
    }
    model.deformation = new LatticeDeformation(model.panels, root);
    this.ctx.shadows.addShadowCaster(root, true);
    return model;
    } catch (error) {
      root.dispose();
      for (const material of model.materials) material.dispose();
      throw error;
    }
  }

  dispose(): void { this.disposed = true; this.container?.dispose(); this.container = undefined; this.parts = []; this.origins.clear(); }
}
