# Character, lighting and casualty checkpoint

**Ready for further playtesting; the full requested goal remains incomplete.** The user authorized frequent commits and pushes on 2026-09-09. Tested checkpoints are committed and pushed to origin/main. Hosting and deployment remain unconfigured.

## Playable additions

The original coastal district now connects to an authored western market, bungalow neighborhood, southern workshops and a small explicitly creative training compound. Real GPU mesh and Havok collider residency rebuilds scenery as needed. A 508-node road graph powers traffic and user map routes.

Jason/Lucia can mantle low ledges, respect crouch headroom, blend into a visible driver seat and exit only through a capsule-clear path. Combat now has hand-attached weapons, conserved magazines, muzzle obstruction, melee, physical grenades, breakable barriers, material-aware fire/destruction and Babylon constrained ragdoll reactions. Visible patrol/SWAT crews, foot pursuit, compliance/resistance, vehicle/face memory, roadblocks and a physical observation helicopter deepen police response.

Creative controls add material/barrier placement, ignition/extinction and complete weapon refill/clear. Saves preserve armor, stable civilians, all weapon magazines/reserves, damaged prop geometry and current settings. Controller menu navigation, render interpolation, rain, night illumination and bounded spatial audio are integrated.

## Verification

- **115 tests pass**, including actual Havok movement, vehicles, officers, grenades, barrier/destruction/navigation, ragdoll recovery/reset, streaming lifecycle and resource limits; input, interpolation, routing and malformed-save tests also pass.
- TypeScript and production build pass. The large initial JS bundle still triggers a size warning.
- Combined normal-control WebGPU audit at1920×1080 verifies visible seated driving (~23m/s), service braking/safe exit, map search/road route, pistol destruction of a physics crate, grenade flight/detonation, conserved ammunition, saved barrier/civilian/inventory restoration and night rain. Both final WebGPU and WebGL2 combined audits pass eight stages with zero errors, including grenade timers while creative is open. Consult `combined-webgpu.json`, `combined-webgl.json` and their logs.
- Independent WebGL2 police audits verify physical arrival, visible dismount and compliant BUSTED/recovery at all five levels. A separate normal threat run verifies officer gunfire (health100→59.5), four tactical officers and a helicopter reaching58.27m. Initial failed mouse attempts are preserved; the first-press compatibility issue has since been fixed with pointer events. The third checkpoint adds production-world Havok regressions and fixes for the observed corner blockage and foot-route oscillation; wider traffic/pursuit behavior still needs work.
- Independent WebGPU world review at1440×900 traversed five places with zero errors. Real mesh/collider disposals and reload counters changed while retained CPU geometry bytes stayed constant. This is a short functional review, not a long-run memory result.

Browser evidence is under `docs/evidence/`. Initial harness mistakes (wrong projectile field and exit attempted above the safe-speed limit) are retained. They were corrected before the passing combined audit. Unit physics tests do not substitute for normal-controls browser evidence.

## Remaining scope and risk

Only a small part of the planned Leonida map is built. The other five regions and most of Vice City remain unbuilt. Procedural assets remain visibly stylized and do not satisfy the requested final realism. Current police/tactical, weapon, melee/reload/door/passenger, swimming/water-region, service/activity and acoustic systems remain partial implementations, not GTA VI parity.

Native Babylon world packages now load on demand, releasing their CPU and GPU geometry and unused materials when evicted. Immediate readiness loads 12 of 84 packages in the CPU HTTP harness; background loading and active traffic bring in additional local packages. The original procedural authoring code runs at export time. The initial application JavaScript remains large. Browser localStorage is still quota-limited. The third-checkpoint 30-minute mixed traversal/pursuit/destruction run completed without browser errors or transport recoveries, but failed the performance target: 59.52 median FPS, 19.45 slowest-1% FPS, and a 1026.3 ms maximum stall. Heap ranged 188–984 MB and ended at 697 MB; bounded long-run retention remains unproven. Concurrent CPU work is a recorded confounder. Profile the save/load stalls and retention, then repeat the target gate without competing work.

Read `goal-objective.md`, `feature-index.md`, the dedicated implementation design documents and `continuation.md` before continuing. This checkpoint preserves a playable base for the full outstanding scope.

## Third-checkpoint changes and evidence

