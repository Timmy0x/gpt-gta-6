import type { ColliderRecord, BoundsXZ, StreamingStats, WorldDetail } from './ChunkResidency';
export interface ChunkPackage {
  id: string; url: string; bounds: BoundsXZ; detail: WorldDetail;
  meshes: number; vertices: number; cpuBytes: number; compressedBytes: number;
  materials: string[]; sha256: string;
}
export interface MaterialPackage { id: string; name: string; url: string; bytes: number; }
export interface WorldManifest {
  version: 1; build: string; seed: number; format: 'babylon-json+gzip';
  chunks: ChunkPackage[]; materials: MaterialPackage[];
  colliders: ColliderRecord[];
  lights: number[][]; litMaterials: {id:string;color:number[];intensity:number}[];
  waterMaterial: string; asphaltMaterial: string; foam: string[];
  totals: { meshes:number; cpuGeometryBytes:number; compressedBytes:number; textureBytes:number; };
}
export interface NetworkStreamingStats extends StreamingStats {
  loadedPackages: number; totalPackages: number; pendingPackages: number;
  failedPackages: number; retries: number; requests: number; fetchedBytes: number;
  residentMaterials: number; totalCpuGeometryBytes: number; ready: boolean;
  lastError: string; packagesLoaded: number; packagesEvicted: number;
}
export const PACKAGE_LIMITS = {
  immediateRadius: 95, detailLoad: 200, structureLoad: 420, unloadHysteresis: 100,
  anchorLoad: 65, concurrentLoads: 2, unloadsPerUpdate: 2,
  retryBaseMs: 400, maxRetryMs: 12000, requestTimeoutMs: 12000,
} as const;
