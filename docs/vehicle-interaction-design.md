# Vehicle doors, lighting and garage service

These are authored project behaviors. They do not establish exact GTA VI vehicle construction, animation, lighting or service prices. The current nine vehicle classes retain original procedural assets; the road cabin improvement is still below the requested final art fidelity.

## Doors and cabins

Coupe and pickup models have two front doors; sedan, SUV and police models have four. The former solid cabin roof volume is now an open cabin with a roof surface, pillars, floor, dashboard, steering wheel and front seats. Door glazing, handles, trim, mirrors and police stripes follow their door hinge. Clearer glass exposes the seated rig. The existing stable panel slots and window slots remain loadable from prior saves.

Normal entry opens the approached front door for 0.85 seconds; safe exit opens the chosen side for 1.1 seconds. The hinge moves at up to 3.8 radians/second to 1.12 radians and returns closed. Driving above 5 m/s closes it. Entry continues using the existing visible 0.65-second mount transition. Exit still places the character at a swept, ground-supported safe location; a complete authored exit clip remains missing.

Attached doors are animated components. Their open shape is not a separate hinge constraint or moving contact surface; the vehicle retains its existing compound chassis/cabin proxy. This limitation must not be described as a fully physical attached-door simulation. A local strike over 28 damage within 1.35 m of a door removes that component and creates an independent 32 kg Havok box aggregate carrying the visible door and remaining attached glazing/trim. It inherits vehicle velocity plus a bounded outward impulse, collides, and expires after 26 seconds. Vehicle debris shares the existing 32-fragment budget. Removed parts no longer identify as their source vehicle for combat queries.

Optional per-door enabled/angle fields extend the version-1 vehicle damage snapshot; older saves default to intact closed doors. Repair restores doors, windows, bumpers, lamps, tires, mechanical health and the original deformed panels. The low-detail collision proxy, incomplete passenger seating, simplified glass fragments and missing attached-door contacts remain explicit gaps.

## Lighting and sound

L toggles headlights; J toggles a police cruiser siren. Both are rebindable. Creative-mode buttons provide the same toggles through the controller-navigable menu. H produces a separate synthesized steady horn; active sirens use the spatial continuous responder sound.

Headlamps illuminate geometry with a fixed pool of four Babylon spotlights. Only functioning headlamps on live vehicles within 110 m of the camera compete for that pool, sorted nearest first. Each beam has 48 m range, 0.58-radian cone, exponent 2 and intensity 85. These are chosen rendering settings, not real lamp photometry. Headlamp meshes remain emissive outside the light pool. Brake/handbrake input raises the red tail emission. Red/blue police lightbar materials alternate at an 8-step/second cadence when the siren is active. A motorcycle uses one working headlight; watercraft and aircraft still need class-specific navigation/landing lights. Turn signals and reverse lamps are not implemented.

Localized lamp damage extinguishes its geometry and associated beam. The damage radius is clamped from amount × 0.012 to 0.45–1.5 m, so a weak shot does not automatically break both headlights. Headlight and siren switches survive saves. Old motorcycle snapshots with no recorded lamp slots remain compatible with the added headlight.

## Garage

Stop a vehicle below 2 m/s within 10 m of a garage location and press E. Sunset Customs opens a controller-navigable service panel. Repair costs $150; one of six paint colors costs $75. Validation checks the live vehicle, garage distance, speed, available game cash and color before mutation. Insufficient funds and invalid/stale requests leave both the vehicle and cash unchanged. Exit Vehicle uses the existing safe-exit checks; Back to the Street resumes driving.

Paint changes the vehicle's paint material and is preserved separately from appearance seed and damage. Repair does not remove custom paint. This is the first garage customization feature; performance upgrades, wheels, interiors, liveries, parts purchasing and extensive body kits remain missing. Shops now refill each weapon's appropriate reserve rather than giving the currently selected grenade weapon a firearm-sized reserve.

## Evidence

`tests/vehicle-equipment.test.ts` uses real Havok and checks opening/closing, glazing attachment, physical detached-door movement, ten damage restore cycles with stable resource counts, bounded lights, lamp damage, brake/siren response, garage rejection/charging and painted damage/repair/save round trips. Existing vehicle tests retain driving/flight, crash and render-cadence coverage. `tests/frame-history.test.ts` checks that the bounded circular frame-time buffer preserves raw stalls and ordering beyond 120,000 frames without per-frame array shifting.

`tests/checkpoint-3-audit.mjs` passes 12 normal keyboard/mouse/UI stages on both WebGPU and WebGL2 at 1920×1080, including door entry/exit, headlights, paid garage paint, a deliberately failed world request with preserved player position, visitor access and restricted entry/alarm. Both runs have zero unexpected browser errors; injected HTTP 503 failures are recorded separately. JSON and screenshots use the `checkpoint-3-webgpu` and `checkpoint-3-webgl` prefixes under `docs/evidence`. Earlier failed startup, material and report-timing checks are preserved separately. The 30-minute stability and full final visual-fidelity gates remain outstanding.
