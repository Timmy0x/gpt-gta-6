import { Color3, Color4, Material, Mesh, Plane, RawTexture, StandardMaterial, Texture, Vector2, Vector3, VertexBuffer, VertexData, type AbstractMesh, type Camera, type Observer, type Scene } from '@babylonjs/core';
import type { BoundsXZ } from './ChunkResidency';
import { Underwater } from './Underwater';
import { OceanWaterMaterial } from './OceanWaterMaterial';

export interface OceanOptions {
  /** Mean physical surface; native visual swell stays within 4 cm above it. */
  waterLevel?: number;
  shorelineX?: number;
  bounds?: BoundsXZ;
  /** Supply the same bathymetry used by physical seabed collision. */
  floorHeightAt?: (x: number, z: number) => number;
}
export const OCEAN_LIMITS = { targetSize: 512, refreshRate: 2, reflectionMeshes: 32, refractionMeshes: 16, reflectionTriangles: 80000, refractionTriangles: 40000, candidateRadius: 720 } as const;
const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const hash = (x: number, y: number, seed = 31) => { let n = Math.imul(x + 19, 374761393) ^ Math.imul(y + 41, 668265263) ^ seed; n = Math.imul(n ^ n >>> 13, 1274126177); return ((n ^ n >>> 16) >>> 0) / 4294967296; };

/** Original periodic normal field: crossed wind ripples, no downloaded imagery. */
export function oceanNormalPixels(size = 256): Uint8Array {
  const pixels = new Uint8Array(size * size * 4);
  const waves = [[2, 3, .32, .6], [5, -2, .13, 2.1], [9, 4, .055, 4.2], [13, -7, .025, 1.3], [3, 11, .045, 3.1]];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let dx = 0, dz = 0;
    for (const [kx, kz, strength, phase] of waves) {
      const derivative = Math.cos((x * kx + y * kz) / size * Math.PI * 2 + phase) * strength;
      dx += derivative * kx / Math.hypot(kx, kz); dz += derivative * kz / Math.hypot(kx, kz);
    }
    const length = Math.hypot(dx, dz, 1), index = (y * size + x) * 4;
    pixels[index] = Math.round((.5 - dx / length * .5) * 255); pixels[index + 1] = Math.round((.5 - dz / length * .5) * 255); pixels[index + 2] = Math.round((.5 + .5 / length) * 255); pixels[index + 3] = 255;
  }
  return pixels;
}
function foamPixels(size = 128): Uint8Array {
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size * 8, v = y / size * 8;
    let nearest = Infinity, second = Infinity;
    for (let cy = Math.floor(v) - 1; cy <= Math.floor(v) + 1; cy++) for (let cx = Math.floor(u) - 1; cx <= Math.floor(u) + 1; cx++) {
      const distance = Math.hypot(u - cx - hash(cx, cy), v - cy - hash(cx, cy, 71));
      if (distance < nearest) { second = nearest; nearest = distance; } else second = Math.min(second, distance);
    }
    const edge = clamp((.15 - (second - nearest)) / .13);
    const envelope = Math.pow(Math.max(0, Math.sin(Math.PI * x / size) * Math.sin(Math.PI * y / size)), .45);
    const breakup = clamp((Math.sin(u * 1.8 + Math.sin(v * 1.3)) + Math.cos(v * 2.1 - u * .6) + 1.1) * .6);
    const index = (y * size + x) * 4; pixels[index] = 230; pixels[index + 1] = 242; pixels[index + 2] = 237; pixels[index + 3] = Math.round(edge * envelope * breakup * 255);
  }
  return pixels;
}

/** Native WaterMaterial presentation; physical water/shore containment stays explicit. */
export class Ocean {
  readonly material: OceanWaterMaterial;
  readonly mesh: Mesh;
  readonly foam: Mesh;
  readonly waterLevel: number;
  readonly shorelineX: number;
  readonly bounds: BoundsXZ;
  private readonly normal: RawTexture;
  private readonly foamTexture: RawTexture;
  private readonly foamMaterial: StandardMaterial;
  private readonly clockObserver: Observer<Mesh>;
  private readonly cameraObserver: Observer<Camera>;
  private readonly extinction: Underwater;
  private readonly floorHeightAt: (x: number, z: number) => number;
  private readonly foamPositions: Float32Array;
  private readonly foamColors: Float32Array;
  private readonly foamPatches: { z: number; length: number; width: number; phase: number }[] = [];
  private elapsed = 0;
  private selectionClock = 1;
  private disposed = false;
  private sources: readonly AbstractMesh[] | undefined;
  private submerged = false;
  private daylight = 1;
  private atmosphericFog = { density: .00125, color: new Color3(.56, .7, .8) };

