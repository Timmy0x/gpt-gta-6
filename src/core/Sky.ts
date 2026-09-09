import { Color3, Constants, Mesh, MeshBuilder, StandardMaterial, Vector3, VertexData, type Observer, type Scene } from '@babylonjs/core';
import { SkyMaterial } from '@babylonjs/materials/sky/skyMaterial.js';

export interface SkyState {
  /** Direction from the observer to the solar disk; negate for DirectionalLight.direction. */
  sunDirection: Vector3;
  daylight: number;
  night: number;
  horizonColor: Color3;
}
const SKY_COLORS = {
  clear: new Color3(.56, .7, .8), haze: new Color3(.64, .65, .62), rain: new Color3(.36, .4, .43),
  twilight: new Color3(.46, .32, .28), night: new Color3(.018, .027, .048),
};

/** Authored equinox-like 06:00–18:00 solar arc; project decision, not a geographic ephemeris. */
export function skyState(time: number, weather = 'Clear'): SkyState {
  return updateSkyState(time, weather, { sunDirection: Vector3.Zero(), daylight: 0, night: 0, horizonColor: Color3.Black() });
}
function updateSkyState(time: number, weather: string, result: SkyState): SkyState {
  const hours = Number.isFinite(time) ? ((time % 24) + 24) % 24 : 12;
  const angle = (hours - 6) / 12 * Math.PI, elevation = Math.sin(angle);
  result.sunDirection.set(Math.cos(angle), elevation, elevation * -.35).normalize();
  result.daylight = Math.max(0, elevation); result.night = Math.max(0, Math.min(1, (-elevation - .025) / .2));
  const day = weather === 'Rain' ? SKY_COLORS.rain : weather === 'Haze' ? SKY_COLORS.haze : SKY_COLORS.clear;
  Color3.LerpToRef(SKY_COLORS.twilight, day, Math.min(1, result.daylight * 3), result.horizonColor);
  Color3.LerpToRef(result.horizonColor, SKY_COLORS.night, result.night, result.horizonColor);
  return result;
}

/**
 * Native Babylon Rayleigh/Mie scattering with a small, seeded night star field.
 * Construct immediately after Scene, before world materials, so its depth-free
 * opaque background precedes geometry in Babylon's material-sorted render queue.
 */
export class Sky {
  readonly material: SkyMaterial;
  readonly mesh: Mesh;
  readonly stars: Mesh;
  private readonly starMaterial: StandardMaterial;
  private readonly observer: Observer<Scene>;
  private disposed = false;
  private state = skyState(12);

  constructor(private readonly scene: Scene) {
    this.material = new SkyMaterial('sky/atmospheric-scattering', scene);
    this.material.backFaceCulling = false;
    this.material.disableDepthWrite = true;
    this.material.fogEnabled = false;
    this.material.useSunPosition = true;
    this.material.dithering = true;
    this.material.luminance = .9;
    this.material.rayleigh = 2.15;
    this.material.mieDirectionalG = .82;
    this.mesh = MeshBuilder.CreateBox('sky/dome', { size: 1000 }, scene);
    this.mesh.material = this.material;
    this.mesh.infiniteDistance = true;
    this.mesh.isPickable = false;
    this.mesh.applyFog = false;
    this.mesh.alwaysSelectAsActiveMesh = true;
    this.mesh.metadata = { sky: true };

    this.starMaterial = new StandardMaterial('sky/starlight', scene);
    this.starMaterial.disableLighting = true;
    this.starMaterial.emissiveColor.set(.85, .89, 1);
    this.starMaterial.diffuseColor.set(0, 0, 0);
    this.starMaterial.specularColor.set(0, 0, 0);
    this.starMaterial.backFaceCulling = false;
    this.starMaterial.disableDepthWrite = true;
    this.starMaterial.fogEnabled = false;
    this.starMaterial.alphaMode = Constants.ALPHA_ADD;
    this.starMaterial.alpha = .999;
    this.stars = new Mesh('sky/stars', scene);
    const positions: number[] = [], colors: number[] = [], indices: number[] = [];
    let seed = 73129;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    for (let i = 0; i < 160; i++) {
      const azimuth = random() * Math.PI * 2, height = .08 + random() * .9, radial = Math.sqrt(1 - height * height);
      const center = new Vector3(Math.cos(azimuth) * radial, height, Math.sin(azimuth) * radial);
      const right = Vector3.Cross(center, Vector3.Up()).normalize(), up = Vector3.Cross(right, center).normalize();
      const size = .00075 + random() * .00065, brightness = .6 + random() * .4;
      for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        positions.push(...center.add(right.scale(x * size)).add(up.scale(y * size)).asArray());
        colors.push(brightness, brightness * .96, brightness * .9, 1);
      }
      const base = i * 4; indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    const data = new VertexData(); data.positions = positions; data.colors = colors; data.indices = indices;
    data.normals = []; VertexData.ComputeNormals(positions, indices, data.normals); data.applyToMesh(this.stars);
    this.stars.material = this.starMaterial;
    this.stars.infiniteDistance = true;
    this.stars.isPickable = false;
    this.stars.applyFog = false;
    this.stars.alwaysSelectAsActiveMesh = true;
    this.stars.metadata = { sky: true };
    this.observer = scene.onBeforeRenderObservable.add(() => {
      const far = scene.activeCamera?.maxZ ?? 1500;
      // Keep background vertices within the actual far plane and stars behind visible scenery.
      this.mesh.scaling.setAll(far * .55 / 1000);
      this.stars.scaling.setAll(far * .98);
    });
    this.update(12);
  }

  /** Call after time/weather changes. Returned light direction and horizon color share this solar state. */
  update(time: number, weather = 'Clear'): SkyState {
    updateSkyState(time, weather, this.state);
    const haze = weather === 'Haze', rain = weather === 'Rain';
    this.material.sunPosition.copyFrom(this.state.sunDirection).scaleInPlace(450000);
    this.material.turbidity = rain ? 18 : haze ? 10 : 3.8;
    this.material.mieCoefficient = rain ? .035 : haze ? .012 : .0038;
    this.material.rayleigh = rain ? 1.4 : 2.15;
    this.material.luminance = (rain ? 1 : .9) - this.state.night * .55;
    this.starMaterial.alpha = this.state.night * (rain ? 0 : haze ? .18 : .8);
    this.stars.setEnabled(this.starMaterial.alpha > .001);
    return this.state;
  }

  get stats() { return { meshes: 2, triangles: 332, textures: 0, visibleStars: this.stars.isEnabled() ? 160 : 0 }; }

  dispose(): void {
    if (this.disposed) return; this.disposed = true;
    this.observer.remove();
    this.mesh.dispose(); this.stars.dispose(); this.material.dispose(); this.starMaterial.dispose();
  }
}
