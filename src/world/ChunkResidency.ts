import {
  Mesh,
  MeshBuilder,
  PhysicsAggregate,
  PhysicsShapeType,
  Vector3,
  VertexData,
} from "@babylonjs/core";
import type { Material, Scene, ShadowGenerator } from "@babylonjs/core";
import type { Obstacle } from "../core/contracts";

export type WorldDetail = "global" | "structure" | "detail";
export interface BoundsXZ {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}
export interface ColliderRecord {
  id: string;
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
  global?: boolean;
  obstacle?: Obstacle;
  material?: string;
  /** Pitch across X for authored walkable banks and slopes. */
  rotationZ?: number;
}
interface MeshRecord {
  id: string;
  data: VertexData;
  material: Material | null;
  bounds: BoundsXZ;
  detail: WorldDetail;
  chunkId: string;
  casts: boolean;
  pickable: boolean;
  receiveShadows: boolean;
  metadata: unknown;
  mesh: Mesh | null;
  bytes: number;
}
interface CollisionAsset {
  record: ColliderRecord;
  mesh: Mesh | null;
  physics: PhysicsAggregate | null;
}
export interface StreamingStats {
  totalChunks: number;
  residentChunks: number;
  totalMeshes: number;
  residentMeshes: number;
  totalColliders: number;
  residentColliders: number;
  cpuGeometryBytes: number;
  meshLoads: number;
  meshDisposals: number;
  colliderLoads: number;
  colliderDisposals: number;
  pendingMeshes: number;
  activeAnchors: number;
  lastMeshOperations: number;
}

export const RESIDENCY_LIMITS = {
  detailLoad: 285,
  structureLoad: 650,
  visualHysteresis: 90,
  collisionLoad: 220,
  collisionUnload: 310,
  anchorVisualLoad: 65,
  anchorCollisionLoad: 90,
  anchorCollisionUnload: 150,
  meshOperationsPerUpdate: 12,
  colliderDisposalsPerUpdate: 40,
} as const;

export function distanceToBounds(
  position: Pick<Vector3, "x" | "z">,
  bounds: BoundsXZ,
): number {
  return Math.hypot(
    Math.max(bounds.minX - position.x, 0, position.x - bounds.maxX),
    Math.max(bounds.minZ - position.z, 0, position.z - bounds.maxZ),
  );
}

/**
 * Retains CPU asset records; actual render buffers and Havok shapes are resident only
 * around active simulation. This is GPU/physics streaming, not network asset loading.
 */
export class ChunkResidency {
  private readonly meshes = new Map<string, MeshRecord>();
  private readonly colliders = new Map<string, CollisionAsset>();
  private anchors: Vector3[] = [];
  private primary: Vector3;
  private loads = 0;
  private disposals = 0;
  private physicsLoads = 0;
  private physicsDisposals = 0;
  private pending = 0;
  private lastOperations = 0;
  constructor(
    private readonly scene: Scene,
    private readonly shadows: ShadowGenerator,
    spawn: Vector3,
  ) {
    this.primary = spawn.clone();
  }

