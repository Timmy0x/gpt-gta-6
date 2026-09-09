# Physical authored lamps and palms

Accepted functional slice `street-v18`, world `authored-860409-v8-street-objects`, 2026-09-09. This is a concrete subset of the larger physical-world request. It covers **264 existing lampposts and 291 palms**, including the central neighborhood and western expansion. It does not establish completion of all world-object physics or GTA-level visual fidelity.

## Geometry and physics

`StreetObjectAuthoring` captures the existing lamp/palm hierarchy before the district material merge loses ownership. Stable IDs derive from kind and authored coordinates, with deterministic occurrence suffixes where coordinates repeat. Records retain the original geometry's compound transforms, material mesh spans, mass, health and lamp light position. The exporter adds 555 records and 4,839 box/cylinder compound children. This is existing original project art; no new third-party assets or generated art were introduced.

Intact meshes remain shared per chunk and material. `batchStreetObjects` assigns disjoint vertex/index ranges, verified against every exported native package. `StreetObjectGeometry` extracts only a damaged object's exact source vertices and indices, parents those pieces to its physical root, and degenerates the original intact index ranges. Neighbors remain in the same batch. There is never a rendered intact duplicate of the fallen object. Materials remain owned by the package and are released only after moving pieces are removed.

Static compounds use the actual trunk, stiff palm spines/coconuts and lamp base/post/arm/housing transforms. They stop vehicles, characters and props and are returned by the shared combat ray. Upon destruction the same root changes to a dynamic Havok body; the existing geometry falls with it. Fallen bodies retain collision and can be moved by later contact. Havok handles natural sleep. Navigation changes from the upright base footprint to the fallen rigid assembly's conservative footprint, including when the object is restored outside visual residency. Lamplight anchors and the extracted emitter disappear after the pole breaks.

Project tuning: metal lamp 110 kg / 140 health; palm mass `height × 45 kg` / 260 health. Shared material responses apply to impacts, bullets, blasts and fire. Native contacts above 240 N·s enter a bounded deferred queue, with damage `min(650, impulse / 20)`. Falling impulse is capped at 2,400 N·s; the generic blast body loop excludes street objects to prevent applying a second impulse. These are project decisions, not published Rockstar values.

## Residency and persistence

Physics uses the existing 220 m load / 310 m unload primary radius and 90 / 150 m active-anchor radii. Far fallen bodies retire first, preserving their last supported pose before terrain support is released; up to 24 ordinary static bodies then unload per update. Two reusable primitive shapes support all compound instances. Exact package buffers and extracted pieces are discarded by package eviction. Both physics-first and visual-first eviction orders dispose the final unused root.

`SaveData.streetObjects` stores only changed IDs, health, fire, fall state, transform and velocity. Main save/load uses that field, while unknown IDs can be ignored by a changed authored layout. Validation rejects duplicate IDs, non-finite values, malformed vectors and invalid quaternions. The ordinary encounter reset does not regrow scenery. Saved load can restore earlier intact scenery or a damaged state; it also updates lights, physical bodies, batch visibility and navigation.

Burning palms damage nearby characters through the shared heat path, respect solid cover, and extinguish more quickly in rain. Extinguishing does not restore the tree. Blast exposure is tested before applying damage and the target's own body is excluded from its cover query.

## Cost and evidence

The immutable candidate derives from `coastal-v15-source`, with the street files and targeted save/load and combat-hit hooks overlaid. It excludes the later weapon inventory/handling and occupancy animation work. Final frozen file hashes are in [staging-v18.json](evidence/street-objects/staging-v18.json); cohort-v16/v17/v18 record the intermediate lineage. Both browser runs used `/assets/index-DRAG-R9K.js`, SHA-256 `6855b993e9dfef08bcf3ad7888dc429887c66e8d48e4830a403bfa727ddd87e1`.

| Export metric | Previous world v7 | Street world v8 |
|---|---:|---:|
| Native packages | 138 | 138 |
| Shared materials | 190 | 190 |
| Authored meshes | 1,970 | 1,920 |
| CPU geometry bytes | 75,149,512 | 75,149,512 |
| Compressed asset bytes | 17,740,840 | 17,456,841 |
| Texture bytes | 5,387,386 | 5,387,386 |
| Raw manifest bytes | 319,463 | 3,153,513 |

The v8 manifest compresses to 380,972 bytes with gzip. The 1,983 per-object material spans use 350 intact street batches. This reduces whole-world intact mesh submissions by 50 compared with the previous authoring batches; it does not measure actual GPU draw calls. Damage adds two meshes per lamp or up to five per palm in the current material grouping, only while that package is resident. All original source buffers remain present while a subset is extracted, so heavy nearby destruction can increase residency cost.

