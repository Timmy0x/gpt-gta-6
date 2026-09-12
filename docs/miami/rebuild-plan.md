# Miami reconstruction plan

The user replaced the previous fictional map objective on 2026-09-12: rebuild the City of Miami at real scale, beginning in Brickell and expanding through adjoining areas. The old street grid, invented districts, landmarks, coastline and location list are retired from the replacement map. Character, vehicle, combat, physics, persistence and rendering systems remain reusable. Earlier geographic work is retained in Git history, not reused as Miami scenery.

## Selected reality-mesh source

The user selected Aerometrex for personal use on 2026-09-12. Acquire a provider-issued Miami extract beginning with the established Brickell AOI, then expand through the available municipal coverage. The advertised 2021 capture is a source epoch, not a claim of parity to present-day Miami; the published 9.1 km² product is not the entire City of Miami. Request the actual coverage polygon, newer captures and missing-area options before marking any area covered. The prepared access request is in `docs/miami/aerometrex-access.md`.

Keep source deliveries, access records and derived licensed packages in the ignored `.private-data/` directory or another local private directory. They must not enter this public Git repository or its public Vercel build. The current delivery inspector and coordinate adapter prepare ingestion; no Aerometrex model has been acquired or integrated. Source-textured surfaces still need street-level comparison, collision/clearance verification and separate moving objects after ingestion. Retain the public survey foundation for geographic checks and development while access is resolved.

## Geographic contract

The scope is the City of Miami municipal boundary, including its roads, buildings, parks and waterfront. Miami Beach and other municipalities are separate geography, not silently counted as completed Miami. External bridge/road connections receive explicit boundary records. The complete municipal polygon defines the master coverage atlas; the initially playable area is a smaller contiguous construction stage.

Use WGS84 source coordinates and a Brickell-centred local east/north tangent plane. The fixed origin is latitude25.765, longitude−80.193; X is east, Z north, Y survey elevation in metres. The origin is an arbitrary stable coordinate anchor, not an asserted street intersection. There is no world-distance compression. Horizontal and vertical source units are independently recorded: State Plane feet must never imply that an undocumented height field also contains feet.

Every street segment, building part, water polygon and authored asset has a persistent source identity. Raw data, retrieval time, license/terms, hashes, projection and conversion scripts are preserved. Geometry corrections are authored overrides tied to those identities, so reimporting updated survey data cannot arbitrarily change the world or saved damage.

## Source hierarchy and reference limits

1. City/County survey and open GIS: municipal boundary, streets, building footprints, shoreline, water, parcels, parks and elevation where defined.
2. Explicitly licensed OSM attributes for named streets, directions, lane counts, heights, building levels and POIs. OSM and municipal data retain separate attribution and source layers.
3. Reusable survey, architecture and street photography; official building/project information for named structure dimensions and shape references.
4. Authored approximations only where the source is incomplete. These remain visibly marked in the internal coverage ledger and do not pass the exact-reconstruction gate.

Google Maps/Street View links may locate reference places for inspection, but their imagery is not extracted, traced, downloaded or converted into game geometry or textures. Google's current Geo Guidelines prohibit those extraction uses. Game assets need an independently usable source. The user-facing experience has concise controls; source/review detail belongs in the development atlas and asset credits.

The first City street extract identifies the shared SE8th Street/Brickell Avenue endpoint at longitude−80.1907224560056, latitude25.7661748271726. The first bounded extract has135 street records,590 building-footprint parts,16 shoreline records and12 water polygons. These are data inventory counts, not completed art. The590 County footprint records contain200 identified2015 buildings and390 newer2023 records with null building IDs; all HEIGHT fields are null. Multipart records normalize to613 separate polygons. Unknown identities remain separate footprint records, never one shared null building. A separate official County I3S source now supplies262 building meshes with metre-based NAVD88 envelopes, mostly dated2015. Newer footprints and contradictory parcel/address joins still require reconciliation.

## Construction order

