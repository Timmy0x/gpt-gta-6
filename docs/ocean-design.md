# Native ocean presentation

`src/world/Ocean.ts` uses the installed `@babylonjs/materials@9.25.0` WaterMaterial. Its [official documentation](https://doc.babylonjs.com/toolsAndResources/assetLibraries/materialsLibrary/waterMat/) and [publisher implementation](https://github.com/BabylonJS/Babylon.js/blob/master/packages/dev/materials/src/water/waterMaterial.ts) were inspected alongside the pinned local GLSL/WGSL files. Native water provides moving normal perturbation, planar reflection/refraction targets, specular highlights and a Fresnel blend. It does not provide bathymetric absorption, screen-depth foam or a full underwater optical simulation.

The module supplies an original deterministic periodic ripple normal texture and irregular cellular foam texture as raw RGBA data. Sparse shoreline patches drift and fade independently, with gaps and uneven edges. There are no downloaded water pictures, repeated painted horizontal bands, third-party texture rights, or downloaded water shaders. The native surface is extended only by a scoped underwater dielectric Fresnel expression, described in `underwater-rendering.md`. The native9.25 clock advances only when frame delta changes; a public `onBindObservable` callback writes the existing shader's `time` uniform from the module's accumulated delta time so a stable frame interval still animates it.

## Integration and physical datum

The default mean water height is **Y=−0.18 m**, matching `World.waterLevel` and the current beach/boat datum. The earlier 0.55 value described a player floating height and is not the ocean surface. Constructor options allow another level explicitly. Native visual swell rises no more than approximately 4 cm above the mean in rain; the physical query stays at the stable mean rather than injecting presentation waves into the boat solver.

```ts
const ocean = new Ocean(scene, {
  waterLevel: world.waterLevel,
  shorelineX: 210,
  bounds: { minX: 210, maxX: 14210, minZ: -9000, maxZ: 9000 },
  floorHeightAt: (x, z) => physicalBathymetry(x, z),
});
ocean.update(dt, player.position, weather, daylight);
// Optional: restrict further to known world/sky/vehicle candidates.
ocean.setRenderSources(scene.meshes);
const wetFootprint = ocean.contains(x, z);
const meanSurface = ocean.surfaceHeight(x, z); // number, or null outside footprint
const depth = ocean.depthAt(x, z); // zero outside footprint or above seabed
// At teardown:
ocean.dispose();
```

`contains` describes the rectangular ocean footprint, not a land/island mask. Swimming must also consult `depthAt` and the player's altitude. Root integration should supply the exact bathymetry function used for seabed collision; the default gentle-depth function is an authored fallback, not a new physical seabed. `Ocean` creates no collider. Its wide visual bounds hide the previous nearby water-plane edge but do not provide playable world-edge protection by themselves.

Remove the old Atlantic Ocean, shallow shelf and long foam ribbon presentation when enabling this module. Otherwise overlapping water surfaces will remain visible and render twice. Keep Sky before world opaque materials as already documented. Reflection/refraction sources default to current scene meshes; the module excludes itself, old water/foam materials and disposed/disabled sources, and prioritizes Sky. World seabed/shore geometry should be included so the actual sloping bank appears through the refraction target. The native material's near/far color controls are not claimed as physical light absorption by depth.

## Bound work and limits

The current module owns three meshes, three materials and four textures: a 256² normal map, a 128² alpha foam map and two 512² reflection/refraction targets. Its default ocean mesh plus 817 broken shoreline patches and 12-triangle distant underwater extinction box total 38,510 triangles. The targets use one sample, no sprite/particle rendering and a two-frame refresh interval. Source selection runs every 0.5 simulation seconds, with a 720 m candidate radius, at most 32 meshes/80,000 triangles for reflection and 16 meshes/40,000 triangles for refraction. These are source-list budgets, not a measured integrated frame-time result. Each target still renders its selected scene and has color/depth attachment cost; two 512² RGBA8 + 32-bit-depth attachments alone are roughly 4 MiB before engine overhead.

Reflection selection can omit distant or unusually large merged batches. It uses the installed planar material, not ray tracing or a scene-wide reflection capture. Foam follows the authored straight eastern shoreline; it does not discover future island coasts, boat wakes or arbitrary object contacts. There is no ocean spectrum solver, weather-driven tide, caustics, volumetric scattering, interactive wake, or guarantee of reference-level water fidelity. The root gameplay layer owns underwater state, fog/audio transition, swimming and safe edges.

## Verification

`tests/ocean.test.ts` passes five CPU tests: dielectric transmission/total internal reflection, exact pinned shader extension isolation for GLSL/WGSL, camera-side RTT roles and fog restoration, explicit surface/depth/containment, deterministic normal data, fixed-delta animation time, bounded source lists, exact RTT settings, self/disposed-source exclusion, and three create/dispose cycles returning mesh/material/texture/image-processing-observer counts to baseline. Native9.25's RTT constructor references the browser global `name`; NullEngine tests temporarily supply that browser global and restore it afterward.

`scripts/ocean/preview.html` and `tests/ocean-preview.mjs` provide an isolated visual check. `docs/evidence/ocean-underwater-v3/result.json` records 12 focused stages across actual WebGPU and WebGL2 with zero shader/runtime errors. Zenith, angled underwater, horizon, shoreline reflection and resurfacing images were inspected; the gray zenith cap and bright horizon slit are corrected. It combines production Ocean and Sky with a sloping sand bank, pier, buildings and a simple floating scale object, then captures shore, waterline, reflection, sunset, rain, night and underwater views on each backend. These fixtures are presentation references, not a normal-game test or proof that the expanded map has been integrated.

The native module is now integrated with matching bank collision, immersion, camera fog/audio, swimming and world bounds. Both-backend normal coast checks pass in [map/coast v15](map-coast-checkpoint.md); the focused study alone is not the integration evidence.
