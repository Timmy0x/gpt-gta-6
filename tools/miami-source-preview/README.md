## Verified local-frame source rendering

Actual Google/Cesium Brickell now renders in a left-handed local metre scene with the game post-processing pipeline. This preview is an integration tool; it is not yet the playable Miami map. Credentials remain connection-local in browser memory, and source attributions remain visible.

The previous 240-entry cap deadlocked at one coarse ocean tile: all 240 admitted entries were protected and all queues were idle. A normal cache-control change on the same live connection restored textured buildings. At the 1500 m viewpoint, the completed working set is 488 entries / 187 visible tiles; the 700 m viewpoint uses 628 protected entries / 256 visible tiles. Default capacity is now 960 entries, with 240/480 diagnostic comparisons. This is a count safeguard, not measured VRAM or a byte budget. The closer measured resource subtotal was 497.2 MiB with 687 unknown resources, so no performance or complete memory acceptance is claimed.

The R2.2 adapter also replaces its overly loose world-AABB distance with a conservative oriented enclosure. Independent tests prove reduced unnecessary refinement on tilted bounds. That correction alone did not resolve the actual 240-entry live stall; cache capacity is separately necessary. Raw failure and recovery summaries are retained under docs/evidence/miami-streaming-live-r1 in the repository.

Streaming diagnostics report current admitted/protected counts, download/parse queues and sanitized error counters. The sampler runs even when an update throws. Model-load events are explicitly cumulative; resident resource counts are separate. Changing renderer reloads and clears the token; changing cache capacity takes effect in the current page without another authentication request.

## Run the preview

This package starts disconnected with Cesium ion selected. The renderer selector offers the upstream RH Earth-coordinate source comparison, LH WebGL2 and LH WebGPU. The LH modes use one ArcRotateCamera in East/Up/North metres and the game DefaultRenderingPipeline. The origin is WGS84 latitude25.7662°, longitude−80.1907°, ellipsoid height0m; NAVD88 alignment and gameplay collision remain separate work. Adapter source hashes are in adapter-provenance.json.

```sh
npm ci --ignore-scripts
npm test
npm run build
npm run preview
```

Open `http://127.0.0.1:4293/`. Requires a current Node.js version supported by Vite 8 and a WebGL2 browser. This package has its own lockfile; it does not change the game's dependencies or runtime.

- **Cesium ion** accepts your token and a positive asset ID; the default `2275207` is the Google Photorealistic 3D Tiles asset used by the official example. Your account must have access.
- **Google Map Tiles** accepts your own Map Tiles API key and requests the official 3D Tiles root. Use a browser-restricted key permitting your localhost origin. Both document and fetch referrer policies send the origin for cross-origin requests.
- **Local test fixture** explicitly loads two synthetic CC0 boxes at an ECEF location. They test transforms, tile traversal and credits; they are not a city model. The badge and status keep this distinction visible. Under **Test & source notes**, choose missing-root or missing-child cases to check failures.
- **Brickell** and **Overview** move the camera to the Brickell area; those coordinates alone do not imply that data is available or current.

Credentials stay in page memory for the active connection/retry and are cleared on disconnect, changing source, or closing the page. There is no localStorage, URL parameter, environment token, or backend credential store. They are necessarily sent to the selected provider for authentication and remain observable in your browser's network tools. The page sanitizes its error display and framework warning/error arguments. Do not include real credentials in screenshots, diagnostics or committed files. Reconnecting recreates the renderer and auth plugin because the pinned upstream auth implementation retains rejected refresh promises.

The footer displays every visible-tile attribution returned by the renderer, plus the official Google Maps logo for Google content. Treat each provider's API terms, attribution, account access and quota as requirements of that provider. This tool creates no accounts, enables no billing, and downloads no proprietary assets for offline reuse.

## Current limits

This is a source-access preview, not a finished game map or importer. It provides no Havok colliders, terrain query, traffic, swimming, damage, editable mesh export, offline city cache or guarantee of surveyed geometry. Photogrammetry may contain dated, fused, missing or distorted surfaces; a successful connection does not establish street-level fidelity.

The upstream Babylon backend is right-handed; the tested local adapter supplies the left-handed path. `checkCollisions` would only activate Babylon's legacy mesh collision flags, so it is disabled here. Its `calculateBytesUsed()` currently returns `1`; the configured byte thresholds are not a measured GPU-memory budget. The preview retains its count-only safeguard and fetch/parse concurrency settings. Used or visible tiles may exceed LRU soft limits; no measured VRAM or hard byte ceiling is enforced. The source comparison uses large-world ECEF rendering; the LH paths rebase in double precision before Babylon node transforms. Physics integration remains separate work.

Provider root/auth failures and child failures are displayed separately. A root JSON response alone does not count as rendered data. Tile coverage counters report renderer selection/loading, not completed shader compilation; the first GPU frame can remain blank while materials compile. Raster inspection is required before claiming a visible result. Retry creates fresh auth state; Disconnect disposes the renderer. The synthetic test verifies renderer behavior only. Production build emits the expected large-Babylon-chunk advisory. The valid 3D Tiles 1.1/GLB fixture also triggers the pinned renderer's limited-1.1-support advisory.