1. **Brickell core survey:** import the SE8th/Brickell Avenue area, validate topology, footprints, water holes, units and geographic correspondence. Establish a safe sidewalk spawn from measured geometry. Replace the old runtime world and map coordinates with the new dataset.
2. **First complete adjoining blocks:** source dimensions for every building; author facades, setbacks, entrances, glazing, roofs, garage ramps, sidewalks, curbs, road markings, signs, lamps, vegetation and street furniture. Audit every side accessible from public streets. A footprint extrusion is an envelope, not a finished building.
3. **Complete Brickell:** expand north to the Miami River, east along the bay and Brickell Key connections, south through the documented neighborhood, and west through connecting streets. Preserve real bridges, ramps and grade separation. Do not transplant the previous airport or fictional facilities into Brickell.
4. **Adjacent city expansion:** Downtown and river crossings, The Roads/Shenandoah and Little Havana connections, then adjoining western and northern neighborhoods and the Coconut Grove corridor. The municipal boundary and street topology determine the exact work packages; contiguous completed areas remain connected as construction expands.
5. **Full municipal pass:** finish remaining blocks, regional roads/transit, waterfront, parks, facilities and all source exceptions. Review changes in imagery/survey dates. Unbuilt districts are not represented by repeated generic blocks and counted as complete.

## Geometry, materials and interaction

Street centerlines retain their real polylines, names, directions and grade/layer. Widths and sidewalk dimensions need explicit confidence. Same-level intersections use polygon unions so sidewalks and curbs do not run across drivable junctions. Bridges and tunnels remain separate elevations. Lane navigation follows source directions and connects real junctions; pedestrian navigation stays on accessible sidewalks and crossings.

Building footprints retain concavities, courtyards and part identities. Survey envelopes provide collision and placement checks while individual exterior assets are authored. Verified height, roofline, podium/tower setbacks, facade bay rhythm and ground-floor entrances form each building's acceptance record. Different structures must not become recoloured copies of a generic tower.

All visible surfaces use appropriate sourced or authored PBR detail with consistent metre-scaled UVs: albedo, normals and roughness, plus material-specific glass/reflection, occlusion and displacement where appropriate. Pavement joints, road wear, curb edges, concrete variation, facade panels and glazing are required visual features. Texture maps alone do not make an incorrect building photorealistic.

Physical surfaces and visible geometry share source records. Roads, sidewalks, curbs, ramps, buildings, railings and shore edges block the relevant bodies. Structural surfaces can resist destruction; props and detachable details use the existing damage/physics system. Breakage updates collision and navigation. New water polygons determine surface access, swimming and shoreline containment rather than an arbitrary straight beach line. Baths/seabeds and elevations stay explicitly provisional until sourced.

## Streaming and persistence

Export modular mesh records and spatial chunks; retain a compact city index outside the loaded neighborhood. Near-field collision must exist before travel or teleport completes. Building/road IDs, damage, casualty positions and vehicle states are tied to a world identifier. Old fictional-map saves must not silently teleport their coordinates into a Miami building: loading requires an explicit migration/reset policy with preserved inventory/settings.

The in-game map must render the actual imported streets and water, support named destinations and arbitrary safe points, and distinguish unavailable terrain. The construction boundary prevents falling beyond loaded support without pretending that a visible wall exists in Miami. All prior hard-coded locations, coast tests, aircraft spawns, traffic seeds and restricted-facility coordinates must be audited before promotion.

## Team ownership

- Geodata agent: licensed source acquisition, normalized raw layers, height/elevation evidence, stable IDs and complete municipal coverage inventory.
- Geometry/physics agent: triangulation, road/intersection/sidewalk/curb and land/water mesh records, native collision and lane topology checks.
- Art/reference agent: block reference atlas, photorealistic material sources, metre scale and building-specific exterior asset inputs.
- Root: projection/types, dataset assembly, building envelope/asset replacement, runtime streaming, save migration, map/UI integration and integrated playtesting. Root commits and pushes exact reviewed cohorts.

## Acceptance gates

Each block requires geographic correspondence, complete street/building inventory, verified or explicitly unresolved dimensions, individual exterior review, textured surface scale, native obstruction/collision, walking/driving/teleport/swimming where applicable, traffic continuity and persistent damage. Inspect daylight, shade, wet pavement and night views in WebGPU and WebGL2. Capture street-level and aerial reference viewpoints and retain defects instead of marking an attractive overview as finished.

Full completion requires all municipal work packages, all building/street exceptions resolved to the requested fidelity, connected travel and the game's full interaction checks. The existing60FPS median/30FPS1%low target at1080p and bounded30-minute memory target remain unchanged. No one-to-one, photorealistic, city-wide completion claim is justified by the initial GIS import or a working Brickell prototype.
