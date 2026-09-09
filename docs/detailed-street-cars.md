# Detailed starter and traffic cars

Aster Concept now appears at the normal starting location and in two of the twelve initial traffic slots. Those traffic cars use the same Havok driving system and navigation as other traffic; they are blue-grey and silver variants of the same model, not new vehicle classes. The original detailed car's handling, doors, glass, lamps, damage and customization remain available.

The game loads one shared 5,920,756-byte asset at startup. If it cannot download or validate the asset, it starts with the existing procedural coupe/traffic and allows a later Sandbox retry. The full-resolution source is retained for offline comparison and is not requested during play. Every source variant has a separate exact SHA-256 in `ConceptCar.ts`; the runtime selects the game variant.

## Geometry preparation

`node scripts/assets/prepare-concept-lod.mjs` verifies the original debranded source and pinned meshoptimizer 0.25 module, then creates the simplified and batched derivatives. The vendored simplifier retains its MIT license. Car geometry and textures retain Eric Chadwick / Darmstadt Graphics Group GmbH CC BY 4.0 attribution and modification disclosure.

| Representation | Bytes | Triangles | Renderable component meshes |
|---|---:|---:|---:|
| Original prepared source | 11,271,376 | 213,347 | 112 |
| Simplified | 5,936,700 | 61,879 | 112 |
| Batched game asset | 5,920,756 | 61,879 | 79 |

These are mesh/geometry counts, not measured frame-rate gains. Simplification preserves component extents and seams, retained normals/UVs/tangents and original embedded images/materials. Batching merges compatible material primitives inside the same parent and damage role; it keeps door/cover anchors, glazing, lamps, wheel rims, rotating discs and fixed calipers separately controllable. One pair of compatible body panels merges, reducing deformable meshes from ten to nine; the same 405-coordinate deformation lattice drives them. Hashes and component mappings are in `public/vehicles/concept/lod-provenance.json` and `lod-batching.json`.

The game uses this fixed optimized representation at all distances. Automatic distance LOD, impostors, texture compression and broader detailed vehicle variety remain unfinished.

## Integration and budget

The detailed-class budget is six total cars. Sandbox rejects an extra spawn before changing the world. Saves can contain six owned detailed cars; load removes surplus ambient detailed cars before restoring the owned set. Existing detailed saves retain stable IDs, paint, doors, glazing, tires, lamps and lattice deformation across the mesh change. No save-format version changed.

The initial street audit also exposed latent reverse throttle after vehicle exit. Successful exit now releases throttle, steering and lift, applies braking and parks ground vehicles. Rejected exits retain the driver's controls. A real-Havok exit regression verifies three seconds without powered movement.

## Evidence

- Fixed-camera WebGL2 comparison covers front, rear, side, wheel, cabin, driving and open-door views. The parent inspected the batched front/wheel/cabin images. The derivative retains its curved silhouette and cabin detail; most visible simplification is in wheel/cabin details at close inspection. Reports and original/derived screenshots are under `docs/evidence/concept-lod`.
- Actual-material Chrome/NullEngine loading reports 87 child meshes including empty control pivots, 61,879 triangles, 23 used materials and 32 shared active texture references. Eight create/remove cycles keep mesh/material/texture/geometry/transform counts unchanged. This checks actual embedded texture decoding and ownership, not GPU performance.
- All 114 tests and the production build pass with the optimized asset, including Havok suspension/driving, damaged geometry isolation, detachable doors, repair, saved lattice reconstruction and exit-control release.
- Initial WebGPU normal street review passes eight stages and the full concept-car review passes fourteen, including deliberate startup/download failures and retry, driving, character switching, night lights, physical crash, saved damage, fresh Continue, garage paint and credits. The initial street captures revealed the exit bug, fixed afterward. Final WebGPU and WebGL2 street reviews each pass ten stages, including the parked-exit regression, normal six-car spawn cap/save/load and a separately labeled six-owned-save fixture which displaces surplus ambient detailed traffic. Both have zero errors. The final WebGL2 fourteen-stage damage/loading/night-light/customization audit also passes with zero unexpected errors.
- A first final-run test fixture incorrectly addressed saved position as a nested object; the actual save format uses flat x/y/z. The failed record is preserved separately. It did not indicate a runtime load failure.

This is an incremental visual improvement. It does not establish final world/vehicle fidelity, a full model catalog, distance-based LOD or the outstanding 30-minute performance gate.
