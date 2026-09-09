import { Mesh, VertexData, type AbstractMesh, type Scene, type ShadowGenerator } from "@babylonjs/core";
import type { StreetObjectState } from "./StreetObjectSystem";

interface ResidentBatch { mesh: Mesh; indices: Uint32Array; hidden: Set<string>; pieces: Map<string, Mesh[]>; }
/** Only damaged objects allocate independent render geometry; intact objects share their chunk batches. */
export class StreetObjectGeometry {
  private readonly batches = new Map<string, ResidentBatch>();
  constructor(private scene: Scene, private shadows: ShadowGenerator | undefined, private objects: Map<string, StreetObjectState>, private root: (object: StreetObjectState) => Mesh) {}
  mount(meshes: readonly AbstractMesh[]): void {
    for (const mesh of meshes) {
      if (!(mesh instanceof Mesh) || !mesh.metadata?.streetBatch) continue;
      const batch: ResidentBatch = { mesh, indices: Uint32Array.from(mesh.getIndices()!), hidden: new Set(), pieces: new Map() };
      this.batches.set(mesh.id, batch);
      for (const object of this.objects.values()) if (object.fallen) this.extract(object, batch);
    }
  }
  private extract(object: StreetObjectState, batch: ResidentBatch): void {
    const id = object.definition.id;
    const ranges = object.definition.visuals?.filter(range => range.batch === batch.mesh.id);
    if (!ranges?.length || batch.hidden.has(id)) return;
    const pieces: Mesh[] = [];
    const indices = Uint32Array.from(batch.mesh.getIndices()!);
    for (const [slot, range] of ranges.entries()) {
      const piece = new Mesh(`${id}/fallen/${slot}/${batch.mesh.id}`, this.scene);
      const data = new VertexData();
      const attribute = (kind: string, size: number) => {
        const original = batch.mesh.getVerticesData(kind);
        return original ? Float32Array.from(original.slice(range.vertexStart * size, (range.vertexStart + range.vertexCount) * size)) : undefined;
      };
      data.positions = attribute("position", 3)!; data.normals = attribute("normal", 3)!;
      data.uvs = attribute("uv", 2) ?? null; data.uvs2 = attribute("uv2", 2) ?? null; data.colors = attribute("color", 4) ?? null;
      data.indices = Uint32Array.from(batch.indices.slice(range.indexStart, range.indexStart + range.indexCount), i => i - range.vertexStart);
      data.applyToMesh(piece, false);
      piece.material = batch.mesh.material;
      piece.parent = this.root(object);
      piece.position.set(-object.definition.position[0], -object.definition.position[1], -object.definition.position[2]);
      piece.metadata = { streetObject: object, streetEmitter: range.emitter, cameraBlocker: true };
      piece.isPickable = true; piece.receiveShadows = true;
      if (range.emitter) piece.setEnabled(false);
      this.shadows?.addShadowCaster(piece, false);
      pieces.push(piece); object.parts.add(piece);
      indices.fill(range.vertexStart, range.indexStart, range.indexStart + range.indexCount);
    }
    batch.mesh.setIndices(indices); batch.hidden.add(id); batch.pieces.set(id, pieces);
  }
  sync(object: StreetObjectState): void {
    for (const batch of this.batches.values()) {
      if (object.fallen) this.extract(object, batch);
      else if (batch.hidden.has(object.definition.id)) this.showIntact(object, batch);
    }
  }
  private removePieces(object: StreetObjectState, batch: ResidentBatch): void {
    for (const piece of batch.pieces.get(object.definition.id) ?? []) {
      object.parts.delete(piece); this.shadows?.removeShadowCaster(piece, false); piece.dispose(false, false);
    }
    batch.pieces.delete(object.definition.id);
  }
  private showIntact(object: StreetObjectState, batch: ResidentBatch): void {
    this.removePieces(object, batch);
    const indices = Uint32Array.from(batch.mesh.getIndices()!);
    for (const range of object.definition.visuals?.filter(range => range.batch === batch.mesh.id) ?? [])
      indices.set(batch.indices.subarray(range.indexStart, range.indexStart + range.indexCount), range.indexStart);
    batch.mesh.setIndices(indices); batch.hidden.delete(object.definition.id);
  }
  unmount(meshes: readonly AbstractMesh[]): void {
    for (const mesh of meshes) {
      const batch = this.batches.get(mesh.id);
      if (!batch) continue;
      for (const id of batch.pieces.keys()) { const object = this.objects.get(id); if (object) this.removePieces(object, batch); }
      this.batches.delete(mesh.id);
    }
  }
  stats() {
    const pieces = [...this.batches.values()].flatMap(b => [...b.pieces.values()].flat());
    const extractedGeometryBytes = pieces.reduce((total, mesh) => total + mesh.getVerticesDataKinds().reduce((n, kind) => n + mesh.getVerticesData(kind)!.length * 4, 0) + mesh.getTotalIndices() * 4, 0);
    return { batches: this.batches.size, extractedMeshes: pieces.length, extractedGeometryBytes, indexBackupBytes: [...this.batches.values()].reduce((n, b) => n + b.indices.byteLength, 0) };
  }
  dispose(): void { this.unmount([...this.batches.values()].map(batch => batch.mesh)); }
}
