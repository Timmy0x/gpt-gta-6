# Architecture and technical decisions

## Runtime

Babylon.js 9.25.0, Havok 1.3.14, TypeScript 5.9 and Vite 8.2.2 are pinned in the lockfile. Node 24.18.0 was used. Current versions were checked against npm and the [official engine specifications](https://www.babylonjs.com/specifications/) on 2026-09-09. The [official Physics V2 source documentation](https://github.com/BabylonJS/Documentation/blob/master/content/features/featuresDeepDive/physics/v2/usingPhysicsEngine.md) and installed `.d.ts` / implementation files were inspected to verify APIs.

`Renderer.ts` selects WebGPU, explicitly supplies bundled GLSLang/TWGSL assets, catches initialization failures and falls back to a checked WebGL2 context. `main.ts` initializes Havok with bundled WASM and composes dedicated world, player, vehicle, population, wanted, combat, damage, audio, input, UI and persistence modules. The application is static and client-side. No hosting or deployment configuration was created.

## Units and stepping

Meters, kilograms and seconds; +Y is up and +Z is vehicle forward. Gravity is `(0,-9.81,0)`. Havok uses a fixed 1/60 s step with Babylon's millisecond substep accumulator (`1000/60`). Gameplay systems update from `Scene.onBeforePhysicsObservable` with that same fixed step. The Havok plugin is configured to use its fixed timestep. Simulation-speed adjustments change substep wall-time scheduling, not force constants. Pause disables scene physics. A test drives the same controls under 30, 60 and 144 Hz render scheduling and checks identical step counts, speed and position.

Characters now use one vertex-colored skinned mesh with 17 authored Babylon bones, a shared PBR material, and procedural idle/walk/run/aim/crouch blending. These are original approximations; realistic replacement assets and interaction animations remain needed.

Player locomotion uses Babylon's PhysicsCharacterController capsule (1.8 m standing, 1.3 m crouched, radius .32 m, step height .36 m). Walk 3.7 m/s, sprint 7.1 m/s, swim 3.3 m/s; jump speed 5.7 m/s. Camera collision rays query authored structural proxies. Camera smoothing is frame-rate independent. Player previous/current position storage exists; comprehensive vehicle render interpolation is still a gap.

## World and navigation

The central district has a 72 m intersection grid, 14 m carriageways, 3 m sidewalks and authored building layouts. Static collision stays resident. Rendering geometry is merged per material, detail tier and 144 m chunk; distance-based visual LOD is implemented. This is **not yet full asset streaming or collision unloading**. The directed lane network contains 284 nodes and is strongly connected; traffic chooses graph successors, steers through tire forces, follows simple signal phases and attempts reverse recovery when stuck. Pedestrians have sidewalk destinations, phone/walking states and threat reactions; they do not yet use a general navmesh.

See the atlas for exact planning coordinates. The rendered central district and provisional skyline do not count as completed Leonida regions.

## Vehicles and damage

`VehicleSystem.ts` owns dynamic Havok bodies, ray suspension, tire force limits, braking/steering, boat buoyancy/propulsion/drag, helicopter rotor thrust/torque, and trainer lift/drag/stall behavior. Original mesh models differ across nine classes. Vehicle motion uses forces and torques; normal driving never writes scripted positions. Explicit creative recovery uses Babylon's teleport prestep mode and returns to dynamic simulation.

Impact contacts are accumulated to avoid hiding major impacts behind a small first contact. Damage alters vertex positions, hides broken glazing/lights, damages tire grip, detaches physical bumper debris, and affects engine performance. Full soft-body simulation and large structure collapse are not implemented. Aircraft collision proxies were changed to tapered compounds after a runway rotation failure was reproduced.

`DamageSystem.ts` owns material-classified movable and breakable crates, bins and phone kiosks. Breaking removes the collider and composite model and creates bounded physical debris. Explosion effects use falloff and structural line obstruction. Fire has damage/extinguishing logic; complete convincing fire rendering/spread remains unfinished. Many authored street props are still decorative/static exceptions. Character ragdoll fidelity remains incomplete.

## Police and combat

`WantedSystem.ts` is a deterministic state machine: clear → reporting → pursuit → search → cooldown → clear, with reacquisition. Five stars are explicitly a configurable GTA V-inspired project fallback; newer secondary reports about VI are documented separately, without silently claiming parity. Witness checks use range and building obstruction. Police record last-known coordinates and track seen vehicle/character identities. Vehicle pursuit works; foot officers, tactical deployment, helicopter support, roadblocks and military behavior remain outstanding.

Combat has three weapon modes, ammo/reload/cooldown, camera-ray hits, tracers, shared prop/vehicle damage, pedestrian injuries and witnessed-crime reporting. Grenade placement/throwing, recoil animation, melee/cover and reactions are still approximations or absent. Combat is not complete merely because shots cause damage.

## Persistence and resource boundaries

Saves are versioned and local to the browser. Current serialized data covers player, time/weather, cash, custom vehicle IDs/full pose/velocities/actual deformed vertices/glazing/lamps/bumpers/tire state, destroyed authored prop IDs, prop transforms/health, creative civilians and sandbox settings. Vehicle schema validation happens before replacement; tests show eight replacements preserve geometry, state and resource counts. Detached free debris, all ambient AI state and full chunk changes are not yet preserved. Those limitations remain acceptance gaps. No cloud save or account service is required.

Pedestrian and traffic targets are bounded in the initial district; debris expires. Creative population caps and reliable repeated-spawn/removal disposal require sustained testing. Large-world saves should move to IndexedDB as data grows. Main diagnostics retain a bounded recent frame history; raw frame times are stored separately from clamped rendering deltas.

## Verified integration defects

Object spread on Babylon vectors discarded public x/z getters; explicit public coordinate copies fixed police last-known routing and have a regression test. Passing a plain object cast to Vector3 into `Vector3.add()` produced non-finite audio coordinates and froze the loop; a real Vector3 and finite guards fixed it. Both failures were found by independent normal-control tests and retested in a frozen production build.
