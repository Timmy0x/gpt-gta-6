import { Color3, Color4, CubeTexture, DirectionalLight, Engine, FreeCamera, MeshBuilder, PBRMaterial, Scene, ShadowGenerator, Vector3 } from '@babylonjs/core';
import { ConceptCarAssets } from '../../src/vehicles/ConceptCar';

/** Offline inspection only. The harness permits the two pinned derivative hashes in its Vite transform. */
export async function createLODReview() {
  document.body.innerHTML = '<canvas id="review"></canvas><div id="label"></div>';
  document.head.insertAdjacentHTML('beforeend', '<style>html,body{margin:0;background:#24292e;overflow:hidden}canvas{width:100vw;height:100vh;display:block}#label{position:absolute;left:26px;top:22px;color:white;font:18px system-ui;background:#111b;padding:10px 16px;border-radius:8px}</style>');
  const canvas = document.querySelector<HTMLCanvasElement>('#review')!;
  const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
  const scene = new Scene(engine); scene.clearColor = new Color4(.32, .36, .40, 1);
  scene.imageProcessingConfiguration.toneMappingEnabled = true; scene.imageProcessingConfiguration.toneMappingType = 1;
  scene.imageProcessingConfiguration.exposure = 1; scene.imageProcessingConfiguration.contrast = 1;
  const environment = new CubeTexture('/lighting/coastal-street.env', scene, { prefiltered: true, forcedExtension: '.env', createPolynomials: true });
  scene.environmentTexture = environment; environment.rotationY = .65;
  const camera = new FreeCamera('inspection', new Vector3(-5, 2.5, 6), scene); camera.minZ = .05; camera.maxZ = 80; camera.fov = .65;
  const sun = new DirectionalLight('sun', new Vector3(-.45, -.8, .38), scene); sun.position = new Vector3(5, 9, -5); sun.intensity = 2.1;
  const shadows = new ShadowGenerator(2048, sun); shadows.usePercentageCloserFiltering = true; shadows.bias = .0004; shadows.normalBias = .005;
  const ground = MeshBuilder.CreateGround('floor', { width: 100, height: 100 }, scene); ground.receiveShadows = true;
  const material = new PBRMaterial('floor', scene); material.albedoColor = new Color3(.2, .22, .24); material.roughness = .85; material.metallic = 0; ground.material = material;
  const paths = ['car.glb', 'car-lod1.glb', 'car-lod1-batched.glb'], labels = ['Original · 213,347 triangles', 'LOD · 61,879 triangles', 'Batched LOD · 61,879 triangles'];
  const caches = [], models = [];
  for (const [index, path] of paths.entries()) {
    const source = new Uint8Array(await (await fetch(`/vehicles/concept/${path}`)).arrayBuffer());
    const cache = new ConceptCarAssets({ scene, shadows }, source, false, (["source", "simplified", "game"] as const)[index]); await cache.prepare();
    const model = cache.create(index + 1); model.root.position.y = .6; model.root.setEnabled(false); caches.push(cache); models.push(model);
  }
  await scene.whenReadyAsync();
  const reports = models.map((model, i) => ({ path: paths[i], meshes: model.root.getChildMeshes().filter(mesh => mesh.getTotalVertices() > 0).length, allChildMeshes: model.root.getChildMeshes().length, triangles: model.root.getChildMeshes().reduce((sum, mesh) => sum + mesh.getTotalIndices() / 3, 0), materials: model.materials.length, wheels: model.wheels.length, doors: model.doors.length, windows: model.windows.length, lamps: model.lights.length, covers: model.bumpers.length, panels: model.panels.length }));
  const viewpoints = {
    front: { position: [-5.2, 2.4, 6.5], target: [0, .65, 0] },
    rear: { position: [5.2, 2.4, -6.5], target: [0, .65, 0] },
    side: { position: [-7.5, 1.35, .2], target: [0, .65, 0] },
    wheel: { position: [-2.8, .65, 3.2], target: [-.97, .4, 1.45] },
    cabin: { position: [-1.7, 2.7, 1.9], target: [-.3, .7, .1] },
    driving: { position: [-1.3, 3.3, -10], target: [0, .65, 0] },
    door: { position: [-5.2, 2.4, 6.5], target: [0, .65, 0] },
  };
  const references = new Map<string, Uint8Array>();
  return {
    reports, viewpoints: Object.keys(viewpoints),
    async capture(index: number, view: keyof typeof viewpoints) {
      models.forEach((model, i) => { model.root.setEnabled(index === i); model.doors[0].mesh.rotation.y = view === 'door' ? -.85 : 0; });
      camera.position.copyFromFloats(...viewpoints[view].position as [number, number, number]);
      camera.setTarget(Vector3.FromArray(viewpoints[view].target));
      document.querySelector('#label')!.textContent = `${labels[index]} / ${view}`;
      await scene.whenReadyAsync();
      for (let frame = 0; frame < 8; frame++) { scene.render(); await new Promise(requestAnimationFrame); }
      const pixels = new Uint8Array(await engine.readPixels(0, 0, engine.getRenderWidth(), engine.getRenderHeight()));
      if (index === 0) { references.set(view, pixels); return { reference: true }; }
      const reference = references.get(view)!; let absolute = 0, changed = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        let peak = 0;
        for (let channel = 0; channel < 3; channel++) { const difference = Math.abs(pixels[i + channel] - reference[i + channel]); absolute += difference; peak = Math.max(peak, difference); }
        if (peak > 16) changed++;
      }
      return { meanAbsoluteChannelDifference255: absolute / (pixels.length / 4 * 3), fractionPixelsAnyChannelOver16: changed / (pixels.length / 4) };
    },
  };
}
