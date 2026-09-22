# Brickell public collision expansion R2

This compiler retains the complete available public source area around the first playable Brickell Avenue / SE 8th Street junction. It uses source geometry, terrain and mapped roads; it does not extract or author collision from streamed Google imagery.

The original acquisition rectangle is longitude −80.199 to −80.187, latitude 25.7596 to 25.7704. The surface rectangle is inset one retained raster step (about one metre) to keep the numerical surface-query derivatives inside actual bilinear pixel-centre coverage. Its common-frame bounds are approximately x −831.654 to 370.201, z −730.057 to 464.211: **1,202 × 1,194 metres**, without scale compression. The same origin, latitude 25.7662 / longitude −80.1907 / ellipsoid height 0, remains unchanged. Output world ID is `brickell-public-common-frame-r2`; save compatibility requires an explicit runtime migration for the unchanged frame.

## Sources and coverage

- All **262** County 2015 I3S source-building features intersecting the original acquisition rectangle are retained whole, including parts extending beyond it: 368,152 original building triangles. Geographic input is decoded directly from original request bytes, not inverted from an older quantized local mesh. The existing archive SHA-256 is `c579f8eb6ec5061418812a354de63c4d5504c4613a7aeb14c872a0163b9be73d`; preparation verifies the archive and all 82 required original request payloads. The archive itself is already retained in the repository and is not duplicated here.
- Terrain uses 1,296,000 USGS one-metre-source raster samples resampled to the recorded WGS84 grid. 33,408 cells are explicitly marked older coastal fallback; the remainder use Miami-Dade D23. Bilinear interpolation and adaptive triangulation are numerical surface approximations, not additional surveyed detail.
- **130 clipped road pieces**, approximately **15.1 km of centreline**, retain City street geometry and the frozen, documented R5 OSM direction/width/profile joins. Road widths, curbs and paving offsets remain authored assumptions where the source lacks surveyed edges.
- Mapped dry land covers approximately **1.205 km²**, including one contiguous polygon of 1.129 km² and three smaller disconnected pieces. Twelve mapped water features cover approximately 0.230 km². Water and every unmeasured waterbed remain non-supporting. Four source road records crossing water without a verified bridge profile remain excluded; no deck is fabricated.
- The existing lane builder produces 1,871 lane nodes, 32 terminal nodes, and nine weak components; 1,799 nodes belong to the largest component. This is a source-backed street network, not proof that every turn, traffic rule or pavement edge is current.
- 223 joined County footprint parts correspond to 200 of the 262 retained source-building colliders. 62 colliders have no joined footprint, and 390 other County input footprint parts lack a joined 3D source feature. The differing source catalogues and acquisition dates do **not** establish current building-by-building completeness. Do not substitute arbitrary-height footprint extrusions to make this count appear complete.

The compiled frame remains explicitly provisional. Source EPSG:4326 realization/epoch is unresolved; NAVD88 H + NOAA GEOID18 N is used as an approximate ellipsoid height in the WGS84-formula local frame. This is not an exact NAD83-to-WGS84 realization conversion. Metre-scale, potentially 2m-level source/provider mismatch remains, as do source age and physical correspondence uncertainties. Original NOAA point samples, public-domain attribution, geoid source hash, source dates and County provenance remain retained.

## Reproduction

```sh
npm ci --ignore-scripts
npm run compile
npm run typecheck
npm test
npm run audit
```

Prepared `data/` is sufficient for compilation and native testing, with no network or proprietary access. To independently rebuild only the geographic building input from the already retained public archive:

```sh
python3 scripts/prepare-buildings.py /path/to/repository/data/world/miami
```

That folder must contain `building-envelopes.json`, `i3s/manifest.json`, and `i3s/source-nodes.tar.gz`. The prior script that depended on an implicit task-local R5 directory is replaced by this explicit-input command. The prepared terrain, GIS dataset, geoid cutout and metadata remain the pinned R1 inputs; their provenance is recorded in `data/preparation.json`. The retained 23-point PROJ oracle validates unchanged frame arithmetic under the same provisional datum policy; it does not validate modern surface correspondence.

## Runtime handoff and evidence

The compiled package contains 51 chunks, 437 mesh records, 6,335,492 total triangles and 211,968,600 bytes of mesh data. Native samples measured maximum ground interpolation error 30.27mm, road error 18.91mm and resting-body error 0.483mm; these are sampled mesh-versus-retained-raster checks, not survey accuracy.

Copy only `output/packages.json`, `dataset.json`, `runtime-query.json`, `terrain/`, and chunks referenced by the package manifest into the game's world directory. All mesh records are `render:false`, `collision:true`. `coordinates.json`, `native-result.json` and `expansion-audit.json` are evidence/authoring records, not required startup payloads. No credentials or streamed provider content are included.

`npm test` exercises the actual generated public meshes in native Havok, source terrain and road height agreement, selected exposed building faces, missing coverage, source-frame arithmetic and a dynamic resting body. Building checks use a temporary single-body collision membership bit; they do not wrap a bit per building past 32 bits. Not every source building has both an upward roof face and a near-vertical wall in the selected normal categories; native evidence lists actual checked groups rather than pretending 524 categories exist.

`npm run audit` writes actual source coverage, road connectivity, source hashes and sampled collision/preload byte envelopes to `output/expansion-audit.json`. The runtime's old 420m prefetch and 820m eviction exclusion can exceed the nominal 96MiB CPU geometry budget on this larger area. Parent integration must prioritize required/anchored collision and bound optional prefetch; the audit's byte totals exclude JS, physics and GPU duplication. Real play, streaming boundaries, shoreline behavior and rendering performance must be verified in the integrated game separately.