World assets are versioned gzip-compressed native Babylon packages with shared external PNG materials, per-package hashes, retry/error handling and synchronous manifest-based collision safety. Fast travel and saved-state loading wait for required scenery and preserve the current player position after failed downloads. Real HTTP and browser tests inject failures and verify recovery. A native fetch receiver bug, sign-canvas clipping, shared-template merge index corruption and serialized image-processing overrides were found and fixed; every exported index is now validated.

Cars have open cabins, hinged doors and separately colliding 32kg detached doors. Headlight beams use a fixed four-light pool; brake and police lamp emission responds to controls. L toggles headlights, J police sirens, and H a distinct synthesized horn. Sunset Customs offers validated cash transactions for repair and saved paint colors. Low seated poses keep both characters' skinned feet above the cabin floor. The trainer now banks its lift into commanded turns; real Havok left/right regressions and two 180-second flight checks support this correction.

The creative Coastal Reserve annex has four military-marked guards, an animated colliding gate, 90-second visitor passes, six-second restricted-entry warnings, alarms, armed response and arrest. These are authored additions, not verified VI military behavior. The first normal-control audits exposed missing exported scenery; corrected geometry is now visible in the parent WebGPU street and interior-annex screenshots.

The parent checkpoint-3 audits each pass 12 stages on WebGPU and WebGL2 at 1920×1080 with zero unexpected errors, including entry/exit doors, lights, paid garage paint, failed-destination preservation, visitor entry, warning and three-star response. Final WebGL2 captures also verify visible annex scenery and nighttime lighting. Earlier independent WebGL review found the export and seated-pose defects, and its failures remain preserved.

A 15m51s mixed baseline on ce382f3 retained 57,006 frame samples with no browser errors, but stopped on an invalid aircraft recovery loop. Its 59.88 median FPS and 45.55 slowest-1% FPS do not establish a completed 30-minute gate or the performance of this changed renderer. The harness and evidence are documented in performance-stability.md. A later complete third-checkpoint run is recorded above and in performance-stability.md; it failed the performance targets.

Licensed source artifacts now include an ODbL Miami Beach extract (1,028 building and 1,305 road/path features) with conversion/validation, plus a prepared CC-BY detailed concept-car GLB with excluded logos removed and attribution. The detailed car is now a drivable runtime option; OSM data does not yet replace runtime geography. See geodata.md and concept-vehicle-design.md.

The existing combined normal-control combat/save/load loop was rerun against the final third-checkpoint production build on both WebGPU and WebGL2: all eight stages pass on each backend with zero browser errors. The harness now waits for asynchronous fast travel and saved-world preparation. Evidence is preserved separately as `checkpoint-3-combined-*`. These functional checks do not establish the long-run performance target.

## Detailed-car integration

Aster Concept is available through the Sandbox vehicle selector. Its verified 11.27 MB GLB loads on demand, with retry feedback and saved-game preparation. The adapted car retains a detailed cabin, glass, tire/rim/brake geometry, curved bodywork and PBR materials. Four-wheel Havok suspension, neutral steering/rolling frames, animated detachable doors and covers, headlight priority, paid garage paint/repair and bounded lattice deformation are integrated. Both character variants use a reclined seat pose. In-game credits retain the source author, CC BY 4.0 license and modification disclosure.

Parent normal-control audits on WebGPU and WebGL2 each pass 13 stages at 1920×1080 with zero unexpected errors: failed download preservation/retry, entry and character switching, actual driving, night lights, physical crash/deformation, repair and save restoration, fresh continuation, paid garage paint and credits. CPU material verification covers eight stable instance creation/removal cycles with shared immutable textures. Evidence is in concept-*.json and screenshots. The initial integration had no optimized representation and was limited to four explicit instances. The later street-car checkpoint below supersedes that deployment choice. The aircraft launch/control fix was committed in 02e4363. The casualty lifecycle correction and first licensed player-skin and lighting improvements are described below; most character/world fidelity remains unfinished.


## Character, lighting and casualty checkpoint — 2026-09-09

Both playable characters now use locally bundled MIT-licensed Microsoft Rocketbox skins: detailed faces, hair, clothing, fingers and 80-bone source rigs driven by the existing gameplay skeleton. These are generic visual substitutes, not Jason/Lucia likenesses. The two prepared GLBs contain 7,440 and 8,732 triangles. Scene-level synchronization follows Havok bone updates before visible mesh evaluation. Eleven focused checks cover the actual imported skins, seated clearance, repeated switching/disposal, moving ragdolls and retained fatal poses. See character-assets.md.

