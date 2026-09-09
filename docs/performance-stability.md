# Performance and stability evidence

**The 30-minute acceptance gate is not yet satisfied.** The first long run stopped after **951.07 seconds (15 minutes 51 seconds)** during its plane phase. No browser crash or page error occurred, but the planned destruction and save/load phases were not reached. The corrected build passed sustained functional flight checks; a fresh measurement awaits the final integration freeze.

## Frozen baseline and result

The production artifact `ce382f3` was measured on 2026-09-09 from **12:24:56.800 UTC** until the workload failure at **12:40:47.725 UTC**. Its main JavaScript SHA-256 was `d93125df258fd0ae3e0c2619a69b33f5a911e4326fec55ffb3559601c5ca12df`; all fingerprinted assets were unchanged at completion. Concurrent source changes were not part of this artifact.

| Measurement | Incomplete baseline |
| --- | ---: |
| Raw render intervals | 57,006 |
| Resource samples | 98 |
| Median FPS | 59.88 |
| Mean FPS | 59.94 |
| P99 frame interval | 19.00 ms |
| Reciprocal P99 | 52.63 FPS |
| Mean slowest 1% frame interval | 21.95 ms |
| **1% low, from mean slowest 1%** | **45.55 FPS** |
| Maximum render interval | 307.40 ms |
| Browser errors / crashes | 0 / 0 |

These partial-session values do not demonstrate the project's 30-minute, 60 FPS median / 30 FPS 1% low target. The median is also slightly below the literal 60 FPS threshold. The renderer ran at 1920 × 1080, high quality, hardware WebGPU throughout the recorded samples.

## Workload completed and failure diagnosis

- Coupe: 298.66 seconds of real physics driving, nine waypoints and three explicitly logged hook recoveries. Pursuit, search, escape, collisions and streamed district travel occurred. Some original waypoint coordinates cut across roadside objects; the current harness uses lane coordinates.
- Boat: 298.70 seconds, ten waypoints, no recovery, ending at full health.
- Helicopter: 298.35 seconds, eight waypoints, no recovery; 293.75 seconds above 8 m altitude. The aircraft sustained travel near 35 m altitude.
- Plane: physical runway acceleration and takeoff occurred, then the aircraft left the authored land area and descended below the map at approximately 927 seconds. The first failure position was `(-3.19, -6.33, 403.33)`. This exposes a geographic boundary gap and a turn-control defect, rather than showing a general Havok crash.
- The original harness then recovered the plane at 50 m altitude with zero airspeed. Because recovery correctly resets velocity, the aircraft fell before accelerating. This invalid recovery loop exhausted the guard after eight assisted recoveries. The harness now recovers on a cleared runway and accelerates physically; it never seeds an airborne velocity.
- The five-minute destruction/pursuit and save/load/chunk-travel phases were **not reached** in this baseline.

A separate 78.58-second functional check on the same old artifact used proper runway recoveries and reproduced the turning failure three times with 100 health and no browser errors. Its telemetry shows the nose yawing left while horizontal velocity continues north, passing beyond the authored terrain. This separates the flight defect from the earlier midair recovery mistake.

## Plane regression and correction

[`tests/plane-turn.test.ts`](../tests/plane-turn.test.ts) uses real Havok, a continuous 5 km test ground, physical runway acceleration and aerodynamic takeoff. It then commands separate four-second left and right turns and measures heading, lift-bank direction, lateral acceleration and altitude. No transform or velocity is seeded after spawning.

| Signed response, positive toward commanded turn | Before fix, either direction | After fix, either direction |
| --- | ---: | ---: |
| Mean bank projection | −0.2133 | +0.1554 |
| Mean lateral acceleration | −0.7341 m/s² | +1.5115 m/s² |
| Heading change magnitude | 0.5279 rad | 0.4666 rad |
| Starting → ending altitude | 61.52 → 73.65 m | 61.52 → 75.66 m |

Both tests failed before correction and passed afterward. The plane bank target had used the opposite sign from yaw steering; changing that sign makes lift bank into the commanded turn. The subsequent integrated checks below cover sustained flight separately.

## Corrected integrated flight checks

The corrected working artifact on port 4176, main JavaScript SHA-256 `7a647826f6cf86804124bd3570cea9e38351e1f333c1572f002d862c65005b4e`, passed two 180-second functional browser checks. Other integration browsers were permitted concurrently, so these are not performance acceptance runs.

