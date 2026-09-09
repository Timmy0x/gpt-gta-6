# World residency and contiguous district expansion

The world now releases and rebuilds Babylon render meshes and Havok static bodies around the player and active vehicles. It retains deterministic CPU geometry records and shared materials. This is local GPU/physics residency management; it does not fetch chunk files or evict CPU asset records.

## Runtime contract

`World.setActiveAnchors(Vector3[])` takes the positions of occupied or moving vehicles. `World.ensureCollision(player.position)` must run after anchor updates and before the next physics step, including after fast travel. `World.update(...)` performs normal residency work. The integration supplies these calls before simulation.

`World.getStreamingStats()` returns spatial cell counts, total/resident mesh and collider assets, retained CPU geometry bytes, cumulative creation/disposal counters, pending visual work, active anchor count and visual operations in the last update. `World.lightPositions` contains deterministic street-lamp emitter positions for the atmosphere's bounded nearby lights.

Terrain, the shoreline substrate, water and road surfaces remain global. Static building and sidewalk colliders load synchronously within 220 m of the player or 90 m of an active vehicle. Unneeded colliders unload beyond 310 m from the player and 150 m from every active vehicle, at most 40 per update. Immediate collision loads intentionally take precedence over a frame budget so a teleport or fast-moving active vehicle cannot advance into an unloaded wall. Inactive parked vehicles keep global ground support; if they start moving they become anchors before the next physics step.

Visual assets load by their XZ bounding box distance: detail within 285 m and structures within 650 m of the player. Active vehicle anchors additionally retain nearby visuals within 65 m. A resident asset gets 90 m of extra range before eviction. The queue processes at most 12 mesh loads/disposals per update, prioritizing nearby loads. There can be temporary overlap between old and new residency while this queue drains. Visuals may visibly arrive after a long teleport; collision has already been restored.

## Asset lifecycle

`ChunkResidency` registers material-batched geometry under deterministic names and maps it to 144 m spatial cells. Mesh records contain transformed vertex data, material references, bounds, render flags and metadata. Vertex arrays are retained as Float32 data, with Uint16 or Uint32 indices. On eviction, the mesh leaves the shadow render list and `Mesh.dispose(false, false)` releases its scene geometry/render buffers. Reconstruction creates a new mesh from the CPU data and restores the shared material, shadow and picking configuration.

Static collider records contain box dimensions and material response. Eviction disposes both the Havok aggregate and its invisible picking mesh. Reconstruction creates a new aggregate and updates its persistent obstacle record's optional mesh reference. Navigation bounds remain available while their physical collider is absent.

Chunk statistics count cells with registered or resident visual assets. Work is budgeted per mesh asset within cells; cells are not indivisible all-or-nothing packages. Materials, generated textures, global terrain and the animated ocean remain resident. The implementation does not claim network loading, a persistent disk chunk format, CPU memory reclamation, full-world streaming or a production-scale asset pipeline. Initial construction still generates the district before evicting distant buffers.

## Authored geographic coverage

The connected grid now has 9 north/south streets at X = -432 through 144 and 8 east/west streets at Z = -288 through 216, on a 72 m pitch. The directed lane graph has 508 approach/departure nodes. Roads remain 14 m wide, with 3 m sidewalks. The contiguous authored area reaches west to a local compound and south to workshops; it is not the complete Leonida map.

The western addition contains Mercado Palma's covered market, striped produce stalls and courtyard; Mangrove Estates' small detached houses, terracotta pitched roofs, shutters, porches and gardens; local shops and a diner; and southern industrial workshops. The market, residential blocks and warehouse strip use different footprints and street activity from the central Art Deco hotels.

Coastal Reserve is an original local training annex at X [-548, -456], Z [78, 198], with an east entrance near (-452, 144), fence perimeter, guard house, workshop, barracks, helipad and watchtowers. It is explicitly classified as a creative-mode addition. It does not replace the separately planned regional military facility or establish any GTA VI geographic claim. Block dimensions, coordinates, layouts and names in this expansion are project decisions; the reference atlas remains the authority for supported regional relationships.

World material changes convert selected opaque architectural and ground colors to linear PBR color space. Palm trunks/fronds, awnings and balcony slabs now enter the shadow caster batches. Lighting exposure, ambient illumination and nearby street lights are handled by the parent atmosphere integration.

## Reproducible verification

Run `npm test` for the complete suite, or `node --import tsx --test tests/world-streaming.test.ts` for residency and road coverage. The tests use Babylon NullEngine with real Havok WASM. They verify:

- Actual disposal reduces scene mesh/geometry counts; reconstruction restores transformed vertices and shared materials, with stable shadow-list membership over 20 round trips.
- Visual work respects its operation budget and hysteresis prevents boundary churn.
- A vehicle-like Havok body continues to hit a retained wall while the player is distant, global ground remains, and 20 collider unload/reload cycles do not leak bodies.
- Every one of the 508 road nodes reaches every other node, and sampled lane edges remain on paved road/intersection areas.

At the 2026-09-09 checkpoint, `npm run typecheck` passed and the full `npm test` suite passed 60 tests. These checks establish local lifecycle correctness and navigation continuity; they do not establish console-level frame rates or reference-map parity.

## Browser residency checkpoint

A headless Chrome WebGPU run at 1440×900 visited spawn → Mercado Palma → Mangrove Estates → Coastal Reserve → Sunset Customs using the normal map fast-travel controls. Each capture waited for the visual work queue to drain. It recorded zero browser errors; the player remained supported by the correct ground at every stop. This local result is a short, capped frame-rate observation, not a hardware-independent performance guarantee. Traffic continued simulating and supplied 6–11 remote residency anchors.

| Stop | Resident visual assets | Resident colliders | Cumulative mesh disposals | Cumulative collider disposals | Observed FPS |
| --- | ---: | ---: | ---: | ---: | ---: |
| spawn | 1080/1211 | 228/249 | 310 | 2 | 60.0 |
| market | 1062/1211 | 239/249 | 422 | 17 | 60.0 |
| residential | 961/1211 | 218/249 | 603 | 61 | 60.0 |
| compound | 993/1211 | 221/249 | 694 | 99 | 60.0 |
| return | 1104/1211 | 230/249 | 718 | 113 | 60.0 |

The retained geometry records occupy 58,206,120 bytes (55.5 MiB), excluding textures, materials, temporary construction data and other gameplay systems. CPU geometry bytes stayed constant over the route. The counters include initial generation and far-mesh disposal. A high proportion of this first district remains physically resident when many traffic anchors are spread across it; residency is intentionally safety-driven rather than a fixed body-count cap.

Evidence: [raw telemetry](evidence/streaming-world.json), [central spawn](evidence/spawn-world.png), [market](evidence/market-world.png), [residential arrival](evidence/residential-world.png), [compound entrance](evidence/compound-world.png), [return to Sunset Customs](evidence/return-world.png). The snapshot was served from a local production bundle to avoid unrelated Vite HMR restarts during verification. Rendering remains an original procedural approximation; these images do not establish GTA VI asset or visual parity.
