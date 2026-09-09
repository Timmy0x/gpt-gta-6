# Movement and interaction checkpoint

These values and animation curves are project decisions, using GTA V movement as a documented fallback category rather than claiming unpublished GTA VI metrics. Babylon 9.25 Physics V2/Havok supplies the actual controller, capsule queries and rigid-body simulation.

## Movement

The standing capsule is 1.8 m tall with 0.32 m radius; crouching lowers it to 1.3 m while preserving foot position. Standing up first tests the larger capsule against actual Havok shapes. Walk/sprint/crouch/swim target speeds remain 3.7/7.1/1.65/3.3 m/s. Jump vertical speed is 5.7 m/s. The controller supports 0.36 m automatic stepping.

Pressing jump near a ledge tries a supported landing 1.05 m ahead, 0.42–1.45 m above the feet. Capsule sweeps check up/across/down stages and overhead clearance. The existing Havok character controller then follows the checked path through velocity/integration, with a two-second abort limit. The 17-bone skin uses an authored climbing pose. Moving obstacles can still interrupt the climb safely. This is low ledge mantling, not arbitrary ladders, handholds or a full parkour system.

Additional skeleton overlays cover seating, entry blending, swimming and hit reactions. Current exit placement is capsule-safe but exit animation and explicit opening doors remain incomplete. Swimming still uses the initial eastern water boundary; regional water volumes are an open integration requirement.

## Vehicles

Entry rejects moving vehicles above 5 m/s and a world obstruction between the player and the seat approach. The actor blends toward the driver's seat over 0.65 seconds and remains visibly attached to the vehicle, including motorcycles. Driver seat placement is authored per broad vehicle class; it is not a complete passenger/door/bone contact system.

Exit rejects speed above 10 m/s. It checks left door, right door and rear, requires walkable ground or the local sea, rejects a landing above the exit step range, tests the complete standing capsule and sweeps against the surrounding world. All blocked candidates leave the player inside with a clear message. Explicit creative teleport/recovery/load can force a dismount; ordinary interaction cannot bypass the checks.

Render interpolation stores previous/current physical vehicle transforms, interpolates only for drawing, and restores authoritative transforms after rendering. Player capsule positions interpolate similarly. Babylon 9.25's pinned internal `_physicsTimeAccumulator` supplies render alpha; this dependency must be reviewed during an engine upgrade. AI/collision/save operations observe restored physical transforms. Teleport/recovery invalidates render history.

## Routes, services and controls

Map routes use A* over the same directed lane graph as traffic. They reroute at 1.5-second intervals and clear within 9 m of the destination. The first/last connection from the actor or landmark to its nearest road is an approximate access leg; this does not claim pedestrian pathfinding through arbitrary interiors. Fast travel remains explicitly labeled separately in the map UI.

Stationary damaged vehicles near the garage can receive $150 repairs. Palmetto Supply provides $50 replenishment; generic landmarks no longer behave as unnamed shops. Creative controls retain free repair, placement, fire and encounter reset.

Keyboard melee is rebindable on F. Standard controller RB performs melee on foot and horn while driving. Controller menus support D-pad/left stick focus, A activate/cycle select, B close and left/right range adjustment. Physical-device verification remains pending. Panels now show current time, weather, density, cheats, quality and audio state rather than reset-looking defaults.

Saves retain stable creative civilian IDs, every weapon's magazine/reserve and selection, armor, complete current prop geometry, and sandbox settings. Legacy version-1 saves with these fields absent remain accepted. Reload progress and the active wanted encounter are intentionally reset during load. This is still browser localStorage, with its quota and no full regional database.

## Environment and audio

A bounded Babylon ParticleSystem shows local rain. A roof test suppresses the local emitter while sheltered; it is not per-particle collision against every roof. Wetness changes road grip and dries gradually. Sky/fog and environment brightness follow time/weather. Four nearest street lamps provide real bounded local illumination at night, in addition to facade emission. Headlights, volumetric clouds, lightning and regional weather remain open.

Original procedural Web Audio provides engine/traffic, spatial sirens, wind/surf/rain and footsteps plus combat effects. At most eight persistent spatial voices and 32 transient effects are active. Transient nodes disconnect at completion. This is a functional authored sound study, not recorded vehicle audio, licensed music, speech or final acoustic fidelity.

## Evidence

`tests/movement.test.ts` uses actual Havok to check wall/ceiling overlap, thin-wall sweeps, valid/blocked ledges, a complete controller climb and alternate-door/fully-blocked vehicle exits. `tests/interpolation.test.ts` checks visual interpolation/restoration and teleport history. `tests/navigation.test.ts` checks directed connectivity and disconnected destinations. Existing input tests now cover all 15 bindings. Browser records are retained under `docs/evidence/combined-*`; consult their assertions and errors rather than treating a screenshot as proof of complete behavior.
