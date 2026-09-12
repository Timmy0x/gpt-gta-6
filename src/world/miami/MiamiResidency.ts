import { Mesh, PhysicsAggregate, PhysicsShapeType, Vector3, VertexData, type Material, type Scene, type ShadowGenerator } from '@babylonjs/core';
import { distanceToBounds } from '../ChunkResidency';
import type { NetworkStreamingStats } from '../packages';
import { decodeMiamiChunk, validateMiamiManifest, type MiamiChunk, type MiamiPackageManifest } from './MiamiPackages';
type Decoded = ReturnType<typeof decodeMiamiChunk>[number];
interface Resident { data: Decoded; mesh?: Mesh; physics?: PhysicsAggregate; }
interface Loaded { chunk: MiamiChunk; buffer: ArrayBuffer; residents: Resident[]; }
interface Waiter { resolve: () => void; reject: (error: Error) => void; }
const LIMITS = { render: 650, collision: 210, preload: 420, unload: 820, cpuBytes: 96 * 1024 * 1024, network: 2, meshOperations: 12 } as const;

/** Network, GPU and Havok residency share exact source bounds and geometry. */
export class MiamiResidency {
  private loaded = new Map<string, Loaded>();
  private pending = new Map<string, Promise<Loaded>>();
  private pins = new Map<string, number>();
  private materials = new Map<Material, number>();
  private anchors: Vector3[] = [];
  private primary?: Vector3;
  private slots = 0;
  private queue: Waiter[] = [];
  private abort = new AbortController();
  private disposed = false;
  private failed = new Set<string>();
  private nextRetry = new Map<string, number>();
  private geometryBytes = 0;
  private lastOperations = 0;
  private visualVisibility = true;
  private counts = { requests: 0, fetchedBytes: 0, retries: 0, packagesLoaded: 0, packagesEvicted: 0, meshLoads: 0, meshDisposals: 0, colliderLoads: 0, colliderDisposals: 0, lastError: '' };
  onMeshLoaded?: (mesh: Mesh, kind: string) => void;
  onMeshDisposed?: (mesh: Mesh) => void;
  constructor(private scene: Scene, private shadows: ShadowGenerator, readonly manifest: MiamiPackageManifest, private baseUrl: string, private material: (key: string) => Material, private fetcher: typeof fetch = fetch) {
    validateMiamiManifest(manifest);
  }
  setActiveAnchors(anchors: Vector3[]) {
    if (!this.disposed) this.anchors = anchors.filter(p => Number.isFinite(p.x) && Number.isFinite(p.z)).map(p => p.clone());
  }
  private assertPosition(position: Vector3) {
    if (this.disposed) throw new Error('Miami world disposed');
    if (![position.x, position.y, position.z].every(Number.isFinite)) throw new TypeError('Invalid Miami streaming position');
  }
  private distance(bounds: MiamiChunk['bounds'], primary = this.primary): number {
    let distance = primary ? distanceToBounds(primary, bounds) : Infinity;
    for (const anchor of this.anchors) distance = Math.min(distance, distanceToBounds(anchor, bounds));
    return distance;
  }
  private async slot() {
    if (this.disposed) throw new Error('Miami world disposed');
    if (this.slots >= LIMITS.network) await new Promise<void>((resolve, reject) => this.queue.push({ resolve, reject }));
    else this.slots++;
  }
  private release() {
    const next = this.queue.shift();
    if (next) next.resolve(); else this.slots--;
  }
  private load(chunk: MiamiChunk): Promise<Loaded> {
    if (this.disposed) return Promise.reject(new Error('Miami world disposed'));
    const loaded = this.loaded.get(chunk.id); if (loaded) return Promise.resolve(loaded);
    const pending = this.pending.get(chunk.id); if (pending) return pending;
    const operation = (async () => {
      let entered = false, stage = 'queue';
      try {
        await this.slot(); entered = true;
        if (this.disposed) throw new Error('Miami world disposed');
        let error: unknown;
        for (let attempt = 0; attempt < 3; attempt++) try {
          if (attempt) this.counts.retries++;
          this.counts.requests++;
          stage = 'fetch';
          // Window.fetch requires its global receiver, including when injected.
          const response = await this.fetcher.call(globalThis, new URL(chunk.url, this.baseUrl), { signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(12000)]) });
          if (!response.ok) throw new Error(`Miami chunk ${chunk.id}: HTTP ${response.status}`);
          stage = 'response body';
          const buffer = await response.arrayBuffer(); this.counts.fetchedBytes += buffer.byteLength;
          stage = 'integrity check';
          const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buffer)), n => n.toString(16).padStart(2, '0')).join('');
          if (hash !== chunk.sha256) throw new Error(`Miami chunk integrity mismatch: ${chunk.id}`);
          if (this.disposed) throw new Error('Miami world disposed');
          stage = 'geometry decode';
          const residents = decodeMiamiChunk(chunk, buffer).map(data => ({ data }));
          const asset = { chunk, buffer, residents };
          this.loaded.set(chunk.id, asset); this.geometryBytes += buffer.byteLength;
          this.failed.delete(chunk.id); this.nextRetry.delete(chunk.id);
          if (!this.failed.size) this.counts.lastError = '';
          this.counts.packagesLoaded++; return asset;
        } catch (cause) { error = cause; if (this.disposed) throw cause; }
        throw error;
      } catch (error) {
        const failure = new Error(`Miami chunk ${chunk.id} (${chunk.url}) ${stage}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
        if (!this.disposed) { this.failed.add(chunk.id); this.nextRetry.set(chunk.id, performance.now() + 10000); this.counts.lastError = failure.message; }
        throw failure;
      } finally { if (entered) this.release(); this.pending.delete(chunk.id); }
    })();
    this.pending.set(chunk.id, operation); return operation;
  }
  async preparePosition(position: Vector3) {
    this.assertPosition(position);
    const target = position.clone(); this.primary ??= target.clone(); this.primary.copyFrom(target);
    const chunks = this.manifest.chunks.filter(c => distanceToBounds(target, c.bounds) < LIMITS.preload).sort((a, b) => distanceToBounds(target, a.bounds) - distanceToBounds(target, b.bounds));
    for (const chunk of chunks) this.pins.set(chunk.id, (this.pins.get(chunk.id) ?? 0) + 1);
    try {
      await Promise.all(chunks.map(c => this.load(c)));
      this.assertPosition(target); this.update(target, true);
      if (!this.collisionReady(target, false)) throw new Error('No ready Miami collision coverage at destination');
    } finally {
      for (const chunk of chunks) { const count = (this.pins.get(chunk.id) ?? 1) - 1; if (count > 0) this.pins.set(chunk.id, count); else this.pins.delete(chunk.id); }
    }
  }
  private create(resident: Resident) {
    if (resident.mesh) return resident.mesh;
    const { record, positions, normals, uvs, indices } = resident.data, mesh = new Mesh(record.id, this.scene);
    try {
      const data = new VertexData(); data.positions = positions; data.normals = normals; data.uvs = uvs; data.indices = indices; data.applyToMesh(mesh);
      mesh.position.copyFromFloats(...record.origin); mesh.material = record.render === false ? null : this.material(record.material); mesh.receiveShadows = true; mesh.isPickable = true; mesh.isVisible = this.visualVisibility && record.render !== false;
      mesh.metadata = { worldId: this.manifest.worldId, miamiSource: record.sourceIds, miamiKind: record.kind, cameraBlocker: record.collision, structural: true };
      mesh.computeWorldMatrix(true); if (mesh.isVisible && (record.kind === 'building' || record.kind === 'detail')) this.shadows.addShadowCaster(mesh);
      resident.mesh = mesh; if(mesh.material)this.materials.set(mesh.material, (this.materials.get(mesh.material) ?? 0) + 1); this.counts.meshLoads++;
      this.onMeshLoaded?.(mesh, record.kind); return mesh;
    } catch (error) {
      if (resident.mesh) this.remove(resident); else mesh.dispose(false, false);
      throw error;
    }
  }
  private collide(resident: Resident) {
    if (!resident.data.record.collision || resident.physics) return;
    const mesh = this.create(resident), record = resident.data.record;
    resident.physics = new PhysicsAggregate(mesh, PhysicsShapeType.MESH, { mass: 0, friction: record.friction, restitution: record.restitution }, this.scene); this.counts.colliderLoads++;
  }
  ensureCollision(position: Vector3) {
    if (this.disposed) return;
    const before = this.counts.meshLoads;
    for (const asset of this.loaded.values()) for (const resident of asset.residents) if (distanceToBounds(position, resident.data.record.bounds) < LIMITS.collision) this.collide(resident);
    this.lastOperations = this.counts.meshLoads - before;
  }
  setVisualVisibility(visible: boolean) {
    if (visible === this.visualVisibility) return;
    this.visualVisibility = visible;
    for (const asset of this.loaded.values()) for (const resident of asset.residents) {
      if (resident.mesh) {
        resident.mesh.isVisible = visible && resident.data.record.render !== false;
        if (['building', 'detail'].includes(resident.data.record.kind)) {
          if (resident.mesh.isVisible) this.shadows.addShadowCaster(resident.mesh);
          else this.shadows.removeShadowCaster(resident.mesh);
        }
      }
    }
  }
  private remove(resident: Resident) {
    if (resident.physics) { resident.physics.dispose(); resident.physics = undefined; this.counts.colliderDisposals++; }
    if (resident.mesh) {
      const mesh = resident.mesh, material = mesh.material;
      try { this.onMeshDisposed?.(mesh); } catch (error) {
        this.counts.lastError = error instanceof Error ? error.message : String(error);
      } finally {
        this.shadows.removeShadowCaster(mesh); mesh.dispose(false, false); resident.mesh = undefined; this.counts.meshDisposals++;
        if (material) { const refs = (this.materials.get(material) ?? 1) - 1; if (refs > 0) this.materials.set(material, refs); else this.materials.delete(material); }
      }
    }
  }
  update(position: Vector3, immediate = false) {
    if (this.disposed) return;
    this.assertPosition(position); this.primary ??= position.clone(); this.primary.copyFrom(position);
    const before = this.counts.meshLoads + this.counts.meshDisposals;
    for (const chunk of this.manifest.chunks) if (!this.loaded.has(chunk.id) && !this.pending.has(chunk.id) && this.distance(chunk.bounds) < LIMITS.preload && (this.nextRetry.get(chunk.id) ?? 0) <= performance.now()) void this.load(chunk).catch(() => {});
    let visualLoads = 0;
    for (const asset of this.loaded.values()) for (const resident of asset.residents) {
      const d = this.distance(resident.data.record.bounds);
      // Safety-critical collision creation has priority over the visual budget.
      if (d < LIMITS.collision) this.collide(resident);
      else if (d > LIMITS.collision + 100 && resident.physics) { resident.physics.dispose(); resident.physics = undefined; this.counts.colliderDisposals++; }
      if (resident.data.record.render !== false && d < LIMITS.render && !resident.mesh && (immediate || visualLoads < LIMITS.meshOperations)) { this.create(resident); visualLoads++; }
      else if ((resident.data.record.render === false || d > LIMITS.unload) && resident.mesh && !resident.physics) this.remove(resident);
    }
    if (this.geometryBytes > LIMITS.cpuBytes) {
      const farthest = [...this.loaded.values()].sort((a, b) => this.distance(b.chunk.bounds) - this.distance(a.chunk.bounds));
      for (const asset of farthest) {
        if (this.geometryBytes <= LIMITS.cpuBytes) break;
        if (this.pins.has(asset.chunk.id) || this.distance(asset.chunk.bounds) <= LIMITS.unload) continue;
        for (const resident of asset.residents) this.remove(resident);
        this.loaded.delete(asset.chunk.id); this.geometryBytes -= asset.buffer.byteLength; this.counts.packagesEvicted++;
      }
    }
    this.lastOperations = this.counts.meshLoads + this.counts.meshDisposals - before;
  }
  collisionReady(position = this.primary, includeAnchors = true): boolean {
    if (this.disposed || !position) return false;
    let required = 0;
    for (const chunk of this.manifest.chunks) {
      const distance = includeAnchors ? this.distance(chunk.bounds, position) : distanceToBounds(position, chunk.bounds);
      if (distance >= LIMITS.collision) continue;
      const asset = this.loaded.get(chunk.id);
      for (let i = 0; i < chunk.meshes.length; i++) {
        const record = chunk.meshes[i], d = includeAnchors ? this.distance(record.bounds, position) : distanceToBounds(position, record.bounds);
        if (!record.collision || d >= LIMITS.collision) continue;
        required++; if (!asset?.residents[i].physics) return false;
      }
    }
    return required > 0;
  }
  getStats(): NetworkStreamingStats {
    let residentChunks = 0, totalMeshes = 0, residentMeshes = 0, totalColliders = 0, residentColliders = 0, pendingMeshes = 0;
    for (const chunk of this.manifest.chunks) {
      const asset = this.loaded.get(chunk.id), wanted = this.distance(chunk.bounds) < LIMITS.preload; let visible = false;
      for (let i = 0; i < chunk.meshes.length; i++) {
        const record = chunk.meshes[i], resident = asset?.residents[i]; totalMeshes++; if (record.collision) totalColliders++;
        if (resident?.physics) residentColliders++;
        if (resident?.mesh) { visible = true; residentMeshes++; }
        else if (!this.disposed && (asset || wanted) && this.distance(record.bounds) < (record.render === false ? LIMITS.collision : LIMITS.render)) pendingMeshes++;
      }
      if (visible) residentChunks++;
    }
    return { ...this.counts, totalChunks: this.manifest.chunks.length, residentChunks, totalMeshes, residentMeshes, totalColliders, residentColliders,
      cpuGeometryBytes: this.geometryBytes, totalCpuGeometryBytes: this.manifest.totalBytes, pendingMeshes, activeAnchors: this.anchors.length, lastMeshOperations: this.lastOperations,
      loadedPackages: this.loaded.size, totalPackages: this.manifest.chunks.length, pendingPackages: this.pending.size, failedPackages: this.failed.size, residentMaterials: this.materials.size, ready: this.collisionReady() };
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.abort.abort();
    for (const waiter of this.queue.splice(0)) waiter.reject(new Error('Miami world disposed'));
    this.pending.clear(); this.failed.clear(); this.nextRetry.clear(); this.pins.clear(); this.anchors = [];
    const before = this.counts.meshDisposals;
    for (const asset of this.loaded.values()) for (const resident of asset.residents) this.remove(resident);
    this.loaded.clear(); this.geometryBytes = 0; this.lastOperations = this.counts.meshDisposals - before;
  }
}
