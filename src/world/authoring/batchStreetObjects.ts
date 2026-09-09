import { Mesh } from "@babylonjs/core";
import { mergeAuthoredBatch } from "./mergeBatch";
import type { StreetObjectDefinition } from "../StreetObjectRecords";

/** Keep intact render submissions bounded while retaining ownership of every vertex/index span. */
export function batchStreetObjects(meshes: Mesh[], definitions: StreetObjectDefinition[]): Mesh[] {
  const objects = new Map(definitions.map(d => [d.id, d]));
  for (const definition of definitions) { definition.visuals = []; definition.meshes = []; }
  const groups = new Map<string, Mesh[]>();
  for (const mesh of meshes) {
    const anchor = mesh.metadata.streetAnchor as number[];
    const key = `${Math.floor((anchor[0] + 72) / 144)}_${Math.floor((anchor[2] + 72) / 144)}/${mesh.material!.name}`;
    const group = groups.get(key) ?? [];
    group.push(mesh); groups.set(key, group);
  }
  const result: Mesh[] = [];
  for (const [key, group] of groups) {
    const id = `street-batch/${key}`;
    let vertexStart = 0, indexStart = 0;
    const material = group[0].material!, anchor = group[0].metadata.streetAnchor;
    for (const mesh of group) {
      const object = objects.get(mesh.metadata.streetObjectId);
      if (!object) throw new Error(`Missing authored object for ${mesh.name}`);
      object.visuals!.push({ batch: id, vertexStart, vertexCount: mesh.getTotalVertices(), indexStart,
        indexCount: mesh.getTotalIndices(), emitter: !!mesh.metadata.streetEmitter });
      object.meshes.push(id);
      vertexStart += mesh.getTotalVertices(); indexStart += mesh.getTotalIndices();
    }
    const batch = mergeAuthoredBatch(group)!;
    batch.name = batch.id = id; batch.material = material;
    batch.metadata = { streetBatch: true, streetAnchor: anchor, worldCasts: true, worldDetail: "detail" };
    batch.isPickable = false;
    if (batch.getTotalVertices() !== vertexStart || batch.getTotalIndices() !== indexStart) throw new Error(`Street batch span mismatch: ${id}`);
    result.push(batch);
  }
  return result;
}
