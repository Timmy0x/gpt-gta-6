# Car Concept — modified local asset

Model and textures by **Eric Chadwick**, © 2024 **Darmstadt Graphics Group GmbH**, licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). [Original asset](https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/44b6f9bdb08a5b16e92b91857ec3c87de9401dfa/Models/CarConcept/glTF-Binary/CarConcept.glb).

Modified for Leonida: Khronos and 3DCommerce logo texture references and image payloads removed; generic tire sidewalls and blank license plate; logo emissive contributions removed. Door, wheel, cabin and body geometry/hierarchy retained. No endorsement by the original creators or Khronos is implied. Original licensing notices and exact source/output hashes are retained beside this file.

Runtime adapter modifications: transforms rebased to the physics chassis; front wheel steering neutralized; movable component groups rebuilt; lamp/glazing slots separated; PBR textures shared with per-vehicle paint and lamp materials; bounded body deformation and mechanical controls added. The prepared GLB bytes remain unchanged by this runtime adaptation.

Reproduce: `node scripts/assets/prepare-car-concept.mjs`. Optionally pass `--source /path/to/original.glb`; the source SHA-256 is always checked.


The runtime uses `car-lod1-batched.glb`, a derivative simplified with meshoptimizer 0.25 (MIT) and batched by material within compatible interactive groups. Geometry was reduced from 213,347 to 61,879 triangles while retaining original embedded textures, body/cabin proportions, named component anchors and material definitions. Source and derivative hashes and component mapping are in `lod-provenance.json` and `lod-batching.json`. The original CC BY 4.0 author, copyright and excluded-logo terms continue to apply.
