/** Diagnostic allowlists are deliberately finite. No source strings, vectors, URLs or payloads are returned. */
export const EXTENSIONS = [
  'CESIUM_RTC', 'EXT_mesh_gpu_instancing', 'EXT_meshopt_compression', 'EXT_mesh_features',
  'EXT_instance_features', 'EXT_structural_metadata', 'EXT_texture_webp', 'EXT_texture_avif',
  'KHR_draco_mesh_compression', 'KHR_mesh_quantization', 'KHR_texture_basisu', 'KHR_texture_transform',
  'KHR_materials_unlit', 'KHR_materials_pbrSpecularGlossiness', 'KHR_materials_clearcoat',
  'KHR_materials_sheen', 'KHR_materials_transmission', 'KHR_materials_volume', 'KHR_materials_ior',
  'KHR_materials_specular', 'KHR_materials_emissive_strength', 'KHR_materials_iridescence',
  'KHR_materials_anisotropy', 'KHR_materials_dispersion', 'KHR_materials_diffuse_transmission',
  'KHR_materials_variants', 'KHR_lights_punctual', 'KHR_animation_pointer',
] as const;
const FORMATS = ['glb', 'gltf', 'b3dm', 'i3dm', 'pnts', 'cmpt', 'subtree', 'unknown'] as const;
const VERSIONS = ['1.0', '2.0', 'unknown'] as const;
const AXES = ['X', 'Y', 'Z', 'defaultY', 'unknown'] as const;
const MODES = ['POINTS', 'LINES', 'LINE_LOOP', 'LINE_STRIP', 'TRIANGLES', 'TRIANGLE_STRIP', 'TRIANGLE_FAN', 'unknown'] as const;
const COMPONENTS = ['BYTE', 'UNSIGNED_BYTE', 'SHORT', 'UNSIGNED_SHORT', 'UNSIGNED_INT', 'FLOAT', 'unknown'] as const;
const componentNames: Record<number, typeof COMPONENTS[number]> = { 5120: 'BYTE', 5121: 'UNSIGNED_BYTE', 5122: 'SHORT', 5123: 'UNSIGNED_SHORT', 5125: 'UNSIGNED_INT', 5126: 'FLOAT' };
const LIMIT = 10_000;
const MAX_MAGNITUDE = 1e12;
const counts = <T extends readonly string[]>(keys: T) => Object.fromEntries(keys.map(key => [key, 0])) as Record<T[number], number>;
function own(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object') return undefined;
  // Data properties only: diagnostics must not invoke metadata getters.
  return Object.getOwnPropertyDescriptor(value, key)?.value;
}
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function vector(value: unknown, size: number): number[] | null {
  if (!Array.isArray(value) || value.length !== size || !value.every(v => typeof v === 'number' && Number.isFinite(v))) return null;
  return value as number[];
}
function magnitude(values: number[] | null): number | null {
  if (!values) return null;
  const result = Math.hypot(...values);
  return Number.isFinite(result) && result <= MAX_MAGNITUDE ? result : null;
}
function nonUnitMatrix(matrix: number[]) {
  return [0, 4, 8].some(i => Math.abs(Math.hypot(matrix[i], matrix[i + 1], matrix[i + 2]) - 1) > 1e-6);
}
export function contentFormat(buffer: ArrayBuffer | ArrayBufferView, extension: string): typeof FORMATS[number] {
  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer, 0, Math.min(4, buffer.byteLength)) : new Uint8Array(buffer.buffer, buffer.byteOffset, Math.min(4, buffer.byteLength));
  const magic = String.fromCharCode(...bytes);
  if (magic === 'glTF') return 'glb';
  if (['b3dm', 'i3dm', 'pnts', 'cmpt'].includes(magic)) return magic as 'b3dm' | 'i3dm' | 'pnts' | 'cmpt';
  if (magic === 'subt') return 'subtree';
  return typeof extension === 'string' && extension.toLowerCase() === 'gltf' ? 'gltf' : 'unknown';
}

