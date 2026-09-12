# Left-handed streamed 3D Tiles adapter R2.2

Isolated source candidate for Babylon **9.25.0** and NASA-AMMOS **3d-tiles-renderer 0.5.2**. It uses an existing left-handed Babylon scene and camera. All retained geometry, geographic fixtures and auth responses are independently authored synthetic test data. No provider tile, credential, response or session is included.

With Node.js 22 or newer:

```sh
npm ci
npm run generate
npm test
npm run typecheck
```

The lockfile pins every dependency. The verified clean installation uses Node 24.18.0/npm 11.16.0 and local, independent node_modules. Generation creates both the original asymmetric fixture and eight geographic cases. Tests create ignored evidence files; no workspace symlink or pre-existing evidence is needed.

## Interface

```ts
const renderer = new LHTilesRenderer(tilesetURL, existingLHScene, {
  origin: {
    latitudeDegrees: 25.7662,
    longitudeDegrees: -80.1907,
    ellipsoidHeightM: 0,
  },
});
renderer.registerPlugin(new CesiumIonAuthPlugin({
  apiToken, assetId, autoRefreshToken: true,
}));
// The application retains its normal camera and renders this same scene.
renderer.update();
// Recreate the renderer when changing provider or geographic origin.
renderer.dispose();
```

The geographic origin is an explicit **WGS84 ellipsoidal** test/application input. Scene X points east, Y up, Z north, in metres. Height zero in this example is ellipsoid zero. It does not mean ground level, NAVD88 zero, mean sea level or a reconciled Miami gameplay floor. This adapter performs no geoid, NAVD88, geodetic epoch or local surveyed-height conversion.

The R1 local-frame constructor remains supported: `{tileToLocal: Matrix}`, where the matrix is a rigid reflection with determinant −1 mapping RH tile metres to the existing LH scene. Supply exactly one frame mode. The geographic group starts as identity; the local mode retains its reflection. Rigid group movement is supported. Do not scale/shear the group or change scene handedness while active.

## Coordinate and lifecycle behavior

Tile ancestry is composed in JavaScript doubles. External JSON resolves relative to its referring tileset, retains the parent tile transform, and takes its own `asset.gltfUpAxis`, default Y. Geographic box/sphere points are transformed and rebased in doubles before creating Babylon vectors. Region bounds ignore tile transforms and conservatively enclose the curved WGS84 region using interval bounds; the enclosure can over-refine large regions. Error uses actual framebuffer pixels, viewport dimensions and conservative source-transform stretch. R2.2 measures distance to a source-oriented enclosure, avoiding the zero distance reported by a loose world AABB when a thin tilted box is far away. An orthonormal frame follows the original half-edges; each half extent sums the absolute projections of every original half-edge. This preserves true oriented boxes and conservatively encloses rounded or sheared boxes. Tiny/zero axes use a stable orthogonal basis. Source edge directions are transformed directly in doubles, without differencing Earth-scale corners. Frustum corners and source geometry remain unchanged.

For content, the source order is glTF node hierarchy → glTF up-axis conversion → RTC offset → tile ancestry → local ECEF frame. CESIUM_RTC and B3DM RTC_CENTER are carried outside the importer in doubles. Their source metadata remains available for attribution. They are not silently left to a loader that does not implement CESIUM_RTC.

Large static glTF origins are rebased before Babylon creates node matrices. Empty ancestor coordinate systems move toward a rendered descendant using `M'_i = T(-o_parent) * M_i * T(o_i)`. Offsets cancel along each hierarchy path. Mesh nodes keep zero internal offset, so source vertex buffers, linear transforms, children and final geometry are preserved. A common external anchor is restored in doubles. This also handles large parent/child translations that cancel to a small final position. The original JSON remains the tile metadata; only the in-memory importer copy changes. No geometry is flattened, exported or retained by the adapter.

The real AUTO import root stays intact. A wrapper compensates its conversion exactly once and applies the rebased content placement in the same scene. R1 normal and winding regressions remain applicable. Containers are added to the scene before their imported root is parented, avoiding an invalid-container-parent warning.

A generation plus abort guard owns root settlement and prevents late root/model installation. Official plugin dispatch remains intact. Scoped wrappers deliver the lifetime signal to the initial ion endpoint, Google session refresh and tile requests; release a failed cached refresh promise; preserve external-endpoint credits only while tiles are visible; and prevent duplicate Google plugins on root retry. The initial Google root uses the official status-checking refresh path, avoiding 0.5.2's initial `fetch` JSON parsing that loses a non-2xx status. R2.1 restores one automatic initial-root retry for the exact pinned 401 error when `autoRefreshToken` is enabled. A persistent 401 stops after two requests, 403 and 503 receive no automatic initial-root retry, and disposal prevents the second request. The exact upstream error text is version-pinned and tested; a future changed error format fails closed until reviewed. These are version-specific compatibility seams, covered by actual official-plugin mocks. The application still owns credential input, sanitized diagnostics, full visible branding, attribution rendering and the provider's live connection lifecycle.

