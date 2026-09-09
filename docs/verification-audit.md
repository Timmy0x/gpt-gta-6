# Independent integrated gameplay audit

Reviewer: reference/map subagent, independently exercising the parent-integrated build. Date: **2026-09-09**. Status: **critical runtime defects and both map/civilian defects fixed and independently retested; central prototype remains partial with substantial functional and visual gaps**. This does not certify the complete goal.

## Reproducible setup

- Script: [tests/browser-audit.mjs](../tests/browser-audit.mjs).
- Device: Apple M5 Pro, arm64, 24 GiB system memory; Darwin 25.5.0.
- Browser: installed Google Chrome **152.0.7977.83**, isolated headless profile.
- Rendering: explicit **WebGL2**, 1920×1080 render resolution, device scale 1, high quality. Chrome launched with Metal ANGLE. This is an automated browser context, not a substitute for a user-visible interactive performance session.
- Original URL: `http://127.0.0.1:5174/?backend=webgl`; page title verified **Leonida — Free Roam**. Parent later provided a stable production snapshot at `http://127.0.0.1:4175`.
- Normal UI and keyboard controls used; `window.__leonida.snapshot()` read for instrumentation. The checkpoint additionally reads only UI-generated sandbox saves through Playwright storage inspection to compare restored entities/components. No save injection or `?test` mutation hooks used in these runs.
- Developer hot reload interrupted the very first launch/entry attempt. A subsequent run disabled browser WebSockets to prevent HMR; related Vite connection console errors are test-harness effects, not gameplay defects. Production snapshot retests avoid HMR entirely.

Run with `AUDIT_SUFFIX=-retest node tests/browser-audit.mjs` from the repository. Run the bounded arrest/search audit with `AUDIT_MODE=outcomes AUDIT_SUFFIX=-outcomes node tests/browser-audit.mjs`. `AUDIT_URL` overrides the base URL and `AUDIT_BACKEND=auto` requests normal capability selection. Suffixes preserve earlier evidence. The script records observations; it does not convert screenshots or absent exceptions into automatic acceptance assertions.

## Initial normal-control evidence

Evidence: [audit-results.json](evidence/audit-results.json), plus screenshots below. These results predate the police/audio fixes.

| Interaction | Observed result | Scope of conclusion |
|---|---|---|
| Enter Free Roam | Scene starts, HUD and control prompts readable, actual WebGL2 backend reported | Fresh startup passed |
| Hold W for 650 ms | Player moved from Z −28 to −25.595, stable ground height ~1.02 m | Basic forward walking passed |
| E near starter coupe | Occupied `vehicle-1`, health 100, four ground contacts | Instant entry works; entry animation/passenger rig not implemented |
| W for 3.8 s | Coupe moved ~52 m, reached 24.86 m/s | Physical driving responds through normal input |
| W+D then W into scenery | Crash count increased 0→1; coupe health 100→25; player health fell to 88.2; body count increased 133→135 | Collision, damage and independently simulated fragments exercised; exact local dent fidelity needs more close-up tests |
| Crash near witnesses | Wanted state changed clear→reporting→one-star pursuit | Witnessed crash reporting observed; unobserved counterpart still needs separate validation |
| G | Coupe condition restored 25→100 | Repair control works in this case |
| E exit, then Tab | Vehicle became null, identity changed Jason→Lucia | Basic exit/switch works; no claim of clearance-safe exit or rigged blending |
| F2 spawn sedan, crate, civilian | Vehicle/body/prop and pedestrian counts increased; wanted selection changed to 3 | UI controls dispatch their actions |
| Wait after three-star selection | Simulation and rendering stopped at simTime 17.5; snapshot still callable and paused=false | **Fail: complete pursuit/recovery loop blocked** |

## Critical findings

**AUDIT-001 — Police coordinates copied incorrectly (fixed and retested).** `WantedSystem.crime`, `setLevel` and visible-contact updates used object spread on a Babylon `Vector3`. Its public coordinates are accessors; snapshots contained `_x/_y/_z` and no `x/z`. Road guidance and distance queries reading `lastKnown.x/z` therefore receive undefined. Reproduced both with a witnessed physical crash and through normal F2 wanted selection. Parent added explicit `{x: position.x, z: position.z}` copies and a regression test. Stable-build retest confirms public `x/z`, search/reacquisition transitions and visible police arrival.