export class StructuralProfile {
  private seenTiles = new WeakSet<object>();
  private seenTilesets = new WeakSet<object>();
  private seenModels = new WeakSet<object>();
  private pendingFormat = new WeakMap<object, typeof FORMATS[number]>();
  private data = {
    schemaVersion: 1,
    loadedContent: counts(FORMATS), gltfVersions: counts(VERSIONS),
    extensionsUsed: counts(EXTENSIONS), unknownExtensionsUsed: 0,
    extensionsRequired: counts(EXTENSIONS), unknownExtensionsRequired: 0,
    tilesets: 0, gltfUpAxis: counts(AXES), tilesObserved: 0,
    tileBounds: { box: 0, sphere: 0, region: 0, unknown: 0 },
    tileTransforms: { present: 0, omitted: 0, invalid: 0, nonUnitScale: 0, maxTranslationMagnitudeM: 0 },
    maxBoxCenterMagnitudeM: 0, maxSphereCenterMagnitudeM: 0,
    nodesObserved: 0, maxNodeTranslationMagnitudeM: 0, nonUnitNodeScale: 0,
    cesiumRtc: { present: 0, invalidCenter: 0, maxCenterMagnitudeM: 0 },
    buffers: { embedded: 0, external: 0 }, images: { embedded: 0, external: 0, unspecified: 0 },
    primitiveModes: counts(MODES), positionComponents: counts(COMPONENTS),
    missingGltfMetadata: 0, invalidNumericValues: 0, inspectionLimitReached: false,
  };
  private limited(value: unknown) {
    const values = array(value);
    if (values.length > LIMIT) this.data.inspectionLimitReached = true;
    return values.slice(0, LIMIT);
  }
  private maxMagnitude(value: number[] | null, update: (value: number) => void) {
    const result = magnitude(value);
    if (result === null) this.data.invalidNumericValues++;
    else update(result);
  }
  observeTileset(value: unknown) {
    if (!value || typeof value !== 'object' || this.seenTilesets.has(value)) return;
    this.seenTilesets.add(value); this.data.tilesets++;
    const axis = own(own(value, 'asset'), 'gltfUpAxis');
    const normalized = typeof axis === 'string' && ['x', 'y', 'z'].includes(axis.toLowerCase()) ? axis.toUpperCase() as 'X' | 'Y' | 'Z' : axis === undefined ? 'defaultY' : 'unknown';
    this.data.gltfUpAxis[normalized]++;
  }
  observeTile(tile: object) {
    if (this.seenTiles.has(tile)) return;
    this.seenTiles.add(tile); this.data.tilesObserved++;
    const bounds = own(tile, 'boundingVolume');
    let boundFound = false;
    for (const kind of ['box', 'sphere', 'region'] as const) {
      const value = own(bounds, kind);
      if (value === undefined) continue;
      boundFound = true; this.data.tileBounds[kind]++;
      if (kind === 'region') continue;
      const numbers = vector(value, kind === 'box' ? 12 : 4);
      this.maxMagnitude(numbers?.slice(0, 3) ?? null, result => {
        const key = kind === 'box' ? 'maxBoxCenterMagnitudeM' : 'maxSphereCenterMagnitudeM';
        this.data[key] = Math.max(this.data[key], result);
      });
    }
    if (!boundFound) this.data.tileBounds.unknown++;
    const transform = own(tile, 'transform');
    if (transform === undefined) this.data.tileTransforms.omitted++;
    else {
      this.data.tileTransforms.present++;
      const matrix = vector(transform, 16);
      if (!matrix) this.data.tileTransforms.invalid++;
      else {
        if (nonUnitMatrix(matrix)) this.data.tileTransforms.nonUnitScale++;
        this.maxMagnitude(matrix.slice(12, 15), result => { this.data.tileTransforms.maxTranslationMagnitudeM = Math.max(this.data.tileTransforms.maxTranslationMagnitudeM, result); });
      }
    }
  }
  observeBuffer(tile: object, buffer: ArrayBuffer | ArrayBufferView, extension: string) {
    this.pendingFormat.set(tile, contentFormat(buffer, extension));
  }
  observeLoaded(tile: object, metadata: unknown) {
    if (this.seenModels.has(tile)) return;
    this.seenModels.add(tile);
    this.data.loadedContent[this.pendingFormat.get(tile) ?? 'unknown']++;
    this.pendingFormat.delete(tile);
    const version = own(own(metadata, 'asset'), 'version');
    if (version === undefined) { this.data.missingGltfMetadata++; return; }
    this.data.gltfVersions[version === '1.0' || version === '2.0' ? version : 'unknown']++;
    for (const field of ['extensionsUsed', 'extensionsRequired'] as const) {
      for (const value of this.limited(own(metadata, field))) {
        if (typeof value === 'string' && (EXTENSIONS as readonly string[]).includes(value)) this.data[field][value as typeof EXTENSIONS[number]]++;
        else if (field === 'extensionsUsed') this.data.unknownExtensionsUsed++;
        else this.data.unknownExtensionsRequired++;
      }
    }
    const rtc = own(own(metadata, 'extensions'), 'CESIUM_RTC');
    if (rtc !== undefined) {
      this.data.cesiumRtc.present++;
      const center = magnitude(vector(own(rtc, 'center'), 3));
      if (center === null) this.data.cesiumRtc.invalidCenter++;
      else this.data.cesiumRtc.maxCenterMagnitudeM = Math.max(this.data.cesiumRtc.maxCenterMagnitudeM, center);
    }
    for (const node of this.limited(own(metadata, 'nodes'))) {
      this.data.nodesObserved++;
      const translation = own(node, 'translation');
      if (translation !== undefined) this.maxMagnitude(vector(translation, 3), result => { this.data.maxNodeTranslationMagnitudeM = Math.max(this.data.maxNodeTranslationMagnitudeM, result); });
      const rawMatrix = own(node, 'matrix');
      const matrix = rawMatrix === undefined ? null : vector(rawMatrix, 16);
      if (rawMatrix !== undefined) this.maxMagnitude(matrix?.slice(12, 15) ?? null, result => { this.data.maxNodeTranslationMagnitudeM = Math.max(this.data.maxNodeTranslationMagnitudeM, result); });
      const scale = own(node, 'scale');
      const numericScale = scale === undefined ? null : vector(scale, 3);
      if (numericScale?.some(value => Math.abs(Math.abs(value) - 1) > 1e-6) || (matrix && nonUnitMatrix(matrix))) this.data.nonUnitNodeScale++;
      else if (scale !== undefined && !numericScale) this.data.invalidNumericValues++;
    }
    for (const resource of this.limited(own(metadata, 'buffers'))) {
      const uri = own(resource, 'uri');
      this.data.buffers[uri === undefined || (typeof uri === 'string' && /^data:/i.test(uri)) ? 'embedded' : 'external']++;
    }
    for (const resource of this.limited(own(metadata, 'images'))) {
      const uri = own(resource, 'uri');
      this.data.images[typeof uri === 'string' ? /^data:/i.test(uri) ? 'embedded' : 'external' : own(resource, 'bufferView') !== undefined ? 'embedded' : 'unspecified']++;
    }
    const accessors = array(own(metadata, 'accessors'));
    let primitiveBudget = LIMIT;
    for (const mesh of this.limited(own(metadata, 'meshes'))) {
      for (const primitive of this.limited(own(mesh, 'primitives'))) {
        if (--primitiveBudget < 0) { this.data.inspectionLimitReached = true; break; }
        const mode = own(primitive, 'mode');
        this.data.primitiveModes[mode === undefined ? 'TRIANGLES' : typeof mode === 'number' && Number.isInteger(mode) && mode >= 0 && mode <= 6 ? MODES[mode] : 'unknown']++;
        const position = own(own(primitive, 'attributes'), 'POSITION');
        const component = typeof position === 'number' && Number.isSafeInteger(position) && position >= 0 && position < accessors.length ? own(accessors[position], 'componentType') : undefined;
        this.data.positionComponents[typeof component === 'number' ? componentNames[component] ?? 'unknown' : 'unknown']++;
      }
      if (primitiveBudget < 0) break;
    }
  }
  snapshot() { return structuredClone(this.data); }
}

/** Passive inspection hook: returning null preserves the official parser and all loader behavior. */
export function structuralProfilePlugin(profile: StructuralProfile) {
  return {
    name: 'READ_ONLY_STRUCTURAL_PROFILE',
    preprocessNode(tile: object) { profile.observeTile(tile); },
    parseTile(buffer: unknown, tile: object, extension: string) {
      if (buffer instanceof ArrayBuffer || ArrayBuffer.isView(buffer)) profile.observeBuffer(tile, buffer, extension);
      return null;
    },
  };
}
