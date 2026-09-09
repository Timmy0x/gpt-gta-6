# World package loading

The runtime now fetches pre-exported Babylon asset packages instead of generating the district or retaining its full CPU geometry. The authored district is unchanged. Nearby packages own their CPU vertex arrays and GPU buffers through Babylon `AssetContainer`; eviction disposes both. Shared material objects are reference-counted and reused across resident packages, then released when unused.

## Format and export

Run `node scripts/world/export.mjs` to regenerate `public/world`. The exporter runs the original procedural authoring code from `src/world/authoring/WorldBuilder.ts` in an isolated Babylon NullEngine. A headless browser supplies real canvas2D pixels for original signage and normal maps; no game or GPU renderer is launched. Standard `SceneSerializer.SerializeMesh` creates `.babylon` scenes, then Node gzip-compresses their JSON. The runtime uses Babylon `LoadAssetContainerAsync` with the native `.babylon` loader. This is not a custom geometry binary format.

The exported assets contain:

- A 162 KB JSON manifest with version, package bounds, dependencies, hashes, collision/navigation boxes and street-light locations.
- 84 geometry packages grouped by 144 m cells and structure/detail class, including one small global terrain/road/water package.
- 171 separately fetched material descriptions and 46 deduplicated PNG textures.
- About 13.2 MB of compressed geometry/material files plus 722 KB of textures for the entire authored district.

Generated textures are external PNGs, shared by material references. The manifest supplies SHA-256 hashes for compressed geometry packages. Asset requests revalidate HTTP caches; integrity or parse failures enter the same retry path as network failures. IDs for meshes, geometry, materials and the eight animated shore waves are stable across residency cycles. Authoring code is not imported by the runtime World module.

## Integration and collision safety

Construct `new World(ctx)`, then await `world.ready` before creating gameplay systems that consume its obstacle and light arrays. The ready promise loads the manifest, installs initial collision, and prepares the immediate spawn neighborhood and global assets. The constructor also accepts `{baseUrl?, fetch?}` for isolated tests.

Before fast travel, save restoration or remote spawning, await `world.preparePosition(destination)`. Commit the gameplay position only after success. The parent integration pauses during preparation and keeps the original position if it fails. Destination assets are temporarily pinned during this operation; current-origin updates keep its scenery resident. A failed destination does not remove the playable origin. Each preparation makes at most three attempts, then rejects so the UI can report the problem and allow another attempt.

Call `world.setActiveAnchors(occupiedOrMovingVehiclePositions)` and `world.ensureCollision(player.position)` before simulation. Collision stays synchronous because all small BOX descriptions are in the manifest, independent of asynchronous mesh downloads. Global ground always remains. Static walls and sidewalks load within 220 m of the player or 90 m of an active vehicle; unload beyond 310 m from the player and 150 m from every active vehicle, at most 40 per update. Navigation obstacle boxes persist when their Havok bodies are absent. A delayed or failed scenery download can cause missing visuals, but it cannot remove a required wall or ground collider.

`world.update(...)`, `world.getStreamingStats()` and `world.lightPositions` remain compatible. New stats include loaded/total/pending/failed packages, request and byte counters, retries, resident materials, cumulative package eviction and full-export versus resident CPU geometry bytes. `failedPackages` is current state; `lastError` retains the most recent failure message even after recovery. Counters cover package/material fetches; PNG requests are handled by Babylon's texture loader and are visible in browser network traces rather than this byte counter.

## Residency and retries

Initial preparation loads packages whose bounds lie within 95 m of the destination, plus global assets. Background detail range is 200 m; structure range is 420 m. Active vehicle anchors add a 65 m visual radius. Resident packages receive 100 m of extra range to avoid repeated eviction at a boundary. At most two packages load concurrently and at most two packages are disposed per update. One package may contain several material-batched meshes, so work is bounded by package count rather than a fixed millisecond budget.

Fetches time out after 12 seconds. Automatic retry starts at 400 ms and backs off to a maximum of 12 seconds while a package remains wanted. Disposed worlds abort outstanding fetches. Late results for unwanted packages are released. A package load first acquires shared materials, then parses its native Babylon geometry; failed loads release acquired references. Serialized JSON and compressed buffers are not retained after parsing. Loaded vertex/index arrays are converted to typed arrays, matching the reported geometry byte estimate. Eviction removes meshes from shadow lists and disposes their geometry, then drops package and material references.

