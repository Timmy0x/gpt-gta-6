# Scanned road and beach surfaces

Asphalt and sand now use local 1K albedo, OpenGL normal and packed AO/roughness/metalness maps from Poly Haven. The material importer preserves source-relative scale: 3 metres for Asphalt 02 by Rob Tuytel, 2 metres for Sand 03 by Charlotte Baglioni. All six publisher JPEG maps are copied unchanged, size/MD5 verified and SHA-256 recorded. Source API metadata, attribution, downloads and reproduction script are retained. In-game credits link the local attribution.

The six maps total 4,451,259 bytes. The exported world uses 50 referenced textures (44 generated plus six source maps), totaling 5,116,939 texture bytes; 84 packages retain 1,221 meshes and 57,932,888 CPU geometry bytes. Existing seeded grain generation remains in the offline authoring sequence so asset acquisition does not rearrange the world. It is no longer referenced by the road or beach materials.

Babylon interprets color in sRGB and normal/ARM in linear space, with mipmaps and anisotropic filtering. The packed map uses red AO, green roughness and blue metalness, with a dielectric metalness factor. Ground UVs repeat in metres and exported names resolve relative to the world root into `/surfaces/`. The existing wet-road roughness factor still applies. Normal maps shade existing geometry; they do not create collision displacement or physical potholes.

## Verification

The frozen `.local-builds/photo-surfaces-v6` production bundle was served locally on port 4194. Normal fresh launch and map fast travel to Ocean Beach passed on WebGPU and WebGL2, with zero console or page errors. Read-only checks of the actual loaded mesh verify 3 m asphalt / 2 m sand in both directions, six ready 1024 × 1024 maps and correct color/data interpretation. Actual street/beach screenshots were inspected. Hash/path/channel integrity also has a production-file regression test.

- Module: `/assets/index-DmvLSStP.js`
- World: `authored-860409-v5-photo-surfaces`
- Manifest SHA-256: `631b016d1ff96342d17793fb1358c06b10cab4f3b45f488488230b276e285eb3`
- [WebGPU results](evidence/material-scale-webgpu-photo-v6/result.json)
- [WebGL2 results](evidence/material-scale-webgl-photo-v6/result.json)
- [Street capture](evidence/material-scale-webgpu-photo-v6/street.png)
- [Beach capture](evidence/material-scale-webgpu-photo-v6/beach.png)

The isolated staged checkpoint passes all 116 automated tests and the production build. This isolated copy avoids testing unrelated concurrent edits as though they were part of the checkpoint. These checks do not establish performance. The broad surfaces expose repeating asphalt cracks at a distance. Sand 03 appears too dark/damp for the entire dry tropical beach; a paler source replacement is the next art correction. Buildings, foliage, aircraft and most vehicle classes still use provisional geometry. No GTA VI visual parity is claimed.