- The [first corrected check](evidence/stability/flight-check-2026-09-09T12-51-16-017Z/) sustained flight for 164.73 seconds above 8 m, with no recovery or browser errors and 100 vehicle health. Continuous throttle produced approximately 60 m/s and a circuit wider and higher than intended.
- The [tuned control check](evidence/stability/flight-check-2026-09-09T12-54-46-720Z/) ran from **12:54:57.111 to 12:57:57.408 UTC**. Physical runway takeoff and subsequent turns delivered 165.21 seconds above 8 m with no recovery, no browser errors and 100 health. After the first 25 seconds, sampled speed was 33.61–36.25 m/s and altitude was 45.01–62.90 m. The controller uses W throttle around 34 m/s, A/D steering, and proportional duty cycles of Shift/C elevator. No airborne transform or velocity seed is used. Its initial turn still overshot the north map edge before the circuit converged, while remaining airborne.
- [After-fix Havok measurements](evidence/stability/plane-turn-after-fix.json) preserve the separate deterministic regression output.

The final screenshot confirms a banked aircraft over the rendered city. It also exposes fidelity gaps: the seated torso protrudes above the trainer fuselage, aerial atmosphere is flat grey, and large roofs remain geometrically simple. Flight stability does not establish visual acceptance.

The updated harness additionally fingerprints streamed world packages, materials and textures, records observed physical travel distance and flight altitude bounds, and confirms before/after character identity when reporting a switch. Its CPU-only fingerprint check found 335 assets totaling 25.91 MB in this working build.

## Resource observations and limits

CDP JS heap used ranged from **246.55 MB to 1,043.40 MB**, ending at **260.07 MB**, compared with 977.26 MB at the first sample after loading. Five-minute heap minima were 260.28, 246.55 and 252.48 MB. This is bounded within the observed partial workload, with ordinary garbage collection, and does not establish long-term boundedness under the unexecuted destruction/save-load workload. Decimal MB are used here.

| Live resource | Minimum | Maximum | Final |
| --- | ---: | ---: | ---: |
| Meshes | 1,648 | 2,482 | 1,909 |
| Havok bodies | 152 | 287 | 200 |
| Materials | 353 | 455 | 365 |
| Textures | 100 | 120 | 102 |
| Geometries | 1,631 | 2,457 | 1,887 |
| Skeletons | 31 | 41 | 32 |
| DOM nodes | 606 | 1,712 | 693 |
| DOM listeners | 57 | 77 | 60 |

Population and streaming cause expected count variation; materials and skeletons return close to the starting count after police reset. GPU allocations and whole-process RSS were unavailable and are not inferred from JS heap.

## Environment and method

- MacBook Pro (Mac17,9), Apple M5 Pro, 15 CPU cores and 16 GPU cores, 24 GB unified memory; macOS 26.5.1.
- Installed Chrome 152.0.7977.83, headless, hardware WebGPU adapter vendor `apple`, architecture `metal-3`.
- 1920 × 1080 render resolution, device scale factor 1, high quality, no automatic quality reduction.
- Only the harness GPU browser ran during the baseline. Other agents continued ordinary source editing and CPU checks; this is a development-machine baseline. Functional flight checks explicitly allow concurrent integration browsers and are not isolated performance measurements.
- Keyboard/mouse events drive actual vehicle physics. Steering reads live snapshots. Vehicle fixture placement and exceptional recovery use test hooks with explicit event records. Creative UI sets wanted/weather/invulnerability, spawns props, ignites fire, saves/loads and fast-travels. These assisted segments do not establish normal-control acceptance gates.
- Raw intervals are captured between Babylon `onAfterRender` callbacks, including UI/streaming stalls and paused-map renders. This measures delivered render callbacks, not GPU execution or display presentation time.
- CDP JS heap and DOM counters plus Babylon live-resource counts are sampled every ten seconds without forced garbage collection.
- The intended six approximately five-minute phases are driving/pursuit, boat travel, helicopter flight, plane flight, grenade/fire destruction with pursuit, and repeated chunk travel/save/load/character switching. Failures stop invalid workloads rather than substituting stationary waiting.

## Metric definitions

For positive raw frame intervals sorted ascending: median FPS is 1000 divided by the median interval; mean FPS is 1000 divided by the mean interval. P99-equivalent FPS is 1000 divided by the 99th-percentile interval. **1% low FPS is 1000 divided by the mean of the slowest 1% of intervals**, which differs from reciprocal P99 and is the metric compared with the 30 FPS low target.

