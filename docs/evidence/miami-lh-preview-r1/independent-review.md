# Independent visual review

Accepted for this bounded synthetic LH rendering proof. I inspected all 30 retained PNGs and the 24 normal-control checks in `result.json`; no additional browser or GPU session was launched. The reviewed entry is `/assets/index-C1jNRhvG.js`, SHA-256 `2d76aaa031a6b923c7a139423028fac3a578ad180e63496e75ee99e9f793123c`, captured at 1600 × 1000 in Chrome 152.0.7977.83.

| Review | Observed result on WebGL2 and WebGPU |
| --- | --- |
| Front, FOV 18° / 65° / 85°, panels shown and hidden | The near pink panel occludes the blue fixture; the fixture occludes the farther cyan panel. Hiding the panels reveals the expected blue silhouette and orange offset geometry. |
| Rear, FOV 18° / 65° / 85°, panels shown and hidden | The cyan panel becomes nearest and occludes the blue fixture and pink panel. The orange offset geometry remains visible outside its edge. Hiding panels restores the rear silhouette. |
| Orientation and faces | The blue point reverses screen direction and the orange part changes screen side between front and rear, as expected. Visible side/bottom faces remain coherent; no apparent inverted winding or missing-face patches. |
| Backend and postprocessing appearance | Positions, silhouettes, depth ordering, colors, shading, exposure and floor grid appear consistent. No visible blank layer, mirrored geometry, black-face artifact, depth bleed or separate postprocessing layer. This is a visual comparison, not a pixel-equality assertion. |
| Overview and walking captures | Both overviews show one consistent arrangement of tiles, panels and independently authored bodies. The capsule appears adjacent to the obstacle when blocked and beyond its side after sidestepping, with no gross visible penetration. |

At 18° some geometry extends outside the viewport or behind the controls. This is consistent with the narrower field of view; the 65° and 85° views show the complete fixture. Flat colors and faceted forms belong to the explicitly synthetic fixture.

The control record contains 12 checks per backend and no errors. It records the capsule remaining at z = 4.18 m while blocked, passing to z = 6.61 m after sidestepping, and returning to its start on reset. The dropped ball returns to y = 8.58 m on both backends. These readouts supplement the still images; the still images alone do not establish continuous contact behavior. The only recorded warnings are the upstream advisory about limited support for 3D Tiles 1.1 features.

This accepts the retained views as evidence of shared depth and a consistent rendering pipeline for the original fixture, alongside the bounded independent Havok exercise. It does not accept Google/Cesium content, provider-derived collisions, the game controller, actual map integration, photorealism, arbitrary camera views, temporal stability or performance. Those require separate checks.
