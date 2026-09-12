# Static tile resource accounting — isolated R1

This helper supplies honest accounting inputs for the pinned Babylon 9.25.0 / 3d-tiles-renderer 0.5.2 integration. It does **not** measure VRAM, set an enforced device-memory limit, load provider data, change the renderer, or alter the game. The upstream Babylon tiles backend's `calculateBytesUsed` returns the placeholder value `1`; that is unsuitable as a byte estimate.

## API

```ts
import { measureTileResources } from './src/TileResourceBudget';

const report = measureTileResources(residentTiles.map(tile => ({
  id: tile.id,
  container: tile.container,
  encodedGlbByteLength: tile.downloadedGlbByteLength ?? null,
})));

// report.budgetChargeBytes is null if any static resource cannot be accounted for.
// Do not substitute 0 or 1 for a null result.
```

`container` uses real `AssetContainer.meshes` and `.textures`. The report also walks material texture references, so shared textures referenced by a mesh but owned elsewhere are included. Each call is a fresh snapshot without allocations, observers, retained object references, scene mutations or disposal. Keep the supplied container list current as tiles load/unload; an explicitly supplied released or pending texture with no internal metadata is unknown rather than silently free.

- `gpuBufferCapacityBytes` sums the **reported Babylon `DataBuffer.capacity`** for every unique referenced vertex/index buffer. It counts the whole capacity, including unused tails. Interleaved attributes, geometry clones and separate geometries sharing one DataBuffer are counted once. CPU vertex array length is not a fallback for missing GPU capacity.
- `decodedTextureTexelReserveBytes` describes a conservative decoded color-payload reserve. It uses `InternalTexture` dimensions and type, reserves four channels (including RGB/RED expansion), and reserves every level down to 1×1. Byte, half/short and float/int reserve 4, 8 and 16 bytes per texel; packed color reserves 16. Disabling mip sampling does not establish that the mip storage was freed. Reported/generation/sampling mip metadata is included separately.
- `textureAllocationEstimateBytes` adds a configurable reserve: **256-byte rows and 4 KiB per mip** by default. These are accounting policy values, not a query or claim about actual WebGL/WebGPU allocation granularity. They intentionally overestimate small textures but are **not a guaranteed hardware upper bound**; drivers may use other padding, heaps and extra storage.
- `knownResourceSubtotalBytes` is the sum of known buffer capacities plus those texture estimates. `budgetChargeBytes` is the same only when the declared static geometry/texture scope contains no unknown resources; otherwise it is `null` and the report retains its known subtotal and detailed reasons.
- `encodedGlbBytes` is the sum of supplied GLB download lengths. It is kept entirely separate. Compressed download size is not decoded texture allocation, and this number does not establish that encoded buffers are retained in memory. Unknown encoded size does not invalidate known geometry/texture accounting.

Resource deduplication uses native DataBuffer and InternalTexture object identity, the sharing interfaces used by this pinned Babylon build. Reports contain IDs/values, not pointers. A global snapshot over all resident tiles counts sharing once. Summing independent per-tile reports deliberately double-charges resources shared across tiles; it must not be presented as a unique global allocation total. Engine implementations that alias one native allocation through distinct DataBuffer/InternalTexture objects need a separately validated identity adapter.

## Supported scope and unknowns

This cohort validates static mesh vertex/index buffers and ordinary uncompressed **2D color textures**. Missing/zero buffer capacities, pending texture metadata, compressed/depth/extended formats, cube/volume/array targets, render-target attachments, MSAA/multiview, skinning, morph targets, instance allocations and wireframe/edge buffers are explicit unknowns. They block a complete charge. The pinned wireframe-cache check also detects derived index buffers retained after wireframe rendering is disabled. No guessed zero-byte resources or arbitrary `1`-byte fallback are returned.