## Reproducible native evidence

Thirty-nine native tests pass, plus TypeScript checking:

- The original six meshes, 72 vertices and 24 triangles exercise two noncommuting tile transforms, nonuniform glTF nodes, real AUTO conversion, bounds, normals, 108 camera/FOV/aspect/direction views, NDC/depth and projected winding. Four bad-transform controls remain rejected.
- Eight geographic cases exercise external Z/X tilesets, default Y with omitted transforms, large root TRS/matrix positions, large nested positions, cancelling Earth-scale translations, and RTC GLB/B3DM. Every case uses the actual renderer traversal and GLB loader. Across 576 vertices the maximum world error is below **0.00000065 m**; 10,368 NDC comparisons stay below **0.00000065**. The acceptance tolerance is 0.001 m. Required KHR_materials_unlit maps to actual Babylon unlit materials.
- A deliberate premature Float32 conversion loses a 0.1234 m offset completely; the double-first path retains it to about 0.000000003 m. The initial rejected nested-child implementation had a 0.423 m error; its failing log is retained, and that case now passes.
- 6,615 fractional WGS84 region points cover Brickell, the antimeridian, both poles and the globe. All remain inside conservative bounds. Missing origin height and malformed longitude ranges fail before iteration.
- Official ion → Google root → external JSON → GLB mocks verify credential host scope, session propagation, visible endpoint credits, initial ion/Google 503 manual-reset retry, initial Google 401→200, bounded persistent 401, forbidden 403 without retry, disabled refresh, transient nested 401 session refresh, cancellation and zero late installed resources. Every fetch is intercepted; only dummy credentials are used.
- R2.2 includes a tilted thin-slab counterexample: true camera distance 1234.397 m, old AABB distance zero; the old path produced infinite SSE and filled a 24-entry cache while retaining one coarse ancestor. At the same capacity, the corrected 5.722-pixel error requests only the appropriately coarse model. This original test deliberately uses overlapping conservative child bounds; it establishes a refinement mechanism, not a reconstruction of provider topology.
- Oriented distances match the pinned upstream OBB over 2,400 probes, including rotations, thin/zero axes and translations, with maximum difference 0.000100 m (the reference uses Float32 matrices). Every one of 192 original sheared/tiny/degenerate source corners remains inside the enclosure within 0.000000000006 m, including a separate 10,000-km near-orthogonal boundary regression.
- Existing same-container hide/reveal, rigid group movement, cancellation after actual import, delayed/pre-start/reentrant root disposal, plugin dispatch, and framebuffer scaling regressions pass. Uniform tile stretch now scales SSE as well as bounds.

Tests use NullEngine, not a GPU. Native sub-micrometre oracle errors describe these small synthetic meshes after rebasing, not real-world geographic accuracy. The original 1.1 fixture retains upstream's generic limited-support warning. It is not suppressed or treated as support for every 1.1 feature.

## Deliberate limits and pending integration gates

This candidate accepts embedded GLB2 (including in-memory data URIs), B3DM, nested external tileset JSON, explicit affine tile transforms and box/sphere/region bounds. It has native coverage for ordinary Float32 positions and unlit materials, matching the successful structural sample reported by the separate live source viewer. That sample does not establish a universal provider format guarantee.

Implicit tiling, multiple content, other tile encodings, text glTF, external glTF buffers/images, Draco and meshopt are explicit errors pending separate loader/decoder/auth tests. Large-coordinate skinned/animated glTF and static hierarchies whose rebased node translations still span more than 4096 m are explicit errors. Already-quantized large Float32 vertex positions cannot recover lost precision. Image decoding, texture UV/color fidelity, KTX/Basis or other extensions and source-specific metadata need browser verification; these original native fixtures do not prove their raster behavior.

No provider content has been downloaded to disk. No Havok geometry, collision surface extraction, streamed collision readiness, travel, vehicle or gameplay integration is included. The existing Miami NAVD88 floor is not aligned by this adapter. CPU tests do not prove common GPU depth, raster winding, postprocess output, transparency ordering, image quality, bandwidth or performance. Those require the separate single-scene browser comparison before any live game integration.

The inherited byte estimator still returns 1. The 128/96 tile-count cap is **not** a memory or VRAM measurement. The independent resource-budget helper is not included here. Oriented distance reduces unnecessary refinement but does not solve every protected-working-set cache stall. The application must preserve ancestor coverage and choose/report an adequate finite capacity; this adapter does not silently raise the limit or disable ancestor loading. Pinned private hooks and lifecycle constants require renewed source review and regression tests before upgrading the renderer.
