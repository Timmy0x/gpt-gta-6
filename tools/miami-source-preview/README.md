# Miami source API preview

A separate local preview of the official NASA/AMMOS Babylon.js 3D Tiles renderer. It starts disconnected with **Cesium ion** selected. No city geometry or remote API request occurs until you enter your own access token and press **Connect**. Actual Miami provider access has not been verified without a user credential.

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

The pinned Babylon backend is right-handed. `checkCollisions` would only activate Babylon's legacy mesh collision flags, so it is disabled here. Its `calculateBytesUsed()` currently returns `1`; the configured byte thresholds are not a measured GPU-memory budget. The preview instead bounds tile count and fetch/parse concurrency. Large-world rendering remains ECEF; integration with the game's local metre physics is separate work.

Provider root/auth failures and child failures are displayed separately. A root JSON response alone does not count as rendered data. Tile coverage counters report renderer selection/loading, not completed shader compilation; the first GPU frame can remain blank while materials compile. Raster inspection is required before claiming a visible result. Retry creates fresh auth state; Disconnect disposes the renderer. The synthetic test verifies renderer behavior only. Production build emits the expected large-Babylon-chunk advisory. The valid 3D Tiles 1.1/GLB fixture also triggers the pinned renderer's limited-1.1-support advisory.

Verification: 13 native tests and a production/typecheck build pass. A separate browser audit passed 15 normal-control and intercepted-provider checks, including both credits, missing root/child, retry, disconnect, API403 and a recovered401 with ion endpoint credits plus Google tile credits/logo. No real provider credentials or Miami data were used. The first screenshot was premature; retained follow-up captures after material warm-up show both synthetic boxes at420 m and1500 m.

## Sources and licenses

Read the official [NASA/AMMOS renderer](https://github.com/NASA-AMMOS/3DTilesRendererJS), its [Babylon guide](https://github.com/NASA-AMMOS/3DTilesRendererJS/blob/master/src/babylonjs/renderer/README.md), and the [Babylon official example source](https://github.com/BabylonJS/Demos/blob/main/3d-tiles/src/index.ts). Source URLs and hashes of locally inspected references are in `references/provenance.json`; raw research snapshots are not committed; installed runtime versions are pinned to `3d-tiles-renderer 0.5.2` and Babylon `9.25.0`.

Renderer and Babylon licenses/notices are retained under `licenses/`. The synthetic fixtures are CC0, documented in `public/fixture/LICENSE.txt`. Google's unmodified attribution image is an official trademark asset, not CC0; its archive/source hash is retained. See the [Google Map Tiles documentation](https://developers.google.com/maps/documentation/tile/3d-tiles), [policies and attribution guidance](https://developers.google.com/maps/documentation/tile/policies), and [Cesium ion documentation](https://cesium.com/learn/ion/).

The repository-level normal-controls audit is `tests/miami-source-controls-audit.mjs`; run it from the root with `AUDIT_URL` pointing at this local preview. It intercepts synthetic provider responses and requires the root Playwright development dependency. See `docs/evidence/miami-streamed-preview-r1/README.md` for the clean-checkout evidence and its limits.
