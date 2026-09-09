import { Mesh, Quaternion, Vector3, type Material } from "@babylonjs/core";
import { mergeAuthoredBatch } from "./mergeBatch";
import type { StreetObjectDefinition, StreetObjectKind, StreetShape, StreetVector } from "../StreetObjectRecords";
import type { AuthoringSink } from "./WorldBuilder";

/** Captures the existing authored meshes before district-wide material batching erases their identity. */
export class StreetObjectAuthoring {
  readonly records: StreetObjectDefinition[] = [];
  private capture?: { kind: StreetObjectKind; position: Vector3; meshes: Mesh[]; light?: StreetVector };
  private readonly occurrences = new Map<string, number>();
  constructor(private sink: Pick<AuthoringSink, "registerMesh">) {}
  begin(kind: StreetObjectKind, x: number, z: number): void {
    if (this.capture) throw new Error("Nested street object capture");
    this.capture = { kind, position: new Vector3(x, 0, z), meshes: [] };
  }
  add(mesh: Mesh, material: Material): boolean {
    if (!this.capture) return false;
    mesh.material = material;
    this.capture.meshes.push(mesh);
    if (mesh.name === "lamp-emitter") this.capture.light = mesh.position.asArray() as StreetVector;
    return true;
  }
  end(): void {
    const source = this.capture;
    if (!source) throw new Error("No street object capture");
    this.capture = undefined;
    const key = `street-object/${source.kind}/${source.position.x.toFixed(3)}/${source.position.z.toFixed(3)}`;
    const occurrence = this.occurrences.get(key) ?? 0;
    this.occurrences.set(key, occurrence + 1);
    const id = occurrence ? `${key}/${occurrence}` : key;
    const shapes: StreetShape[] = [];
    const groups = new Map<Material, Mesh[]>();
    let height = 0;
    for (const mesh of source.meshes) {
      const world = mesh.computeWorldMatrix(true);
      const bounds = mesh.getBoundingInfo().boundingBox;
      height = Math.max(height, bounds.maximumWorld.y);
      // Flexible leaf ribbons do not turn the crown into an invisible solid canopy.
      // The trunk, branch spines, coconuts, lamp stem/arm/base and housing remain physical.
      if (!/palm-frond|palm-bark-ring|lamp-emitter/.test(mesh.name)) {
        const position = Vector3.TransformCoordinates(bounds.center, world).subtract(source.position);
        const rotation = Quaternion.Identity(), scale = Vector3.One();
        world.decompose(scale, rotation);
        scale.multiplyInPlace(bounds.extendSize).scaleInPlace(2);
        shapes.push({ kind: /palm-trunk|palm-spine|lamp-base|lamp-post|lamp-arm/.test(mesh.name) ? "cylinder" : "box",
          position: position.asArray() as StreetVector, rotation: rotation.asArray() as [number, number, number, number],
          size: [Math.max(.015, Math.abs(scale.x)), Math.max(.015, Math.abs(scale.y)), Math.max(.015, Math.abs(scale.z))] });
      }
      const material = mesh.material!;
      const group = groups.get(material) ?? [];
      group.push(mesh); groups.set(material, group);
    }
    const meshes: string[] = [];
    for (const [material, group] of groups) {
      const merged = mergeAuthoredBatch(group)!;
      merged.name = `${id}/material-${meshes.length}`;
      merged.id = merged.name;
      merged.material = material;
      merged.isPickable = true;
      merged.metadata = { streetObjectId: id, streetAnchor: source.position.asArray(), worldCasts: true, streetEmitter: source.kind === "lamppost" && material.name === "street-light" };
      this.sink.registerMesh(merged, "detail", true);
      meshes.push(merged.id);
    }
    this.records.push({ id, kind: source.kind, position: source.position.asArray() as StreetVector, shapes, meshes,
      mass: source.kind === "palm" ? Math.round(height * 45) : 110,
      health: source.kind === "palm" ? 260 : 140, ...(source.light ? { light: source.light } : {}) });
  }
}
