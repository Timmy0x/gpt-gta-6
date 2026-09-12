# Licensed road car roster — integration checkpoint

This replaces five procedural road bodies and adds five distinct vehicle types. It is a functional checkpoint, not acceptance of the user's requested final realism or GTA parity. The existing imported Concept remains a separate eleventh car.

## Implemented

Ten source bodies have four independent wheel assemblies, real cabin geometry, opening front doors, measured metre-scale bounds, individually authored handling values, native Havok suspension/tire forces, chassis and moving-component collision, localized lattice dents, breakable glazing, failed lamps, punctured tires and detachable doors. The police Charger uses the original ChargerCop mesh, livery, pushbar, spotlights and emergency fittings.

The MPV static source's material groups differ from metadata array order. They are now matched by their original slot names. Its static geometry also differs from the skeletal wheel anchors; four exact wheel components use centres measured from the original tire surfaces. Jeep and Patrol retain full precision source topology. Packed 8-bit skeletal paint normals caused false dents in reflective panels; face-derived smooth normals preserve authored hard edges and remove those quantization bands. Repair restores original normals exactly. The Mini fender repair replaces only its torn skeletal paint shell with the intact parked source and excludes both separate door skins by their exact authored vertices. Its 102,647 triangles, component ordering and damage lattice remain unchanged, so the existing save layout identifier is retained independently of the new GLB integrity hash.

Disconnected window panes and lamp assemblies are separate damage components. Pane origins sit on their visible geometry, so a local hit selects the nearby pane. A measured deformation grid covers long bodies such as the Sprinter and pickup. New saves identify source topology. Old procedural saves map tires by side/axle, doors by side/front, glazing/lamps by location, and reconstruct local dents onto the new body; dense old vertex topology is not copied into unrelated meshes.

## Integration API

`VehicleSystem.prepareModel(kind)` loads and integrity-checks the selected model. Call it before synchronous `spawn` or `restore`. `vehicles.roadCars.ready(kind)` reports readiness. Before creating ordinary traffic/police, prepare `coupe`, `sedan`, `suv`, `truck`, and `police`. The five new kinds are `hatchback`, `executive`, `van`, `offroad`, and `mpv`. They also appear in the tuning-driven creative menu. Existing five kinds retain their procedural fallback while unprepared; the new five reject unprepared spawning. Main startup now prepares the five traffic types before Population/Police construction. The creative spawn and save-load paths prepare every requested model before constructing it.

The cache retains at most the ten immutable source packages; each spawned car owns its mutable panel geometry and material state while textures are shared. `VehicleSystem.dispose()` releases the cache after live vehicles. No LOD or long-session performance acceptance is implied by this bounded catalog.

## Verification

`node --import tsx --test tests/road-car-assets.test.ts tests/concept-car.test.ts tests/vehicles.test.ts tests/vehicle-exterior.test.ts tests/vehicle-equipment.test.ts`

The original source integration passed 192/192 tests and production build (`index-BFIauodF.js`, `road-game-r1`). Its full WebGPU roster completed 180 normal-control checkpoints and 1,264 transition frames, with all gameplay assertions passing. One Babylon warning reported that late glTF loading raised the scene's material light counts above the GPU limit, so that audit failed its zero-warning gate.

The Mini repair retains 28/28 targeted native passes, including restoring a damaged save captured from the shipped pre-repair source. The isolated Mini plus lighting-budget candidate then passed **193/193 native tests and production build** (`/tmp/road-game-r2-tests.log`, `/tmp/road-game-r2-build.log`). `road-game-r3` adds only two sample-rate-aware audio filter clamps; it passed TypeScript and production build without repeating that full native suite. Its entry is `index-Q2X-Vqud.js`, SHA-256 `039822bd48b114cdb8b548a2a6e451b6580c72e9f5519264e574b97572edde67`.