**AUDIT-002 — Siren position calculation stops the render loop (fixed and retested).** Actual captured exception: `Failed to set the 'value' property on 'AudioParam': The provided float value is non-finite.` Stack originates in `GameAudio.effect`, called by `GameAudio.update` inside the render loop. The source adds a plain `{x,y,z}` object cast to `Vector3` to a Babylon vector; Babylon's method reads internal vector components and produces NaNs. Random siren emission makes the failure intermittent, including at one star. Parent used a real vector and finite audio input guards. The final production retest completed the full audit script, including 30 seconds of three-star response, with zero page exceptions.

**AUDIT-003 — Frame-time instrumentation previously truncated long stalls (fixed source and retest instrumentation).** The render loop stored `Math.min(rawDt, .1)` in the frame-time series. It cannot measure frames above 100 ms correctly. Parent now retains raw frame times separately. No performance gate is declared passed from pre-fix measurements.

**AUDIT-004 — Map search leaves all results visible (fixed and independently retested).** Open M, type `Palmetto`. All ten location buttons originally remained visible, including Ocean Beach, Nacre Hotel and the police station. Source sets `button.hidden` but `#locations button { display: flex }` overrode the browser's default hidden rendering. Original evidence: [failed map search](evidence/audit-map-retest.png). Parent added `[hidden] { display: none !important }`. The refreshed checkpoint shows exactly one visible result, Palmetto Supply, in both an automated DOM assertion and the [independently inspected screenshot](evidence/audit-map-checkpoint.png).

**AUDIT-005 — Creative civilian spawn hidden by ambient density budget (fixed and independently retested).** F2 → Spawn civilian originally increased the total from 30 to 31, but `Population.update` immediately disabled index 30 at density 1 through `i < 30 * density`. Parent added a separate creative flag and excluded those actors from the ambient visibility cap. The refreshed checkpoint confirms density 1, an actor visibly rendered at the left edge of the [first frame](evidence/audit-civilian-before-checkpoint.png), and 13.10 m displacement between normal UI saves around a three-second observation. It moves beyond framing in the [second frame](evidence/audit-civilian-after-checkpoint.png); pursuit/threat conditions can make it run. Both screenshots were independently inspected. This closes the reported hidden-spawn defect without claiming complete civilian navigation.

## Independent visual review

The reviewer opened these generated local images with `view_image`; the comments describe actually inspected frames:

- [Entered vehicle](evidence/audit-entered-car.png): readable HUD, connected roads, crossings, sidewalks and hotel massing. Lighting is flat and gray/beige; facade modules repeat heavily, windows lack depth/variation, and vehicles have visibly primitive body shapes.
- [Impact scene](evidence/audit-driving.png): damaged vehicle and separated fragments appear after the physical crash. Generic block facades and sparse material detail remain apparent at close range.
- [Three-star freeze](evidence/audit-police-pursuit.png): HUD shows active pursuit, but no responding police are visible in this shot. Lucia's body is an obvious assemblage of primitive shapes, without realistic clothing or a skinned character rig. This does not meet the requested finished character standard.

Parent is improving lighting and camera placement; new captures must be assessed separately. Better illumination cannot alone close model, texture, animation, population or geographic fidelity gaps.

## Final production retest

Evidence: [audit-results-retest.json](evidence/audit-results-retest.json). Tested at `http://127.0.0.1:4175/?backend=webgl` after parent rebuilt the stable production copy with both fixes. All audit-created browsers were closed afterward.

- Walking, entry, driving, crash damage, repair, exit and identity switching reproduced successfully.
- Wanted 3 progressed pursuit → search → pursuit; six police vehicles were added to the twelve ambient drivers. [Police arrival](evidence/audit-police-pursuit-retest.png), independently opened with `view_image`, visibly shows police cars surrounding the player. Their driver/officer models are absent. Arrest/escape completion was not asserted in this run; the test reset the encounter after the observation period.
- F2 created the requested vehicle and crate. The civilian count rose; its later visibility fix is verified in the checkpoint below.
- Save RAIN → set CLEAR → load restored the displayed RAIN state. This validates weather persistence, not complete component/world damage persistence.
- Pause held simTime exactly constant during a 1.5 second wall-clock wait. Map search failed as described above.
- Zero captured page exceptions or failed requests. Two console resource 404 messages lacked URLs in this run. The later outcome run captured both corresponding warnings at `http://127.0.0.1:4175/favicon.ico`; no failed gameplay asset or WASM request was observed.
- [Updated vehicle view](evidence/audit-entered-car-retest.png), independently opened with `view_image`, has better street-level framing and brighter material response. It remains pale/washed out with minimal surface detail and obviously provisional models. Visual quality does not meet the full requested realistic art standard.

