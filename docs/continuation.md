# Continuation checkpoint

Full goal remains active. This is an early central-neighborhood build, not full scope completion. The user authorized frequent commits and pushes on 2026-09-09. Push every tested checkpoint to origin/main. Hosting and deployment remain unconfigured pending a separate decision.

## Repository and commands

The workspace and remote `https://github.com/Timmy0x/gpt-gta-6` were empty at inspection. Initialized local `main`, configured only that Git origin, installed pinned dependencies and retained lockfile. `npm test`, `npm run typecheck`, `npm run build`, `npm run dev`, `npm run preview` are the reproducible entry points.

During development the game server is at `http://127.0.0.1:5174` because an unrelated server occupied 5173. A frozen production snapshot under `/tmp/leonida-audit-build` is served at port 4175 for uninterrupted audits. Tests in `tests/browser-audit.mjs` and `tests/production-smoke.mjs` use that snapshot. Refresh it deliberately after a production build; editing source should not change an active audit.

## Current evidence

- Actual Havok behavior tests cover road suspension, acceleration, steering, solid/thin-wall collisions, deformation/glazing/debris, boat flotation/shore, helicopter ascent/descent, trainer runway takeoff, explicit recovery and identical physics outcomes under 30/60/144 Hz render cadence.
- Normal-control WebGL2 audit covers launch, walking, car entry, physical crash/damage, wanted reporting, switching, actual police arrival/reacquisition, weather save/load and pause. Independent screenshots and initial failure records are retained.
- Normal-control WebGPU production smoke covers car entry/driving/crash, repair/recovery/exit/switch, three-star pursuit, save/load, powered boat travel and helicopter takeoff.
- Initial WebGPU material warmup briefly stalls; later 1080p control tests are near 60 FPS. Raw measurements are short runs, not the required stability gate. Record actual JSON evidence rather than extrapolating.
- The two resource 404s were favicon requests. An explicit local SVG favicon fixes them; updated WebGPU smoke has zero console errors.

## Integrated corrections

Map search used `hidden` but button CSS overrode it; source now enforces `[hidden]`. Creative civilians were hidden by the ambient population budget; source now tracks explicit creative spawns separately. Both passed the final independent WebGL2 checkpoint retest. Siren NaN and lost police coordinates are fixed and retested. Detailed street props, marina-aligned boats, gamepad controls, 17-bone skinned characters and full vehicle component serialization are integrated. Both updated WebGPU smoke and independent WebGL2 checkpoint audits pass; all 29 behavior/rig/input/Havok tests and the production build pass. Read docs/readiness.md and the exact JSON records.

## Next gates, in order

1. Arrest/recovery is now verified; sandbox-assisted loss-of-contact completes search/cooldown/escape. Verify continuous driving/walking evasion next.
2. Continue loading/performance optimization and physical-device gamepad/menu verification. Missing favicon resources and both UI defects are resolved; production core paths pass on both backends.
3. Initial tested local checkpoint includes README, source/feature index and concrete evidence. Continue making tested commits; do not mark the full goal complete.
4. Deepen whole-world save/load and stable pedestrian IDs, interaction/exit safety, player/AI animation, combat/ragdoll, visible responders and tactical escalation. Keep feature status granular.
5. Acquire/create better licensed detailed assets; current procedural meshes do not meet requested final fidelity. Maintain provenance.
6. Expand adjacent finished districts following the geographic atlas, then all six planned regions with real streaming and complete content.
7. Perform isolated 30-minute traversal/pursuit/destruction profiling at 1080p, median60/1%low30 targets and bounded memory. Resolve failures rather than lowering targets.

The full source objective is copied to `docs/goal-objective.md`; read it and the feature index before continuing. Evidence of one passing loop never replaces the full map, feature, visual and stability requirements.

## Second checkpoint continuation (supersedes earlier next-step statuses)

70 tests and the production build pass. The combined code now includes police/Combat submodules, MovementQueries, directed waypoint Navigation, PhysicsInterpolation, Atmosphere/audio, and real ChunkResidency. The parent fixed integration defects in no-step jump buffering, recovery interpolation, autonomous grenade/ragdoll updates behind creative UI, malformed/duplicate save validation, dead-state controls, paused camera, race material disposal, destroyed-prop removal and burning-wreck extinction. Ragdoll reset is wired before reset/load; save captures every weapon and armor. Read the new police/combat/movement/world design documents.

Current browser commands: `node tests/integrated-checkpoint.mjs webgpu` and `node tests/police-browser-audit.mjs`. The frozen production snapshot remains4175; update `/tmp/leonida-audit-build` only between active audits. The world agent's4181 helper is stopped. Combined audit uses normal UI/keyboard/mouse with read-only test diagnostics; its earlier failed harness records are retained.

Normal armed-threat urban evidence is now retained in `verification-police-checkpoint.md`; both combined renderer audits pass. Next priorities: improve blocked/oscillating urban AI routes, capture close-up tactical behavior, and run isolated30-minute mixed-world performance/memory profiling; acquire/create higher-fidelity licensed assets; continue contiguous district/regional construction following the atlas with modular network assets, regional water/terrain and actual military/emergency/activities systems. Do not treat this expanded local district as the full planned map. The user subsequently authorized frequent commits and pushes on 2026-09-09. Push tested checkpoints to origin/main; deployment configuration still awaits a separate decision.

