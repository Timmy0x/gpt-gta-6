# Asset catalog and fidelity gaps

Initial catalog: **2026-09-09**. This file separates reference media from assets shipped in the game. An official download link is not evidence of permission to republish that content as a game asset. No Rockstar model, texture, audio track, screenshot or trailer has been imported by this research task.

## Provenance policy

For every shipped file record: stable asset ID, local path, creator, source URL, exact license/permission, retrieval date, modifications, dimensions and units, LODs, compression, byte size, attribution, intended use, and replacement status. Maintain the record when an asset changes. Original procedural geometry and synthesized audio must be identified as such; visual placeholders are not finished realistic art.

## Prepared licensed vehicle — runtime integration pending

`VEH-ASTER-CONCEPT` is retained at `public/vehicles/concept/car.glb`: the Car Concept model credited upstream to Eric Chadwick / © 2024 Darmstadt Graphics Group GmbH, under CC BY 4.0 with separately excluded logos. The 11,271,376-byte prepared asset is debranded: the plate/logo atlas and both branded tire-sidewall color/normal images, all references to them and their embedded PNG bytes are removed. Generic plate/rubber factors replace those slots; cabin, geometry and hinges remain intact. Attribution, source license, exact immutable download URLs and original/prepared SHA-256 values are stored beside it.

`scripts/assets/prepare-car-concept.mjs` reproduces the rewrite and verifies no removed-image payload survives. `scripts/assets/verify-car-concept.mjs` imports the resulting GLB through Babylon in a CPU-only loader check. It contains 101 glTF nodes, 109 primitives and 213,347 triangles; exact posed geometry bounds are about 2.542 × 1.149 × 4.357 metres. There are no animation clips, skins or LODs. The asset is now the drivable Aster Concept option, loaded on explicit spawn or save continuation. Its runtime adapter integrates wheel frames, Havok suspension, reclined seats, doors, panel damage, compact saved deformation and shared texture ownership. Both renderer audits pass 13 normal-control stages. It remains a generic licensed concept car, not a GTA VI replica; no LOD or full performance acceptance is claimed. The [source brief](car-concept-adapter.md) records pivots and provenance, and [runtime design](concept-vehicle-design.md) records implementation and verification.

## Initial asset families

Implementation status here is **planned / awaiting code inventory** unless a concrete path and evidence are supplied. The developer creating each family must update its source and gap record. Do not infer a completed asset from this list.