The current candidate passes the complete **WebGL2 ten-car roster: 181 checkpoints, 1,824 transition frames, zero errors or warnings**. A **WebGPU Mini smoke passes 19 checkpoints and 150 transition frames with zero errors or warnings**. Normal controls cover map travel, creative spawning, Jason/Lucia entry and exit, driving, braking, night headlamp beams, headlight toggles, police siren and removal. Actual in-game Mini side views confirm its fender gap is closed. The updated full-roster WebGPU stress pass remains open. Compact results, raw-trace hashes and selected views are in `docs/evidence/road-cars/checkpoint-r3`; the earlier warning is retained in that record.

Native cases verify four-tire support, propulsion, braking, colliding opening doors, local door detachment, damage persistence, body cleanup, long-body deformation, independent panes, corrupt-save rejection and authored-normal restoration. These checks establish the integration and repair behavior; they do not establish final cabin, animation or performance fidelity.

CPU visual comparisons are retained under `docs/evidence/road-cars/source-r2` (before) and `source-r3` (after normals/police correction). They are source reviews only. The current normal-control evidence and remaining backend/animation gates are described above.

## Fidelity and acceptance gaps

- The Mini front door/fender tear is corrected from its original full precision parked paint shell. Source review is retained in `docs/evidence/road-cars/mini-fender`. Its repaired shell and cabin glazing still need the updated in-game/backend review.
- Jeep and MPV have visibly coarse cabin/trim geometry compared with the eight newer sources. More detailed replacements or authored improvements remain necessary for final fidelity.
- The Wrangler currently clips its occupant head and arms through the cabin. A separate measured pedal/steering contact fix is in progress and excluded from this checkpoint. All ten seating offsets, steering contact, door clearance and entry/exit frames still need full-skin review with both characters; successful control handoff does not establish animation quality.
- Every source needs normal-control drive-by tests in the combined weapon/character build. Headlight/siren control checks pass on the full WebGL2 roster; final visual fidelity and updated full-roster WebGPU stress remain open.
- Native doors/windows/wheels are physical. Full body-specific bumper detachment, hood/trunk opening, localized mechanical damage, glass fragments and structural fracture remain incomplete. The lattice is authored deformation, not full soft-body simulation.
- Chassis/roof collision uses measured compound proxies; it is not a full concave cabin collision mesh. Source lamp and trim geometry can extend beyond the main cabin shape.
- The roster is approximately 74.3 MB across modular GLBs and 794,172 source triangles. No newer 30-minute frame-time or memory gate has passed. Runtime LOD, texture residency and traffic density need measured profiling before final acceptance.

## Sources and reproducibility

CARLA content revision `2ff5d92bd388ed4171df637cb44c2c9f5ee9b4ed`, CC BY 4.0. Exact license text and all 377 input hashes/paths are in `data/vehicles/carla/LICENSE` and `source-inputs.json`; attribution ships in `public/vehicles/carla/ATTRIBUTION.md`. The source inputs total 535,374,218 bytes and remain outside the runtime/repository.

From the repository root, `python3 scripts/vehicles/carla/acquire.py` verifies/reacquires inputs under `/tmp/codex-carla-probe`. The extractor in `ExportSource.cs` was built with .NET 10 against CUE4Parse revision `67d8a8e864737d92d0c71697cb9e1f6b460f430d`; run it for the Mini, each roster directory, and shared metadata. It emits skeletal geometry, material metadata and original texture SourceArt. The strict `mesh_description.py` independently reads original static MeshDescription bulk data. Rebuild Mini paint with `rebuild_mini.py`, and static Jeep/MPV data with `rebuild_static.py`; generate Patrol parked static mesh JSON and run `rebuild_patrol.py`. Run `assemble.py SOURCE CONFIG OUTPUT` for each `*-assembly.json`, then `catalog.py` to copy runtime packages and regenerate hashes/bounds. Pillow is required by the converter. `render_review.py` uses Blender 3.6.23 with Cycles on CPU.

Remaining reproducibility work: package the .NET extractor bootstrap/build command and add a single end-to-end conversion command. Current metadata extraction logs include unsupported source import-bookkeeping fields; runtime geometry/material arrays are separately validated by strict conversion and native loading checks.
