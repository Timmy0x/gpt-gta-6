# Local left-handed 3D Tiles adapter R1

This is an isolated, original-geometry regression candidate for Babylon 9.25.0 and NASA-AMMOS `3d-tiles-renderer` 0.5.2. It places a tile hierarchy into an existing left-handed Babylon scene, preserving the real AUTO glTF importer root. It does not load Miami or any provider data, perform geodesy, create collision bodies, or modify the game.

With Node.js 22 or newer:

```sh
npm ci
npm run generate
npm test
npm run typecheck
```

The lockfile pins all dependencies. The accepted native run uses Node 24.18.0/npm 11.16.0. Generation retains the original 7,788-byte GLB with SHA256 `76b9127d73fcf37cd8e05531008400397193d4c785ad6dd22d197e2fa6b76b48`. Tests create their own ignored `evidence/result.json`; no workspace dependency symlink or pre-existing evidence is needed.

## Interface and placement

```ts
import { LHTilesRenderer } from './src/LHTilesRenderer';
const renderer = new LHTilesRenderer(tilesetUrl, existingLHScene, {
  tileToLocal, // Babylon Matrix: RH tile metres -> LH scene metres
});
// Keep the existing camera. After moving it, once per frame:
renderer.update();
// When the renderer is no longer needed:
renderer.dispose();
```

`tileToLocal` must be an orthonormal affine matrix with determinant −1. The adapter validates this and requires the scene to remain left-handed. The fixture's explicit map is `Matrix.FromArray(expected.frame).multiply(Matrix.Scaling(1,1,-1))`. This map comes from the known synthetic fixture; the adapter itself imports no fixture/oracle data. Its constructor never derives an Earth origin, altitude datum or a metre scale from a label.

Tile transforms and their box/sphere bounds stay in the renderer's right-handed tile basis. A group pre-transform maps that basis into the existing LH scene. Each actual AUTO GLB root remains unchanged beneath a new placement node whose full local matrix is `C.inverse() * upRotation * tileTransform`, in Babylon multiplication order. `C` is measured from the loaded import root. Thus the effective source chain is `sourceNodes * C * C.inverse() * upRotation * tileTransform * tileToLocal`; the reflection happens exactly once in final scene coordinates. Pre-transform matrices avoid decomposing the nested affine hierarchy into lossy TRS values.

The adapter inherits traversal, queues, visibility, metadata, attribution plugin collection and tile disposal. It changes three bounded seams: GLB placement, framebuffer-pixel screen-space error, and guarded initial-root request settlement. A generation/AbortController guard prevents root state/events and imported assets from being installed after disposal. The state constants and undeclared backend hooks are explicitly coupled to 0.5.2; upgrading the package requires these tests and a source review. The initial-root gate preserves registered root-loader plugin dispatch, validated with an independent delegating plugin. Live provider authentication and refresh remain outside this cohort.

`group`, `visibleTiles`, `addEventListener`, `resetFailedTiles` and ordinary rendering events remain available. A visible tile's `engineData.scene` is the placement wrapper; its `engineData.container` contains the real imported meshes. Moving the group by a rigid transform updates geometry and culling together. Do not scale or shear the group.

## Native evidence

The tests use the real renderer update/load/traversal/visibility path and Babylon's real binary GLB importer. Only transport, browser location and animation-frame scheduling are supplied by the Node harness. The original independent double-arithmetic oracle is reused; `placeCanonical` is never called on an adapter result.

- Thirteen tests pass, plus TypeScript checking.
- Six meshes / 72 vertices / 24 triangles traverse two noncommuting tile transforms and a nonuniform nested GLTF node hierarchy. Maximum vertex error is 2.011 micrometres and mesh-bound error 1.966 micrometres; tolerance is 20 micrometres.
- 108 view/FOV/aspect/forward-away configurations verify 7,776 NDC/depth coordinates, 2,592 indexed projected winding comparisons, and 54 visible versus 54 culled tile bounds. Maximum NDC error is 0.000006596; tile-bound corner error is below 0.683 micrometres.
- Seventy-two inverse-transpose normals match the oracle within 0.000000049, with imported back-face culling retained.
- Four deliberate failures are rejected by the untouched oracle: overwritten AUTO root, duplicated compensation, swapped tile transforms and omitted up-axis rotation. Errors range from 2.72 to 6.20 metres. The swapped-transform control uses loose enclosing spheres to keep its deliberately wrong geometry visible to the oracle.
- Real hide/reveal preserves the same container, rigid group movement preserves one-metre markers, and disposal removes all tile meshes/wrappers. Disposal after the actual importer resolves, delayed root completion, synchronous early disposal failed-root retry, root-plugin dispatch and disposal within an earlier root-event listener are covered.
- Screen-space error uses actual framebuffer dimensions and camera viewport size. Tests cover 1600×900, 800×450 and 1200×900 at quality factors 1, 2 and 0.75, plus half viewport and orthographic projection. NullEngine hardcodes its scaling getter to 1, so this test binds the real AbstractEngine getter to its real setter; no GPU resize is claimed.

The retained log includes upstream 0.5.2's general 3D Tiles 1.1 support warning. It is not hidden or treated as proof that all 1.1 extensions work. The earlier AssetContainer-parent warning was fixed by adding the valid imported hierarchy to the scene before parenting it to the external placement node.

## Explicit limits

R1 accepts embedded GLB2 content, one top-level tileset with nested tile nodes, rigid tile transforms, and local box/sphere bounds. It explicitly rejects geographic `region` bounds, external nested tileset JSON, implicit/multiple content, non-GLB content, external GLB buffers/images, `CESIUM_RTC`, Draco and meshopt compression. Other GLTF features and textures have not been validated by this original untextured fixture. B3DM, live credentials, auth refresh, provider credits, external-resource fetch policy and geographic height reconciliation need separate integration gates.

There is no ECEF precision guarantee. Default Babylon matrices use float32 storage, so subtracting large Earth coordinates after matrix creation can lose sub-metre detail. A production georeferencer must perform a validated double-precision rebase or deliberately configure/test large-world precision before this local frame. NAVD88 versus ellipsoid heights remain unresolved here.

The inherited byte estimator still returns 1. The 128/96 tile count cap is a count bound, **not** measured memory or VRAM. Root is developing separate resource accounting. These CPU tests do not prove common GPU framebuffer depth, raster front faces, postprocess composition, transparent ordering, GPU resources or performance. No Havok bodies, safe travel, streamed collision readiness or gameplay integration is included.
