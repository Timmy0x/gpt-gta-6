# Third playable checkpoint

**Ready for further playtesting; the full requested goal remains incomplete.** The user authorized frequent commits and pushes on 2026-09-09. Tested checkpoints are committed and pushed to origin/main. Hosting and deployment remain unconfigured.

## Playable additions

The original coastal district now connects to an authored western market, bungalow neighborhood, southern workshops and a small explicitly creative training compound. Real GPU mesh and Havok collider residency rebuilds scenery as needed. A 508-node road graph powers traffic and user map routes.

Jason/Lucia can mantle low ledges, respect crouch headroom, blend into a visible driver seat and exit only through a capsule-clear path. Combat now has hand-attached weapons, conserved magazines, muzzle obstruction, melee, physical grenades, breakable barriers, material-aware fire/destruction and Babylon constrained ragdoll reactions. Visible patrol/SWAT crews, foot pursuit, compliance/resistance, vehicle/face memory, roadblocks and a physical observation helicopter deepen police response.

Creative controls add material/barrier placement, ignition/extinction and complete weapon refill/clear. Saves preserve armor, stable civilians, all weapon magazines/reserves, damaged prop geometry and current settings. Controller menu navigation, render interpolation, rain, night illumination and bounded spatial audio are integrated.

## Verification

- **94 tests pass**, including actual Havok movement, vehicles, officers, grenades, barrier/destruction/navigation, ragdoll recovery/reset, streaming lifecycle and resource limits; input, interpolation, routing and malformed-save tests also pass.
- TypeScript and production build pass. The large initial JS bundle still triggers a size warning.
- Combined normal-control WebGPU audit at1920×1080 verifies visible seated driving (~23m/s), service braking/safe exit, map search/road route, pistol destruction of a physics crate, grenade flight/detonation, conserved ammunition, saved barrier/civilian/inventory restoration and night rain. Both final WebGPU and WebGL2 combined audits pass eight stages with zero errors, including grenade timers while creative is open. Consult `combined-webgpu.json`, `combined-webgl.json` and their logs.
- Independent WebGL2 police audits verify physical arrival, visible dismount and compliant BUSTED/recovery at all five levels. A separate normal threat run verifies officer gunfire (health100→59.5), four tactical officers and a helicopter reaching58.27m. Initial failed mouse attempts are preserved; the first-press compatibility issue has since been fixed with pointer events. The third checkpoint adds production-world Havok regressions and fixes for the observed corner blockage and foot-route oscillation; wider traffic/pursuit behavior still needs work.
- Independent WebGPU world review at1440×900 traversed five places with zero errors. Real mesh/collider disposals and reload counters changed while retained CPU geometry bytes stayed constant. This is a short functional review, not a long-run memory result.

Browser evidence is under `docs/evidence/`. Initial harness mistakes (wrong projectile field and exit attempted above the safe-speed limit) are retained. They were corrected before the passing combined audit. Unit physics tests do not substitute for normal-controls browser evidence.

## Remaining scope and risk

Only a small part of the planned Leonida map is built. The other five regions and most of Vice City remain unbuilt. Procedural assets remain visibly stylized and do not satisfy the requested final realism. Current police/tactical, weapon, melee/reload/door/passenger, swimming/water-region, service/activity and acoustic systems remain partial implementations, not GTA VI parity.

Native Babylon world packages now load on demand, releasing their CPU and GPU geometry and unused materials when evicted. Immediate readiness loads 12 of 84 packages in the CPU HTTP harness; background loading and active traffic bring in additional local packages. The original procedural authoring code runs at export time. The initial application JavaScript remains large. Browser localStorage is still quota-limited. The 30-minute mixed traversal/pursuit/destruction stability and memory gate has not run to completion. Short near60FPS observations cannot establish that gate or the1080p median60/slowest1%30FPS target.

Read `goal-objective.md`, `feature-index.md`, the dedicated implementation design documents and `continuation.md` before continuing. This checkpoint preserves a playable base for the full outstanding scope.

## Third-checkpoint changes and evidence

World assets are versioned gzip-compressed native Babylon packages with shared external PNG materials, per-package hashes, retry/error handling and synchronous manifest-based collision safety. Fast travel and saved-state loading wait for required scenery and preserve the current player position after failed downloads. Real HTTP and browser tests inject failures and verify recovery. A native fetch receiver bug, sign-canvas clipping, shared-template merge index corruption and serialized image-processing overrides were found and fixed; every exported index is now validated.

Cars have open cabins, hinged doors and separately colliding 32kg detached doors. Headlight beams use a fixed four-light pool; brake and police lamp emission responds to controls. L toggles headlights, J police sirens, and H a distinct synthesized horn. Sunset Customs offers validated cash transactions for repair and saved paint colors. Low seated poses keep both characters' skinned feet above the cabin floor. The trainer now banks its lift into commanded turns; real Havok left/right regressions and two 180-second flight checks support this correction.

The creative Coastal Reserve annex has four military-marked guards, an animated colliding gate, 90-second visitor passes, six-second restricted-entry warnings, alarms, armed response and arrest. These are authored additions, not verified VI military behavior. The first normal-control audits exposed missing exported scenery; corrected geometry is now visible in the parent WebGPU street and interior-annex screenshots.

The parent checkpoint-3 audits each pass 12 stages on WebGPU and WebGL2 at 1920×1080 with zero unexpected errors, including entry/exit doors, lights, paid garage paint, failed-destination preservation, visitor entry, warning and three-star response. Final WebGL2 captures also verify visible annex scenery and nighttime lighting. Earlier independent WebGL review found the export and seated-pose defects, and its failures remain preserved.

A 15m51s mixed baseline on ce382f3 retained 57,006 frame samples with no browser errors, but stopped on an invalid aircraft recovery loop. Its 59.88 median FPS and 45.55 slowest-1% FPS do not establish a completed 30-minute gate or the performance of this changed renderer. The harness and evidence are documented in performance-stability.md. A fresh 30-minute run remains outstanding.

Licensed source artifacts now include an ODbL Miami Beach extract (1,028 building and 1,305 road/path features) with conversion/validation, plus a prepared CC-BY detailed concept-car GLB with excluded logos removed and attribution. Neither replaces runtime geography/vehicles yet; see geodata.md and car-concept-adapter.md.

The existing combined normal-control combat/save/load loop was rerun against the final third-checkpoint production build on both WebGPU and WebGL2: all eight stages pass on each backend with zero browser errors. The harness now waits for asynchronous fast travel and saved-world preparation. Evidence is preserved separately as `checkpoint-3-combined-*`. These functional checks do not establish the long-run performance target.