  constructor(private readonly scene: Scene, options: OceanOptions = {}) {
    this.waterLevel = options.waterLevel ?? -.18; this.shorelineX = options.shorelineX ?? 210;
    this.bounds = { minX: this.shorelineX, maxX: 14210, minZ: -9000, maxZ: 9000, ...options.bounds };
    if (!Number.isFinite(this.waterLevel) || !Number.isFinite(this.shorelineX) || Object.values(this.bounds).some(value => !Number.isFinite(value)) || this.bounds.maxX <= this.bounds.minX || this.bounds.maxZ <= this.bounds.minZ || this.bounds.minX < this.shorelineX) throw new Error('Ocean needs finite non-empty bounds east of its shoreline');
    this.floorHeightAt = options.floorHeightAt ?? ((x: number) => this.waterLevel - Math.min(80, .12 + Math.max(0, x - this.shorelineX) * .065));
    this.material = new OceanWaterMaterial('ocean/native-water', scene, new Vector2(OCEAN_LIMITS.targetSize, OCEAN_LIMITS.targetSize));
    this.material.backFaceCulling = false;
    this.material.fresnelSeparate = false; this.material.bumpSuperimpose = true; this.material.bumpAffectsReflection = true;
    this.material.useWorldCoordinatesForWaveDeformation = true;
    this.material.windDirection.set(.93, .36); this.material.windDirection.normalize();
    this.material.windForce = 2.4; this.material.waveLength = 1; this.material.waveCount = .055; this.material.waveSpeed = 16; this.material.waveHeight = .004;
    this.material.bumpHeight = .07; this.material.waterColor.set(.025, .22, .25); this.material.waterColor2.set(.02, .1, .16);
    this.material.colorBlendFactor = .25; this.material.colorBlendFactor2 = .12;
    this.material.specularColor.set(.72, .78, .8); this.material.specularPower = 196; this.material.maxSimultaneousLights = 2;
    this.normal = RawTexture.CreateRGBATexture(oceanNormalPixels(), 256, 256, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
    this.normal.name = 'ocean/original-crossed-ripple-normal'; this.normal.gammaSpace = false; this.normal.wrapU = this.normal.wrapV = Texture.WRAP_ADDRESSMODE; this.normal.anisotropicFilteringLevel = 4;
    this.material.bumpTexture = this.normal;
    for (const target of [this.material.reflectionTexture!, this.material.refractionTexture!]) {
      target.renderList = []; target.refreshRate = OCEAN_LIMITS.refreshRate; target.samples = 1; target.renderParticles = false; target.renderSprites = false;
    }
    this.material.reflectionTexture!.name = 'ocean/reflection-512'; this.material.refractionTexture!.name = 'ocean/refraction-512';
    this.material.reflectionTexture!.clearColor = new Color4(.32, .54, .67, 1);
    this.material.refractionTexture!.clearColor = new Color4(.02, .11, .145, 1);
    // Keep Babylon's native mirror transform and visibility restoration. Its default
    // clip planes assume the camera is above the surface, so override ONLY which
    // half-space is retained after the native before-render callback has run.
    this.material.reflectionTexture!.onBeforeRenderObservable.add(() => {
      if (this.submerged) scene.clipPlane = Plane.FromPositionAndNormal(new Vector3(0, this.waterLevel - .05, 0), Vector3.Up());
    });
    let airPassFog: { density: number; color: Color3 } | undefined;
    this.material.refractionTexture!.onBeforeRenderObservable.add(() => {
      if (!this.submerged) return;
      scene.clipPlane = Plane.FromPositionAndNormal(new Vector3(0, this.waterLevel + .05, 0), Vector3.Down());
      // Above-surface geometry lies in air; main underwater fog belongs to the
      // eye-to-surface segment, which the native water shader applies afterwards.
      airPassFog = { density: scene.fogDensity, color: scene.fogColor.clone() };
      scene.fogDensity = this.atmosphericFog.density; scene.fogColor.copyFrom(this.atmosphericFog.color);
    });
    this.material.refractionTexture!.onAfterRenderObservable.add(() => {
      if (airPassFog) { scene.fogDensity = airPassFog.density; scene.fogColor.copyFrom(airPassFog.color); airPassFog = undefined; }
    });
    // Native9.25 advances _lastTime only when deltaTime differs. Use its public
    // onBind/effect API so fixed-rate frames still animate the exact native shader.
    this.clockObserver = this.material.onBindObservable.add(() => {
      const effect = this.material.getEffect(); if (!effect) return;
      effect.setFloat('time', this.elapsed / 100);
      const eye = scene.bindEyePosition(effect), offset = scene.floatingOriginOffset;
      effect.setFloat3('cameraPosition', eye.x - offset.x, eye.y - offset.y, eye.z - offset.z);
    });
    this.mesh = new Mesh('ocean/surface', scene);
    const positions: number[] = [], normals: number[] = [], uv: number[] = [], indices: number[] = [];
    const columns = 48, rows = 384, width = this.bounds.maxX - this.bounds.minX, depth = this.bounds.maxZ - this.bounds.minZ;
    for (let row = 0; row <= rows; row++) for (let column = 0; column <= columns; column++) {
      const t = column / columns, x = this.bounds.minX + width * t * t * t, z = this.bounds.minZ + depth * row / rows;
      positions.push(x, 0, z); normals.push(0, 1, 0); uv.push(x / 5, z / 5);
    }
    for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) { const a = row * (columns + 1) + column, b = a + columns + 1; indices.push(a, a + 1, b, a + 1, b + 1, b); }
    const data = new VertexData(); data.positions = positions; data.normals = normals; data.uvs = uv; data.indices = indices; data.applyToMesh(this.mesh);
    this.mesh.position.y = this.waterLevel; this.mesh.material = this.material; this.mesh.isPickable = false; this.mesh.metadata = { ocean: true }; this.mesh.receiveShadows = true;

    this.foam = new Mesh('ocean/broken-shore-foam', scene);
    for (let z = this.bounds.minZ + 16; z < this.bounds.maxZ - 16; z += 22) this.foamPatches.push({ z: z + hash(17, Math.floor(z)) * 9, length: 7 + hash(31, Math.floor(z)) * 12, width: .7 + hash(49, Math.floor(z)) * 1.2, phase: hash(79, Math.floor(z)) * Math.PI * 2 });
    this.foamPositions = new Float32Array(this.foamPatches.length * 12); this.foamColors = new Float32Array(this.foamPatches.length * 16);
    const foamNormals: number[] = [], foamUV: number[] = [], foamIndices: number[] = [];
    for (let patch = 0; patch < this.foamPatches.length; patch++) { const aspect = this.foamPatches[patch].length / this.foamPatches[patch].width; foamNormals.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0); foamUV.push(0, 0, 1, 0, 1, aspect, 0, aspect); const a = patch * 4; foamIndices.push(a, a + 1, a + 2, a, a + 2, a + 3); }
    this.updateFoam();
    const foamData = new VertexData(); foamData.positions = this.foamPositions; foamData.colors = this.foamColors; foamData.normals = foamNormals; foamData.uvs = foamUV; foamData.indices = foamIndices; foamData.applyToMesh(this.foam, true);
    this.foamTexture = RawTexture.CreateRGBATexture(foamPixels(), 128, 128, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
    this.foamTexture.name = 'ocean/original-cellular-foam'; this.foamTexture.hasAlpha = true; this.foamTexture.wrapV = Texture.WRAP_ADDRESSMODE;
    this.foamMaterial = new StandardMaterial('ocean/foam', scene); this.foamMaterial.diffuseTexture = this.foamTexture; this.foamMaterial.useAlphaFromDiffuseTexture = true; this.foamMaterial.alpha = .55; this.foamMaterial.specularColor.setAll(0); this.foamMaterial.emissiveColor.setAll(.025); this.foamMaterial.backFaceCulling = false; this.foamMaterial.disableDepthWrite = true; this.foamMaterial.transparencyMode = Material.MATERIAL_ALPHABLEND;
    this.foam.material = this.foamMaterial; this.foam.isPickable = false; this.foam.metadata = { ocean: true }; this.foam.alwaysSelectAsActiveMesh = true;
    this.extinction = new Underwater(scene);
    // This event follows the camera's render interpolation and precedes its material
    // RTTs, so a surface crossing cannot leave the targets on the previous medium.
    this.cameraObserver = scene.onBeforeCameraRenderObservable.add(camera => this.prepareView(camera));
  }