The combined preview passes 29 native tests and production/typecheck build. The geographic adapter passes 39 native tests. Normal source/error/refresh controls pass 15 checks on each LH backend; resource and cache controls pass all 3 renderer modes. These automated checks use original synthetic fixtures and intercepted provider responses. Actual Google/Cesium aerial views were separately inspected through the authorized local connection. Neither category establishes complete game or street-level fidelity.

## Sources and licenses

Read the official [NASA/AMMOS renderer](https://github.com/NASA-AMMOS/3DTilesRendererJS), its [Babylon guide](https://github.com/NASA-AMMOS/3DTilesRendererJS/blob/master/src/babylonjs/renderer/README.md), and the [Babylon official example source](https://github.com/BabylonJS/Demos/blob/main/3d-tiles/src/index.ts). Source URLs and hashes of locally inspected references are in `references/provenance.json`; raw research snapshots are not committed; installed runtime versions are pinned to `3d-tiles-renderer 0.5.2` and Babylon `9.25.0`.

Renderer and Babylon licenses/notices are retained under `licenses/`. The synthetic fixtures are CC0, documented in `public/fixture/LICENSE.txt`. Google's unmodified attribution image is an official trademark asset, not CC0; its archive/source hash is retained. See the [Google Map Tiles documentation](https://developers.google.com/maps/documentation/tile/3d-tiles), [policies and attribution guidance](https://developers.google.com/maps/documentation/tile/policies), and [Cesium ion documentation](https://cesium.com/learn/ion/).

The repository-level normal-controls audit is `tests/miami-source-controls-audit.mjs`; run it from the root with `AUDIT_URL` pointing at this local preview. It intercepts synthetic provider responses and requires the root Playwright development dependency. See `docs/evidence/miami-streamed-preview-r1/README.md` for the clean-checkout evidence and its limits.

`loadedContent` counts successfully loaded unique tile objects. Failed or unsupported parse candidates are absent from that count, so zero does not establish that a format or compression extension is absent from the provider dataset.

## R3 resident resource diagnostics

The visible **Resources · not measured VRAM** panel inspects all successfully loaded resident tile containers once per second, including hidden cached tiles. A passive parse hook records only complete GLB view byte lengths and returns `null`, leaving the official parser unchanged. `load-model` adds a resident entry, duplicate events retain one entry, and `dispose-model` removes it. Disconnect/retry disposes and clears the ledger; late completions cannot reopen it. Numeric IDs are connection-local, increase monotonically and are not reused by reset. Pending buffers, URLs, source metadata and names are never retained in the report.

`src/TileResourceBudget.ts` is the exact frozen resource-helper R1 source. The panel shows reported native DataBuffer capacities, a conservative decoded 2D color-texture allocation estimate, their known subtotal, unknown-resource count, resident/visible/cached counts, and encoded GLB byte lengths separately. Encoded download length does not establish current encoded-buffer retention. Only fixed labels and numeric aggregates leave the ledger; helper attribute names, exceptions and detail strings are not serialized. Unknown or failed inspection remains explicit rather than becoming a zero estimate.

Texture accounting reserves full mip chains, four-channel expansion and configurable row/mip alignment. These are deliberate conservative policy estimates, not measured VRAM or a guaranteed driver-allocation upper bound. Static resource scope excludes uniforms, shader/VAO/driver overhead, CPU decode staging, and frame-global rendering allocations. Unsupported or missing static resources prevent a complete static charge. The detailed helper documentation and original checkpoint manifest are retained under `references/resource-accounting/` as provenance. Its relative file paths describe the separate original R1 package.

The resource ledger itself remains read-only. Cache capacity is controlled separately by the normal UI. Native lifecycle coverage uses the actual pinned renderer and original GLB loader on NullEngine with a test-only FileReader host shim. Real WebGL2 leaves index-buffer capacities unknown in Babylon 9.25.0; WebGPU reports those capacities in the original fixture. These backend differences remain visible instead of being replaced with guessed values.

## R3 active-scene hierarchy aggregates

The structural profile now includes numeric counts of local node translations strictly greater than **4,096 m**, classified as active-scene roots or nested nodes, and maximum observed hierarchy depth (root depth zero). A matrix takes precedence over a node translation. These are local offsets, not accumulated world coordinates or a claim about a provider's coordinate frame.

The active `scene` is traversed; an omitted scene selects scene 0 to match the loader. Multiple scenes are counted explicitly, while inactive scenes are not traversed by these hierarchy fields. The existing global node inventory remains separate. Iterative traversal is bounded to 10,000 node/index/edge observations. Cycles, repeated references, missing/invalid scenes, invalid child references and limit-limited partial results have explicit numeric counters. Invalid or shared hierarchies must not be interpreted as complete valid-tree depth measurements. No names, node IDs, vectors, URLs or original metadata appear in the aggregates.