## Retained evidence and next run

- Reproducible harness: [`tests/stability-audit.mjs`](../tests/stability-audit.mjs).
- [Incomplete 15m51s baseline](evidence/stability/baseline-2026-09-09T12-24-31-048Z/): raw intervals, sampled counts, metadata, asset hashes, events, screenshots, final result and derived resource summary.
- [Original proper-runway flight failure](evidence/stability/flight-check-2026-09-09T12-45-44-149Z/) and [before-fix Havok measurements](evidence/stability/plane-turn-before-fix.json).
- The initial 22.8-second smoke stopped because its boat fixture intersected a marina pier. Entry correctly rejected it. Moving the fixture to open water resolved this harness issue.
- The corrected [121.99-second all-phase smoke](evidence/stability/smoke-2026-09-09T12-20-57-630Z/) recorded 7,119 intervals and no browser errors. Its median was 59.88 FPS and 1% low was 13.91 FPS, including a maximum 2,013.9 ms interval. It establishes that the short workload can execute, not the long stability target.

A fresh 30-minute measurement will use the final tested production artifact on port 4176 after the sustained-flight check and after other GPU browsers close. Its fingerprint, exact start/end, complete workload and final resource trends must be reported separately; this old baseline must not be relabeled as evidence for later source changes.


## Completed 30-minute baseline on 1387665

The frozen third checkpoint completed at 2026-09-09T16:22:59Z. Evidence is in `evidence/stability/baseline-2026-09-09T15-52-42-401Z/`. The run retained 102,400 raw frame intervals and 181 resource samples over 1,805.53 seconds, with zero browser errors and unchanged served-build fingerprints. The six phases covered driving/pursuit, boat navigation, helicopter traversal, fixed-wing flight, grenades/fire/five-star response, then repeated fast travel/save/load/character changes. All four transport phases completed without recovery hooks; their initial placement remains explicitly recorded as a test fixture.

**The performance gate failed:** 59.52 FPS median, 19.45 FPS slowest-1% mean, 56.73 FPS overall mean and 1,026.3 ms maximum frame interval. Targets remain 60 FPS median and 30 FPS slowest-1% at 1920×1080/high. The reciprocal-p99 figure of 32.47 FPS is not the slowest-1% result and must not be substituted for it.

| Phase | Median FPS | Slowest 1% FPS | Worst frame, ms |
|---|---:|---:|---:|
| Ground traversal and pursuit | 58.82 | 17.42 | 269.7 |
| Boat/coast | 59.88 | 30.40 | 130.6 |
| Helicopter | 59.52 | 25.00 | 120.0 |
| Fixed wing | 59.52 | 20.88 | 135.2 |
| Destruction and pursuit | 59.52 | 23.91 | 155.2 |
| Travel and save/load | 59.52 | 12.00 | 1,026.3 |

The largest stall occurred immediately before the save/load completion event at approximately 1,610 seconds. Many other 200–417 ms intervals also coincide with saved-state restoration. This is timing correlation, not yet a CPU-profile attribution. Geometry package parsing, resource reconstruction, physics replacement and shader warmup need separate profiling before assigning causes.

Observed JS heap ranged from 188 to 984 MB, starting near 190 MB and ending near 697 MB. Natural collections occurred; no forced GC was used. The final workload also retained 53 props (18 initially), 60 short-lived debris pieces, 16 vehicles, 30 civilians and four annex guards. Counts remained under the configured safety limits, but the higher post-collection heap across later phases does not prove a settled long-run memory bound. Further repeated-workload retention checks remain required. Whole-process RSS and GPU memory were not measured.

Hardware/browser/backend were Apple M5 Pro (15 CPU/16 GPU cores), 24 GB RAM, macOS 26.5.1, Chrome 152.0.7977.83, WebGPU at 1920×1080/high. Exactly one game GPU browser ran. The parent edited code and ran CPU tests/builds and a CPU-only NullEngine asset loader during parts of the session; those activities are a host-load confounder. Preserve this failed measurement and rerun final performance checks without competing build/test jobs after the identified stalls are addressed.

This baseline predates the detailed Aster Concept runtime integration. It demonstrates completion of the mixed stability route on 1387665, not final visual fidelity, full regional coverage, the performance target, or the detailed car's long-run behavior.
