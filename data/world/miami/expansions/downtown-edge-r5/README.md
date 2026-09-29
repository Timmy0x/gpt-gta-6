# Bounded Brickell → Downtown public-source preparation R5

Prepared on 29 September 2026 against baseline `9cf3af6`, independently of the current game. This is source-backed expansion input, **not runtime integration, photorealistic scenery, or proof of contemporary 1:1 Miami completeness**.

The new cell is longitude −80.199…−80.193 and latitude 25.7704…25.7758, directly adjoining the northwestern half of the accepted Brickell source rectangle. It is approximately 602 × 598 metres with unchanged horizontal scale. It covers part of Downtown west of the Miami River mouth, including source records labelled SW 1ST ST, W FLAGLER ST, SW 2ND AVE and I95. Full returned source geometry is retained even when it extends beyond the cell. The river and unverified elevated crossings still prevent a promise of continuous playable travel.

## Concrete acquisition

The single bounded acquisition used 100 public requests and 12,041,910 downloaded bytes, below its 350-request/40 MiB cap. Three additional bounded metadata requests retained official USGS product/ScienceBase records and 13,456-byte XML. No vendor contact, purchase, proprietary login, credentials, Google-derived collision, aerial/street imagery or texture resources were involved.

- **89 City street records**, complete object-ID reconciliation, 89 returned full polylines. City fields include raw one-way/cost/level/ramp values. Centreline geometry does not measure pavement, curb or sidewalk edges.
- **58 County footprint records**, 35 carrying 2015 unique IDs and 23 updated 2023 without a unique 3D join. Footprint heights are not turned into arbitrary extrusions.
- **2 water polygons and 2 shoreline lines**. Their overlap IDs match accepted geometry exactly. Water is non-supporting; DEM coverage never makes it drivable land.
- **38 finest-source County 3D building features**, 75,098 original triangles and225,294 source vertices. Full source face ranges survive in Float64 geographic input; no replacement box, roof invention, simplification or height inference. Three source IDs already intersect the accepted cell, leaving 35 additional source-feature IDs after stable-ID deduplication. 35 mesh features join exact County unique IDs; three old meshes lack that join. All 38 source features report 2015.
- **600×540 Float32 terrain samples**, all 324,000 valid, NAVD88 metres. Export is locked to Miami-Dade D23 one-meter-source raster ID 29040 and resampled to the existing 0.00001° WGS84 grid phase. No coastal fallback or missing-value fill was used in this cell. Ground values range 0.06094…7.67886 m NAVD88.

The official USGS product metadata records a temporal range 2023-12-27…2024-05-29 and publication 2025-12-15. The ImageServer catalog separately records AcquisitionDate 2024-05-29; those fields are retained without treating a publication/catalog date as a per-point observation epoch. Native source product horizontal metadata says NAD83 / UTM 17 and verticalNAVD88. The service exported EPSG:4326 coordinates do not resolve the source's exact horizontal realization or coordinate epoch.

## Source provenance and licenses

Exact metadata, requestURLs, response hashes, dates, custom notices and attributions are retained in `manifest.json`, `metadata/`, `terrain/manifest.json` and `i3s/manifest.json`.

