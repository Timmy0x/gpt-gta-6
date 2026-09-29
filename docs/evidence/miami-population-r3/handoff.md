# Miami local population checkpoint

Based on accepted 88a8b2b, implemented in `.local-builds/miami-gameplay-r3-source`.

## Implemented

- `MiamiWorld.pedestrianSites` exposes a reproducible public-road resident catalogue across the expanded R2 area. The current dataset produces 803 sites. Original 30 `miami-civilian-N` identities remain compatible with prior saves.
- Mapped sidewalk sites have a source-grounded short walking segment. Roads whose public source has no sidewalk width may provide roadside **waiting** sites, set outside the road and building footprints. This does not add or claim a mapped sidewalk. Every newly created actor still requires native static walkable ground and capsule/path clearance, so unsupported, wet, occupied and blocked candidates are rejected.
- Local creation is paced (at most 3 walkers and 1 traffic vehicle per half-second). New healthy people appear 18–115m away and outside a conservative camera-facing cone. Offscreen people retire after 120m; the hard far retirement threshold is 180m. The usual local pedestrian budget is 30. Density changes bound new generation and never erase or revive existing casualties.
- Actor creation uses stable public-site IDs and deterministic identity seeds. Healthy distant ambience may restart a simplified local routine; injured/dead people are stored as exact health, limb-injury, pose and position records. Returning restores those records. Ordinary player recovery preserves them; the explicit encounter reset clears them.
- Version-four civilian casualty saves support a finite 4096-entry ledger. Versions 1–3 retain their previous 60-civilian validation cap. There is no truncation or least-recently-used death eviction. Only cached data persists for offscreen retired foot actors; their models, controllers, ragdolls and resources are disposed.
- Traffic appears on supported public lane nodes using real native full-body placement and ground footprint probes. Pristine offscreen crew/cars retire. Damaged cars, injured seated drivers, theft and active entry/ejection handoffs survive retirement. Healthy crew snapshots attached to changed cars make the existing save filter retain those cars. The generation budget targets 12 nearby civilian traffic vehicles and stops generating when the total vehicle list reaches 48. Preserved damaged traffic may exceed the ordinary local target; it remains part of that total generation cap and retains physical collision anchors.
- Civilian fallback death now raycasts native ground while excluding its own controller. It uses source-frame ground +0.35m and preserves the existing height if support is absent.
- Incorporated the parent-owned visibility prerequisites: optional `Obstacle.baseY` and actual native building collider bottom Y.

## Owned files

- src/core/contracts.ts
- src/gameplay/Population.ts
- src/gameplay/police/casualties.ts
- src/world/miami/MiamiWorld.ts
- src/world/miami/MiamiPopulationSites.ts (new)
- tests/miami-population.test.ts (new)
- src/gameplay/CasualtyPlacement.ts (new)

No main/UI/police/camera files were edited by this subagent.

## Evidence

- `/tmp/miami-population-r3-repair-all.log`: 8/8 native tests pass. Actual R2 traversal visited all 34 named destinations after 1.5 seconds of simulation per destination. Minimum 8 nearby foot actors /2 traffic vehicles; maximum 30 foot actors /12 vehicles during that traversal; 803 public sites. This is native simulation evidence, not normal browser-control verification.
- `/tmp/miami-population-r3-repair-travel.json`: public-native per-destination counts and locations, no provider imagery or proprietary geometry.
- `/tmp/miami-population-r3-repair-focused-final.log`: 7/7 tests pass after independent-review repairs. Covers injury/death travel and save/load, native placement rejection, changed traffic preservation, negative-Y fallback, and ledger validation.
- `/tmp/miami-population-r3-repair-regressions.log`: 32/32 existing lifecycle, vehicle-occupancy, traffic-terminal and persistence tests pass.
- `/tmp/miami-population-r3-repair-typecheck-final.log`: final TypeScript result.

The parent should verify the frozen integrated source through a full build/test suite and normal game controls. The final focused run covers transient handoff baseline retention added after the complete native 34-destination run; the final integrated suite should rerun that full test on the frozen cohort.

## Remaining limits

- Accepted assets currently have two licensed civilian skins. Stable identity/appearance selection does not establish complete race, gender, physical or photorealistic diversity.
- Sidewalk routes use public road widths and short native-clear segments, not a full authored pedestrian navigation network. Waiting, walking and short stationary pauses are implemented; full contextual tasks, crossing negotiation, emergency behavior and believable destination schedules remain unfinished.
- Initial and newly resident traffic still use the existing civilian road control/intersection logic. Traffic generation/retirement are improved; lane driving fidelity and current mapped signal timing remain incomplete.
- Damaged far traffic remains as physical vehicles and seated crew; it can broaden mandatory collision residency. Packed public source geometry alone can exceed its optional preload budget when that support is required. No total memory/FPS or long-session target is claimed.
- Explicit user-created entities are governed by existing creative budgets. The 30/12 figures are normal generation targets; protected interactions and retained damaged vehicles can require extra live actors.

## Independent review repairs

- Healthy modern changed-car crew snapshots with explicit `fallen=false` no longer enter the legacy permanent-incapacitation path. Versions 1–2 retain their absent-`fallen` legacy semantics. A native fresh car/crew roundtrip plus later ejection proves healthy crew remains healthy.
- Cached fallen people use their saved root/bone posture for native multi-capsule occupancy checks. This permits saved lying space beneath a low overhead obstruction while rejecting a blocker at the actual saved torso. These are authored clearance proxies; they do not replace the restored real ragdoll or establish exact clothing collision.
- Temporary occupied/locked entry states retain the original ambient car damage baseline. A canceled approach followed by cosmetic damage at 100 health is still saved with its healthy crew.

Independent reviewer evidence: `/tmp/miami-population-independent-repaired-r3.log` matches the prior repaired runtime cohort; see the refreshed source-files.json for the final wide-canopy support repair.

The wide-canopy variant was also reproduced and fixed: cached support rays now begin 0.15m above their saved ground anchor, beneath overhead objects, before saved-posture occupancy checks. The final native low-canopy regression uses a five-metre-wide canopy that covers the root and still proves lying-space blockage is rejected. The final focused 7/7 run covers this source change. New healthy actor and traffic placement is unchanged; the parent integrated suite reruns the 34-destination test on the final cohort.