## Third-checkpoint continuation

The user explicitly superseded the no-push restriction: commit/push frequently, and push each tested checkpoint. Existing dcc7bca/ce382f3 commits are on origin/main. Do not configure deployment without a separate decision.

Current changes include network World/PackageResidency and export-time WorldBuilder; optional world.ready/preparePosition lifecycle is wired in main. The native browser fetch receiver and invalid shared-box merge indices were fixed, all world geometry indices validated, sign PNGs preserved at1024px, and PBR materials rebound to scene image processing. Current manifest build authored-860409-v3 contains84packages,171materials,46PNGtextures,1221meshes,57,932,888CPU geometry bytes and13,132,677compressed package/material bytes.

Root added VehicleEquipment, Garage, bounded FrameHistory, animated/detachable doors, lights/brake/siren behavior, paint persistence, seated pose clearance and plane turn correction. RestrictedFacility/PoliceDirector improvements, production Havok tests, licensed GIS and debranded CarConcept asset preparation also landed. CarConcept is prepared only, not runtime-integrated.

All94 tests and production build pass. Parent WebGPU and WebGL2 checkpoint-3 audits each pass12stages with zero unexpected errors. Real HTTP evidence is refreshed. Frozen current production directory is /tmp/leonida-checkpoint-3-build on4176; the original4175 snapshot is ce382f3 and should stay archived. Runtime/server processes were interrupted by a usage-limit event;4176 was restarted. Subagents reference_atlas and vehicles errored with account usage limit and world became pending; parent continued integration. Do not invent completed subagent reviews after that interruption.

The old30-minute baseline stopped15m51s from harness aircraft-recovery errors; plane banking was separately proven wrong then fixed. Corrected180-second flight smokes passed before the final rendering corrections. Full30-minute validation of the new frozen build remains next, alongside the existing combined combat/save/load normal-control tests. Keep final evidence separate from preserved startup/report-timing/harness failures.

Final third-checkpoint gate: both existing combined combat/save/load renderer audits pass eight normal-control stages with zero errors, in addition to both new 12-stage audits. Logs use `checkpoint-3-*`. All94 unit tests and production build pass. The stability harness now awaits destination package preparation for its explicit fixtures and UI fast travel/load. Next run the new frozen build for30minutes, then integrate the prepared detailed car asset without modifying that frozen snapshot.


## Completed baseline and in-progress detailed car

1387665 was committed and pushed to origin/main. Its frozen4176 build completed the full30-minute harness with zero browser errors and no transport recoveries, but performance failed:59.52median/19.45slowest1%FPS and1026.3ms maximum stall. Heap188–984MB, final697MB; settled retention is unproven. Evidence `stability/baseline-2026-09-09T15-52-42-401Z` and performance-stability.md retain limitations. Largest stalls correlate with save/load; profile before claiming a cause. Do not repeat a final benchmark while concurrent CPU test/build jobs are active.

Next working changes add `ConceptCarAssets`, `LatticeDeformation`, the concept VehicleKind, lazy verified GLB loading, transformed wheel/door/cover hierarchies, independent mutable materials with shared immutable textures, driver pose, compact damage saves and credits. All97 behavior tests and builds pass. CPU browser material tests prove actual PNG loading,23materials/120childmeshes/213347triangles and8stable creation/removal cycles. This remains uncommitted until both normal renderer audits finish. A frozen current car build is on4177 at /tmp/leonida-concept-checkpoint-build; earlier variants are archived under /tmp/leonida-concept-before-*.

The first WebGPU car audit verified driving, physical crash, visible cover loss and restored dents. Initial continuation assertions were premature/used a zero-size HUD box; evidence is retained. Main now keeps the welcome screen until asynchronous saved vehicle/world loading completes. Driven-car headlamps have priority over closer unoccupied traffic in the fixed beam pool. Both final renderer audits must pass before committing and immediately pushing this next checkpoint. Continue performance profiling, higher-fidelity characters/world assets and all remaining geography/system scope afterward.

Detailed-car verification finished: both final renderer audits pass all13stages, zero unexpected errors. Source now awaits saved-game restoration before dismissing welcome, occupied vehicles own headlamp priority, and Vite prebundles the lazy loader to prevent first-spawn reload. User now prioritizes aircraft stuck on ground, rapid respawns and much more realistic cars/characters. All three subagents recovered and are working: vehicles normal aircraft controls/spawns; reference_atlas casualty lifecycle (player recovery currently resets all civilians/guards); world licensed character replacement. Parent owns integration and main save/reset wiring.


## Visual/casualty checkpoint continuation (supersedes previous runtime handles)