The latest **1,800 raw frame samples** (about 30 seconds, not the full requested 30-minute session) at 1920×1080 WebGL2/high measured:

| Measurement | Observed |
|---|---:|
| Median frame time | 16.70 ms |
| Median FPS | 59.88 |
| 99th-percentile frame time | 21.10 ms |
| FPS from mean slowest 1% frame time | 41.17 |
| Maximum frame time in sample | 33.60 ms |
| Used JavaScript heap at sample end | 723,832,891 bytes (~690 MiB) |
| Allocated JavaScript heap | 804,598,959 bytes (~767 MiB) |

This short sample is encouraging for the current small district, but it is not a 30-minute memory/stability result, GPU-memory measurement, full-world traversal, or independent WebGPU performance gate. Headless Chrome, warm-up duration, and concurrent processes limit comparisons. Other agents' WebGPU observations are not presented as this reviewer's independent evidence.

## Arrest, recovery and loss-of-contact outcome audit

Evidence: [audit-results-outcomes.json](evidence/audit-results-outcomes.json). A separate isolated WebGL2 production session used only normal controls and read-only snapshots. It completed without a page exception or failed request; its two console 404s both identify `/favicon.ico`. The browser was closed afterward.

- **Arrest/recovery observed:** launch → F2 → wanted 1 → close panel → stand still for 45 seconds. Responding police reached the player. BUSTED appeared at `2026-09-09T11:07:32.853Z` and cleared at `11:07:35.792Z`. Cash changed from $12,500 to $12,200, health recovered to 100, wanted cleared to zero, and the player returned to the initial location. Simulation continued and subsequent creative/map controls worked. This verifies this one-star arrest case, not foot-officer animations, death recovery or every wanted level.
- **Sandbox-assisted search/escape observed:** reset → F2 wanted 1 → wait nine seconds → M → Sunset Customs teleport. The normal map UI moved the player to approximately X −34, Z −55 while police retained the earlier last-known position X 3.3, Z −28. Search persisted, changed to cooldown after about 21 seconds, and cleared after about 31 seconds without an additional cash loss. This validates loss-of-contact state progression after a creative relocation. It does not demonstrate a continuous walking/driving escape or car-switch identity evasion.
- **Visual evidence independently inspected:** [BUSTED](evidence/audit-arrest-busted-outcomes.png) shows police cars physically contacting the player and the outcome overlay, with no visible officer rigs. [Escape end](evidence/audit-escape-end-outcomes.png) shows Sunset Customs, zero stars and $12,200. Neither screenshot proves a garage service/interior loop.

The final 1,800 frames of this predominantly stationary outcome session measured 59.88 FPS median, 17.70 ms p99, 53.02 FPS from the mean slowest 1% frame time, and 27.70 ms maximum. Used JavaScript heap was 200,094,612 bytes (~191 MiB). This is a separate short sample with a different workload; its lower heap and higher 1% result are not evidence of a memory optimization or a sustained performance gate.

## Refreshed checkpoint audit

Reproduction: `AUDIT_MODE=checkpoint AUDIT_SUFFIX=-checkpoint node tests/browser-audit.mjs`. Evidence: [checkpoint JSON](evidence/audit-results-checkpoint.json). This isolated WebGL2/high/1920×1080 session ran the complete baseline plus explicit assertions for the two fixes and a normal UI save/load/save round trip. All six added assertions passed. No page exceptions, failed requests or console warnings were captured, including no favicon warning. The browser was closed afterward.

- Walking, E entry, driving at 24.92 m/s, impact damage to 21.33% condition, G repair, exit and Jason→Lucia switching worked with the new character mesh. Three-star police search/reacquisition continued; by the last sample the character had recovered at the start with wanted cleared. This run did not poll its transient BUSTED overlay, so the earlier outcome run remains the direct overlay evidence.
- Normal save/load/save preserved all four saved vehicle IDs, exact vehicle HP, all saved panel vertices and component flags. The coupe held 94.45247% condition from later physical contact. This is evidence for the actual current vehicle component states; this run did not deliberately puncture every tire or detach every part. Complete before/after sandbox JSON is retained inside the checkpoint evidence.
- Before saving there were 19 props and one custom civilian. Creating an extra prop/civilian raised the runtime totals to 20 props/32 pedestrians. Load restored 19 props/31 pedestrians, retaining one custom civilian. Prop IDs, material and health matched; poses varied only slightly as the live physics resumed. RAIN and the Lucia identity remained restored. This is a browser-local sandbox round trip, not streaming, corruption recovery or every burning/destroyed state.
- [New character rendering](evidence/audit-civilian-before-checkpoint.png) was independently inspected: shaped torso, clothed limbs, face, shoes and hands improve the former primitive assembly. Source inspection confirms one skinned mesh with 17 authored bones. It still has stylized proportions and simple vertex-color surfaces; full realistic asset fidelity and all animation transitions remain open. [Updated streetscape](evidence/audit-entered-car-checkpoint.png) and [filtered map](evidence/audit-map-checkpoint.png) show more detailed crates, bins and telephone booths, while building repetition and pale lighting remain evident. These screenshots do not prove material-specific destruction.

