# Map, coast and travel checkpoint — 2026-09-09

The western Vice City extension is now integrated with physical terrain, connected road navigation, nearby population and the normal map. It is 0.585 km² of authored/inferred neighborhood with 94 sites and six new destinations; it does not complete the planned six-region map. The combined directed road graph contains 772 connected nodes. The production v7 export has 138 packages, 1,970 meshes and 730 structural colliders. See [district provenance and remaining art work](inner-city-expansion.md).

The map supports search, selecting all twenty named destinations, drag pan, cursor-focused zoom, player/district/world framing, keyboard selection, and arbitrary map pins. Travel loads nearby scenery and chooses actual Havok support plus standing clearance, searching up to twelve metres nearby when needed. Pins can land on supported rooftops, dry terrain, piers or the ocean surface. Unloaded/unsupported and out-of-bounds positions are rejected. Own-character clearance queries exclude only that character's capsule and restore its collision filter immediately.

A normal-control audit exposed a real travel race: while the destination's visual packages loaded, render updates around the old position could unload its sidewalk collider. `World.preparePosition` now restores destination collision again after that asynchronous wait, immediately before the caller's support query. A native Havok regression reproduces eviction during loading and checks restored support.

The shore uses the same sloping-bank geometry for visible terrain, Havok collision and immersion depth. Walking into sufficient water depth enables swimming; C dives and Space ascends. The player floats at the surface, collides with the bank/seabed, tracks breath below water and can return to land. The visual swimming overlay blends treading with a prone stroke. The physics capsule remains upright; this is an approximation, not a full articulated swimmer.

The water uses Babylon's planar WaterMaterial with bounded reflection/refraction targets, a scoped correction for underwater dielectric transmission/total internal reflection, and camera-aware fog/audio. The near water-plane edge is removed. See [rendering details and limitations](underwater-rendering.md). There are still no interactive wakes, caustics, volumetric scattering or detailed seabed ecology. Current water and character visuals do not meet GTA reference fidelity.

World bounds stop outward travel while allowing inward/tangent movement. Native Havok tests cover foot, wheeled, water and aircraft footprints; the normal map test also swims against the eastern boundary and returns. Padding within those bounds is traversable support, not finished geography.

The pause filler sentence “The world will be here when you get back.” is removed. Named destinations omit development/provenance suffixes; attribution and reconstruction uncertainty remain in project documentation.

## Verification

- Immutable source/build: `.local-builds/coastal-v15-source` / `.local-builds/coastal-v15`; entry `index-BHOH6UD5.js`, SHA-256 `6b6d210a8cdca417ac399b9ef3e87c59c02a971108774a350ffd37ab0d53e6ac`, world `authored-860409-v7-inner-city`.
- All **171 tests** and the production TypeScript/Vite build pass, including native Havok travel, swimming, boundaries and the asynchronous collision-restoration regression.
- Normal UI map audit: **32 checkpoints on each backend**, including all twenty destinations, map pins, edge swimming and a 900×700 map view. No console/runtime errors or warnings. Results: [WebGPU](evidence/map-travel-webgpu-v15/result.json), [WebGL2](evidence/map-travel-webgl-v15/result.json).
- Normal gameplay coast audit: **13 checkpoints on each backend**, covering beach entry, floating, diving, resurfacing, walking ashore, western locations and save/load. No console/runtime errors or warnings. Results: [WebGPU](evidence/coast-gameplay-webgpu-v15/result.json), [WebGL2](evidence/coast-gameplay-webgl-v15/result.json).
- Chrome 152.0.7977.83 on the documented M5 Pro host, 1600×900 unless testing the compact map. One GPU browser ran at a time. These functional captures are not the required 1080p thirty-minute performance gate.

The checkpoint also carries the initial contact-IK helpers needed by the player poses. Sparse IK checks pass, but the subsequent complete-frame vehicle-animation review found body overlap and shoe/door penetration. That animation is **not accepted as finished**; a separate choreography revision is in progress. The latest weapons, ten-car catalog, street-object damage and additional NPC variants are separate unfinished changes and are not included in this source cohort.

The earlier thirty-minute baseline still fails the 30 FPS slowest-one-percent target (19.45 FPS). Full map, art fidelity and sustained performance gates remain open.
