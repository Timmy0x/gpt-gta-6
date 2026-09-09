# Police checkpoint verification — 2026-09-09

This is bounded browser evidence for the implemented police subset. It does not establish GTA VI behavior parity or the full project's acceptance gate.

## Environment and evidence method

The independent browser was isolated headless Google Chrome 152.0.7977.83, WebGL2 with Metal ANGLE, 1600 × 900 at device scale 1, high quality, Apple M5 Pro/macOS Darwin 25.5.0. The parent ran a separate WebGPU audit concurrently, so these runs cannot certify sustained performance.

The first run used `http://127.0.0.1:4175/?backend=webgl`, module `/assets/index-CXOdCzSu.js`, normal launch/F2/keyboard/mouse controls and read-only `window.__leonida.snapshot()`. Wanted counts and god mode were selected through the visible sandbox UI, rather than earned through five successive crimes. Saved data was read from the normal UI-generated localStorage save. There were no gameplay hook mutations. The script is [police-browser-audit.mjs](../tests/police-browser-audit.mjs); full snapshots, outcomes, error capture and save contents are in [normal run JSON](evidence/police-checkpoint-normal-webgl.json).

## Arrest and save results

Every selected level produced a physical arriving cruiser, a dismounted foot officer, visible BUSTED outcome, recovery to 100 health and a $300 cash deduction. Five recoveries changed cash from $12,500 to $11,000. The first two runs had god mode disabled; levels 3–5 had it enabled. Peak response counts observed before arrest were:

| Selected level | Officers | Tactical officers | Active foot officers |
|---|---:|---:|---:|
| 1 | 1 | 0 | 1 |
| 2 | 2 | 0 | 1 |
| 3 | 4 | 2 | 1 |
| 4 | 7 | 2 | 3 |
| 5 | 10 | 4 | 5 |

The audit independently opened the level-1 first-foot and BUSTED screenshots and the level-3 first-foot screenshot. A navy uniform, cap, badge, POLICE back marking and animated officer approach are visible. The model remains stylized; these images do not demonstrate realistic character fidelity. The initial officer gun alignment was visibly too low; the parent subsequently raised its attachment in source. A counter recording tactical officers is separate from a clear close-up visual inspection of their markings.

Normal UI save → add another civilian/vehicle → load → save restored vehicle IDs `vehicle-1`, `vehicle-2`, `vehicle-3`, `vehicle-36` and civilian ID `ped-30` exactly, with no duplicate civilian IDs. Runtime civilian count fell from 32 to 31 after loading the earlier save. This checks one restoration case, not every possible migration or corruption path.

The full first run recorded zero page exceptions, failed requests, console warnings/errors or HTTP errors.

## Mouse input limitation and separate diagnosis

Labels such as `level-2-armed-threat` in the first JSON are historical script intentions, **not successful armed-threat observations**. RMB did not activate the aim pose; a final held LMB produced zero shots. These cases therefore support compliant arrest, not resistance or police gunfire.

[police-input-audit.mjs](../tests/police-input-audit.mjs) launched a separate browser with `?test` exclusively to read input fields and attached passive DOM event observers. It did not call action hooks or mutate gameplay. [The event trace](evidence/police-checkpoint-input-probe.json) confirms the canvas was focused, visible and the hit target at (800,450). Initial RMB/LMB produced contextmenu/click events without mousedown events, so aim/fire remained false. An ordinary click established pointer lock; subsequent mouse presses produced mousedown, a visible aiming pose, two shots and resistance. The screenshot was independently viewed. Compatibility-mouse suppression before pointer capture is a plausible cause; no browser-engine root cause is asserted from this trace alone.

## Fresh build threat retest

[police-threat-audit.mjs](../tests/police-threat-audit.mjs) then opened the refreshed module `/assets/index-alOigFSS.js` in a new isolated WebGL2 browser. It used ordinary launch, F2 wanted/god controls, a normal canvas click for pointer capture, RMB aim and LMB fire. `?test` exposed read-only player/officer/response-vehicle diagnostics; neither action hooks nor direct state mutations were used. Full observations are in [the threat retest JSON](evidence/police-checkpoint-threat-retest.json).

At two stars with god mode off, the aim flag and rendered pose remained active for 35 seconds. Both officers arrived and dismounted; arrest progress stayed zero. Health fell from 100 to 91, 79.75, 70.75 and 59.5 as officers engaged. The 25-second diagnostic records an officer in `firing` with a live muzzle-flash timer. This is positive normal-control damage evidence; the camera-facing screenshot does not itself show the flash because the officers were behind the player.

At five stars with god mode on, the response reached ten officers, four tactical officers, eight active foot officers and eight physical response vehicles. The occupied helicopter rose from 0.85 to 13.42, 34.48, 55.58 and 58.27 metres and moved from approximately (-68.7, 62.0) to (-7.9, -14.2) in X/Z. Two cruisers remained stationary at approximately (68.7, 206.0) and (-140.7, 154.0), consistent with the configured roadblock assignments; the diagnostic did not record assignment names and this camera did not provide a close visual inspection of those roadblocks. A final normal LMB press produced two shots and set resistance true. Health staying at 100 in this level is expected with god mode enabled and cannot be used to assess incoming damage.

The 25-second two-star, 30-second five-star and final sky-view screenshots were independently opened. They confirm the aiming rig, ammunition changing from 12 to 10, police instruction toast and ongoing pursuit. Tactical uniforms and the helicopter were outside the captured camera view, so their world presence and motion are supported by read-only entity observations, not claimed as a verified close-up render. The refreshed officer weapon attachment was not visible in these views. This retest recorded zero page exceptions or console errors; it did not collect the broader request/warning trace used by the first run.

Navigation quality remains incomplete: one response cruiser stayed near (-44, -52) at roughly 0.1–0.19 m/s for about 25 seconds while other units arrived. The distant roadblock foot officers oscillated near (68.7, 130) and (-132, 147) without reaching the suspect during this bounded observation. These cases need route/recovery work; the successful arrivals do not establish general navigation reliability.

## Scope still unverified

Continuous player-driven escape and vehicle identity changes, fair spawn visibility across camera directions, officer ragdoll recovery during mixed combat, response withdrawal, robust recovery from blocked urban routes, clear roadblock/air-support visuals, and sustained mixed-world performance require further evidence. Focused Havok tests cover additional mechanics under controlled geometry, as described in [police-design.md](police-design.md); those tests are not substitutes for normal-world visual observations.


Parent integration follow-up: `Input.ts` now handles pointerdown/up/cancel and pointer button chords directly, retaining mouse fallback. New pointer-only/chord tests pass within the full70-test suite. The final combinedWebGL2 audit checks first-press firing against the rebuilt snapshot; consult its result. Blocked urban AI routing remains open.
