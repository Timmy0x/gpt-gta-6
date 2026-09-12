# Brickell building identity and source massing review

This follow-up checks actual polygon overlap instead of relying only on bounding boxes. It does not change the retained source meshes, replace newer buildings automatically, or establish contemporary architectural fidelity.

`building-mesh-footprints.json` contains the horizontal union of roof/floor triangle projections for all 262 retained County I3S objects. Coordinates are local ENU metre pairs `[x,z]`, using the shared `projectMiami` projection; this custom JSON is not WGS84 GeoJSON. Millimetre snapping makes topology robust. Near-vertical faces contribute no horizontal footprint. The original vertex data and archive remain unchanged.

`building-spatial-reconciliation.json` compares these polygons against all 590 current County footprint features. Every one of the 200 exact `UNIQUEID` associations is also the strongest polygon overlap. The minimum intersection-over-union is 98.4182%, and the minimum portion of the current footprint covered by its matched mesh is 99.2064%. This supports identity and mapped placement. It does not prove that a 2015 building remains unchanged today.

Of the 390 newer footprint features without `UNIQUEID`, only 17 have more than 95% of their horizontal area covered by one retained older mesh. The remaining 373 require new geometry review. Even the 17 covered areas cannot inherit old heights or façade detail automatically; subdivisions and changed physical buildings can share a horizontal footprint.

Named/addressed OSM polygons are retained as separate candidates with their own overlap fractions. OSM names, levels and heights are evidence with their own uncertainty, not authoritative replacements for a County source object.

## 701 Brickell

County `D1_MDC_Building_426`, current footprint object 692261 and I3S `county-i3s:316` refer to the same mapped massing. Its source minimum is 1.099082 m NAVD88, roof is 136.693656 m NAVD88 and mesh extent is 135.594574 m. Architectural height is a separate measurement from this source-vertex extent.

`701-source-sections.json` retains eight closed horizontal sections of this object. The source contains intersecting/nested volumes. Segment intersections are explicitly noded before bounded-face traversal and union; tiny numerical holes below 0.01 m² are removed only from these inspection sections. The inspection data leaves the source mesh unchanged.

The upper source envelope is rectilinear. It does not contain the rounded corners visible in the separately licensed west-elevation reference. Its nested/copanar masses can obscure façade details. Therefore the raw object is accepted only as mapped massing, not as a finished façade or a clean architectural shell. The independently authored upper shell is owned by the landmark module and must remain labelled inferred where dimensions lack stronger evidence.

## 801 Brickell address ambiguity

The UBID record labelled 801 Brickell spans a broad complex and uses representative `D1_MDC_Building_3`. That source object is the southern narrow tower (`county-i3s:194`), so the address alone must not label it as the 801 office building.

The OSM polygon `osm:way/299469143`, named One Brickell Square and addressed 801 Brickell Avenue, instead has 87.76% of its area inside `county-i3s:2` / `D1_MDC_Building_10`, with no other retained mesh intersection. This is an office-complex association candidate. Its source extent is 111.191015 m; OSM's 190.5 m height conflicts and is not adopted. The [property location page](https://801brickellmia.com/location/) establishes the address; it does not by itself certify the mesh envelope.

## Reproduce and verify

Run the following from the repository root, after the source acquisition/export checkpoint:

```sh
node --import tsx scripts/world/miami/reconcile-spatial.ts
node --import tsx scripts/world/miami/sections-i3s.ts
node scripts/world/miami/verify-reconciliation.mjs
```

The final command checks source hashes, complete identities, all exact matches, finite closed rings, overlap bounds and eight closed inspection cuts. `spatial-verification.json` records the measured result. Original source attributions and license terms remain in the main data manifest and metadata snapshots.