| Asset ID | Required family | Provenance / proposed representation | Fidelity and completion requirements |
|---|---|---|---|
| CHAR-JASON | Jason player representation | Implemented original skinned substitute in `src/gameplay/Character.ts`; 17-bone Babylon rig, 4,692 vertices | Contoured geometry, face/hair and procedural locomotion/aim/crouch; exact likeness, detailed textures, entry clips and final realistic fidelity remain missing |
| CHAR-LUCIA | Lucia player representation | Implemented original skinned substitute in `src/gameplay/Character.ts`; 17-bone rig, 4,662 vertices | Different torso/hip/sleeve silhouette and tied hairstyle; exact likeness, wardrobe, full interaction clips and final realistic fidelity remain missing |
| CHAR-CIV-* | Civilian variation | Reuses the two original rigged body variants with clothing colors | Limited adult body/outfit variation; sit/phone/cower/hit clips and crowd geometry LOD remain missing |
| CHAR-RESP-* | Police, tactical, military, medical/fire | Separate authored uniforms and equipment | Readable role silhouettes, rigs, radio/aim/arrest/carry animations; face/skin variation |
| VEH-SEDAN | Four-door passenger sedan | Authored model candidate | Correct cabin/wheel proportions, driver/passenger seats, opening doors, glass/lights/tire parts, dents and underside |
| VEH-SPORT | Two-door sports vehicle | Authored model candidate | Distinct low silhouette, suspension/handling data, different cabin and damage layout |
| VEH-SUV / PICKUP / VAN | Utility road vehicles | Separate meshes and dimensional profiles | No renamed/recolored sedan stand-ins; cargo/body variation and distinct masses, centers of mass |
| VEH-TRUCK / BUS | Heavy transport | Separate long-wheelbase meshes | Turning clearance, multiple axles where applicable, suspension, cabin/seats and mass tuning |
| VEH-MOTO / ATV | Two-/four-wheel small transport | Separate frame/rider poses | Wheel articulation, rider lean, balance/recovery and off-road tires |
| VEH-POLICE / SWAT / MIL | Response vehicles | Separate authored equipment/geometry | Lightbars, sirens, equipment, occupant seats; dispatch-compatible handling |
| VEH-EMS / FIRE | Emergency transport | Separate authored van/truck | Role-specific access, lighting, interior/cargo silhouette and responders |
| VEH-BOAT / PWC / AIRBOAT | Powered watercraft | Authored hull models | Float sampling positions, propulsor/rudder animation, passengers, collision hull and wake |
| VEH-KAYAK | Paddle watercraft | Separate light hull | Seated paddling, oar/water interactions and low inertia |
| VEH-HELI | Helicopter | Authored airframe | Rotor/hub parts, cabin, landing skids, rotor animation and damage limits |
| VEH-PLANE | Fixed-wing aircraft | Authored airframe | Control surfaces, landing gear, cockpit, wing geometry, lift reference dimensions |
| WEAP-PISTOL / RIFLE / SHOTGUN | Handheld weapons | Authored fictional representations | Hand placement, muzzle origin, magazine and recoil/reload clips; no real-world operating instruction required |
| WEAP-MELEE / EXPLOSIVE | Melee / throwable game props | Authored representations | Held/thrown states, game-only effect parameters and pickup icons |
| ARCH-DECO | Hotel facade kit | Original geometry; VI/real-world visual reference | Separate parapet/cornice/awning/window/door/balcony/roof details; meter-consistent texture scale |
| ARCH-URBAN | Shops/apartments/office towers | Original authored modules | Ground-floor variation, roofscape, signs, entrances, LOD and interior portals |
| ARCH-REGIONAL | Motel, refinery, stilt house, dock, farm, ranger structures | Original authored modules | Each region has coherent shape/material/weathering, not urban blocks recolored |
| INT-SHOP / GARAGE | Accessible interior kit | Original geometry | Complete floor/walls/ceiling/doorway/collision; merchandise/workshop detail and distinct lighting |
| PROP-STREET | Street and beach furnishing | Original geometry | Benches, bins, signs, fences, hydrants, lamps, parasols; each assigned response class |
| VEG-COAST / WET / FOREST | Vegetation and ground cover | Authored or licensed modular foliage | Species/silhouette variation, alpha/cutout LOD, wind and bounded instance counts |
| FAUNA-* | Regional animal families | Missing rigs/meshes | Birds, wetland reptiles and forest fauna need movement/behavior; static silhouettes are placeholders |
| MAT-* | Asphalt, stucco, concrete, sand, water, glass, metal, rubber, wood | Authored material configuration and future licensed texture sets | Surface scale, roughness/normal variation, wet variants; PBR alone is not fidelity |
| FX-* | Debris, sparks, smoke, fire, wake, rain | Authored particles and physical fragments | Obstruction-aware effects, collision budget, bounded lifetime; do not replace functional destruction |
| AUDIO-* | Engines, tires, steps, impacts, weapons, sirens, weather, ambience | Procedural Web Audio candidate / future licensed samples | Spatial attenuation and mixing; synthetic tones recorded as fidelity gaps |
| UI-* | Map icons, HUD, controls, creative interface | Original vector/text UI | Readable at target resolutions and keyboard/gamepad accessible; no Rockstar UI textures imported |

## Integrated character asset record — 2026-09-09

- **Asset IDs / file:** CHAR-JASON, CHAR-LUCIA and current CHAR-CIV variants; `src/gameplay/Character.ts` (23,765 source bytes at this checkpoint). Geometry is generated locally at runtime; there is no downloaded model, texture or animation payload.
- **Creator / provenance:** Original procedural geometry and animation authored by Codex for this repository. No Rockstar asset, scanned likeness, third-party mesh, motion-capture clip or reference image is embedded. No external asset license or attribution is involved; the repository has not declared a distribution license. Visual references remain separately recorded in the research register.
- **Representation:** One indexed mesh, one submesh and vertex colors for skin, garments, hair and shoes. All character instances in a scene share one PBR material with reference-counted disposal. This is **one main-pass mesh submission per visible character**, plus applicable shadow/additional render passes; it is not a measurement of total frame draw calls or an FPS claim.
- **Rig / deformation:** Actual Babylon `Skeleton` with 17 hierarchical `Bone` objects, normalized skin weights in four influence slots per vertex, and GPU skinning. Root/pelvis/spine/chest/neck/head, upper arms/forearms/hands, and thighs/calves/feet provide the articulation. Procedural idle breathing, walking, running, aiming and crouching blend through bone transforms. There are no imported authored animation clips.
- **Geometry / scale:** Jason: 4,692 vertices, 9,160 triangles. Lucia: 4,662 vertices, 9,100 triangles. Both rest meshes span 1.845 m vertically. Rest bounds are Jason `[-0.318, 0.009, -0.136]` to `[0.318, 1.854, 0.202]`, and Lucia `[-0.302, 0.009, -0.176]` to `[0.302, 1.854, 0.202]`, in metres. These are explicit project dimensions, not Rockstar measurements. Conservative animation bounds are larger. No character geometry LOD or mesh compression is implemented yet.
- **Reproducible checks:** `tests/characters.test.ts`, included by `npm test`, checks both variants' indices/finite vertex data, normalized bone weights, single-submesh representation, outward torso winding, bind-pose preservation, actual skinned foot movement, aiming hand reach, crouch recovery, deterministic fixed-step poses, shared material lifetime, and 30 repeated character creation/disposal cycles. These run with Babylon NullEngine without compiling shaders; they do **not** certify WebGPU/WebGL rendering or visual parity.
- **Visual evidence / remaining gap:** An integrated development-browser review rendered Jason without inverted or missing geometry and reported no console warnings/errors. These remain visibly simplified original substitutes. Exact likeness and clothing, realistic skin/hair textures, full hands/fingers, facial expression, entry/exit and combat/interaction clips, ragdoll transitions, motion quality, bone-accurate hit volumes and crowd LOD require further work. Browser and sustained performance evidence belongs in the verification record.

