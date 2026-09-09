# Safe creative vehicle placement

Ground vehicles previously spawned six metres in front of the player without checking occupancy. At the initial player position this places a detailed concept car onto the starter coupe.

`findGroundVehicleSpawn` now searches nearby forward/side/rear candidates within 22 m. Each candidate must pass an oriented footprint check against the world obstacle index and existing vehicles, nine static-support raycasts spanning the vehicle's complete footprint, and a Havok `shapeProximity` box query for other collidable props and bodies. Width and length come from the requested vehicle's dimensions. Ground height is sampled, so creation no longer drops every car from the player's height plus one metre. A failed search returns null, reports that no clear space exists, and does not spawn a test vehicle or reposition existing entities. The temporary query shape is disposed in all paths. Aircraft and boat launch placement remains separate.

Babylon's public [Havok shape-proximity implementation](https://github.com/BabylonJS/Babylon.js/blob/master/packages/dev/core/src/Physics/v2/Plugins/havokPlugin.ts) supports overlap checks with `maxDistance: 0`; the installed 9.25.0 declarations and actual Havok 1.3.14 behavior were checked.

Verification:

- `tests/spawn-placement.test.ts`: three passing tests cover rotated vehicle footprints, a starter car and diagonal truck, an unlisted dynamic collidable prop, unsupported edges, a fully obstructed search and unchanged body/entity counts and positions after failed placement.
- `tests/spawn-placement-audit.mjs`: normal fresh launch → F2 → select ConceptCar → Spawn twice. The two detailed cars appeared separately at approximately `(7.29, 0.73, -22.00)` and `(-0.70, 0.61, -22.00)`, each at 100 health, with no overlapping startup vehicle footprint and no browser errors.
- [WebGPU evidence and screenshot](evidence/safe-spawn-webgpu/result.json).
- Typecheck and aircraft control tests also pass.

The footprint search deliberately rejects steep, uneven or unsupported ground and low obstructions. It is conservative: a tight area may have a physically possible parking position outside the sampled candidates, in which case the UI asks the player to move to a wider area.
