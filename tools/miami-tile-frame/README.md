# Tile frame regression fixture R1

This isolated fixture exercises the actual Babylon 9.25 GLB loader, nested transforms, metre scale, bounds and camera correspondence needed before an LH tile renderer can be accepted. It is original synthetic content, with no Google/Cesium/provider geometry and no geographic-height claim. No application source, root package lock or renderer was changed. This tools candidate has its own reproducible npm lockfile.

The 7,788-byte `fixtures/asymmetric.glb` contains two distinct offset tetrahedra under a nested, rotated, nonuniformly scaled GLTF hierarchy, plus origin/east/up/north markers one metre apart. Single-sided materials and indexed outward faces expose mirrored geometry. `fixtures/tileset.json` adds two noncommuting rigid transforms and contains complete child bounds. Its local tile axes are East/North/Up; the known synthetic RH display frame is East/Up/negative-North, and LH display reflects its final Z. These labels are fixture directions, not surveyed Miami coordinates.

Use Node.js 22 or newer. From a fresh checkout of this directory, run:

```sh
npm ci
npm run generate
npm test
npm run typecheck
```

The local `package-lock.json` pins Babylon core/loaders 9.25.0, tsx 4.23.13, TypeScript 5.9.3 and Node typings 24.13.3, together with their transitive dependencies. Installation is independent of the game workspace; no parent `node_modules` symlink or root dependency installation is needed. The accepted clean run used Node 24.18.0 and npm 11.16.0. Generated fixture bytes must remain identical to the oracle checks. The test runner creates its own ignored `evidence/result.json` directory, so pre-existing evidence is not required. `scripts/generate.mjs` uses independent JavaScript double-precision column-matrix arithmetic to create the GLB and expected world coordinates. The GLB SHA256 is recorded in the oracle, verified before loading and listed in evidence.

The acceptance controls cover:

- Actual AUTO importer root: LH is `diag(-1,1,1)` (a Y-half-turn combined with negative Z scale), while RH is identity. The full nested node hierarchy must preserve those conversions exactly once.
- Every loaded vertex versus the independent oracle, every transformed AABB corner, and one-metre marker distances before and after the two tile transforms.
- Six view poses, three FOVs and three aspect ratios: 54 camera configurations, 3,888 vertex projection/depth checks, 1,296 indexed screen-winding checks and 324 visible/culled mesh-bound comparisons. Normals use inverse-transpose transforms and culling orientation accounts for the imported material and world determinant.
- Serialized child/parent tile bounds contain geometry and the full transformed child box. An undersized box is rejected.
- Negative controls detect double importer conversion, overwriting the actual importer root quaternion, reversing parent/child tile transforms and omitting GLTF Y-up to tile Z-up correction.

The `placeCanonical` helper is only a known reference placement for these synthetic controls. It computes a parent wrapper that cancels the already-loaded root conversion before applying the desired fixture transform. It is not a general tile adapter, georeferencer or streaming implementation. A future adapter gate should load `fixtures/tileset.json` through the real adapter and feed its actual six meshes/scene to `fixtureError`, without calling `placeCanonical` on the adapter result; then repeat the camera/bounds/winding comparisons.

These are native CPU tests. They do not prove WebGPU/WebGL shared framebuffer depth, rasterized front-face behavior, material shading, GPU precision, postprocess composition, Google availability/permissions, geodesy, LOD/collision streaming or gameplay. Those still need separate renderer and physical tests.