## Identifiable official inventory leads

VI-GALLERY explicitly labels **Dinka Enduro Motorcycle**, **Crest Kayak**, **Shitzu Squalo**, **’67 Vapid Dominator Buggy**, and **Ganado Retro Build**. VI-MEDIA names additional vehicles and the revolvers in the reference register. Each is **confirmed as an official catalog title**, with mesh details, availability, physics and measurements still to verify. Do not attach these names to unrelated generic meshes and claim reference fidelity.

The current gallery also titles mod shops, clothing/salon/tattoo locations and edition benefits. Their appearance does not demonstrate every interaction. A future model-by-model sheet must include several inspected views, estimated wheelbase/width, class, seating, exact source title/date, and confidence. Until then use honest class labels such as “authored sedan.”

## Response-class contract

| Material / object | Default response class | Required visible or functional outcome |
|---|---|---|
| Concrete building shell | Structural/static | Blocks bodies/projectiles; impact marks/effects; no unsupported collapse claim |
| Movable bin / crate / cone | Movable | Mass, friction and impulses; independently colliding body |
| Window | Breakable glass | Intact collision replaced by open portal plus bounded fragments; persistence |
| Fence / sign | Breakable wood/metal | Detachment or segment break, updated navigation, independently colliding parts |
| Vehicle shell | Deformable authored metal | Local mesh deformation and severity-dependent mechanical response |
| Vehicle door / bumper | Detachable metal | Independent body when released; attachment state saved |
| Vehicle tire | Damageable rubber | Grip/rolling behavior changes and visibly deflated/damaged geometry |
| Fuel/fire-sensitive object | Ignitable response layered on material | Fire exposure, spread limits, extinguishing; correct save state |

Numerical mass/friction/impact thresholds belong in data, with values identified as project decisions. Full soft-body physics and whole-building collapse are separate missing capabilities, not implied by authored dents and fragments.

## Import queue and explicit gaps

1. Inventory actual generated geometry/audio paths after integration; record originals, dimensions, counts and size.
2. Improve the original skinned player/civilian substitutes toward believable human detail and complete interaction animation; any replacement assets require verified permission and provenance before shipping.
3. Build distinct road, water and air vehicle meshes with component damage/animation nodes, instead of scaling a common primitive.
4. Add tileable PBR textures and believable vegetation with saved attribution and LOD plans.
5. Establish an audio sample library or document why procedural audio is retained; no copyrighted trailer soundtrack is included.
6. Import OSM/USGS only with the metadata and attribution process in the atlas; no GIS source has yet been incorporated.
7. Review source references at street, coast, interior and aerial viewpoints. Do not close visual defects solely because assets use a PBR shader.

## Second checkpoint original assets

New source-authored families include skinned-hand pistol/SMG/grenade geometry; patrol/SWAT labels, helmets, vest/radio/weapon overlays; fence/gate assemblies and separate colliding fragments; fire meshes and a local rain streak texture; bungalow side elevations/gables/meters, market frontage and a creative training annex. All are original procedural meshes/textures produced in this repository, with no imported Rockstar model or Google imagery. They retain the existing procedural art license/provenance category. Their stylized construction and approximate human/vehicle details do not meet final requested realistic art fidelity.

Audio is newly authored procedural Web Audio synthesis: noise buffers, oscillators, filters and HRTF spatialization. No external samples, music or performer likeness recording is embedded. The initial CSS still requests Google Fonts at runtime; offline typography falls back to system faces. Modular licensed high-detail art, compressed textures, verified animation clips and recorded vehicle/ambient audio remain acquisition work.