  setActiveAnchors(anchors: Vector3[]): void {
    this.anchors = anchors
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.z))
      .map((p) => p.clone());
  }

  registerMesh(mesh: Mesh, detail: WorldDetail, casts = false): string {
    if (this.meshes.has(mesh.name))
      throw new Error(`Duplicate streamed mesh ID: ${mesh.name}`);
    mesh.unfreezeWorldMatrix();
    mesh.bakeCurrentTransformIntoVertices();
    mesh.computeWorldMatrix(true);
    const bounds = mesh.getBoundingInfo().boundingBox;
    const data = VertexData.ExtractFromMesh(mesh, true, true);
    // Typed CPU records have fixed memory cost and survive disposal of the GPU mesh.
    if (data.positions) data.positions = new Float32Array(data.positions);
    if (data.normals) data.normals = new Float32Array(data.normals);
    if (data.uvs) data.uvs = new Float32Array(data.uvs);
    if (data.uvs2) data.uvs2 = new Float32Array(data.uvs2);
    if (data.colors) data.colors = new Float32Array(data.colors);
    if (data.indices)
      data.indices =
        (data.positions?.length || 0) / 3 > 65535
          ? new Uint32Array(data.indices)
          : new Uint16Array(data.indices);
    const arrays = [
      data.positions,
      data.normals,
      data.uvs,
      data.uvs2,
      data.colors,
      data.indices,
    ];
    const bytes = arrays.reduce(
      (sum, array) =>
        sum +
        (array
          ? ((array as ArrayBufferView).byteLength ?? array.length * 8)
          : 0),
      0,
    );
    const centerX = (bounds.minimumWorld.x + bounds.maximumWorld.x) / 2,
      centerZ = (bounds.minimumWorld.z + bounds.maximumWorld.z) / 2;
    const chunkId = `${Math.floor((centerX + 72) / 144)}:${Math.floor((centerZ + 72) / 144)}`;
    const record: MeshRecord = {
      id: mesh.name,
      data,
      material: mesh.material,
      bounds: {
        minX: bounds.minimumWorld.x,
        maxX: bounds.maximumWorld.x,
        minZ: bounds.minimumWorld.z,
        maxZ: bounds.maximumWorld.z,
      },
      detail,
      chunkId,
      casts,
      pickable: mesh.isPickable,
      receiveShadows: mesh.receiveShadows,
      metadata: mesh.metadata,
      mesh,
      bytes,
    };
    this.meshes.set(record.id, record);
    this.loads++;
    if (this.visualWanted(record, false)) {
      if (casts) this.shadows.addShadowCaster(mesh, false);
      mesh.freezeWorldMatrix();
    } else this.releaseMesh(record);
    return record.id;
  }

  registerCollider(record: ColliderRecord): void {
    if (this.colliders.has(record.id))
      throw new Error(`Duplicate streamed collider ID: ${record.id}`);
    const asset: CollisionAsset = {
      record: { ...record },
      mesh: null,
      physics: null,
    };
    this.colliders.set(record.id, asset);
    if (this.collisionWanted(record, false)) this.loadCollider(asset);
  }

  private collisionWanted(record: ColliderRecord, resident: boolean): boolean {
    if (record.global) return true;
    const bounds = {
      minX: record.x - record.w / 2,
      maxX: record.x + record.w / 2,
      minZ: record.z - record.d / 2,
      maxZ: record.z + record.d / 2,
    };
    const playerRadius = resident ? RESIDENCY_LIMITS.collisionUnload : RESIDENCY_LIMITS.collisionLoad;
    const vehicleRadius = resident ? RESIDENCY_LIMITS.anchorCollisionUnload : RESIDENCY_LIMITS.anchorCollisionLoad;
    return distanceToBounds(this.primary, bounds) <= playerRadius ||
      this.anchors.some(anchor => distanceToBounds(anchor, bounds) <= vehicleRadius);
  }

  private visualWanted(record: MeshRecord, resident: boolean): boolean {
    if (record.detail === "global") return true;
    const hysteresis = resident ? RESIDENCY_LIMITS.visualHysteresis : 0;
    const radius =
      record.detail === "detail"
        ? RESIDENCY_LIMITS.detailLoad
        : RESIDENCY_LIMITS.structureLoad;
    if (distanceToBounds(this.primary, record.bounds) <= radius + hysteresis)
      return true;
    return this.anchors.some(
      (anchor) =>
        distanceToBounds(anchor, record.bounds) <=
        RESIDENCY_LIMITS.anchorVisualLoad + hysteresis,
    );
  }

  private loadMesh(record: MeshRecord): void {
    const mesh = new Mesh(record.id, this.scene);
    record.data.applyToMesh(mesh, false);
    mesh.material = record.material;
    mesh.isPickable = record.pickable;
    mesh.receiveShadows = record.receiveShadows;
    mesh.metadata = record.metadata;
    mesh.freezeWorldMatrix();
    record.mesh = mesh;
    if (record.casts) this.shadows.addShadowCaster(mesh, false);
    this.loads++;
  }

  private releaseMesh(record: MeshRecord): void {
    if (!record.mesh) return;
    if (record.casts) this.shadows.removeShadowCaster(record.mesh, false);
    record.mesh.dispose(false, false);
    record.mesh = null;
    this.disposals++;
  }

  private loadCollider(asset: CollisionAsset): void {
    const r = asset.record;
    const mesh = MeshBuilder.CreateBox(
      r.id,
      { width: r.w, height: r.h, depth: r.d },
      this.scene,
    );
    mesh.position.set(r.x, r.y, r.z);
    mesh.rotation.z = r.rotationZ ?? 0;
    mesh.isVisible = false;
    mesh.isPickable = true;
    mesh.metadata = {
      kind: "structure",
      response: "structural",
      material: r.material || "concrete",
      cameraBlocker: true,
      streamId: r.id,
    };
    asset.physics = new PhysicsAggregate(
      mesh,
      PhysicsShapeType.BOX,
      { mass: 0, friction: 0.8, restitution: 0.06 },
      this.scene,
    );
    asset.mesh = mesh;
    if (r.obstacle) r.obstacle.mesh = mesh;
    this.physicsLoads++;
  }

  private releaseCollider(asset: CollisionAsset): void {
    if (!asset.mesh) return;
    asset.physics?.dispose();
    asset.mesh.dispose(false, false);
    asset.physics = null;
    asset.mesh = null;
    if (asset.record.obstacle) asset.record.obstacle.mesh = undefined;
    this.physicsDisposals++;
  }

  /** Call before physics after teleporting or advancing simulation anchors. */
  ensureCollision(position: Vector3): void {
    this.primary.copyFrom(position);
    // Safety loads are immediate. Normal unloading and all visual work are budgeted.
    for (const asset of this.colliders.values())
      if (
        !asset.mesh &&
        this.collisionWanted(asset.record, false)
      )
        this.loadCollider(asset);
  }

  update(
    position: Vector3,
    budget: number = RESIDENCY_LIMITS.meshOperationsPerUpdate,
  ): void {
    this.ensureCollision(position);
    let physicsDisposals = 0;
    for (const asset of this.colliders.values())
      if (
        asset.mesh &&
        !this.collisionWanted(asset.record, true) &&
        physicsDisposals < RESIDENCY_LIMITS.colliderDisposalsPerUpdate
      ) {
        this.releaseCollider(asset);
        physicsDisposals++;
      }
    const work: [MeshRecord, number][] = [];
    for (const record of this.meshes.values()) {
      const wanted = this.visualWanted(record, !!record.mesh);
      if (wanted !== !!record.mesh)
        work.push([record, distanceToBounds(this.primary, record.bounds)]);
    }
    // Near scenery first; distant disposal follows, still within the operation budget.
    work.sort(
      (a, b) => Number(!!a[0].mesh) - Number(!!b[0].mesh) || a[1] - b[1],
    );
    this.lastOperations = Math.min(
      Math.max(0, Math.floor(budget)),
      work.length,
    );
    for (let i = 0; i < this.lastOperations; i++) {
      const record = work[i][0];
      if (record.mesh) this.releaseMesh(record);
      else this.loadMesh(record);
    }
    this.pending = work.length - this.lastOperations;
  }

  getResidentMesh(id: string): Mesh | null {
    return this.meshes.get(id)?.mesh ?? null;
  }
  getColliderMesh(id: string): Mesh | null {
    return this.colliders.get(id)?.mesh ?? null;
  }
  getStats(): StreamingStats {
    const records = [...this.meshes.values()];
    return {
      totalChunks: new Set(
        records.filter((r) => r.detail !== "global").map((r) => r.chunkId),
      ).size,
      residentChunks: new Set(
        records
          .filter((r) => r.detail !== "global" && r.mesh)
          .map((r) => r.chunkId),
      ).size,
      totalMeshes: this.meshes.size,
      residentMeshes: records.filter((r) => r.mesh).length,
      totalColliders: this.colliders.size,
      residentColliders: [...this.colliders.values()].filter((r) => r.mesh)
        .length,
      cpuGeometryBytes: records.reduce((n, r) => n + r.bytes, 0),
      meshLoads: this.loads,
      meshDisposals: this.disposals,
      colliderLoads: this.physicsLoads,
      colliderDisposals: this.physicsDisposals,
      pendingMeshes: this.pending,
      activeAnchors: this.anchors.length,
      lastMeshOperations: this.lastOperations,
    };
  }

  dispose(): void {
    for (const record of this.meshes.values()) this.releaseMesh(record);
    for (const asset of this.colliders.values()) this.releaseCollider(asset);
    this.meshes.clear();
    this.colliders.clear();
    this.anchors = [];
  }
}
