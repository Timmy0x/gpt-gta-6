# Vehicle system implementation record

All tuning, vehicle names, and visual models in this module are original project decisions. They are not exact GTA VI model or handling reproductions. Units are meters, kilograms, seconds, radians, and newtons.

## Integration

`VehicleSystem` is exported from `src/vehicles/index.ts`. Construct after enabling Babylon Physics V2 with Havok. Set `waterLevel` to the world's water elevation and `wetness` between 0 and 1. Run `update(1 / 60)` exactly once in `scene.onBeforePhysicsObservable`, with `scene.getPhysicsEngine().setSubTimeStep(1000 / 60)` configured by the owner. `control` stores input until the next change; AI and player controls use the same forces.

- `spawn(kind, position, heading = 0, stableId?)` creates a dynamic body; positive Z is model forward. An explicit invalid or already-live ID throws before allocating model/physics resources. Generated IDs skip occupied names.
- `list` contains living entities. `root` is the transform used by camera/interaction systems; `body` is its `PhysicsBody`.
- `speed` is horizontal speed in m/s, `forwardSpeed` is signed body-frame speed, `heading` derives from the body orientation.
- `input.throttle` is signed propulsion; `steer` is signed right turn; `brake` is 0–1; `handbrake` breaks rear tire grip; `lift` is helicopter collective or aircraft elevator input.
- Helicopter rotor spools when `occupied && engineRunning`; car, boat, and plane propulsion follows throttle.
- `onCrash(vehicle, severity, point)` receives collision delta velocity in m/s and a world-space point after physical contacts. Multiple progressive impacts can produce multiple callbacks.
- `damage(vehicle, amount, worldPoint?)` creates geometry/functional damage; `repair(vehicle)` restores health and model parts without changing pose.
- `recover(vehicle, optionalWorldPosition)` is an explicit creative action: repairs, finds a supporting surface, rights the vehicle, stops it, and performs a single teleport prestep before restoring ordinary dynamic motion.
- `serialize(vehicle)` returns a JSON-safe `SerializableVehicle` (schema version 1): stable ID, kind, flat x/y/z/heading/health, complete rotation quaternion, linear/angular velocity, engine/siren/rotor state, paint seed, and `VehicleDamageState` containing actual local panel vertices, panel visibility, punctured tire flags, and glazing/light/bumper visibility.
- `restore(snapshot)` accepts that full snapshot or the legacy `{kind,x,y,z,heading,health}` record. It checks values and component topology, then explicitly replaces a matching live ID. Invalid data leaves the old body intact. Full quaternion restoration preserves rollovers; no damage is reconstructed by replaying a generic health hit. Legacy records cannot recover geometry that was never saved, so only their recorded health/pose are migrated. Seat occupancy and short-lived detached debris are not restored.
- `remove` and `dispose` release bodies, compound collision shapes, meshes, materials, and related debris.

## Implemented mechanics

Road vehicles use ray suspension at each wheel, spring/damper support, tire contact-point velocity, a combined tire friction circle, progressive steering, drive force, braking, rear handbrake grip loss, aerodynamic drag, and a lowered centre of mass. Rain and punctures reduce grip. The chassis and roof have distinct rigid collision proxies so rollovers contact the roof. SUV, pickup, sedan, coupe, and interceptor geometry and tuning differ. Motorcycle balance uses a rider-assistance torque.

Runabouts use four buoyancy samples, propeller thrust, anisotropic water drag, and rudder torque; solid shore geometry blocks them. Helicopters apply rotor thrust along actual body orientation, collective, tilt/yaw torques, rotor spool, and drag. Trainer aircraft use a 16 m² wing, dynamic pressure, angle-of-attack lift/stall, thrust, drag, and elevator/bank control torques. Its compound fuselage is tapered to permit real runway rotation; the wing has a collision proxy.

Collision manifolds accumulate contact impulses. The damage calculation also checks actual velocity change and allows a larger follow-up impact through the cooldown. Damage edits local coachwork vertices and normals, breaks lights, detaches glazing/bumpers into dynamic debris, punctures tires, reduces engine power, and disables destroyed engines. Debris is capped at 32 bodies with 10–26 second lifetimes.

## Verification on 2026-09-09

`node --import tsx --test tests/vehicles.test.ts` exercises Babylon 9.25.0 with actual Havok 1.3.14 WASM and NullEngine. Eleven tests cover friction limits, spring equilibrium, engine limits and degradation, damage thresholds, stall envelope, ground suspension, acceleration and steering, wall collision, visible vertex damage, broken glazing, buoyancy/shore collision, helicopter takeoff/translation/landing, aircraft runway acceleration/takeoff, explicit recovery, render-cadence independence, and full component save/restore.

Measured test results: coupe 20.80 m/s after three seconds throttle; sedan wall crash reduced health to about 54 and deformed/broke parts; powered boat about 18 m/s; helicopter climbed above 23 m and landed under collective; trainer reached 36.5 m/s on runway and took off under lift; 62 m/s car hit an 8 cm wall without crossing it. Driving at simulated 30, 60, and 144 Hz render cadence produced the same 299 physics steps, 17.623 m/s speed, and z=36.987 m after five seconds.

A damaged and overturned coupe snapshot was 3,029 bytes. JSON round-tripping retained its exact dent vertices and tire/glass/light/bumper flags, engine/siren state, full orientation, and velocity within Havok float precision. Eight replacements retained constant mesh/body/material counts. All nine vehicle classes pass a damaged component round-trip. Duplicate IDs are rejected, stale references cannot affect replacements, malformed topology leaves the previous body intact, and repaired restored cars recover their original geometry.

These are simulation tests, not browser visual or performance evidence. The integrating owner must verify ordinary game controls, both rendering backends, streamed terrain, traffic, and sustained populations.

## Remaining limitations

Models are authored procedural geometry with PBR materials, not finished realistic production assets. No researched per-model GTA VI fidelity is claimed. Door articulation/detachment, physically simulated wheels/axles, passengers, gearbox, detailed engine/drivetrain failure, rotor blade collisions, deforming collision hulls, wing separation, wake spray, and fine water surface sampling remain absent. Ray tires cannot climb steps as robustly as swept wheels. Debris/part breakage is authored rigid-body behavior, not soft-body physics. Detached debris lifetime/pose and seat occupancy are not serialized. The motorcycle uses balance assistance; the trainer uses angle-of-attack assistance. Aircraft stall is modeled, but full flight envelopes and landing scenarios still need player testing.

## API sources inspected

- [Babylon Physics V2 core concepts](https://github.com/BabylonJS/Documentation/blob/master/content/features/featuresDeepDive/physics/v2/rigidBodies.md): dynamic rigid bodies, mass distribution, forces, and simplified collision shapes.
- [Babylon Physics V2 engine setup](https://github.com/BabylonJS/Documentation/blob/master/content/features/featuresDeepDive/physics/v2/usingPhysicsEngine.md): Havok integration.
- Installed Babylon 9.25.0 declarations/implementation: `physicsBody`, `physicsShape`, `physicsRaycastResult`, `physicsEngine`, `joinedPhysicsEngineComponent`, and collision-event types. Verified `ignoreBody`, `applyTorque`, contact impulse data, `disablePreStep`, and that scene substep arguments are milliseconds while `_step` receives seconds.