Static world assets are owned by their package containers. Gameplay-owned damaged props, vehicles, characters and their save state are outside those containers and are not reset by chunk loading. Permanent modification of static world architecture is not implemented; the exported building geometry is immutable.

## Coverage and visual changes

The road grid has 9 north/south streets at X = -432 through 144 and 8 east/west streets at Z = -288 through 216, on a 72 m pitch. Its 508 directed approach/departure nodes are strongly connected. Roads are 14 m wide with 3 m sidewalks. Ocean Beach's central Art Deco hotels transition west into Mercado Palma's covered market, Mangrove Estates' detached houses, a diner and local shops; southern blocks contain workshops.

Coastal Reserve remains a creative local training annex at X [-548, -456], Z [78, 198], with the east gate near (-452, 144). It does not replace the planned regional military facility or establish GTA VI geography. Coordinates, block dimensions, names and layouts are authored decisions. The expansion is contiguous local coverage, not the full Leonida map. Architectural materials use linear PBR colors for selected opaque surfaces; palms, awnings and balconies cast shadows. Houses have front and side windows, porches, shutters, gables, vents and roof detail.

## Verification and evidence

Run `npm test`, or `node --import tsx --test tests/world-streaming.test.ts tests/world-packages.test.ts` for the focused suites. Tests cover native Babylon parsing, selective package requests, ten repeated near/far cycles with stable mesh/geometry/shadow counts, material reuse/release, server-error retry, failed-destination preservation, unrelated gameplay ownership, export hashes and unique mesh/geometry IDs. Real Havok tests verify retained walls/ground around a remote active body and 20 collider unload/reload cycles without leaking bodies. Road tests visit all 508 nodes and sample every lane edge against pavement.

`node --import tsx scripts/world/verify-network.mjs` runs a CPU-only integration over actual local HTTP. It uses the production manifest, native Babylon loader and real Havok, and injects one actual HTTP 503 response for a western detail package to verify successful retry. NullEngine parses texture references but does not fetch/render PNGs, so this is network/geometry/collision evidence rather than a visual check. Its recorded trace is [network-world.json](evidence/network-world.json).

At the initial network checkpoint, readiness downloaded 12 of 84 packages and retained 391 of 1,221 visual meshes: 24.0 MB of the full 58.3 MB CPU geometry. Package/material transfer was 5.29 MB, plus the manifest. Westward travel and return disposed two packages/72 meshes and 100 Havok colliders; a remote active body stayed supported. Background loading continued independently of readiness. These measurements are from the CPU harness; browser validation follows the separate profiling run.

Corrected sign PNGs retain their original 1024×128 canvas dimensions; these dimensions and every exported mesh/geometry ID are checked by the package tests.

Earlier renderer evidence in `*-world.png` predates asynchronous package loading. It shows the preserved authored geography but must not be treated as validation of the new loading path. The project still has original procedural assets, finite local coverage, no production-scale asset pipeline and no reference-game visual or map parity. HTTP/disk caching may retain compressed files independently of released JavaScript geometry; runtime eviction does not clear the browser cache.

## Final third-checkpoint corrections

The final `authored-860409-v3` export contains 57,932,888 bytes of CPU geometry and 13,132,677 bytes of compressed package/material files, plus 722,275 bytes of PNG textures. Exporting merged meshes with source disposal had mutated shared box-template indices; some later boxes referenced vertices beyond their arrays. `mergeAuthoredBatch` now requests a separate merged index buffer and disposes source meshes explicitly afterward. Export and package tests validate every geometry index and preserve the shared template.

The runtime calls injected/native fetch with the global receiver, avoiding the browser's Illegal invocation error. Parsed PBR materials share the scene image-processing configuration rather than restoring a serialized disabled override. Both normal-control browser backends now pass 12 stages, including visible scenery after travel, real PNG rendering and intentionally failed/retried destination loads. Screenshots retain the visibly provisional architectural and character fidelity.