- [City of Miami GIS catalog](https://datahub-miamigis.opendata.arcgis.com/) and retained hosted Streets / WaterBodies / Shoreline item notices: **CC BY 4.0**, credit City of Miami Department of Innovation and Technology GIS Team and the County where the item names it. Their source dates differ; street item metadata is older than shoreline/water publication.
- [County 3D scene item](https://www.arcgis.com/home/item.html?id=ce420278a45a4bf4a349c37c197263b3) and [County footprint item](https://www.arcgis.com/home/item.html?id=d511e9ebc5aa4f49a23ff5fa2fb99786): **County custom as-is public-data terms**, retained verbatim in item metadata; credit Miami-Dade County GIS/ITD. Do not relabel them CC0 / CC BY or infer survey accuracy. County 3D layer advertised coverage extends across Miami/Downtown/western adjacent cells, but its 2015 feature epoch remains a material limit.
- [USGS 3DEP service](https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer), [selected product metadata](https://www.sciencebase.gov/catalog/item/69423b61d4be02297efc2c5a), and [USGS credits](https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits): **public-domain USGS-produced elevation data**, credit USGS 3DEP. Bare-earthDEM does not establish bridge decks, tide, waterbed, facade/entrance heights or street furniture.

## Prepared compiler inputs and checks

`prepared/i3s-geographic.bin/json` stores original Float64 longitude / latitude / NAVD88 and Float32 Earth-centred source normals, 36 bytes per source vertex. `prepared/terrain/grid.json`, `heights.f32`, `source-mask.u8` preserve the new source raster. The deterministic original-payload archive is `i3s/source-nodes.tar.gz`, 986,937 bytes, SHA256 `7f37b59317269b97bc75c82876aeb3541ac657ce1fd83d5e3d106fc2c4479032`.

`prepared/terrain/northwest-strip-*` provides an actual 600 × 1620 rectangular grid: the new 540 rows followed by the accepted west 600 columns of all 1080 old rows, byte-for-byte. It permits bilinear queries across the shared seam without separately inset cells creating a gap. It is preparation input; copying it over the accepted grid would silently remove the old eastern half and is incorrect.

Source overlap is explicit in `prepared/reconciliation.json`: 2 shared street IDs, 2 water IDs, 2 shoreline IDs, 4 footprint IDs and 3 mesh IDs. Shared feature geometry matches exactly. Terrain grid phase matches to numerical precision; neighboring pixel centers are one recorded grid step apart. Maximum adjacent seam-sample difference is 0.564 m, mean 0.0305 m. Those are neighboring ~1 m cells, not same-point residuals or an accuracy guarantee; local riverbank/curb gradients need inspection.

`prepared/verification.json` independently checks 114 original source vertices, exact source normals/face ranges, all 1080 accepted strip rows byte-for-byte, five real seam bilinear stencils, and unsupported-outside returns. It uses the unchanged common-frame origin 25.7662 / −80.1907 / ellipsoid height 0 and existing GEOID18 cutout. Roundtrip arithmetic error was 1.1e-14 degrees. That proves numeric handling, **not** datum realization or source/provider physical parity; the existing provisional NAVD88 H + GEOID18 N policy and potentially metre-scale mismatch remain.

`prepared/source-coverage.png` is an authored diagram of actual retained City polylines/water and County footprint polygons. It is not a game render or source photograph.

## Exact next compiler work

1. Merge original/new raw features by source+stable ID; assert shared geometries/source versions agree. Merge all 38 mesh features by County ObjectID, retaining the three existing colliders once. Preserve whole mesh faces and dates. Keep 23 unjoined 2023 footprints explicit instead of filling them with guessed boxes.
2. Compile source support from the combined 600 × 1620 west strip and the accepted eastern 600 columns, with a shared pixel stencil/halo at both seams. Repartition/replace affected accepted terrain chunks; do not overlay two physical grounds. Keep original sampled ordinates, source masks, fixed origin, existing GEOID18 sample coverage and provisional datum status. Use dry geometry minus full source water polygons; outside real support remains unavailable.
3. Rebuild bounds/chunkhashes/query metadata together. Current compiler assumes one rectangular DEM and pinned old R5 road joins, so it cannot safely ingest this L-shaped union by only changing bbox. Add explicit mosaic support or partitioned samplers and matching dry coverage first. Require coverage queries and native Havok seam/resting-body checks on generated meshes before adding teleport destinations.
4. New City street routes retain exact centerlines and raw source direction/level fields. Validate coded semantics and joins; measure or obtain road edges / curb / sidewalk widths rather than assuming them. I95 ramps/elevated roads and river crossings remain withheld from driveable physical-deck generation until independent approved / as-built / 3D source profiles establish their height. Never sample bare earth as a bridge deck.
5. Acquire neighboring north-east cell`[−80.193,25.7704,−80.187,25.7758]`, then full north row`[−80.199,25.7758,−80.187,25.7812]`; acquire west`[−80.205,25.7596,−80.199,25.7704]` under separately bounded manifest budgets. Query official raster coverage and source IDs before downloading. Those extents are plans, not acquired/currently playable coverage. Use exact same 0.00001° grid phase and shared full feature ID cohort.

Exact current building facades/materials, modern missing structures, per-street surveyed edges, bridge mechanics, street furniture/vegetation, source epochs and datum/provider correspondence still need independent sources and verification. This bounded 2015 massing / public terrain cell does not satisfy the full 1:1 photorealistic Miami goal.

## Reproduce without proprietary access

From the R5 geography source directory:

```
node scripts/world/miami/acquire-expansion-r5.mjs
node scripts/world/miami/acquire-expansion-metadata-r5.mjs
python3 scripts/world/miami/prepare-expansion-r5.py
node --import tsx scripts/world/miami/verify-expansion-r5.ts
python3 scripts/world/miami/plot-expansion-r5.py
```

Network acquisition is bounded and only writes thiscell. Original request hashes must match the recorded cohort; upstream changes require a new cohort rather than silently replacing accepted inputs. If raw I3S `.bin` cache files are omitted from a retained artifact bundle, unpack thiscell's `source-nodes.tar.gz` into its `i3s/` directory before running offline preparation. The existing accepted baseline archive/terrain/common-frame inputs remain required and untouched.