8584c66 (detailed car) and 02e4363 (aircraft launch and controls) are committed and pushed. Current verified changes add Rocketbox player skins, CC0 HDR lighting, persistent NPC casualties and collision-free ground spawns. All 113 tests and production build pass; integrated WebGL2 car 13-stage and WebGPU casualty/character 20-stage records have zero errors. See readiness.md and dedicated documents. Frozen build `.local-builds/visual-casualty-v1` is served on4187; restore5174 to this tested directory for user play. Previous /tmp snapshots and process handles may have expired; inspect processes before relying on them.

Character verification agent completed 11 actual-skin checks and documentation. Gameplay review found a real barrel/camera mismatch and left Character.aimToward, Player calls and a combat regression unstaged for a separate normal-control verification. Vehicle LOD agent left 61,879-triangle derivatives and batching/review scripts; these are not runtime integrated or visually accepted yet. Both latter agents stopped with account usage limit. Do not assume their pending checks passed. Parent owns review, integration and frequent commit/push. No usage-reset credit has been authorized.

The full goal remains active. Most geographic content, realistic vehicle/NPC variety, animation and world art remain incomplete; the recorded 30-minute performance gate still fails. Continue with aiming validation, car LOD visual/runtime integration and ordinary-play detailed cars, then broader licensed assets/world material improvements and full-scope expansion.


Aiming follow-up: parent verified the subagent's arm correction against frozen `.local-builds/aiming-v2` (module index-BZcSSHf8.js). Both renderer normal-control 10-stage audits and the 16-stage WebGPU lethal-shot/BUSTED/save/fresh-Continue flow pass with zero errors. All114 tests and build pass. Held-C crouching was corrected in the harness; a tap does not test crouching. This change is ready for a separate push. The next uncommitted work switches the detailed-car cache to the reviewed batched derivative and introduces a starter/two-traffic placement; its current tests pass but production normal-controls validation remains pending.


## Detailed street-car checkpoint — 2026-09-09

476e191 (licensed players/HDR/casualties/safe spawning) and c12324c (camera-aligned arms/weapons) are pushed to origin/main. The next tested checkpoint switches the default car to the subagent's reviewed batched derivative, uses it for the starter and two ambient cars, caps total detailed cars at six, and evicts surplus ambient detailed cars when restoring six owned cars. Parent fixed the newly observed powered-reverse-after-exit bug; successful exit releases inputs and parks ground cars. Rejected exits preserve controls.

All114 tests and build pass. Actual-material create/remove cycles remain stable. `detailed-street-webgpu-final-pass` and `detailed-street-webgl-final-pass` each contain ten passing stages on module index-DmvLSStP.js. `concept-webgpu-street` and `concept-webgl-street-final` have fourteen passing stages each; only the former predates the separately covered exit correction. All report zero unexpected errors. Initial exit movement and the failed flat-coordinate test fixture are retained. Node fetch rejects port4190, although browser checks worked there; the same frozen files are served on4191 for Node-assisted audits.

Current final frozen directory is `.local-builds/detailed-street-v4`; use it for the user's5174 page. All previous /tmp process handles should be revalidated. Next: improve stretched/world material UV scale in src/world/authoring/WorldBuilder.ts (road currently38×38 repeats regardless of physical width/depth; sand42×90 on55×1250m), acquire licensed surface textures and more realistic vegetation/NPC/vehicle variants, then continue full map/system scope and profile failed performance gate. World exporter is scripts/world/export.mjs; changing authoring requires regenerating packages and validating native indices/streaming. No world UV edits have been made yet.


## World texture-scale follow-up

eae7c9f (detailed street cars and parked exit) is committed and pushed. Parent then corrected WorldBuilder asphalt/sand UV scale using authoring/metreUVs.ts, regenerated world packages as authored-860409-v4-metre-uv, and verified all115 tests/build. Both normal WebGPU and WebGL2 street/beach audits pass with actual loaded geometry at0.75m asphalt/0.5m sand per tile. Before stretched ranges were0.289–15.526m asphalt and0.611–29.762m sand. Original source grain textures are unchanged. All colliders/navigation/indices/normals match; position rounding is below5.59e-9m. Numeric exporter geometry IDs change; package hashes are updated.

Current final frozen directory `.local-builds/metre-uv-v5` has the same application module index-DmvLSStP.js but a new world manifest SHA f6aaa34892099011171b7968619778ee55713441a01f3b14eda73307bdbef81b. Use this frozen directory for5174 after pushing. Before/after evidence and failed normal-length harness assumptions are retained. No GPU benchmark is running. Subagents previously stopped due usage limits; no reset authorized. Next visual work should acquire licensed detailed PBR surfaces and vegetation/NPC/vehicle variants, improve atmospheric sky and reference world art, while retaining the full outstanding map/system/performance scope.


## Photo surfaces checkpoint, 9 September 2026

Added verified local CC0 Asphalt 02 / Sand 03 PBR maps at source metre scale; normal WebGPU and WebGL2 street/beach audits pass with zero errors. See `docs/photo-surfaces.md` for fingerprints and screenshots. Road detail is improved; selected sand is too dark for dry tropical beach and needs a paler source replacement. Sky and civilian integration plus aircraft seat corrections are parallel work, not part of this surface checkpoint. Full goal and the failed long-session 1% FPS target remain open.
