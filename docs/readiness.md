# Initial playable checkpoint

**Ready for local playtesting. The full goal is not complete.** Nothing has been pushed, deployed or configured for hosting.

## What can be played

The central Vice City study has connected streets, sidewalks, traffic and pedestrians, an accessible shop and garage, beach and marina. Jason and Lucia use original skinned character representations. Players can walk, sprint, crouch, jump, switch characters, enter vehicles, drive, crash and damage vehicles, attract police, be arrested and resume play. Boats and helicopters have also been exercised through the normal controls; trainer takeoff has actual Havok test coverage. Creative tools provide spawning/removal, map search/teleport, time/weather, density, wanted rules, cheats, simulation speed and browser-local saves. Vehicle saves preserve deformed geometry and component damage.

The central loop has separate normal-control evidence for witnessed crash/reporting/pursuit, actual police arrival, arrest/recovery and sandbox-assisted loss of contact. Continuous driving evasion and vehicle-switch identification need more testing. Do not read this checkpoint as complete GTA VI behavior or geography.

## Checks completed

- 29 behavior, real-Havok, rig and input tests pass.
- TypeScript and production build pass; the main JavaScript bundle still produces a size warning.
- Updated production WebGPU smoke at 1920 × 1080: normal driving/crash/switch/pursuit, save/load, boat propulsion and helicopter lift; zero console errors.
- Independent updated WebGL2 audit at 1920 × 1080: core loop, police response, weather, pause, map filtering, visible moving creative civilians, vehicle ID/component save round trips and removal of unsaved custom entities; zero errors or warnings.
- Earlier independent outcome audit verifies one-star BUSTED/recovery and search → cooldown → clear after a map-assisted relocation.
- Screenshots, raw audit records and logs are retained in `docs/evidence/`. Hardware and measurement limits are in `docs/performance.md`.

## Open scope

The full Leonida map is still planned beyond this small district. Art remains stylized procedural reconstruction and does not meet the requested final realism. Foot officers, SWAT, military, tactical roadblocks/helicopters, full ragdolls and combat, complete animation/entry/exit/passenger interactions, additional activities, rigorous destruction/navigation updates, true streamed asset/chunk unloading, full world persistence and long-run profiling remain incomplete. Gamepad gameplay works in synthetic event tests; controller menu navigation and physical-device validation remain open.

The 30-minute memory/stability test and full performance gate have not passed. Short near-60 FPS samples are evidence only for those sampled scenes and conditions.

See `docs/goal-objective.md`, `docs/feature-index.md` and `docs/continuation.md` for the continuing scope. Keep this build playable while expanding it.