  contains(x: number, z: number): boolean { return Number.isFinite(x) && Number.isFinite(z) && x >= this.bounds.minX && x <= this.bounds.maxX && z >= this.bounds.minZ && z <= this.bounds.maxZ; }
  surfaceHeight(x: number, z: number): number | null { return this.contains(x, z) ? this.waterLevel : null; }
  depthAt(x: number, z: number): number { if (!this.contains(x, z)) return 0; const floor = this.floorHeightAt(x, z); return Number.isFinite(floor) ? Math.max(0, this.waterLevel - floor) : 0; }
  setRenderSources(meshes: readonly AbstractMesh[] | undefined): void { this.sources = meshes; this.selectionClock = 1; }
  /** Call with the atmospheric fog immediately BEFORE main switches to underwater fog. */
  setAtmosphericFog(density: number, color: Color3): void {
    if (Number.isFinite(density) && density >= 0 && color.asArray().every(Number.isFinite)) {
      this.atmosphericFog.density = density; this.atmosphericFog.color.copyFrom(color);
    }
  }
  update(dt: number, position: Vector3, weather = 'Clear', daylight = 1): void {
    if (this.disposed) return;
    const step = Number.isFinite(dt) ? clamp(dt, 0, .1) : 0; this.elapsed += step; this.selectionClock += step;
    const rain = weather.toLowerCase() === 'rain';
    this.material.bumpHeight = rain ? .095 : .07; this.material.windForce = rain ? 3.8 : 2.4; this.material.waveHeight = rain ? .006 : .004;
    this.foamMaterial.alpha = rain ? .65 : .55; this.foamMaterial.emissiveColor.setAll(.003 + clamp(daylight) * .022);
    this.daylight = clamp(daylight); this.updateTargetColors();
    this.updateFoam(); this.foam.updateVerticesData(VertexBuffer.PositionKind, this.foamPositions, false, false); this.foam.updateVerticesData(VertexBuffer.ColorKind, this.foamColors, false, false);
    if (this.selectionClock >= .5) { this.selectionClock = 0; this.selectRenderSources(position); }
  }
  private prepareView(camera: Camera): void {
    const position = camera.globalPosition, submerged = position.y < this.waterLevel - .03 && this.contains(position.x, position.z) && this.depthAt(position.x, position.z) > 0;
    this.extinction.update(camera, submerged);
    if (submerged !== this.submerged) {
      this.submerged = submerged;
      // The default native branch uses max(dot(view,+Y),0), which becomes pure
      // above-water reflection below the surface. The scoped separate branch uses
      // dielectric Fresnel/TIR instead of the native hard-capped transmission.
      this.material.fresnelSeparate = submerged;
      this.selectRenderSources(position);
      this.material.reflectionTexture!.resetRefreshCounter(); this.material.refractionTexture!.resetRefreshCounter();
    }
    this.updateTargetColors();
  }
  private updateTargetColors(): void {
    const sky = this.daylight;
    const above = this.submerged ? this.material.refractionTexture! : this.material.reflectionTexture!;
    const below = this.submerged ? this.material.reflectionTexture! : this.material.refractionTexture!;
    above.clearColor.set(.012 + sky * .308, .024 + sky * .516, .043 + sky * .627, 1);
    if (this.submerged) below.clearColor.set(this.scene.fogColor.r, this.scene.fogColor.g, this.scene.fogColor.b, 1);
    else below.clearColor.set(.008 + sky * .012, .025 + sky * .085, .034 + sky * .111, 1);
  }
  private updateFoam(): void {
    for (let i = 0; i < this.foamPatches.length; i++) {
      const patch = this.foamPatches[i], phase = this.elapsed * .7 + patch.phase, drift = 1.4 + Math.sin(phase) * .65, alpha = .12 + .7 * Math.pow(Math.max(0, Math.sin(phase)), 2);
      for (let vertex = 0; vertex < 4; vertex++) {
        const right = vertex === 1 || vertex === 2, top = vertex >= 2, index = i * 12 + vertex * 3;
        this.foamPositions[index] = this.shorelineX + drift + (right ? patch.width : 0) + (top ? .4 : -.4) * Math.sin(patch.phase);
        this.foamPositions[index + 1] = this.waterLevel + .045; this.foamPositions[index + 2] = patch.z + (top ? .5 : -.5) * patch.length;
        const color = i * 16 + vertex * 4; this.foamColors[color] = this.foamColors[color + 1] = this.foamColors[color + 2] = 1; this.foamColors[color + 3] = alpha;
      }
    }
  }
  private selectRenderSources(position: Vector3): void {
    const candidates = (this.sources ?? this.scene.meshes).filter(mesh => !mesh.isDisposed() && mesh.isEnabled() && mesh.isVisible && !mesh.metadata?.ocean && !/ocean-water|shallows|foam|rain/i.test(mesh.material?.name ?? '') && mesh.getTotalVertices() > 0).map(mesh => {
      const box = mesh.getBoundingInfo().boundingBox, dx = Math.max(0, box.minimumWorld.x - position.x, position.x - box.maximumWorld.x), dz = Math.max(0, box.minimumWorld.z - position.z, position.z - box.maximumWorld.z);
      return { mesh, distance: Math.hypot(dx, dz), minY: box.minimumWorld.y, maxY: box.maximumWorld.y, triangles: mesh.getTotalIndices() / 3 };
    }).filter(candidate => candidate.mesh.metadata?.sky || candidate.distance < OCEAN_LIMITS.candidateRadius).sort((a, b) => Number(!!b.mesh.metadata?.sky) - Number(!!a.mesh.metadata?.sky) || a.distance - b.distance);
    const reflection: AbstractMesh[] = [], refraction: AbstractMesh[] = []; let reflectionTriangles = 0, refractionTriangles = 0;
    for (const candidate of candidates) {
      const above = candidate.maxY >= this.waterLevel || candidate.mesh.metadata?.sky;
      const below = !candidate.mesh.metadata?.sky && candidate.minY < this.waterLevel;
      if ((this.submerged ? below : above) && reflection.length < OCEAN_LIMITS.reflectionMeshes && reflectionTriangles + candidate.triangles <= OCEAN_LIMITS.reflectionTriangles) { reflection.push(candidate.mesh); reflectionTriangles += candidate.triangles; }
      if ((this.submerged ? above : below) && refraction.length < OCEAN_LIMITS.refractionMeshes && refractionTriangles + candidate.triangles <= OCEAN_LIMITS.refractionTriangles) { refraction.push(candidate.mesh); refractionTriangles += candidate.triangles; }
    }
    this.material.reflectionTexture!.renderList = reflection; this.material.refractionTexture!.renderList = refraction;
  }
  get stats() { return { meshes: 3, materials: 3, triangles: this.mesh.getTotalIndices() / 3 + this.foam.getTotalIndices() / 3 + this.extinction.mesh.getTotalIndices() / 3, targets: 2, targetSize: OCEAN_LIMITS.targetSize, refreshRate: OCEAN_LIMITS.refreshRate, reflectionMeshes: this.material.reflectionTexture?.renderList?.length ?? 0, refractionMeshes: this.material.refractionTexture?.renderList?.length ?? 0, submergedView: this.submerged, foamPatches: this.foamPatches.length, elapsed: this.elapsed }; }
  dispose(): void {
    if (this.disposed) return; this.disposed = true; this.clockObserver.remove(); this.cameraObserver.remove(); this.extinction.dispose(); this.mesh.dispose(); this.foam.dispose(); this.material.dispose(); this.foamMaterial.dispose(); this.foamTexture.dispose();
  }
}
