# Current world edge protection

`src/world/WorldBoundary.ts` protects the supported terrain envelope from `Coast.ts`: X −1200…2100m, Z −800…800m. These are temporary authored playable limits. They do not represent the full planned Leonida map or verified Rockstar coordinates. The terrain and seabed extend beyond this envelope by a physical margin; the boundary helper adds no invisible wall mesh.

## Motion and recovery

`limitVelocity(position, velocity, dt, radius)` only caps velocity directed toward each nearby X/Z edge. For distance `d` to the edge of the entity footprint, the allowed outward speed is the lesser of `sqrt(2 × 12 × d)` and `d / (dt + .75)`, in metres/seconds. These are explicit project safety settings, not measured GTA values. Inward, tangential, vertical and angular motion remain available. The controller should pass actual movement velocity, including the existing noclip multiplier. Conservative horizontal radii must include wheels, mirrors, doors and aircraft wings.

The stopping-distance envelope slows fast aircraft before they reach the finite terrain; the time envelope approaches zero smoothly and protects a long movement step. Initialising an entity extremely close to an edge with a large outward speed can require an immediate velocity reduction. This is a temporary development-area guard rather than a physical vehicle handling feature. The normal world remains controlled by Havok collision, tire/suspension forces, buoyancy and lift.

`recovery(position, clearance, radius)` normally returns null. It returns a target and reason only for a nonfinite position, an entity footprint beyond the envelope, or a centre more than 8m below the actual queried terrain/seabed. It never snaps an ordinary swimmer to sea level or constrains flight altitude. Outside positions move 12m inside the available envelope and retain valid height above supporting terrain. Invalid positions use the configured safe fallback. A below-floor recovery uses the actual floor plus centre clearance. Death, damage, controls and body orientation are not reset or repaired.

## Integration order

Use a shared `WorldBoundary` instance. For unparented dynamic vehicle bodies:

1. Restore interpolated nodes to their physics poses as usual.
2. Update vehicle controls and apply forces/impulses.
3. Call `boundary.beforePhysics(body, dt, { radius, clearance })`.
4. Run the actual Havok step.
5. Call `boundary.afterPhysics(body, dt, { radius, clearance })` **before** `interpolation.afterStep()` captures transforms.

For players, limit the velocity immediately before character-controller integration or noclip displacement. Perform exceptional recovery before an invalid position can enter movement queries and after integration if a collision pushes the capsule outside. The player integration owns cancelling an interrupted climb/entry pose where necessary; this helper owns no player state.

Babylon 9.25 Havok `applyForce` applies an immediate impulse scaled by the plugin timestep, which is why guarding after control forces is effective. A collision or an impulse added after the guard can still cross the edge during the solver step. The post-step adapter stages a one-step `PhysicsPrestepType.TELEPORT` correction, which is consumed at the next real Havok step before restoring the exact previous prestep mode. This avoids a visually corrected mesh immediately snapping back to the old physical body position. Rotation is preserved unless already nonfinite. Angular velocity is only reset for invalid/below-floor recovery, not ordinary outward motion.

The pending teleport state uses weak body keys and creates no Babylon resources or scene observers. Disposed bodies are safe to pass to either adapter. Calling `afterPhysics` without a real intervening step violates the adapter contract; do not run the pair solely from render frames while physics is paused.

## Verification

`node --import tsx --test tests/world-boundary.test.ts` passes seven tests, including actual Babylon 9.25/Havok 1.3.14 bodies and a real character controller. Coverage includes sustained 60kN/50kN diagonal thrust, a 200m/s initial X velocity, a 12m aircraft footprint, preserved heading/altitude, returning inward, a forced post-guard boundary crossing, old saves outside/below terrain, nonfinite positions, sea-floor depth and walking against the boundary for 20 seconds. Requested step durations include 1/120, 1/60, .1 and .5 seconds; Babylon's PhysicsEngineV2 clamps the last case to a .1s solver step. Pure noclip displacement is additionally checked through two-second movement steps. The ordinary sustained-thrust cases require **zero positional recoveries**. A further integrated `Player.update()` case verifies walking toward the default coast edge, sustained outward noclip and ascent, immediate inward return, and an outside player save recovery before movement queries.

`npm run typecheck` passes. The test log is `docs/evidence/world-boundary-tests.log`. These are physics/helper checks, not normal-control browser or visual acceptance. Root integration and both-renderer normal playtests remain required. Visible finite-area cues such as coastal buoys and authored road-end barriers are still separate world-art work; this helper does not claim those exist or that the finite map is complete.
