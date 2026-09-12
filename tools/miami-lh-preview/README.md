# Synthetic LH integration proof

A separate test harness for one left-handed Babylon scene, one camera and a local-metre 3D Tiles adapter. It contains **no Miami geography, provider credentials, provider requests or map-derived physics**. It does not change the game.

```sh
npm ci --ignore-scripts
npm test
npm run build
npm run preview
```

Open `http://127.0.0.1:4494/`. Choose WebGL2 or WebGPU; changing renderer reloads the harness. WebGPU requires browser support and reports a visible error if unavailable, without silently switching backends. Shader compiler scripts/WASM and Havok WASM are bundled locally from pinned npm dependencies.

The asymmetric GLB and its nested rigid tile transforms come unchanged from the adapter's original synthetic fixture. Its measured metre coordinates are retained. The adapter maps those RH tile coordinates into the existing LH scene; it does not replace the scene or overwrite the glTF AUTO root.

The `DefaultRenderingPipeline` uses the game's current settings: FXAA, one sample, image processing/tone mapping, exposure 1.12, contrast 1.1 and no bloom. No second scene or overlay canvas renders the tiles. The pink near panel and cyan far panel use the same depth buffer as the asymmetric tile. Hide/show them and compare Front/Rear to verify mutual occlusion; inspect pixels, not just tile counters.

Controls:

- Front, Rear and Overview select camera views. Drag the canvas to orbit; the wheel zooms.
- Field of view changes the same camera from 18° to 85°. Scope and Wide select 18°/65°.
- Depth panels toggles the original opaque near/far test panels.
- Walk follows the original capsule. WASD/arrow keys move it in world X/Z. The gold block is an independent Havok obstacle; hold W from the reset position to walk into it.
- Drop ball resets the dynamic sphere above the floor. Reset walker restores the capsule. Visible position readouts allow real metre displacement/contact checks through normal controls.

The floor, capsule, gold block and sphere have independently authored Havok shapes. The tile and depth panels have no physics; this proof must not be described as provider collision integration. The floor has one-metre grid lines. Walking is a bounded capsule test, not the game's animation/controller system.

Tile counters report loading/selection, not completed GPU shader compilation. Wait for several rendered frames and inspect the raster on each backend. Earlier RH preview work demonstrated that the first screenshot can be blank while materials compile despite a loaded/selected count.

The adapter is intentionally limited to embedded GLB2, local box/sphere bounds and rigid metre transforms. Region bounds, implicit/multiple content, RTC/compression and external GLB resources are outside this gate. Package versions are pinned. The original NASA/AMMOS backend has placeholder byte accounting, so this harness uses small explicit fixtures and tile-count/concurrency bounds rather than claiming a measured GPU-memory budget.

Native tests cover actual Havok floor contact, obstacle blocking, reset and metre-scale walking. GPU acceptance is separate and belongs to the parent audit; this source does not claim a provider dataset is loaded.
