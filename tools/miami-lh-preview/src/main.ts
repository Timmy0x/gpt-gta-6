import {
  ArcRotateCamera, Color3, Color4, DefaultRenderingPipeline, DirectionalLight, Engine,
  HavokPlugin, HemisphericLight, Matrix, MeshBuilder, Scene, StandardMaterial, Vector3,
  WebGPUEngine, type AbstractEngine, type PhysicsEngineV2,
} from '@babylonjs/core';
import HavokPhysics from '@babylonjs/havok';
import havokWasm from '@babylonjs/havok/lib/esm/HavokPhysics.wasm?url';
import glslangJS from '@babylonjs/core/assets/glslang/glslang.js?url';
import glslangWASM from '@babylonjs/core/assets/glslang/glslang.wasm?url';
import twgslJS from '@babylonjs/core/assets/twgsl/twgsl.js?url';
import twgslWASM from '@babylonjs/core/assets/twgsl/twgsl.wasm?url';
import { LHTilesRenderer } from './LHTilesRenderer';
import { createProofPhysics } from './ProofPhysics';
import './style.css';

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = element<HTMLCanvasElement>('canvas');
const state = element('state');
const backendControl = element<HTMLSelectElement>('backend');
const backend = new URLSearchParams(location.search).get('backend') === 'webgpu' ? 'webgpu' : 'webgl2';
backendControl.value = backend;
backendControl.addEventListener('change', () => {
  const url = new URL(location.href);
  url.searchParams.set('backend', backendControl.value);
  location.assign(url);
});

