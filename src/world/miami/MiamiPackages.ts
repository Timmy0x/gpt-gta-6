import type { MiamiMeshRecord, MiamiPoint, MiamiProvenance } from './types';
import type { BoundsXZ } from '../ChunkResidency';
export interface MiamiBufferSlice { offset: number; count: number; }
export interface MiamiPackedMesh extends MiamiProvenance {
  id: string; kind: MiamiMeshRecord['kind']; material: string; collision: boolean; friction: number; restitution: number;
  render?: boolean;
  origin: MiamiPoint; bounds: BoundsXZ;
  positions: MiamiBufferSlice; normals: MiamiBufferSlice; uvs: MiamiBufferSlice; indices: MiamiBufferSlice;
}
export interface MiamiChunk {
  id: string; url: string; bytes: number; sha256: string; bounds: BoundsXZ; meshes: MiamiPackedMesh[];
}
export interface MiamiPackageManifest { version: 1; worldId: string; chunks: MiamiChunk[]; totalBytes: number; }

function validBounds(bounds: BoundsXZ): boolean {
  return !!bounds && [bounds.minX, bounds.maxX, bounds.minZ, bounds.maxZ].every(Number.isFinite) && bounds.minX <= bounds.maxX && bounds.minZ <= bounds.maxZ;
}
function contains(outer: BoundsXZ, inner: BoundsXZ, tolerance = .002): boolean {
  return inner.minX >= outer.minX - tolerance && inner.maxX <= outer.maxX + tolerance && inner.minZ >= outer.minZ - tolerance && inner.maxZ <= outer.maxZ + tolerance;
}
/** Bounds drive collision residency, so they are part of the verified geometry contract. */
export function validateMiamiManifest(manifest: MiamiPackageManifest): void {
  if (manifest.version !== 1 || !manifest.worldId || !Array.isArray(manifest.chunks) || !manifest.chunks.length) throw new TypeError('Invalid Miami package manifest');
  const chunks = new Set<string>(), meshes = new Set<string>(); let bytes = 0;
  for (const chunk of manifest.chunks) {
    if (!chunk.id || chunks.has(chunk.id) || !chunk.url || !/^[a-f\d]{64}$/i.test(chunk.sha256) || !Number.isSafeInteger(chunk.bytes) || chunk.bytes <= 0 || chunk.bytes % 4 || !validBounds(chunk.bounds) || !Array.isArray(chunk.meshes) || !chunk.meshes.length) throw new TypeError(`Invalid Miami package: ${chunk.id}`);
    chunks.add(chunk.id); bytes += chunk.bytes;
    for (const record of chunk.meshes) {
      if (!record.id || meshes.has(record.id) || !record.material || !validBounds(record.bounds) || !contains(chunk.bounds, record.bounds) || !Number.isFinite(record.friction) || record.friction < 0 || !Number.isFinite(record.restitution) || record.restitution < 0 || record.restitution > 1) throw new TypeError(`Invalid Miami mesh metadata: ${record.id}`);
      meshes.add(record.id);
    }
  }
  if (!Number.isSafeInteger(bytes) || bytes !== manifest.totalBytes) throw new TypeError('Miami manifest byte total mismatch');
}

/** Binary slices are validated before Babylon/Havok receive any source geometry. */
export function decodeMiamiChunk(chunk: MiamiChunk, buffer: ArrayBuffer) {
  if (buffer.byteLength !== chunk.bytes) throw new Error(`Miami chunk byte count mismatch: ${chunk.id}`);
  const checkSlice = (slice: MiamiBufferSlice) => {
    if (!slice || !Number.isSafeInteger(slice.offset) || slice.offset < 0 || slice.offset % 4 || !Number.isSafeInteger(slice.count) || slice.count < 0 || slice.count > (buffer.byteLength - slice.offset) / 4) throw new TypeError(`Invalid Miami geometry slice: ${chunk.id}`);
  };
  const float = (slice: MiamiBufferSlice) => { checkSlice(slice); return new Float32Array(buffer, slice.offset, slice.count); };
  return chunk.meshes.map(record => {
    const positions = float(record.positions), normals = float(record.normals), uvs = float(record.uvs);
    checkSlice(record.indices); const indices = new Uint32Array(buffer, record.indices.offset, record.indices.count);
    const vertices = positions.length / 3;
    if (!Number.isInteger(vertices) || !vertices || normals.length !== positions.length || uvs.length !== vertices * 2 || indices.length % 3 || !indices.length || record.origin.length !== 3 || record.origin.some(n => !Number.isFinite(n))) throw new TypeError(`Invalid Miami mesh layout: ${record.id}`);
    for (const values of [positions, normals, uvs]) if (values.some(n => !Number.isFinite(n))) throw new TypeError(`Nonfinite Miami vertex: ${record.id}`);
    if (indices.some(n => n >= vertices)) throw new TypeError(`Miami triangle outside vertex buffer: ${record.id}`);
    const bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i] + record.origin[0], z = positions[i + 2] + record.origin[2];
      bounds.minX = Math.min(bounds.minX, x); bounds.maxX = Math.max(bounds.maxX, x); bounds.minZ = Math.min(bounds.minZ, z); bounds.maxZ = Math.max(bounds.maxZ, z);
    }
    if (!validBounds(record.bounds) || !validBounds(chunk.bounds) || !contains(record.bounds, bounds) || !contains(chunk.bounds, record.bounds)) throw new TypeError(`Miami geometry outside residency bounds: ${record.id}`);
    return { record, positions, normals, uvs, indices };
  });
}
