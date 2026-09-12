import type { AssetContainer } from '@babylonjs/core/assetContainer';
import type { DataBuffer } from '@babylonjs/core/Buffers/dataBuffer';
import type { InternalTexture } from '@babylonjs/core/Materials/Textures/internalTexture';
import type { BaseTexture } from '@babylonjs/core/Materials/Textures/baseTexture';
import { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh';
import { Mesh } from '@babylonjs/core/Meshes/mesh';

export interface TileResourceInput {
  id: string;
  container: Pick<AssetContainer, 'meshes' | 'textures'>;
  /** Download size, NOT decoded texture size or proof these bytes remain in memory. */
  encodedGlbByteLength: number | null;
}
export interface TextureReservationPolicy {
  /** Deliberate accounting reserve; not a query of the graphics driver's layout. */
  rowAlignmentBytes: number;
  mipAllocationAlignmentBytes: number;
}
export const DEFAULT_TEXTURE_RESERVATION: Readonly<TextureReservationPolicy> = Object.freeze({
  rowAlignmentBytes: 256,
  mipAllocationAlignmentBytes: 4096,
});
export interface UnknownResource {
  kind: 'buffer' | 'texture' | 'mesh';
  resourceId: string;
  tileIds: string[];
  reason: string;
}
export interface BufferAccounting {
  resourceId: string;
  tileIds: string[];
  roles: string[];
  capacityBytes: number | null;
}
export interface TextureAccounting {
  resourceId: string;
  tileIds: string[];
  textureIds: number[];
  width: number;
  height: number;
  depth: number;
  faces: number;
  format: number;
  type: number;
  reportedMipLevels: number;
  generatesMipMaps: boolean;
  samplesMipMaps: boolean | null;
  reservedMipLevels: number;
  /** Four-channel expansion reserve, before row/mip alignment. */
  decodedTexelReserveBytes: number | null;
  allocationEstimateBytes: number | null;
  reason: string | null;
}
export interface TileResourceReport {
  /** These are accounting inputs and estimates, never measured VRAM. */
  measurement: 'babylon-buffer-capacities-and-conservative-texture-estimates';
  tileCount: number;
  encodedGlbBytes: number;
  encodedSizeUnknownTileIds: string[];
  uniqueBufferCount: number;
  uniqueTextureCount: number;
  gpuBufferCapacityBytes: number;
  decodedTextureTexelReserveBytes: number;
  textureAllocationEstimateBytes: number;
  knownResourceSubtotalBytes: number;
  /** Null if any resource in the declared static geometry/texture scope is unknown. */
  budgetChargeBytes: number | null;
  unknownResources: UnknownResource[];
  buffers: BufferAccounting[];
  textures: TextureAccounting[];
  policy: TextureReservationPolicy;
}

const positiveInteger = (value: number) => Number.isSafeInteger(value) && value > 0;
const align = (value: number, alignment: number) => Math.ceil(value / alignment) * alignment;
function checkedAdd(a: number, b: number): number {
  const value = a + b;
  if (!Number.isSafeInteger(value)) throw new Error('Resource accounting exceeded safe integer byte range.');
  return value;
}
function componentReserve(format: number, type: number): number | null {
  // Uncompressed Babylon color formats only. Always reserve four channels, including RGB/RED.
  if (![0, 1, 2, 4, 5, 6, 7, 8, 9, 10, 11].includes(format)) return null;
  if ([0, 3].includes(type)) return 4; // byte
  if ([2, 4, 5].includes(type)) return 8; // half float / short
  if ([1, 6, 7].includes(type)) return 16; // float / int
  if ([8, 9, 10, 11, 13, 14].includes(type)) return 16; // packed color/HDR may expand; reserve RGBA32.
  return null;
}
function estimateTexture(texture: InternalTexture, policy: TextureReservationPolicy): Omit<TextureAccounting, 'tileIds' | 'textureIds'> {
  const { width, height, format, type } = texture;
  const depth = texture.is3D || texture.is2DArray ? texture.depth : 1;
  const faces = texture.isCube ? 6 : 1;
  const value: Omit<TextureAccounting, 'tileIds' | 'textureIds'> = {
    resourceId: `texture:${texture.uniqueId}`, width, height, depth, faces, format, type,
    reportedMipLevels: texture.mipLevelCount,
    generatesMipMaps: texture.generateMipMaps,
    samplesMipMaps: texture.useMipMaps,
    reservedMipLevels: 0, decodedTexelReserveBytes: null, allocationEstimateBytes: null, reason: null,
  };
  const fail = (reason: string) => ({ ...value, reason });
  if (![width, height, depth].every(positiveInteger)) return fail('Decoded texture dimensions are absent, invalid or not yet available.');
  if (texture.isMultiview || texture.samples > 1) return fail('Multiview/MSAA textures may own additional renderbuffer allocations outside this static-tile estimator.');
  if (texture.isCube || texture.is3D || texture.is2DArray) return fail('Cube, volume and array texture allocations require a separate native validation gate; this cohort validates 2D color textures.');
  const bytesPerTexel = componentReserve(format, type);
  if (bytesPerTexel === null || texture._compression) return fail('Compressed, depth, unknown or extended color format needs a separately validated allocation model.');
  const maxDimension = Math.max(width, height, texture.is3D ? depth : 1);
  const levels = Math.floor(Math.log2(maxDimension)) + 1;
  if (!positiveInteger(texture.mipLevelCount) || texture.mipLevelCount > levels) return fail('Reported mip count is inconsistent with the decoded dimensions.');
  // Sampling flags do not establish which baked mip levels remain allocated. Reserve a full chain.
  let texels = 0, allocation = 0;
  for (let level = 0; level < levels; level++) {
    const w = Math.max(1, Math.floor(width / 2 ** level));
    const h = Math.max(1, Math.floor(height / 2 ** level));
    const d = texture.is3D ? Math.max(1, Math.floor(depth / 2 ** level)) : depth;
    texels = checkedAdd(texels, w * h * d * faces * bytesPerTexel);
    const slice = align(align(w * bytesPerTexel, policy.rowAlignmentBytes) * h, policy.mipAllocationAlignmentBytes);
    allocation = checkedAdd(allocation, slice * d * faces);
  }
  return { ...value, reservedMipLevels: levels, decodedTexelReserveBytes: texels, allocationEstimateBytes: allocation };
}

/**
 * A fresh snapshot: no retained container references, scene mutation, allocation or disposal.
 * Pass all resident tiles together for an identity-deduplicated global estimate. Independent
 * per-tile reports intentionally double-charge shared resources and cannot be summed as unique VRAM.
 */
export function measureTileResources(inputs: readonly TileResourceInput[], policy: TextureReservationPolicy = DEFAULT_TEXTURE_RESERVATION): TileResourceReport {
  for (const value of [policy.rowAlignmentBytes, policy.mipAllocationAlignmentBytes]) {
    if (!positiveInteger(value) || !Number.isInteger(Math.log2(value))) throw new Error('Reservation alignments must be positive power-of-two byte counts.');
  }
  const buffers = new Map<DataBuffer, { row: BufferAccounting; tiles: Set<string>; roles: Set<string> }>();
  const textures = new Map<InternalTexture, { row: TextureAccounting; tiles: Set<string>; ids: Set<number> }>();
  const unknown = new Map<string, UnknownResource>();
  const tileIds = new Set<string>();
  let encodedGlbBytes = 0;
  const encodedSizeUnknownTileIds: string[] = [];
  const mark = (kind: UnknownResource['kind'], resourceId: string, tileId: string, reason: string) => {
    const key = `${kind}:${resourceId}:${reason}`;
    const current = unknown.get(key);
    if (current) { if (!current.tileIds.includes(tileId)) current.tileIds.push(tileId); }
    else unknown.set(key, { kind, resourceId, tileIds: [tileId], reason });
  };
  const addBuffer = (buffer: DataBuffer, role: string, tileId: string) => {
    let entry = buffers.get(buffer);
    if (!entry) {
      entry = { row: { resourceId: `buffer:${buffer.uniqueId}`, tileIds: [], roles: [], capacityBytes: positiveInteger(buffer.capacity) ? buffer.capacity : null }, tiles: new Set(), roles: new Set() };
      buffers.set(buffer, entry);
    }
    entry.tiles.add(tileId); entry.roles.add(role);
    if (entry.row.capacityBytes === null) mark('buffer', entry.row.resourceId, tileId, 'Babylon DataBuffer capacity is absent or zero; CPU attribute lengths do not prove GPU allocation.');
  };
  const addTexture = (texture: BaseTexture, tileId: string) => {
    const internal = texture.getInternalTexture();
    if (!internal) { mark('texture', `base-texture:${texture.uniqueId}`, tileId, 'Texture has no internal allocation metadata; it may be pending, released or unsupported.'); return; }
    let entry = textures.get(internal);
    if (!entry) {
      entry = { row: { ...estimateTexture(internal, policy), tileIds: [], textureIds: [] }, tiles: new Set(), ids: new Set() };
      textures.set(internal, entry);
    }
    entry.tiles.add(tileId); entry.ids.add(texture.uniqueId);
    if (entry.row.reason) mark('texture', entry.row.resourceId, tileId, entry.row.reason);
    if (texture.isRenderTarget) mark('texture', entry.row.resourceId, tileId, 'Render-target attachment/depth allocations are not enumerated by a static color texture.');
  };
  for (const input of inputs) {
    if (!input.id || tileIds.has(input.id)) throw new Error('Every tile must have a nonempty unique accounting ID.');
    tileIds.add(input.id);
    if (input.encodedGlbByteLength === null) encodedSizeUnknownTileIds.push(input.id);
    else if (!Number.isSafeInteger(input.encodedGlbByteLength) || input.encodedGlbByteLength < 0) throw new Error('Encoded GLB length must be a nonnegative safe byte count or null.');
    else encodedGlbBytes = checkedAdd(encodedGlbBytes, input.encodedGlbByteLength);
    for (const mesh of input.container.meshes) {
      if (mesh.isDisposed()) continue;
      const source = mesh instanceof InstancedMesh ? mesh.sourceMesh : mesh;
      if (mesh.skeleton || mesh.morphTargetManager || mesh.hasThinInstances || mesh instanceof InstancedMesh) mark('mesh', `mesh:${mesh.uniqueId}`, input.id, 'Skinning, morph or instance allocations need a separate resource enumeration gate.');
      if (!(source instanceof Mesh)) {
        if (mesh.getTotalVertices() > 0) mark('mesh', `mesh:${mesh.uniqueId}`, input.id, 'Renderable mesh has no supported public Mesh geometry interface.');
        continue;
      }
      if (source.instances.length > 0) mark('mesh', `mesh:${source.uniqueId}`, input.id, 'Source mesh owns instance allocations outside its static geometry.');
      // Pinned 9.25 cache inspection: turning wireframe/edges off need not release their buffers.
      const cachedLines = source.subMeshes?.some(sub => Boolean((sub as unknown as { _linesIndexBuffer: DataBuffer | null })._linesIndexBuffer));
      if (source.material?.wireframe || source.getScene().forceWireframe || source._edgesRenderer || cachedLines) mark('mesh', `mesh:${source.uniqueId}`, input.id, 'Wireframe/edge rendering can retain derived buffers outside the static geometry interface.');
      const geometry = source.geometry;
      if (geometry) {
        const attributes = geometry.getVertexBuffers();
        if (!attributes) mark('mesh', `geometry:${geometry.uniqueId}`, input.id, 'Geometry attributes are not ready for allocation inspection.');
        for (const [kind, attribute] of Object.entries(attributes ?? {})) {
          const buffer = attribute.getBuffer();
          if (buffer) addBuffer(buffer, `vertex:${kind}`, input.id);
          else mark('buffer', `vertex:${attribute.uniqueId}`, input.id, 'Vertex buffer has no allocated DataBuffer.');
        }
        const index = geometry.getIndexBuffer();
        if (index) addBuffer(index, 'index', input.id);
        else if (source.getTotalIndices() > 0) mark('buffer', `index:${geometry.uniqueId}`, input.id, 'Indexed geometry has no allocated index DataBuffer.');
      } else if (source.getTotalVertices() > 0) mark('mesh', `mesh:${mesh.uniqueId}`, input.id, 'Renderable geometry is absent.');
      for (const texture of mesh.material?.getActiveTextures() ?? []) addTexture(texture, input.id);
    }
    // Include allocated but currently inactive textures still owned by the container.
    for (const texture of input.container.textures) addTexture(texture, input.id);
  }
  const bufferRows = [...buffers.values()].map(({ row, tiles, roles }) => ({ ...row, tileIds: [...tiles], roles: [...roles] }));
  const textureRows = [...textures.values()].map(({ row, tiles, ids }) => ({ ...row, tileIds: [...tiles], textureIds: [...ids] }));
  const sum = (values: number[]) => values.reduce(checkedAdd, 0);
  const gpuBufferCapacityBytes = sum(bufferRows.map(row => row.capacityBytes ?? 0));
  const decodedTextureTexelReserveBytes = sum(textureRows.map(row => row.decodedTexelReserveBytes ?? 0));
  const textureAllocationEstimateBytes = sum(textureRows.map(row => row.allocationEstimateBytes ?? 0));
  const knownResourceSubtotalBytes = checkedAdd(gpuBufferCapacityBytes, textureAllocationEstimateBytes);
  return {
    measurement: 'babylon-buffer-capacities-and-conservative-texture-estimates', tileCount: inputs.length,
    encodedGlbBytes, encodedSizeUnknownTileIds, uniqueBufferCount: buffers.size, uniqueTextureCount: textures.size,
    gpuBufferCapacityBytes, decodedTextureTexelReserveBytes, textureAllocationEstimateBytes, knownResourceSubtotalBytes,
    budgetChargeBytes: unknown.size ? null : knownResourceSubtotalBytes,
    unknownResources: [...unknown.values()], buffers: bufferRows, textures: textureRows, policy: { ...policy },
  };
}
