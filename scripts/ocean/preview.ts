import { Color3, DirectionalLight, Engine, HemisphericLight, Mesh, MeshBuilder, PBRMaterial, Scene, Texture, UniversalCamera, Vector3, VertexData, WebGPUEngine } from '@babylonjs/core';
import { Sky } from '../../src/core/Sky';
import { Ocean } from '../../src/world/Ocean';

const query = new URLSearchParams(location.search), canvas = document.querySelector<HTMLCanvasElement>('#ocean')!;
const engine = query.get('backend') === 'webgpu' ? new WebGPUEngine(canvas, { antialias: true }) : new Engine(canvas, true);
if (engine instanceof WebGPUEngine) await engine.initAsync();
const scene = new Scene(engine), sky = new Sky(scene);
const camera = new UniversalCamera('observer', new Vector3(202, 2.3, -18), scene); camera.maxZ = 1800; camera.minZ = .05;
const sun = new DirectionalLight('sun', Vector3.Down(), scene), fill = new HemisphericLight('fill', Vector3.Up(), scene);
scene.imageProcessingConfiguration.toneMappingEnabled = true; scene.imageProcessingConfiguration.toneMappingType = 1; scene.imageProcessingConfiguration.exposure = 1.05;
scene.fogMode = Scene.FOGMODE_EXP2; scene.fogDensity = .0007;
const sand = new PBRMaterial('study/sand', scene); sand.albedoColor = Color3.White(); sand.roughness = .97; sand.metallic = 0; sand.albedoTexture = new Texture('/surfaces/dense_sand/color.jpg', scene);
const bed = new Mesh('study/continuous-sand-bank', scene), positions: number[] = [], indices: number[] = [], normals: number[] = [], uvs: number[] = [];
const columns = [100, 180, 202, 210, 230, 270, 350, 600, 1000], zs = [-1500, 1500];
const floorHeight = (x: number) => x <= 202 ? .06 : x <= 210 ? .06 - (x - 202) * .0325 : -.2 - (x - 210) * .065;
for (const z of zs) for (const x of columns) { positions.push(x, floorHeight(x), z); uvs.push(x / 1.8, z / 1.8); }
for (let x = 0; x < columns.length - 1; x++) indices.push(x, x + 1, x + columns.length, x + 1, x + columns.length + 1, x + columns.length);
VertexData.ComputeNormals(positions, indices, normals); const bedData = new VertexData(); bedData.positions = positions; bedData.indices = indices; bedData.normals = normals; bedData.uvs = uvs; bedData.applyToMesh(bed); bed.material = sand;
const wall = new PBRMaterial('study/shore-building', scene); wall.albedoColor = new Color3(.62, .42, .28); wall.roughness = .82; wall.metallic = 0;
for (let i = 0; i < 5; i++) { const block = MeshBuilder.CreateBox(`shore-building-${i}`, { width: 14, depth: 15, height: 10 + i * 5 }, scene); block.position.set(162, (10 + i * 5) / 2 + .06, -75 + i * 35); block.material = wall; }
const pier = MeshBuilder.CreateBox('study/pier', { width: 55, depth: 4, height: .35 }, scene); pier.position.set(224, 1.6, 16); pier.material = wall;
for (const x of [208, 225, 244]) for (const z of [14.5, 17.5]) { const post = MeshBuilder.CreateCylinder('study/pier-post', { diameter: .32, height: 5 }, scene); post.position.set(x, -.7, z); post.material = wall; }
const boat = MeshBuilder.CreateSphere('study/boat-scale', { diameter: 1, segments: 16 }, scene); boat.scaling.set(2.2, .7, 5.3); boat.position.set(238, -.08, -8); boat.material = wall;
const ocean = new Ocean(scene, { floorHeightAt: floorHeight });
let hour = 12, weather = 'Clear', elapsed = 0;
function show(time: number, condition = 'Clear', view = 'shore') {
  hour = time; weather = condition;
  if (view === 'reflection') { camera.position.set(250, .37, -26); camera.setTarget(new Vector3(173, 6, 8)); }
  else if (view === 'shallows') { camera.position.set(216, 3.8, -15); camera.setTarget(new Vector3(219, -.5, -11)); }
  else if (view === 'surface') { camera.position.set(233, .47, -16); camera.setTarget(new Vector3(270, -.03, 18)); }
  else if (view === 'underwater') { camera.position.set(258.109, -1.035, -34.984); camera.setTarget(new Vector3(258.109, -1.72, -30)); }
  else if (view === 'underwater-up') { camera.position.set(245, -1.35, -8); camera.setTarget(new Vector3(245, 12, 9)); }
  else if (view === 'zenith') { camera.position.set(245, -1.35, -8); camera.setTarget(new Vector3(245, 12, -7)); }
  else if (view === 'underwater-shore') { camera.position.set(232, -1, -12); camera.setTarget(new Vector3(210, 4, 12)); }
  else if (view === 'deep') { camera.position.set(280, -3.5, -20); camera.setTarget(new Vector3(280, -2, 25)); }
  else { camera.position.set(204, 1.97, -26); camera.setTarget(new Vector3(248, -.13, 10)); }
  document.querySelector('#label')!.textContent = `${time.toFixed(1)}h · ${condition} · ${view} · ${engine instanceof WebGPUEngine ? 'WebGPU' : 'WebGL2'} · Native water study`;
}
show(12);
engine.runRenderLoop(() => {
  const dt = Math.min(.05, engine.getDeltaTime() / 1000); elapsed += dt; const state = sky.update(hour, weather);
  sun.direction.copyFrom(state.sunDirection).negateInPlace(); sun.intensity = state.daylight * 2.4; fill.intensity = .025 + state.daylight * .45;
  scene.fogDensity = weather === 'Rain' ? .003 : .00125; scene.fogColor.copyFrom(state.horizonColor);
  ocean.setAtmosphericFog(scene.fogDensity, scene.fogColor);
  if (camera.position.y < ocean.waterLevel - .03) { scene.fogDensity = .095; scene.fogColor.set(.025 + state.daylight * .03, .11 + state.daylight * .10, .14 + state.daylight * .10); }
  ocean.update(dt, camera.position, weather, state.daylight); scene.render();
});
const snapshot = () => ({ backend: engine instanceof WebGPUEngine ? 'WebGPU' : 'WebGL2', elapsed, stats: ocean.stats, meshes: scene.meshes.length, materials: scene.materials.length, textures: scene.textures.length, shaderLanguage: ocean.material.shaderLanguage, effectReady: ocean.mesh.subMeshes[0]?.effect?.isReady(), optics: ocean.material.opticsStats, dielectricShader: ocean.mesh.subMeshes[0]?.effect?.fragmentSourceCode.includes('oceanTransmission'), separateFresnel: ocean.material.fresnelSeparate, compiledSeparateFresnel: ocean.mesh.subMeshes[0]?.effect?.defines.includes('FRESNELSEPARATE'), reflection: ocean.material.reflectionTexture?.renderList?.map(mesh => mesh.name), refraction: ocean.material.refractionTexture?.renderList?.map(mesh => mesh.name), camera: camera.position.asArray(), physicalWater: ocean.surfaceHeight(230, 0), depth: ocean.depthAt(230, 0), nativeWaveHeight: ocean.material.waveHeight, renderTargets: [ocean.material.reflectionTexture, ocean.material.refractionTexture].map(target => ({ name: target?.name, size: target?.getSize(), refresh: target?.refreshRate, samples: target?.samples })) });
async function targetImages() {
  const result: Record<string, string> = {};
  for (const [name, target] of [['reflection', ocean.material.reflectionTexture!], ['refraction', ocean.material.refractionTexture!]] as const) {
    const pixels = await target.readPixels(); if (!pixels) continue;
    const { width, height } = target.getSize(), canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, pixels.byteLength), width, height), 0, 0);
    result[name] = canvas.toDataURL('image/png').split(',')[1];
  }
  return result;
}
(window as unknown as { oceanStudy: unknown }).oceanStudy = { show, snapshot, targetImages };
window.addEventListener('resize', () => engine.resize());