The estimate excludes CPU scene objects/JSON, decoded CPU vertex arrays, browser image decode staging, fetch/transcode temporaries, driver/shader/program/VAO overhead, uniforms and frame-global environment/shadow/postprocessing/render-target allocations. It is an estimate for the declared tile resource scope, not total process memory or total renderer/device usage. Streaming can temporarily retain old and new resources during replacement; pass all resident containers to the global snapshot, including hidden cached content.

The renderer integration remains separate. When replacing `calculateBytesUsed`, it must explicitly decide how to handle `null`, preserve the hard tile-count safeguard, display unknowns and avoid describing the LRU byte threshold as a hard memory ceiling. **Used/pinned/visible tiles can remain resident above an LRU soft budget**, and loading/transition peaks can exceed a settled estimate. An exact unique global ledger and conservative independent per-tile eviction charges are different quantities.

## Native validation

```sh
npm ci
npm test
npm run typecheck
```

Pins and integrity hashes are in `package-lock.json`; no floating dependency versions. The development `node_modules` symlink is excluded from the manifest and can be replaced by `npm ci` in this isolated directory.

Six tests use **real Babylon objects and the actual GLB loader**, without replacing engine methods:

1. Engine-created capacity-bearing DataBuffers are attached via public VertexBuffer/Geometry APIs. One 96-byte buffer backs two interleaved attributes, shared geometry and separate geometry; the 24-byte index capacity is independent. Global accounting is 120 bytes versus 216 when separately charging each tile. Partial and final disposal update snapshots correctly.
2. The original, locally authored asymmetric GLB imports six renderable meshes. Ordinary NullEngine vertex/index DataBuffers report capacity zero; the helper correctly marks those unknown and returns no complete charge. Encoded GLB length remains separate through disposal.
3. Native RawTexture clones share one InternalTexture across two material slots and two tiles. An 8×4 RGBA texture reserves four levels, 172 decoded texel bytes and 16,384 aligned bytes. Turning mip sampling off leaves the allocation estimate unchanged. Disposal clears resources.
4. A 9×5 RGB float texture demonstrates non-power-of-two levels, RGBA expansion (896 texel bytes), configurable alignment and independent download bytes. A RED half-float texture has a 168-byte expanded texel reserve.
5. Native pending textures, render targets, depth textures and ordinary headless geometry produce explicit unknowns, not fictitious allocation totals; container disposal removes them.
6. Duplicate IDs, invalid byte counts and invalid reservation policies fail explicitly.

NullEngine has **no physical GPU**. Its vertex/index allocation constructors leave capacity at zero, while `createUniformBuffer` populates real DataBuffer capacity metadata. The positive-capacity fixture deliberately reuses those engine-created buffers through supported geometry APIs to validate identity/capacity traversal without claiming they were uploaded to a GPU. Browser/WebGL/WebGPU allocation observations remain a later integration check. The fixture tests actual metadata semantics, not GPU driver storage or appearance.

`evidence/result.json` records the native outcomes. `manifest.json` fingerprints all release files and the authored fixture. No Google/Aerometrex tile payload, credential, browser capture or third-party model appears in this candidate.

## Pinned primary implementation references

The installed package sources used to establish these contracts are:

- `@babylonjs/core/Buffers/dataBuffer`: `capacity` and native identity.
- `@babylonjs/core/Meshes/geometry`: public vertex/index DataBuffer access and disposal.
- `@babylonjs/core/Engines/nullEngine.pure`: headless buffer capacity behavior and RawTexture metadata.
- `@babylonjs/core/Engines/thinEngine.pure`: WebGL buffer-capacity assignment.
- `@babylonjs/core/Engines/WebGPU/webgpuBufferManager`: WebGPU capacity alignment.
- `@babylonjs/core/Materials/Textures/internalTexture`: decoded dimensions, mip metadata, references and release behavior.
- `@babylonjs/core/Materials/Textures/rawTexture`: clone sharing of InternalTexture.
- `3d-tiles-renderer/src/babylonjs/renderer/tiles/TilesRenderer`: placeholder byte accounting.
- `3d-tiles-renderer/src/core/renderer/utilities/LRUCache`: eviction and used-content behavior.
