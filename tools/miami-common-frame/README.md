# Brickell public collision data in the common renderer frame

This is a bounded, actual public-data collision package for the Brickell Avenue / SE 8th Street area. It does not use streamed provider geometry. Surface coverage is approximately 361 × 355 metres, centred at latitude 25.7662, longitude −80.1907. Twenty complete selected County source-building volumes are included; their bounds can extend beyond the surface AOI. Gameplay navigation/spawning must stay on the actual dry surface coverage and use normal obstruction checks.

The output is provisional: source EPSG:4326 realization/epoch is unresolved. GEOID18 is evaluated at the numeric source coordinates, and NAVD88 H + geoid N is used as an approximate WGS84-formula ellipsoid height. The input is **not** relabelled NAD83(2011), and the missing NAD83↔WGS84 realization/epoch step is **not** called exact. Metre-scale, potentially 2m-level mismatch remains; that is not a statistical bound. Survey/source age and physical correspondence are separate uncertainties.

## Runtime handoff

Copy `output/` to the game's selected public world directory. `packages.json` uses the existing `MiamiPackages` layout: Float32 local positions/normals/UVs, Uint32 indices, exact binary hashes, per-mesh origin and residency bounds. Its additional frame/provenance/exclusion fields should remain available. Every mesh has `render:false`, `collision:true`; use the streamed visual module for city appearance. The package has 7 chunks, 48 meshes, 630,610 triangles and 21,368,568 mesh bytes. There are no waterbed colliders.

`dataset.json` shares the package world ID, contains common-frame bounds, 13 clipped source-road pieces, 12 joined footprint parts, dry land and the AOI's clipped water list (empty for this first land AOI). All 20 source-building colliders remain in the package even where the County footprint join is unavailable. `locations` are labelled source/query locations, not automatically clear or safe spawns. Four unsupported road/deck records are retained in the exclusion ledger. Original whole-AOI water IDs are retained there too.

Runtime source files are `src/CommonFrame.ts`, `src/SourceCoordinates.ts`, `src/PublicCollisionQueries.ts`. The latter two refer to the pinned legacy projection and polygon containment helpers under `vendor/world/miami`; when integrating into the existing game, those imports may target the identical existing helpers.

```ts
const queries = await loadPublicCollisionQueries('/world/miami/');
queries.floorHeightAt(x, z); // local Up, or null outside retained dry ground
queries.surfaceAt(x, z); // local point, geodetic coordinates, NAVD88, source-mask flag
queries.hasSourceGround(x, z); // coverage only, not collision clearance/walkability
queries.frame.navd88ToLocal(longitude, latitude, navd88Metres);
queries.frame.localToGeodetic([x, y, z]);
queries.frame.localToProvisionalNavd88([x, y, z]);
```

The loader reads `runtime-query.json`, `terrain/heights.f32` and `terrain/source-mask.u8`; `terrain/grid.json` is also supplied for inspection. If these arrays are already loaded, call `createPublicCollisionQueries(config, heights, mask)` directly. Floor queries iteratively solve the transformed DEM surface's x/z coordinates; they do not treat NAVD88 as local Up. There is no bridge, water or out-of-coverage fallback. Road/sidewalk top surfaces have the pinned authored surface/curb offsets, so final support/clearance must use native collision checks. Preserve a frame version in saves and transform all dynamic spawn/navigation/map locations coherently.

## Source and arithmetic

- Terrain is the retained USGS D23/older-fallback NAVD88 raster, with source-mask values preserved. Roads use the frozen R5 mapped City centerlines, documented widths, mapped dry clipping, 2 m adaptive surface subdivision and authored curb offsets.
- Selected I3S inputs are decoded directly from the original verified node geometry bytes: Float32 longitude/latitude/NAVD88 offsets plus node MBS, retained as Float64 geographic input. No inverse of the older quantized building export is used. Source object/UNIQUEID, node, 2015 date and original archive/request hashes are preserved. There were no zero-area triangle removals in the selected set.
- GEOID18's 6×6 cutout contains exact original Float32 point samples without resampling; it preserves the public-domain NOAA grid SHA, source indices, CRS and license. Bilinear sampling rejects missing coverage. Full ECEF coordinates and origin subtraction use doubles, with x=East, y=Up, z=North. Only final chunk-relative buffers are Float32. Maximum measured packing error is 10.43 micrometres.
- Original source NAVD88 vertex heights are retained in a packed Float32 sidecar; original building geographic inputs remain Float64 under `data/`. Normals are recomputed from transformed geometry while existing hard-edge vertex splits are preserved. Legacy ground/road horizontal positions are inverted with a checked Newton solve before reprojecting.

## Reproduce and verify

`package.json` and the pruned lockfile pin the compiler/runtime dependencies. This local review used the existing matching installed dependency tree through a development symlink; the symlink is not part of the freeze.

```sh
npm ci --ignore-scripts
npm run compile
npm run typecheck
npm test
```

`data/` contains the prepared public inputs, so compilation/tests need no network, geodesy installation or provider access. The optional original-source preparation script requires the retained R5 source directory and official grid; the independent PROJ oracle script requires the existing pyproj runtime. The retained oracle can be tested directly without either Python runtime.

Independent full-PROJ arithmetic agrees on 23 actual source points to 4.66e-10 m under the same explicitly provisional policy. Native Havok tests load every static mesh, check actual ground and road rays, exposed building faces, and a resting dynamic body at the source junction. `output/native-result.json` contains the measured counts and errors. These arithmetic/physics checks do not establish exact provider/public-source surface correspondence or current architectural fidelity.
