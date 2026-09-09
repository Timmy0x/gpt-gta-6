# Licensed human assets

The player can use two Microsoft Rocketbox avatars, `Male_Adult_01` and `Female_Adult_01`. These replace the original procedural player skins with modeled anatomy, fingers, face detail, hair alpha geometry, garment folds and diffuse/normal textures. They are generic licensed human substitutes, not depictions of Rockstar's Jason or Lucia and not a claim of GTA VI visual parity. Civilian and police skins remain the original procedural assets until distinct licensed variants are integrated.

## Source and permission

- Upstream: [Microsoft Rocketbox](https://github.com/microsoft/Microsoft-Rocketbox), commit `0943055db6ec570bcef9f2c8b41c9e5467c808f9`.
- [Pinned MIT license](https://github.com/microsoft/Microsoft-Rocketbox/blob/0943055db6ec570bcef9f2c8b41c9e5467c808f9/LICENSE.md): Copyright (c) 2020 Microsoft. The upstream README records its MIT relicensing in 2020; older research-only descriptions should not be substituted for the current repository license.
- Original avatar creation: Rocketbox Studios; Microsoft release. The license is retained in `data/characters/rocketbox/LICENSE.md` and the distributable `public/characters/rocketbox/LICENSE.txt`.
- Every acquired FBX and TGA path, pinned URL, byte size and SHA-256 is recorded in `data/characters/rocketbox/source-manifest.json`. Raw source files are excluded from Git because the uncompressed TGA files are large and can be reproduced by the acquisition script.

## Reproduction

Run:

```sh
node scripts/characters/acquire.mjs
npm install --prefix /tmp/leonida-character-tools three@0.180.0
python3 scripts/characters/convert-textures.py
node scripts/characters/convert.mjs
```

Python needs Pillow. `CHARACTER_TOOL_ROOT` can point to another Three 0.180.0 installation. Three is an offline FBX parsing/export tool only; Babylon remains the game renderer and asset loader. No additional renderer is downloaded by the game.

The converter preserves the 80-bone source rigs, welds duplicate FBX vertices, groups triangles into three contiguous material draws, flips texture V coordinates for glTF, scales centimeters to meters, and emits GLB files with external local textures. Body and head diffuse maps become 2048-pixel JPEGs; normal maps and alpha hair maps use 1024-pixel PNGs. Diffuse material factors are reset to white as required by the source's Max material convention. Metalness is zero and roughness/normal strength are authored PBR approximations. No facial scan or texture is generated from a Rockstar image.

| Asset | GLB size | Vertices | Triangles | Material draws | Skin bones |
|---|---:|---:|---:|---:|---:|
| Male Adult 01 | 413,068 bytes | 4,688 | 7,440 | 3 | 80 |
| Female Adult 01 | 528,260 bytes | 5,436 | 8,732 | 3 | 80 |

Both texture sets together occupy about 8.8 MB. `public/characters/rocketbox/manifest.json` contains exact GLB hashes. The game loads two shared asset templates once per scene and clones rigs/meshes while sharing geometry and materials during character switching.

## Runtime contract

Call `prepareCharacterAssets(scene)` before creating `Player` or `Population`. A rejected load can be caught by the boot code; Character retains its original procedural skin when the templates are unavailable. Failed preparation can be retried. Only callers explicitly passing `{ licensedPlayerSkin: true }` as the seventh constructor argument select these skins. Player enables the option for Jason/Lucia; NPC constructors retain their existing appearances.

`RocketboxSkin` adapts the existing 17-joint gameplay skeleton to 17 anatomical anchors in the imported 80-bone rig. The adapter aligns arm/leg source directions and preserves the source's face/finger child bones. The existing gameplay skeleton, `.torso`, weapon attachment points, collision, seating overlays and ragdoll constraints retain their existing APIs. The procedural torso uses `isVisible=false`, so weapon children attached to it remain enabled. Visible imported parts are included in `Character.parts` before callers attach hit metadata.

A single scene `onBeforeActiveMeshesEvaluation` observer (after Havok Ragdoll’s `onBeforeRender` synchronization) updates live visual rigs, including direct Havok ragdoll changes and frozen corpse poses that do not call `animate`. Each disposed skin unregisters from the live set and removes its shadow casters. Scene disposal releases cached templates and shared assets. Conservative pose bounds support seated and ragdoll limbs without forcing every mesh active.

## Verification and remaining work

- `tests/character-assets.test.ts` loads the actual GLBs with Babylon's native loader in NullEngine. It verifies the 80-bone rigs, 3 draws, pinned hashes, direct driver translation without animate, all-vertex seated cabin bounds, six repeated male/female replacements with stable mesh/geometry/skeleton/transform/shadow counts, fallback/retry and preserved NPC uniform selection. NullEngine skips material loading, so its material/texture counts do not prove GPU texture residency or texture disposal.
- A real Havok check compares the imported pelvis directly with the physical pelvis after each physics step and the normal render-observer ordering. It verifies 35 moving frames, then continues past the fatal ragdoll's eight-second physical lifetime and verifies the retained visible corpse stays settled for another second. The comparison uses the physical aggregate and `Character.root`; the invisible procedural torso can legitimately still have its previous world matrix before active-mesh evaluation.
- The focused `character-assets` and existing `characters` suites passed 11 tests on 2026-09-09; see `docs/evidence/character-assets-checkpoint.log`. For the licensed male/female assets, the low seat's measured body bounds in cabin coordinates are respectively −0.1528/+0.9126 m and −0.1545/+0.8929 m. The concept seat's bounds are −0.4322/+0.5010 m and −0.4307/+0.4790 m. These checks cover floor, roof and forward foot space; they do not prove exact steering-wheel grip or seat-surface contact.
- `scripts/characters/verify-visual.mjs` runs the local Babylon studio on port 4184 through actual WebGL. Screenshots `docs/evidence/rocketbox-{idle,walk,aim,seated}.png` show the integrated skins, not upstream previews. `rocketbox-review.json` retains runtime counts and browser errors. This studio is functional/visual evidence, not a performance benchmark or an in-game gameplay pass.
- Facial expressions, finger grip animation, broader skin/clothing diversity, authored locomotion clips, material/texture LODs and exact vehicle fit still need deeper work. Existing procedural poses are retargeted approximations; the licensed models do not supply Rockstar identity or reference-game animation fidelity.


## Camera-aligned aiming correction

The ordinary pointer-lock review found that changing camera pitch left the visible weapon aimed elsewhere: baseline default/up/down gaps were 30.13°, 17.23° and 53.42°. `Character.aimToward` now adjusts both posed upper-arm orientations to align the wrist-attached barrel with the current camera firing direction. Shoulder attachment points are retained. Player simulation and interpolated camera rendering apply the correction; swimming, climbing, seating and ragdolls keep their existing poses.

The combat regression checks 18 yaw/pitch/crouch combinations, barrel direction dot product above 0.9999, hand attachment within 10 cm, repeat-call stability and retained recoil. All 114 tests and a production build pass. Ordinary WebGPU and WebGL2 gameplay reviews each pass 10 stages, including actual pointer-locked up/down look, Jason/Lucia switching and held-C crouched aim; aimed barrel error stays below 0.001° in those samples. Earlier baseline screenshots are preserved. Full finger contact, left-hand support grip and animation fidelity remain unfinished.

A fresh WebGPU normal-control combat audit with this correction passes 16 stages: seven actual shots kill the spawned civilian, the corpse stays dead after ten seconds, police arrest/recovery preserves it, and normal save/load/fresh Continue preserve it. Zero errors/warnings were recorded. This complements the earlier casualty tests; it does not establish a separate WASTED browser test or the performance target. Evidence uses `character-gameplay-*-aligned` and `casualty-controls-aiming`.
