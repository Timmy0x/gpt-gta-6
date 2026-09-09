# Miami Beach geographic reference

A small OpenStreetMap extract now supplies editable real-world road centerlines and building footprints for future authoring. It is a fallback geographic reference under the objective's source hierarchy, not GTA VI map data. This checkpoint does not replace the authored runtime district, road graph or collision geometry with GIS features.

## Source and permitted use

The source is OpenStreetMap, retrieved successfully from the public FOSSGIS Overpass endpoint `https://overpass-api.de/api/interpreter` on 2026-09-09 at 12:36:49UTC. The response's OSM base timestamp is 12:35:09UTC. The query bbox is south 25.770, west -80.140, north 25.784, east -80.127, covering an Ocean Drive / southern Miami Beach reference area. The raw response contains 13,534 elements and is 1,685,550bytes; its SHA-256 is `0742f53c479a3d573e912a146beae4f13043094bb527a1de0e1dbc938b31ce9c`.

Attribution: **© OpenStreetMap contributors**. The extract and derived geographic data are provided under the [Open Data Commons Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/). OpenStreetMap requires attribution and identification of the database license; adapted database distribution follows its share-alike conditions. See the [official copyright and license page](https://www.openstreetmap.org/copyright). The dataset's [license notice](../data/gis/miami-beach/LICENSE.txt) and [source metadata](../data/gis/miami-beach/source.json) travel with the files.

This was one successful request to the primary endpoint (HTTP 200). The acquisition script has a second public Overpass endpoint as a fallback, but did not need it. No provider failure or unavailable-data claim was invented. The exact [query](../data/gis/miami-beach/query.overpassql), untouched [raw JSON response](../data/gis/miami-beach/raw-overpass.json), request result and retrieval date are retained. The [Overpass API documentation](https://wiki.openstreetmap.org/wiki/Overpass_API) identifies the public service.

## Editable outputs and coordinate transform

- [miami-beach-wgs84.geojson](../data/gis/miami-beach/miami-beach-wgs84.geojson) uses geographic longitude/latitude coordinates and normalized polygon winding.
- [miami-beach-local.geojson](../data/gis/miami-beach/miami-beach-local.geojson) uses local east/north metres with explicit coordinate-system metadata. It intentionally is not RFC7946 geographic GeoJSON: an editor must respect the local coordinates rather than interpreting them as longitude/latitude.
- [road-topology.json](../data/gis/miami-beach/road-topology.json) retains OSM node IDs, way IDs and per-edge highway, layer, bridge, tunnel and one-way tags.

The local origin is longitude -80.1309, latitude 25.7823, ellipsoid height 0 m. The importer converts WGS84 geodetic positions to Earth-centered Cartesian coordinates using semi-major axis 6,378,137m and flattening 1/298.257223563, subtracts the origin and rotates to a local east/north tangent plane. Coordinates are rounded to 1 mm for editing. Elevation is not supplied by this extract. A future Babylon import can map east→X, north→Z and a separately authored elevation→Y.

Roads preserve their complete queried ways, including vertices outside the selection bbox. They are not clipped or welded by proximity. Their retained local bounds reach approximately X[-1193,884]m and north[-2038,2940]m because some paths cross the bbox boundary. Tags are preserved as source strings; no missing heights, lanes, widths or driving rules are fabricated.

Building ways must already close in the source. Multipolygon member ways are stitched only through shared endpoint IDs, including reversed members; inner rings are assigned to containing outer rings. Open chains and orphan holes are rejected and recorded. This extract imported without rejected features. Polygon outer rings are counterclockwise and holes clockwise.

## Validation

The extract produces 2,333 features: 1,028 building polygon/multipolygon features and 1,305 roads or paths. It contains 1,046 building rings, 4,645 road nodes and 5,890 road edges. Building footprint areas range from 14.0 m² to 10,995.6 m². No open ring, proper self-intersection, orphan hole, invalid winding, non-finite coordinate, missing road node or raw-hash error was detected.

Projected road/path length totals 109.583km, counting separately mapped sidewalks, paths, service ways and complete ways beyond the bbox. A spherical geodesic cross-check totals 109.758km; the largest individual segment discrepancy above 1 m is 0.4275%, consistent with comparing a WGS84 ellipsoid tangent plane against a spherical distance approximation. Tests separately verify the origin and the expected east/north metre scale.

The preserved road/path graph has two connected components: 4,636 nodes and 9 nodes. The small component is OSM way 481648920, tagged as a service parking aisle near the western selection boundary. It is retained as disconnected, not joined by an invented road. The data needs author review before becoming a playable lane network; this topology report does not claim every mapped path is drivable.

Full results are in [validation.json](../data/gis/miami-beach/validation.json). These checks validate this conversion, not the completeness or current physical accuracy of every OSM feature.

## Reproduction and integration status

Run `node scripts/gis/acquire.mjs` only when deliberately refreshing the source snapshot; it performs a public API request and updates provenance. Rebuild local files offline with `node scripts/gis/import.mjs`, then run `node scripts/gis/validate.mjs`. The projection, ring assembly and snapshot checks also run with `node --import tsx --test tests/world-gis.test.ts`.

The importer and raw snapshot establish a licensed source foundation. Geographic alignment to documented Leonida, landmark selection, road-width/lane authoring, façade assets, terrain elevation and runtime chunk generation from these shapes remain future work. No GTA VI map parity, actual building height or real-world interior is claimed.
