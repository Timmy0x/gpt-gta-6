# Car Concept: source preparation and adapter reference

The debranded source at `public/vehicles/concept/car.glb` supplies the drivable Aster Concept. Runtime now uses its simplified/batched derivative; see detailed-street-cars.md. Runtime implementation and final verification are recorded in [concept-vehicle-design.md](concept-vehicle-design.md); the preparation measurements below describe the original posed source. The GLB contains a detailed cabin, separate doors, hood, rear hatch, wheels, brakes and lights. It is a concept-car asset rather than a GTA VI vehicle replica.

## Provenance and rights

The [upstream license](https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/CarConcept/LICENSE.md) identifies CC BY 4.0 for the model and excludes logos/trademarks. [Upstream metadata](https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/CarConcept/metadata.json) credits Eric Chadwick, © 2024 Darmstadt Graphics Group GmbH. Attribution, a license link and modification disclosure are retained in [ATTRIBUTION.md](../public/vehicles/concept/ATTRIBUTION.md), consistent with the [CC BY 4.0 terms](https://creativecommons.org/licenses/by/4.0/). No endorsement is implied.

The exact binary source is pinned to upstream commit `44b6f9bdb08a5b16e92b91857ec3c87de9401dfa`; the generated license documents appeared later and are separately pinned to `90d7ede14c7e280af263824604b427a1ca02cb66`. All URLs, source notices, removed-image hashes and document hashes are in [provenance.json](../public/vehicles/concept/provenance.json).

| Artifact | Bytes | SHA-256 |
|---|---:|---|
| Original GLB | 11,778,688 | `c272098089d78c5cd9fd9f24ff50ee8acf8d932c55f2d55fc10adb6c8998966b` |
| Prepared GLB | 11,271,376 | `6923a315ac3656ddab95c281a8113055f0a4051ced2c35b35706fc1095d860ab` |

Run `node scripts/assets/prepare-car-concept.mjs` to reproduce it, or pass `--source /path/to/original.glb`; the original SHA-256 is always checked. The script performs JSON/material edits and binary compaction, without raster editing.

## Debranding verified

Four source textures were independently opened: the Khronos logo atlas, dashboard atlas, tire-sidewall color and tire-sidewall normal map. The dashboard has generic gauges. **Both tire-sidewall maps contain Khronos and 3DCommerce marks**, so removing only the license plate or color texture would leave logos behind.

The preparation removes original image indices 3 (`Khronos_C.png`), 10 (`Tireside_C.png`) and 11 (`Tireside_N.png`), including their original buffer views 521, 528 and 529 and PNG byte payloads. It removes the corresponding textures, remaps all remaining indices, blanks the plate material and assigns generic dark rough rubber to the sidewalls. Original material indices 2, 5, 15, 16, 20 and 21 also referenced the Khronos atlas through emissive slots; those references and emissive contributions are removed. Cabin/dashboard geometry and all other textures are retained.

The script recursively validates texture references, compares retained image hashes against the deleted images, and asserts that none of the three complete removed PNG payloads exists anywhere in the rewritten GLB. Legal/provenance text still names the licensors and excluded marks; those required notices are not rendered logo artwork.

## Geometry and import evidence

The prepared asset preserves all 101 glTF nodes, 97 meshes, 109 primitives, 162,766 position vertices and 213,347 triangles. There are no skins or animation clips. A vertex-by-vertex transformation scan proves the source and prepared geometry share exact bounds: approximately **2.542 m wide × 1.149 m high × 4.357 m long**, with floor near Y 0. These are geometric extents of this posed asset, including its turned front wheels; they are not suspension or collision tuning.

`node scripts/assets/verify-car-concept.mjs` successfully imports the prepared GLB through the installed Babylon 9.25 loader in NullEngine with `skipMaterials: true`. [The loader report](../public/vehicles/concept/loader-verification.json) confirms 110 Babylon meshes, 16 transform nodes and intact named door/wheel groups. Babylon's transformed local bounding boxes are conservatively larger than the exact vertex extents (approximately 2.716 × 1.308 × 4.357 m); this is expected for rotated parts. That source-preparation check used no GPU. Later material and normal-control renderer verification are documented in concept-vehicle-design.md.

The installed loader's default AUTO coordinate conversion preserves the asset's forward +Z direction and places its named left door at negative X in this project's left-handed scene. Keep the imported `__root__` conversion; dropping it would reverse side labels. The model also has a body transform converting its original Z-up authoring coordinates.

| Runtime component | Imported node | Imported position before vehicle rebasing, metres |
|---|---|---|
| Left door hinge | `BodyDoorLColor1` | (−1.089, 0.643, 0.998) |
| Right door hinge | `BodyDoorRColor1` | (1.087, 0.643, 0.998) |
| Hood hinge | `BodyHood` | (0, 0.176, 2.379) |
| Rear hatch hinge | `BodyRearPanelsColor1` | (0, 0.423, −1.929) |
| Front left/right wheels | `WheelFrontL`, `WheelFrontR` | X about ±0.976, Y 0.384, Z 1.485 |
| Rear left/right wheels | `WheelRearL`, `WheelRearR` | X about ±0.982, Y 0.384, Z −1.314 |

Each door has 14 children including its window, mirror and interior panels. The hood includes its headlights; the rear hatch includes glass and taillights. Each wheel group includes tire, rim, brake pad and disc. Its authored rotations are not neutral: front wheels are turned, and wheel orientations differ. The runtime adapter establishes steering/rolling frames from the actual wheel axes, preserving the authored rest transforms rather than assigning raw Euler angles to every imported child.

## Original adapter requirements (implemented; see runtime design)

Use the installed `LoadAssetContainerAsync` with the registered glTF loader, cache the prepared asset on first explicit demand, then clone its hierarchy for each vehicle. Preserve AUTO coordinates and use the imported names to construct `VehicleModel` component mappings. The new loader options support `createInstances` and `animationStartMode`; there are no bundled clips to start here. The upstream model uses clearcoat, emissive-strength, iridescence, transmission, variants and texture-transform extensions, all visible in the asset metadata.

Rebase the ground-origin model under the physics chassis origin. Calibrate the approximately 2.8 m wheelbase, 1.95 m track and 0.384 m tire radius against suspension mounts and collision dimensions; visual size alone is not correct physics calibration. Map the two door hierarchies to entry/detachment, put steering and rolling wrappers around each wheel, and retain a separate body collider. Use a collision proxy rather than triangle-mesh vehicle collision.

For deformation, explicitly make damaged mesh geometry unique per vehicle before changing vertices; ordinary clones can still share geometry. Clone mutable paint/light materials as needed, and attach `vehicleId` plus component metadata to every pickable child. Removal must dispose the instance and unique buffers without destroying the cached shared asset. Save IDs and component state should continue through the existing serializer.

Start with a single nearby drivable instance and measure it. This asset's 109 source primitives, substantial interior and 213k triangles warrant lower-detail derivatives before populating traffic. The subsequent runtime checkpoint implements the adapter, wheel neutralization, seated pose, authored damage and visual checks. Measured LOD derivatives, full hand/seat contact and graphics-performance acceptance remain open.
