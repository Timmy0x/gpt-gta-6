# Additional licensed civilians

Prepared assets plus civilian runtime selection. Normal-game integration is verified separately from the isolated asset evidence retained here.

| Variant | Distinct appearance | GLB bytes | Unique vertices | Triangles | Material draws | Bones | Source-pose height |
|---|---|---:|---:|---:|---:|---:|---:|
| Male Adult 03 | Older man, checked jacket and dark trousers | 396,196 | 4,427 | 7,200 | 3 | 80 | 1.807 m |
| Female Adult 06 | Long olive outfit and white headscarf | 445,360 | 4,372 | 6,992 | 3 | 80 | 1.736 m |

Both are distinct from the current Male Adult 01 and Female Adult 01 player assets. The complete two-model runtime package, including ten local textures, is approximately 9.31 MB. Male textures total 5,202,140 bytes; female textures total 3,268,654 bytes. Only Three 0.180.0 is used offline for FBX conversion; runtime loading and rendering remain Babylon.

## Retargeting compatibility

Both GLBs were loaded with Babylon 9.25.0 and passed through the actual existing `Character` and `RocketboxSkin` implementation. All 80 source bones retain linked transform nodes, and all 17 anatomical anchors required by the adapter are present. The joint mapping does not need variant-specific corrections. `prepareCivilianAssets(scene)` independently loads and caches these two templates; a failure releases partial civilian assets while retaining any loaded player templates. `CharacterOptions.licensedCivilianSkin` selects the explicit variant. Population chooses the female variant when its existing stable appearance index is divisible by three and the male variant otherwise, matching its existing driver-rig proportions. Existing player asset selection remains unchanged.

The two civilian templates share geometry, materials and textures across private actor rigs. Within the existing population of 30 ambient civilians and a creative limit of 60 total, at most 12 civilians use the detailed three-draw skin at once. Detail enters within 70 m of the camera and leaves beyond 80 m; an 8 m preference for an already detailed actor reduces competition at the pool boundary. Nearby ragdolls and settled casualties receive priority over living pedestrians, still respecting the twelve-skin cap. Other actors use the existing single-draw procedural distant skin; that proxy changes visible clothing and remains a fidelity limitation. The actor, ID, health, gameplay skeleton, detailed source skeleton and source material references survive these visibility changes. No actor or corpse is rebuilt or reposed when switching distance representation. The same scene observer updates visible imported skins after Havok synchronization; hidden source skins skip retarget work.

Female Adult 06's original FBX joint array starts with Spine2. Three's exporter initially wrote this first joint as `skin.skeleton`, which is not a common ancestor of the leg/pelvis joints. The civilian converter now finds the actual lowest common ancestor and writes that node as the skin root. Joint indexing, inverse-bind matrices, bone names and skin weights retain their original order. Babylon then imports without the invalid-root warning.

## Verification

- `verification.json`: actual GLB import, hashes, three material draws, expected triangle counts, 80 linked bones, finite meter-scale skinned vertices in idle/walk/run/crouch/aim/seated poses, direct pelvis translation without `animate`, and eight create/dispose cycles with stable scene resource counts. Walking moved visible vertices by 0.561 m and 0.558 m over the sampled stride. CPU loading skips materials.
- `evidence/visual-verification.json`: actual WebGL2 studio, all ten material texture slots loaded, six pose screenshots, zero browser errors or warnings, and eight repeated pair replacements without a change in mesh/geometry/skeleton/transform/material/texture/shadow counts. Screenshots were inspected after capture. This is isolated asset evidence, not gameplay or performance evidence.
- `tests/civilian-assets.test.ts`: concurrent independent player/civilian loading, partial failure cleanup/retry, unchanged player appearance, stable population variant IDs, private rigs with shared geometry, repeated cleanup, a sixty-civilian/twelve-detail budget, hysteresis, casualty priority, and real Havok same-frame synchronization through settling and distance visibility changes. The existing player/character/casualty tests are run alongside it; `evidence/runtime-tests.log` records the focused combined run. GPU texture residency and full-game performance are not established by these NullEngine tests.
- Idle and walking retain recognizable clothing and body proportions. The long garment is skinned to the source bones; it has no cloth simulation. The seated pose bunches the hem into angular folds, and raised arms can stretch the scarf near the shoulders. Material/texture LODs, cloth behavior, exact vehicle seating and full crowd performance remain integration work. Neither asset supplies authored locomotion clips, facial expressions, or GTA VI identity fidelity.

## Reproduce

From the repository root:

```sh
npm install --prefix /tmp/leonida-character-tools --no-audit --no-fund three@0.180.0
node scripts/characters/civilians/acquire.mjs
python3 scripts/characters/civilians/convert-textures.py
node scripts/characters/civilians/convert.mjs
node --import tsx scripts/characters/civilians/verify.mjs
node scripts/characters/civilians/verify-visual.mjs
```

Python requires Pillow. Set `CHARACTER_TOOL_ROOT` to another installation's `three` package directory if necessary. The visual fixture uses local port 4189 and Chrome; coordinate with other GPU audits. Raw FBX/TGA files live in ignored `source/` and can be reacquired from pinned URLs. Source previews, source manifest, license, converted assets and verification records are retained.

Upstream source: [Microsoft Rocketbox at the pinned commit](https://github.com/microsoft/Microsoft-Rocketbox/tree/0943055db6ec570bcef9f2c8b41c9e5467c808f9). [Pinned MIT license](https://github.com/microsoft/Microsoft-Rocketbox/blob/0943055db6ec570bcef9f2c8b41c9e5467c808f9/LICENSE.md). Exact hashes are recorded in `source-manifest.json`, `verification.json`, and `public/characters/civilians/manifest.json`.