At the production spawn in the native package test: 167 street bodies, 42 street batches, zero extracted meshes, 1,169,568 bytes of index backups. The entire fixture had 653 scene meshes (including invisible physics roots), 486 geometries and 271 physical bodies. One damaged production lamp added two extracted pieces and its compact save delta was 359 bytes. `World.getStreamingStats()` includes street bodies, extracted meshes/geometry and backup buffers, with a nested breakdown. It is not a browser/process memory measurement.

Validation:

- All **181 tests** in the immutable candidate passed, including nine street-specific and two native combat-exclusion tests and the existing combat, packages, aircraft, vehicle exterior, police and travel suites. Production TypeScript/Vite build passed. The source snapshot predates the subsequently added coastal travel-collider regression test; its runtime fix is present, and staging preserves the newer coastal test rather than reverting it. [Build log](evidence/street-objects/build-v18.log), [test log](evidence/street-objects/tests-v18.log).
- Actual Havok contact stops a moving prop at the pole surface; a 19 m/s sedan impact breaks it; projectile damage extracts the original geometry; blast, obstruction, heat and rain use shared damage behavior.
- Eight native geometry/physics eviction/reload cycles retain damage with stable mesh/body/shape counts in both eviction orders. The production test travels west, disposes the old lamp buffers, reloads a new native package and restores its pose; final body/mesh/geometry/shadow counts are all zero after disposal.
- Every exported range is disjoint and covers its source batch exactly. There are no cross-object triangle indices. [Export metrics](evidence/street-objects/export-metrics.json).
- Normal UI audits passed **10 checks on each of WebGPU and WebGL2**, with zero runtime errors/warnings. Map travel, 12 actual pistol hits on a central lamp, sedan entry/driving into a western lamp, save/load, nine pistol hits on a central palm and encounter reset all use normal controls. Read-only diagnostics confirm actual damage, native motion, extracted geometry, persistent central damage across travel, and load restoring the earlier central state while undoing the later western damage. Both sets of impact and fallen-palm screenshots were inspected. [WebGPU result](evidence/street-objects/normal-v18-webgpu/result.json), [WebGL2 result](evidence/street-objects/normal-v18-webgl/result.json).
- GPU frame times, 1% lows and sustained destruction memory have **not** passed the full goal's performance acceptance gate. A short isolated NullEngine physics timing is not a rendering benchmark.

### Browser findings and corrections

The first attempts remain in the evidence folder. Two map/aim attempts had an obstructed or wrongly selected viewpoint; later unobstructed testing established a real native collector bug: Havok's default ray collector stored only the nearest self capsule, so filtering afterward lost the physical lamp. The shared ray now uses native `ignoreBody` for one exclusion and an adaptive collector for multiple excluded bodies, without mutating shared shape collision filters. Native regressions cover an actual player controller, a thin pole and close cover, plus 40 excluded bodies sharing a shape with a valid target. The earlier diagnostic runs are not acceptance evidence.

A first western driving attempt missed the narrow pole after map zoom quantization moved the car 2.55 m sideways. The final normal harness reprojects the precise pin after zoom and records driving samples. Both final runs hit and break the pole. A separate native red/green regression reproduced a fallen pole dropping 2.3 cm when distant terrain support unloaded before its queued body; prioritizing fallen-body retirement preserves the last supported pose. These failures and their fixes are retained in the v16/v17 reproduction folders and query/eviction logs.

Whole-scene per-frame engine draw-counter deltas in the WebGPU run ranged from 1,401 to 1,654 in the stable captures; save/load had a 3,252-draw transient. Mesh counts ranged from 1,913 to 2,715, and physical body counts from 206 to 399. These are different views and residency states, not a controlled before/after performance comparison. Two nearby fallen objects extracted seven meshes / 57,760 geometry bytes, with 2,102,400 bytes of resident index backups. The draw and residency values are captured in both result files; the visible scene still has a substantial rendering cost.

## Remaining fidelity work

Flexible frond ribbons and decorative bark rings do not receive separate rigid collision; the crown follows the falling trunk. The whole object releases at a damage threshold: trunk fracture, bending metal, stump meshes, cut locations, electrical sparks and individual frond dynamics are not implemented. The lamp emitter is disabled after falling rather than receiving a separate broken-lens material.

Benches, traffic signals, hydrants, planters, many fixtures and remaining non-lamp/non-palm authored props require their own physical/damage integration. The existing procedural palm and lamp art also remains a visual fidelity gap. Aircraft fine geometry and the remaining vehicle catalog are separate work. These omissions must remain visible rather than being counted as completed by this slice.