PBR surfaces now use a verified local 256-pixel prefiltered HDR environment from Wide Street 02 by Sergej Majboroda / Poly Haven, CC0. This supplies richer distant radiance and reflections; it is a generic lighting reference, not Leonida geography or a live scene reflection. Existing exposure is retained. Both WebGL2 and WebGPU load it successfully. See environment-lighting.md.

Player recovery no longer heals or replaces civilian/guard casualties. A bounded casualty ledger restores fatal civilians, guards and response officers through save/load. Explicit Reset encounter still resets the world; living ragdolls can recover. A normal-control WebGL2 run passes 17 stages and an integrated WebGPU run passes 20 stages: actual SMG fatal damage, time delay, BUSTED recovery, save/load and fresh Continue retain the same dead civilian. WebGPU also captures Lucia standing, seated and exiting. Neither run claims a separate WASTED browser test; that path shares the recovery function. Both report zero errors/warnings. Havok tests cover guard/response lifecycle and disposal. See casualty-lifecycle.md.

Ground vehicle spawning now searches nearby level, unoccupied space using oriented footprints and Havok queries. Three physical tests and a normal WebGPU two-car spawn audit pass. The integrated WebGL2 detailed-car audit passes all 13 stages with the new player skins and lighting. Production build and all 113 tests pass for this checkpoint. A subsequent camera/barrel aiming correction and derived vehicle LOD remain separate work, and these functional checks do not establish the performance target.


## Detailed cars in ordinary play

The current starter and two ambient traffic cars use the verified 61,879-triangle, 5.92 MB derivative, retaining detailed bodywork, cabin, tires, brakes, hinged panels, glazing and materials. Its 79 renderable component meshes replace 112 in the original. This is a fixed optimized representation, not automatic distance LOD. The total class budget is six, and owned saves displace excess ambient detailed traffic. Startup download failure preserves a playable procedural fallback; Sandbox can retry.

All114 tests and the production build pass. Both final WebGPU and WebGL2 street audits pass ten stages, including actual starter driving (~23.7m/s), character switching, moving detailed traffic, parked exit, six-car spawn limit, normal save/load and a separately labeled six-owned-save fixture. The full fourteen-stage concept audit passes on WebGPU before the exit fix and on WebGL2 after it, covering startup/explicit download failure and retry, damage, lights, saved damage/fresh Continue, garage paint and credits. All final browser records report zero unexpected errors. The first street run found latent throttle after exit; it is fixed and covered by actual Havok and both final browser paths. See detailed-street-cars.md. No new performance gate has been claimed.


## World surface scale

The authoring/export pipeline now uses physically consistent UV scale for road and beach grain, removing the long stretched streaks in normal views. All115 tests, build and actual-mesh measurements on both renderer paths pass. Geometry/collision/navigation counts are unchanged; package differences are recorded. See world-material-scale.md. The textures themselves are still original prototype grain, and broader world realism remains incomplete.


## Coastal detail checkpoint (9 September 2026)

Nearby civilians now use two distinct licensed Rocketbox variants, with at most twelve detailed skins and persistent private rigs through distance changes. Native Babylon SkyMaterial supplies a solar disk, atmospheric gradient, haze and a seeded night star layer; directional lighting shares its clock/vector. Road PBR detail is retained and the overly dark sand source is replaced by lighter Dense Sand. Aircraft seats and the opaque geometry behind their glass were corrected for both players.

All125 tests and production build pass on this checkpoint; a focused rerun of actual aircraft seating passes after its final shell refinement. The frozen `coastal-detail-v8` module is `index-CxJrQY1k.js` (SHA256 `0e304f177228f219ba9cc1c5ccad41347655f108c4deedb543f41583541e5dcc`). Both renderers pass16 sky stages total,32 aircraft seating/takeoff checks total, and31 actual civilian fatal-damage/BUSTED/save/load/fresh-Continue stages total with zero errors. Full-game source skins and local textures are visible in the records. No new sustained performance pass is claimed.

The latest user requests remain active: hip firing can be inconsistent with body direction; traffic needs visible carjacking rather than immediate ownership transfer; seriously injured surviving NPCs recover too quickly; the connected map is too small; controls are too verbose; visible component collisions, water/swimming/shoreline detail and world-edge protection need work. These are being implemented after this graphics checkpoint. Fatal NPC persistence verification does not excuse the separate rapid nonfatal-recovery defect. See the maintained continuation priorities.
