# Aircraft takeoff usability fix

The reported grounded aircraft behavior was reproduced through the normal creative menu on frozen production port 4177, without changing aircraft transforms, velocity, occupancy, health or controls through test hooks.

The helicopter entry toast showed car controls and omitted its required lift control. W tilted the rotor and produced ground-level movement; holding Shift then reached 27.68 m in eight seconds. Its old 2 m spawn also dropped onto the road, costing 5.28 health before entry.

The plane spawned at `(0, 1, -190)` pointing toward the starter coupe near `(3, 0.9, -20)`. W accelerated to 31.28 m/s, but the takeoff roll then hit the starter vehicle. Health fell from 100 to 45.93, heading spun away from the runway, and continued throttle/lift left it grounded at 17 health. The earlier prepared-runway flight test did not cover this normal spawn path.

## Changes

- Plane creative spawning uses the unobstructed southern beach at `(182.5, 0.95, -565)`, heading north. This is explicitly a project beach launch point, not an authored airport or claimed reference runway.
- Helicopter spawning starts at 0.95 m instead of dropping from 2 m.
- An occupied aircraft launch area rejects overlapping spawns with a clear message.
- Space / gamepad A now commands aircraft lift or elevator; Shift / L3 remains an alternative. Space retains its handbrake function in ground vehicles. C / gamepad B lowers collective or the plane's nose.
- Persistent aircraft prompts replace the car/race hint. The plane first shows W acceleration to 90 km/h, then Space/Shift to rotate. Airborne prompts show pitch/throttle/landing brake controls. Prompts respect rebound keys and connected gamepad controls.
- Actual aerodynamic and rotor forces remain in Havok; this fix does not teleport aircraft airborne or seed launch velocity.

## Verification

`node --import tsx --test tests/aircraft-controls.test.ts tests/plane-turn.test.ts tests/vehicles.test.ts`: 15 passing tests, covering aircraft control mapping, retained car brakes, rebindings, actual Havok lift/turns/collisions and serialization. Typecheck passed.

`tests/aircraft-controls-audit.mjs` automates normal F2 menu spawn, close, E entry, keyboard takeoff, landing and E exit. Test access reads state only; it does not mutate game entities. Functional checks use separate Chrome contexts and private frozen builds while other agents may run functional checks, so performance numbers are not claimed.

- [Before-fix WebGPU reproduction](evidence/aircraft-controls-before-webgpu/result.json).
- [Frozen WebGPU after-fix check](evidence/aircraft-controls-after-frozen-webgpu/result.json): both aircraft took off at 100 health, landed, stopped and exited normally, with no browser errors. The helicopter landed at 96.40 health. The initial plane test pilot cut power too early and stalled into a hard but survivable landing at 78.68 health; this is not evidence of a smooth approach.
- [First WebGL2 check](evidence/aircraft-controls-final-webgl/result.json): both aircraft took off normally at full health; helicopter landing/exit passed. The automated plane approach kept excessive elevator and flew beyond the available beach before touching down. The landing assertion failed; this retained failure is a test-pilot route issue, not evidence that the plane remained on the ground.

A development-server takeoff check was interrupted by unrelated HMR source changes during landing; its screenshots are retained separately and are not used as a complete pass.
- [Corrected WebGL2 plane approach](evidence/aircraft-controls-landing-corrected-webgl/result.json): normal takeoff, a physical descent with keyboard throttle/elevator modulation, touchdown at 97.14 health, wheel braking to a halt, and normal E exit all passed with zero browser errors. This test uses read-only flight telemetry to operate keyboard controls; no aircraft state mutation or airborne seeding occurs.
