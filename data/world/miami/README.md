# Brickell source foundation

This is a bounded real-geography input, not a finished or photorealistic city. Initial bounds are longitude −80.199…−80.187, latitude25.7596…25.7704. `src/world/miami/projection.ts` uses the fixed WGS84 origin25.765,−80.193: X east, Z north, Y independent elevation in metres. Horizontal distances are not compressed. The SE8thStreet/BrickellAvenue shared City street node is −80.1907224560056,25.7661748271726.

`manifest.json` records the six official feature sources, complete returned object-ID counts, exact query URLs, checksums, attributions and terms. `raw/` preserves every source feature intersecting the area, including full geometry outside the boundary. It contains135 street segments,590 County footprint features (613 Polygon parts),16 shoreline lines,12 water features,265 UBID/address records, and the complete City administrative boundary. The boundary includes water and is not a land mask. These counts are source records, not verified counts of distinct current buildings.

City Streets, Shoreline, WaterBodies and CityBoundary item metadata explicitly declares [CC BY4.0](https://creativecommons.org/licenses/by/4.0/). Credit City of Miami, Department of Innovation and Technology, GIS Team, and Miami-Dade County Information Technology Department where named by the item. Exact notices are retained in `metadata/*-item.json`. The [official City catalog](https://datahub-miamigis.opendata.arcgis.com/) supplies the hosted feature services.

The [County footprint dataset](https://www.arcgis.com/home/item.html?id=d511e9ebc5aa4f49a23ff5fa2fb99786), UBID data and [3D source meshes](https://www.arcgis.com/home/item.html?id=ce420278a45a4bf4a349c37c197263b3) use the County's custom public-data terms: provided for use as-is for illustration, with no surveying/engineering accuracy guarantee. These sources are not relabeled CC0 or CC BY. Credit Miami-Dade County ITD, Geospatial Infrastructure Support Group. Their exact notices are retained in item metadata. Do not treat parcel-associated addresses or floor counts as individual tower identity without a geometry match.

`osm-supplement.geojson` retains1,335 road/path ways and340 building/part features,195 with explicit height tags. All source way coordinates and multipolygon holes are retained; none was rejected. These are community-mapped values, not surveyed measurements. OSM copyright and [ODbL1.0](https://www.openstreetmap.org/copyright) apply to the extract and OSM-derived database. Credit ©OpenStreetMap contributors. Keep the attribution and share-alike database terms when distributing derivatives.

`building-meshes.json` indexes UV-free Float32 relative positions, transformed source normals and UInt32 triangle indices in `building-meshes.bin`. Each record has a per-building ENU origin, local/world bounds, source IDs/year and source node. There are262 finest-source meshes,368,152 triangles and409,968 vertices. No roof or facade geometry was invented, simplified or moved. The [I3S1.6 standard](https://docs.ogc.org/cs/17-014r7/17-014r7.html) defines source vertex offsets relative to node bounding-sphere centres. The source declares WGS84 horizontal coordinates and NAVD88 vertical metres. All source meshes date to2015; they do not establish contemporary completeness. `building-envelopes.json` derives min/max from actual mesh vertices, not the ambiguous County HEIGHT field. All590 footprint HEIGHT values are null.

`i3s/source-nodes.tar.gz` preserves the exact470 decompressed public node/geometry/attribute payloads used by the exporter. Its checksum and all per-payload hashes are in `i3s/manifest.json`. No source imagery or textures were downloaded. Unpacked `.bin` files are an ignored reproducible cache. `building-reconciliation.json` records200 exact UNIQUEID/geometry matches,390 newer2023 footprint records without UNIQUEID, and62 old meshes without an exact current footprint join. Bounding-box candidates are review hints only. In particular, the UBID address801Brickell spans a complex and must not label every associated tower.

`terrain/grid.json` describes the1200×1080 little-endian Float32 NAVD88 grid in `terrain/heights.f32`. Pixel centres start at longitude−80.198995,latitude25.770395; step east0.00001° and south0.00001°. The [USGS3DEP bare-earth service](https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer) is locked to the two Miami-DadeD23 one-metre rasters. Exactly33,408 missing eastern coastal pixels use the separately retained older NAVD88 coastal mosaic, marked1 in `source-mask.u8`; primary pixels are0. Every final pixel is valid. Original GeoTIFFs and source catalog/datum records are retained. [USGS-produced data is public domain](https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits); credit U.S.Geological Survey. DEM elevation is not a curb, bridge deck, tide, or independently surveyed building entrance height.

Reproduce with Node and TypeScript dependencies from the repository, Python3 and Pillow:

```sh
node scripts/world/miami/acquire.mjs
node scripts/world/miami/acquire-osm.mjs
node scripts/world/miami/normalize-osm.mjs
node scripts/world/miami/acquire-i3s.mjs
node scripts/world/miami/decode-i3s.mjs
node --import tsx scripts/world/miami/export-i3s.ts
node scripts/world/miami/acquire-terrain.mjs
python3 scripts/world/miami/decode-terrain.py
node --import tsx scripts/world/miami/reconcile.ts
python3 scripts/world/miami/package-i3s.py
node scripts/world/miami/verify.mjs
```

For offline reproduction, unpack the retained archive with `tar -xzf data/world/miami/i3s/source-nodes.tar.gz -C data/world/miami/i3s` before decoding. The metadata snapshots under `research/` are required to validate the source I3S schema. Network acquisition retrieves current public data, so a changed upstream snapshot must produce a new manifest and review rather than silently replacing an accepted cohort.

`coverage-plan.json` defines adjacent growth. Work remains on current building reconciliation, facade/material fidelity, bridge decks, curbs/lane/sidewalk widths, street furniture, vegetation, traffic and full City coverage. Google Maps/Street View are location/reference links only; no Google imagery, tiles, traced geometry or textures are part of this dataset. Offline verification is recorded in `verification.json`; it does not imply browser/gameplay or final visual acceptance.
