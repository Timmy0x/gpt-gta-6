# Microsoft Rocketbox civilian variants

These two generic human assets are from [Microsoft Rocketbox](https://github.com/microsoft/Microsoft-Rocketbox), pinned at commit `0943055db6ec570bcef9f2c8b41c9e5467c808f9`:

- `male-adult-03.glb`: `Male_Adult_03`, with a checked jacket and dark trousers.
- `female-adult-06.glb`: `Female_Adult_06`, with a long olive outfit and white headscarf.

Copyright (c) 2020 Microsoft. Original avatar creation: Rocketbox Studios. Distributed under the [MIT license](./LICENSE.txt); the copyright and permission notice must accompany redistribution. These are licensed civilian substitutes, not Rockstar characters or depictions of GTA VI cast members.

Modifications: offline FBX-to-glTF conversion; centimeters converted to meters; duplicated vertices welded and material groups repacked; common skin root corrected while preserving all 80 joints and inverse-bind order; diffuse/normal/opacity textures converted to browser formats; roughness, normal strength and alpha cutoff authored for PBR. No facial textures were generated from Rockstar imagery.

The repository's `data/characters/civilians/source-manifest.json` records every source URL and SHA-256 plus verification against the pinned Git blob hash. `manifest.json` records distributable GLB hashes, geometry counts and original converted bounds. `data/characters/civilians/verification.json` includes texture hashes and CPU rig checks. The separate compatibility report records known limitations and verification scope.