The latest 1,800 raw frames measured 16.70 ms median (59.88 FPS), 17.60 ms p99, 39.57 FPS from the mean slowest 1% frame time, and 73.50 ms maximum. Used JavaScript heap was 777,896,208 bytes (~742 MiB). Parent ran another browser smoke test concurrently. This short workload does not establish the requested 30-minute stability, bounded-memory or full-world performance gate.

## Remaining audit gates

- Continuous walking/driving escape and vehicle-switch evasion, plus WASTED/death recovery. One-star arrest/recovery and sandbox-assisted search/cooldown/clear now have independent evidence.
- Every supported wanted level; foot officers, tactical units, helicopter support and military interactions must not be inferred from star count alone.
- Complete world save/load state matrix, repeated entry/exit/switching, shooting/reload, boating and flying via normal controls. Map filtering, creative civilian visibility/motion, current saved vehicle components, weather round trip and pause/resume have narrow evidence above.
- Auto backend/WebGPU and explicit WebGL2 production runs, console/WASM/asset-path checks.
- Sustained 30-minute mixed traversal/destruction/pursuit with raw frame-time and bounded memory evidence. Short 60 FPS readings are not the requested performance gate.
- The five other regions and major content systems remain outside this central audit. The goal cannot be marked complete from this neighborhood test.

## Current code-review limits and superseded findings

The earlier axes-only gamepad finding is historical: refreshed source includes action buttons, aim/fire triggers, deadzones and disconnect handling. This reviewer has not independently tested a real controller or full controller/menu loop. Vehicle entry/exit still instantly hides/shows the character, and police population entries are vehicles without visible officer/driver rigs. The former primitive character assembly is superseded by the17-bone skin described above, with final realistic fidelity still missing.

The earlier HP-only save finding is also historical. The refreshed serializer includes vehicle IDs, pose/velocities, panel vertices, tire and window/light/bumper flags, plus prop pose/health/burning and custom civilians. The normal UI round trip verifies its present saved state; every damage configuration, removed-door state, world streaming and long-term persistence still require their own evidence.

## Second checkpoint integration audit

The normal-control combined script (`tests/integrated-checkpoint.mjs`) launches a frozen production build at4175, chooses a backend, and uses UI/keyboard/mouse for every gameplay action. Its `?test` access reads component state only; no teleport, damage, vehicle or weapon mutation hook is invoked. Normal creative UI placements/fast travel are explicitly part of the sequence. Snapshots and screenshots are kept as `docs/evidence/combined-{backend}*`.

Assertions cover visible driver attachment, powered driving, physical braking followed by safe exit, a filtered route destination, real pistol firing/destruction, ammunition conservation over switching, a real airborne grenade and delayed detonation, per-weapon/prop/civilian save restoration and rain/night settings. The current script additionally keeps the creative panel open through a grenade fuse to cover the integration bug where autonomous combat updates previously paused.

Earlier failed harness records are retained: one read `projectiles.active` instead of the actual `grenades` collection; another attempted exit while still travelling14.4m/s after using only the handbrake. The ordinary safe-exit rejection was correct; the corrected sequence uses service braking and waits until below1m/s. These harness failures were not engine crashes.

The independent normalWebGL2 police audit uses no test mutation hook and retains separate initial/follow-up records. Initial levels1–5 produced compliant arrest/recovery and saveID preservation; initial mouse compatibility events failed to activate aim/fire and therefore do not verify resistance. An event probe found native pointer events reached the canvas before compatibility mouse events after Babylon's pointer handling. A normal canvas capture click allowed the follow-up to verify resistance and officer fire. Input now also handles pointerdown/up/cancel directly so the first press need not depend on that compatibility event.

The armed follow-up demonstrates level2 officer gunfire with declining player health, and level5 visible tactical crew and physical helicopter ascent. Source tests separately verify constrained ragdolls, blast shielding, destruction/navigation, dispatch frustum selection and physics lifecycle; those unit results are not mislabeled as browser demonstrations.
