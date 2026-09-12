import { Engine } from '@babylonjs/core/Engines/engine';
import { WebGPUEngine } from '@babylonjs/core/Engines/webgpuEngine';
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';
import { Scene } from '@babylonjs/core/scene';
import { Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector2, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { GeospatialCamera } from '@babylonjs/core/Cameras/geospatialCamera';
import { GeospatialClippingBehavior } from '@babylonjs/core/Behaviors/Cameras/geospatialClippingBehavior';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline';
import { TilesRenderer } from '3d-tiles-renderer/babylonjs';
import glslangJS from '@babylonjs/core/assets/glslang/glslang.js?url';
import glslangWASM from '@babylonjs/core/assets/glslang/glslang.wasm?url';
import twgslJS from '@babylonjs/core/assets/twgsl/twgsl.js?url';
import twgslWASM from '@babylonjs/core/assets/twgsl/twgsl.wasm?url';
import { LHTilesRenderer } from './LHTilesRenderer';
import { ecef } from './access';

export type ViewerMode = 'rh-source' | 'lh-webgl2' | 'lh-webgpu';
export const viewOrigin = Object.freeze({ latitudeDegrees: 25.7662, longitudeDegrees: -80.1907, ellipsoidHeightM: 0 });

/** A comparison harness. Local Y is ellipsoid-relative; it is not the game's NAVD88 height. */
export async function createViewerScene(canvas: HTMLCanvasElement, mode: ViewerMode) {
  const local = mode !== 'rh-source';
  let engine: AbstractEngine;
  if (mode === 'lh-webgpu') {
    if (!(await WebGPUEngine.IsSupportedAsync)) throw new Error('WebGPU is unavailable. Select the explicit WebGL2 renderer.');
    const gpu = new WebGPUEngine(canvas, { antialias: true, adaptToDeviceRatio: false, powerPreference: 'high-performance' });
    try { await gpu.initAsync({ jsPath: glslangJS, wasmPath: glslangWASM }, { jsPath: twgslJS, wasmPath: twgslWASM }); }
    catch (error) { gpu.dispose(); throw error; }
    engine = gpu;
  } else {
    const gl = new Engine(canvas, true, { useLargeWorldRendering: !local, preserveDrawingBuffer: true, stencil: true, powerPreference: 'high-performance' });
    if (gl.webGLVersion < 2) { gl.dispose(); throw new Error('This preview requires WebGL2.'); }
    engine = gl;
  }
  engine.setHardwareScalingLevel(1 / Math.min(devicePixelRatio, 1.5));
  const scene = new Scene(engine);
  scene.useRightHandedSystem = !local;
  scene.clearColor = new Color4(.13, .20, .24, 1);
  let focus: (radius?: number) => void;
  let pipeline: DefaultRenderingPipeline | undefined;
  if (local) {
    const camera = new ArcRotateCamera('shared-local-camera', -Math.PI / 2 - .25, 1.1, 1500, Vector3.Zero(), scene);
    camera.attachControl(canvas, true);
    camera.minZ = .1; camera.maxZ = 100000;
    camera.lowerRadiusLimit = 35; camera.upperRadiusLimit = 20000;
    camera.lowerBetaLimit = .1; camera.upperBetaLimit = Math.PI / 2;
    camera.fov = 65 * Math.PI / 180;
    camera.wheelDeltaPercentage = .015;
    camera.panningSensibility = 20;
    camera.keysUp = []; camera.keysDown = []; camera.keysLeft = []; camera.keysRight = [];
    focus = (radius = 1500) => {
      camera.setTarget(Vector3.Zero()); camera.radius = radius; camera.alpha = -Math.PI / 2 - .25; camera.beta = 1.1;
    };
    new HemisphericLight('local-fixture-light', Vector3.Up(), scene).intensity = 1.2;
    pipeline = new DefaultRenderingPipeline('game-postprocess', true, scene, [camera]);
    pipeline.fxaaEnabled = true; pipeline.samples = 1; pipeline.imageProcessingEnabled = true;
    pipeline.imageProcessing.toneMappingEnabled = true; pipeline.imageProcessing.exposure = 1.12;
    pipeline.imageProcessing.contrast = 1.1; pipeline.bloomEnabled = false;
  } else {
    const camera = new GeospatialCamera('geographic-source-camera', scene, { planetRadius: 6378137 });
    camera.attachControl(true); camera.addBehavior(new GeospatialClippingBehavior());
    camera.limits.radiusMin = 35; camera.limits.radiusMax = 200000;
    camera.limits.pitchDisabledRadiusScale = new Vector2(.5, 1.5);
    new HemisphericLight('source-fixture-light', new Vector3(...ecef(viewOrigin.latitudeDegrees, viewOrigin.longitudeDegrees)).normalize(), scene).intensity = 1.2;
    focus = (radius = 1500) => {
      camera.center = new Vector3(...ecef(viewOrigin.latitudeDegrees, viewOrigin.longitudeDegrees, 0));
      camera.radius = radius; camera.pitch = 1.1; camera.yaw = -.25;
    };
  }
  focus();
  return {
    engine, scene, focus,
    label: local ? `${mode === 'lh-webgpu' ? 'WebGPU' : 'WebGL2'} · LH metres · one scene/camera · game postprocess` : 'WebGL2 · RH Earth coordinates · source comparison',
    makeTiles: (url: string): TilesRenderer => local ? new LHTilesRenderer(url, scene, { origin: viewOrigin }) : new TilesRenderer(url, scene),
    dispose() { pipeline?.dispose(); scene.dispose(); engine.dispose(); },
  };
}
