import { Color3, DirectionalLight, Engine, HemisphericLight, MeshBuilder, PBRMaterial, Scene, ShadowGenerator, UniversalCamera, Vector3, WebGPUEngine } from '@babylonjs/core';
import { Sky } from '../../src/core/Sky';

const query = new URLSearchParams(location.search), canvas = document.querySelector<HTMLCanvasElement>('#sky')!;
const engine = query.get('backend') === 'webgpu' ? new WebGPUEngine(canvas, { antialias: true }) : new Engine(canvas, true);
if (engine instanceof WebGPUEngine) await engine.initAsync();
const scene = new Scene(engine), sky = new Sky(scene);
const camera = new UniversalCamera('observer', new Vector3(0, 2, 0), scene); camera.maxZ = 1500; camera.minZ = .1;
camera.setTarget(new Vector3(-30, 8, -20));
const sun = new DirectionalLight('sun', Vector3.Down(), scene), fill = new HemisphericLight('fill', Vector3.Up(), scene);
const shadows = new ShadowGenerator(1024, sun); shadows.usePercentageCloserFiltering = true;
const floorMaterial = new PBRMaterial('ground', scene); floorMaterial.albedoColor = new Color3(.29, .31, .28); floorMaterial.roughness = .95; floorMaterial.metallic = 0;
const ground = MeshBuilder.CreateGround('ground', { width: 2000, height: 2000 }, scene); ground.material = floorMaterial; ground.receiveShadows = true;
const wallMaterial = new PBRMaterial('facades', scene); wallMaterial.albedoColor = new Color3(.72, .62, .49); wallMaterial.roughness = .9; wallMaterial.metallic = 0;
for (const [i, x] of [-20, -5, 12, 28, 47].entries()) {
  const building = MeshBuilder.CreateBox(`scale-building-${i}`, { width: 10, depth: 12, height: 4 + i * 2 }, scene); building.position.set(x, (4 + i * 2) / 2, -65 - i * 8); building.material = wallMaterial; building.receiveShadows = true; shadows.addShadowCaster(building);
}
const sample = MeshBuilder.CreateSphere('pbr-reference', { diameter: 3, segments: 32 }, scene); sample.position.set(-8, 1.5, -9); sample.material = wallMaterial; sample.receiveShadows = true; shadows.addShadowCaster(sample);
scene.imageProcessingConfiguration.toneMappingEnabled = true; scene.imageProcessingConfiguration.toneMappingType = 1; scene.imageProcessingConfiguration.exposure = 1.05;
function show(time: number, weather = 'Clear', view = 'sunset') {
  const state = sky.update(time, weather); sun.direction.copyFrom(state.sunDirection).negateInPlace(); sun.position.copyFrom(sun.direction.scale(-100)); sun.intensity = state.daylight * 2.6; sun.diffuse = Color3.Lerp(new Color3(1, .6, .4), new Color3(1, .95, .85), state.daylight);
  fill.intensity = .035 + state.daylight * .4;
  if (view === 'sun') camera.setTarget(camera.position.add(state.sunDirection.scale(100)));
  else camera.setTarget(new Vector3(-30, 8, -20));
  document.querySelector('#label')!.textContent = `${String(Math.floor(time)).padStart(2, '0')}:${String(Math.round(time % 1 * 60)).padStart(2, '0')} · ${weather} · ${engine instanceof WebGPUEngine ? 'WebGPU' : 'WebGL2'} · Babylon SkyMaterial`;
  return { time, weather, sun: state.sunDirection.asArray(), night: state.night, daylight: state.daylight, stats: sky.stats };
}
show(Number(query.get('time') || 17.8), query.get('weather') || 'Clear');
engine.runRenderLoop(() => scene.render());
window.addEventListener('resize', () => engine.resize());
(window as unknown as { skyStudy: unknown }).skyStudy = { show, snapshot: () => ({ meshes: scene.meshes.length, materials: scene.materials.length, textures: scene.textures.length, cumulativeDrawCalls: engine._drawCalls.current, sky: sky.stats, backend: engine instanceof WebGPUEngine ? 'WebGPU' : 'WebGL2' }) };
