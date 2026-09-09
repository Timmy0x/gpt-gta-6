# Vehicle exterior collision

Status: implemented and verified with real Havok CPU simulation and normal controls on both rendering backends in the immutable coastal-v12 build. Earlier v10 carjacking captures exclude these colliders.

## Representation

Road vehicles now keep their wheels, enabled door assemblies, door glazing/handles/mirrors, independent mirrors, and bumpers in the existing chassis `PhysicsShapeContainer`. The detailed imported concept car and procedural road vehicles use the same implementation. It does not create kinematic bodies that collide with their own car. Entry queries that ignore the source chassis consequently ignore all its attached components together.

The narrow box instances follow each component's actual local mesh bounds. Wheel cylinders follow the steering/suspension pivot and measured tire/rim width; the rolling axis is symmetric. Their radius is 25 mm inside the visible tire to preserve the established ray-supported suspension. Punctured tire radius follows the damaged visual. Disabling a whole wheel assembly removes it; disabling only rubber does not make the remaining wheel disappear physically.

Babylon 9.25 provides compound `addChild`/`removeChild`, without a public child-transform setter. The update reuses two primitive shapes and replaces compound child instances only when component pose, bounds or enabled state changes. Established mass, center of mass and inertia are explicitly retained. Broken or detached glazing/doors cease blocking their old space immediately. Detached assemblies receive their own dynamic compound containing the enabled panel, glazing and mirror geometry, and inherit vehicle velocity. Debris remains bounded by the existing 32-fragment pool and lifetime policy.

## Doors and other bodies

Door animation now asks Havok for clearance before changing angle. One reused query compound per door contains its current enabled geometry, expanded by 10 mm. Rotation is sampled at at most 0.004 radians, keeping the movement between samples inside that clearance for the supported road door dimensions. A motor stops before worsening contact with another body and can move away from an existing overlap. Its own chassis is the only excluded body. Opening cannot push the chassis sideways by inserting a new overlapping child through a wall; the door can resume when the obstruction is removed. Both opening and closing use the same limiter.

This is a bounded motor animation with physical contact, not a fully simulated hinge/soft-body door. A severe local impact still uses the existing damage system to detach it. Individual rotor/propeller blades, boat details and aircraft landing gear are outside this road-vehicle pass; their existing broad fuselage/wing/skid proxies remain. Fine chassis surfaces are still represented by the established collision hulls rather than a per-triangle dynamic car shell.

## Police integration

Adding real exterior contacts exposed an existing omission: dismounted officers planned only against static world obstacles. A cruiser could recover from a blockage, arrive, release its officer, and then keep the officer walking into the side of its own vehicle. `vehicleFootRoute` now adds local visibility corners around nearby enabled vehicle bounds while preserving the authored street graph and static obstacles. Waypoints use 0.45 m arrival clearance to avoid cutting the corner of a physical vehicle. The original urban garage-blockage test passes without changing its success criterion or collision geometry.

## Evidence

Run:

```sh
node --import tsx --test tests/vehicle-exterior.test.ts tests/vehicle-equipment.test.ts tests/vehicles.test.ts tests/aircraft-controls.test.ts tests/aircraft-seating.test.ts tests/concept-car.test.ts tests/vehicle-occupancy.test.ts tests/police-urban.test.ts tests/police-lifecycle.test.ts tests/police.test.ts
```

The [focused Havok log](evidence/vehicle-exterior/focused-tests.log) records 54 passing tests, including:

- Procedural sedan and imported concept wheel/mirror/open-door queries and invariant chassis mass properties.
- A real 1.8 m, 0.32 m-radius character controller stops at an open door: 0.700 m travel versus 1.722 m after the door is removed.
- A dynamic prop contacts the outboard door; a second moving car produces native contacts outside the main chassis width.
- A nearby wall stops opening at 37.0 degrees on the sedan and 9.1 degrees on the imported concept car, with less than 0.0001 m measured chassis displacement; removing the wall permits full opening.
- Actual local glass damage removes the attached glazing collider. Twelve save replacements preserve the Havok shape registry count; vehicle removal leaves only the fixture ground shape.
- Existing driving, high-speed thin-wall impact, rollover recovery, aircraft flight/seat, concept asset, traffic/carjacking, police response and casualty tests.

[Type checking](evidence/vehicle-exterior/typecheck.log) passes. These checks establish contact and lifecycle behavior, not visual parity with GTA VI or a performance pass. The full goal's 30-minute frame-time/memory acceptance remains separate.

## Normal integrated browser verification

The immutable coastal-v12 entry `/assets/index-YQcdl3e9.js` has SHA-256 `8b2d91ad56e81532aae1b922e3ae19fe4ba5397735dd4ba34b669290848f9f9f`, with world `authored-860409-v7-inner-city`.

[WebGPU](evidence/vehicle-exterior/occupancy-coastal-v12-webgpu/result.json) and [WebGL2](evidence/vehicle-exterior/occupancy-coastal-v12-webgl/result.json) each passed 16 checks with no runtime errors or console warnings. Tests used fresh play, normal keyboard walking, the Sandbox traffic slider, E carjacking, held W through entry/exit, Tab switching, driving and Space braking. The same visible driver survived extraction and fled. Each renderer recorded 148 transition physics samples: 36 attached SUV compound children remained present, vehicle mass remained 2260 kg, and the physical door reached 1.12 radians during extraction and exit. Screenshots show the extraction and clear on-foot exit beside the door.

The first two WebGPU attempts are retained as `occupancy-coastal-v12-webgpu-approach-repro` and `occupancy-coastal-v12-webgpu-approach-clearance-repro`. Their walking harness aimed through the SUV, then used a goal inside the navigation clearance around its mirror. Actual vehicle collision correctly blocked that approach. The audit now plans ordinary keyboard movement around observed vehicle bounds and aims 0.45 m farther outside the driver's side. No game transform, collision, pose or spawn hooks were used to bypass the obstruction. The wall-limited door swing is covered by the explicit native Havok tests above, not claimed as a separate normal-UI wall scenario.