async function start() {
  let engine: AbstractEngine;
  if (backend === 'webgpu') {
    if (!(await WebGPUEngine.IsSupportedAsync)) throw new Error('WebGPU is unavailable in this browser. Select WebGL2 to run the explicit fallback.');
    const gpu = new WebGPUEngine(canvas, { antialias: true, adaptToDeviceRatio: false, powerPreference: 'high-performance' });
    try {
      await gpu.initAsync({ jsPath: glslangJS, wasmPath: glslangWASM }, { jsPath: twgslJS, wasmPath: twgslWASM });
    } catch (error) { gpu.dispose(); throw error; }
    engine = gpu;
  } else {
    const gl = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true, powerPreference: 'high-performance' }, false);
    if (gl.webGLVersion < 2) { gl.dispose(); throw new Error('This proof requires WebGL2.'); }
    engine = gl;
  }
  engine.setHardwareScalingLevel(1 / Math.min(devicePixelRatio, 1.5));
  const scene = new Scene(engine);
  scene.useRightHandedSystem = false;
  scene.clearColor = new Color4(.12, .19, .23, 1);
  const target = new Vector3(42.2, 9.05, 6.45);
  const camera = new ArcRotateCamera('shared-camera', -Math.PI / 2, Math.PI / 2.05, 7, target.clone(), scene);
  camera.attachControl(canvas, true);
  camera.minZ = .05;
  camera.maxZ = 500;
  camera.lowerRadiusLimit = 1.5;
  camera.upperRadiusLimit = 35;
  camera.lowerBetaLimit = .12;
  camera.upperBetaLimit = Math.PI / 2;
  camera.keysUp = []; camera.keysDown = []; camera.keysLeft = []; camera.keysRight = [];
  camera.panningSensibility = 0;
  camera.wheelPrecision = 45;
  camera.fov = 65 * Math.PI / 180;
  const ambient = new HemisphericLight('sky', Vector3.Up(), scene);
  ambient.intensity = .85;
  ambient.groundColor = new Color3(.34, .32, .29);
  const sun = new DirectionalLight('sun', new Vector3(-.6, -.8, .35), scene);
  sun.intensity = .9;
  const pipeline = new DefaultRenderingPipeline('cinematic', true, scene, [camera]);
  pipeline.fxaaEnabled = true;
  pipeline.samples = 1;
  pipeline.imageProcessingEnabled = true;
  pipeline.imageProcessing.toneMappingEnabled = true;
  pipeline.imageProcessing.exposure = 1.12;
  pipeline.imageProcessing.contrast = 1.1;
  pipeline.bloomEnabled = false;

  state.textContent = 'Loading original physics and tile fixture…';
  const havok = await HavokPhysics({ locateFile: () => havokWasm });
  scene.enablePhysics(new Vector3(0, -9.81, 0), new HavokPlugin(false, havok));
  const physics = scene.getPhysicsEngine() as PhysicsEngineV2;
  physics.setTimeStep(1 / 60);
  physics.setSubTimeStep(1000 / 60);
  const proof = createProofPhysics(scene);

  const panels = [
    { name: 'near-depth-panel', position: new Vector3(42.85, 9.1, 5.6), width: .6, height: 1.8, color: '#d9398c' },
    { name: 'far-depth-panel', position: new Vector3(42.45, 9.15, 8.2), width: 1.7, height: 1.8, color: '#41cbd3' },
  ].map(spec => {
    const mesh = MeshBuilder.CreateBox(spec.name, { width: spec.width, height: spec.height, depth: .15 }, scene);
    mesh.position.copyFrom(spec.position);
    const material = new StandardMaterial(`${spec.name}-material`, scene);
    material.diffuseColor = Color3.FromHexString(spec.color);
    material.specularColor = new Color3(.05, .05, .05);
    mesh.material = material;
    return mesh;
  });
  const lineSegments: Vector3[][] = [];
  for (let i = -10; i <= 10; i++) {
    lineSegments.push([new Vector3(42 + i, 8.252, -4), new Vector3(42 + i, 8.252, 16)]);
    lineSegments.push([new Vector3(32, 8.252, 6 + i), new Vector3(52, 8.252, 6 + i)]);
  }
  const grid = MeshBuilder.CreateLineSystem('original-metre-grid', { lines: lineSegments }, scene);
  grid.color = new Color3(.34, .53, .55);

  const expected = await fetch('/fixture/expected.json').then(response => {
    if (!response.ok) throw new Error(`Fixture oracle: HTTP ${response.status}`);
    return response.json() as Promise<{ frame: number[] }>;
  });
  const tiles = new LHTilesRenderer('/fixture/tileset.json', scene, {
    tileToLocal: Matrix.FromArray(expected.frame).multiply(Matrix.Scaling(1, 1, -1)),
  });
  tiles.fetchOptions = { credentials: 'omit', cache: 'no-store' };
  tiles.downloadQueue.maxJobsPerOrigin = 2;
  tiles.parseQueue.maxJobs = 1;
  tiles.errorTarget = 8;
  tiles.loadSiblings = false;
  let loaded = 0;
  let failed = false;
  let walking = false;
  let frames = 0;
  tiles.addEventListener('load-model', () => { loaded++; });
  tiles.addEventListener('load-error', event => { failed = true; showError(event.error); });
  const keys = new Set<string>();
  const moveKeys = new Set(['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']);
  window.addEventListener('keydown', event => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
    const key = event.key.toLowerCase();
    if (walking && moveKeys.has(key)) { event.preventDefault(); keys.add(key); }
  });
  window.addEventListener('keyup', event => keys.delete(event.key.toLowerCase()));
  window.addEventListener('blur', () => keys.clear());
  function walkingMode(value: boolean) {
    walking = value;
    keys.clear();
    proof.setWalking(value);
    element('walk').setAttribute('aria-pressed', String(value));
  }
  function preset(name: 'front' | 'rear' | 'overview') {
    walkingMode(false);
    camera.setTarget(target.clone());
    camera.alpha = name === 'rear' ? Math.PI / 2 : name === 'overview' ? -1.15 : -Math.PI / 2;
    camera.beta = name === 'overview' ? .95 : Math.PI / 2.05;
    camera.radius = name === 'overview' ? 17 : 7;
  }
  for (const name of ['front', 'rear', 'overview'] as const) element(name).addEventListener('click', () => preset(name));
  element('walk').addEventListener('click', () => {
    walkingMode(!walking);
    if (walking) { camera.alpha = -Math.PI / 2; camera.beta = 1.2; camera.radius = 5; canvas.focus(); }
  });
  const fov = element<HTMLInputElement>('fov');
  function setFov(value: number) {
    camera.fov = value * Math.PI / 180;
    fov.value = String(value);
    element('fov-label').textContent = `${value}°`;
  }
  fov.addEventListener('input', () => setFov(Number(fov.value)));
  element('scope').addEventListener('click', () => setFov(18));
  element('wide').addEventListener('click', () => setFov(65));
  element('occluders').addEventListener('click', () => {
    const show = !panels[0].isEnabled();
    panels.forEach(mesh => mesh.setEnabled(show));
    element('occluders').textContent = `Depth panels: ${show ? 'shown' : 'hidden'}`;
    element('occluders').setAttribute('aria-pressed', String(show));
  });
  element('drop').addEventListener('click', () => proof.dropBall());
  element('reset-walker').addEventListener('click', () => { keys.clear(); proof.resetWalker(); });
  const positionText = (value: Vector3) => `${value.x.toFixed(2)}, ${value.y.toFixed(2)}, ${value.z.toFixed(2)} m`;
  scene.onBeforeRenderObservable.add(() => {
    const has = (...values: string[]) => values.some(value => keys.has(value));
    proof.setInput(Number(has('d', 'arrowright')) - Number(has('a', 'arrowleft')), Number(has('w', 'arrowup')) - Number(has('s', 'arrowdown')));
    if (walking) camera.setTarget(proof.walker.position.add(new Vector3(0, .35, 0)));
    tiles.update();
  });
  scene.onAfterRenderObservable.add(() => {
    frames++;
    if (frames % 8 !== 0) return;
    element('scene-status').textContent = `${backend === 'webgpu' ? 'WebGPU' : 'WebGL2'} · LH · 1 camera`;
    element('tile-status').textContent = `${loaded} loaded · ${tiles.visibleTiles.size} selected`;
    element('frame-status').textContent = String(frames);
    element('walker-status').textContent = positionText(proof.walker.position);
    element('ball-status').textContent = positionText(proof.ball.position);
    if (!failed) state.textContent = tiles.visibleTiles.size ? 'Tile coverage available · inspect raster' : 'Waiting for tile coverage';
  });
  engine.runRenderLoop(() => scene.render());
  window.addEventListener('resize', () => engine.resize());
  window.addEventListener('pagehide', () => { tiles.dispose(); pipeline.dispose(); proof.dispose(); scene.dispose(); engine.dispose(); });
}
function showError(error: unknown) {
  state.textContent = 'Proof incomplete';
  element('error').textContent = error instanceof Error ? error.message : 'Unknown startup failure';
  element('error').hidden = false;
}
void start().catch(showError);
