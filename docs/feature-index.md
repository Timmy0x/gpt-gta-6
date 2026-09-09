# Implementation and reference index

Baseline **2026-09-09**, with an independent implementation-status update below. The user objective remains the acceptance scope. This is an implementable backlog, **not an exhaustive GTA VI inventory**. Initial specification rows began **planned / unverified**; the dated status ledger supersedes that initial status for the IDs it lists. Code landing changes status to implemented-unverified; only retained evidence verifies the specific tested behavior. A general “vehicles” or “world complete” claim cannot supersede these rows.

Evidence IDs link to [references.md](references.md); geometry to [map-atlas.md](map-atlas.md); asset families to [asset-catalog.md](asset-catalog.md). **C** = confirmed GTA VI identity/theme, **O** = observed official image/caption (specified), **V** = GTA V-inspired fallback whose direct behavior evidence is still pending, **I** = inferred reconstruction/project specification, **A** = creative-mode addition. A row can combine identity evidence with inferred mechanics. No unpublished numeric value below is represented as Rockstar's specification.

## Shared authored defaults

These defaults make acceptance concrete; the implementation may refine them through tested tuning, updating the record and changelog. They are **specifications, not assertions about current code**.

| Profile | Project default |
|---|---|
| Units and simulation | Meters, kilograms, seconds; gravity 9.81 m/s² downward; simulation/physics 60 Hz, fixed dt 1/60 s; max catch-up 5 steps; render interpolation |
| Player | Capsule radius 0.32 m, height 1.75 m; walk 2.2 m/s, run 4.5 m/s, sprint 7 m/s, crouch 1.3 m/s, swim 2 m/s; jump launch 4.8 m/s; 0.35 m step target |
| Camera | Eye target 1.55 m, chase distance 5.5 m; collision margin 0.2 m; mouse sensitivity adjustable; horizontal FOV selected/documented with actual implementation |
| Interactions | Entry/shop/pickup reach 2.5 m with line-of-sight; exit blocked if capsule sweep collides; entry denied above 2 m/s unless dedicated animation/recovery exists |
| Sedan prototype | 1,450 kg, wheelbase 2.7 m, wheel radius 0.34 m, body about 4.6×1.85×1.45 m; target governed top speed 45 m/s; distinct tuning for other classes |
| Suspension prototype | Four wheel samples; rest travel 0.30 m, travel limits 0.10–0.45 m; per-wheel spring 32,000 N/m and damping 4,500 N·s/m; tune against ride height and actual mass |
| Tires/brakes | Dry friction coefficient target 1.0, wet 0.65; longitudinal/lateral force limited by normal load; hydraulic braking target 8 m/s² dry; steering angle reduced with speed |
| Health | Player health 100 and armor 0–100; armor absorption configurable; respawn/recovery delay 4 s; emergency safe-point validation |
| Pistol prototype | 12-round magazine, 0.22 s firing interval, 1.5 s reload, 70 m game range, 20 base game damage; weapon spread/recoil configuration; all numbers are gameplay abstractions |
| Crime perception | Civilian visual reporting range 45 m, officer 90 m, gunshot alert radius 110 m; occlusion check required; civilian report delay 3 s; identify face only at shorter 25 m range |
| Dispatch/search | Initial dispatch delay 4 s; spawn at 90–180 m along connected roads, outside view; contact loss grace 6 s, low-tier search target 25 s; per-level overrides |
| Object budgets | Provisional maximum active debris 80, lifetime 12 s; nearby pedestrians 30, traffic 16 and responders 10; density controls bounded; profile actual scene before raising |
| Explosion prototype | Game radius 12 m with distance falloff; ray/shape obstruction checks; impulse budget chosen per material and mass; no actual explosive construction values |
| Weather/time | Smooth 10 s weather blend; optional 24-minute day; rain changes grip and presentation, never fixed timestep |
| Streaming proposal | 144 m chunks; graphical range by quality; near simulation 180 m, simplified simulation beyond; changes stored by stable ID, not mesh name |
| Saves | Versioned local browser save; seed + player/config + entity diffs; atomic replacement/error handling, explicit reset; no server needed |

## Foundation and world construction

Every criterion below requires a linked evidence entry with build revision and test result. These are the baseline requirements; see the dated ledger for current tested subsets and remaining gaps.

| ID / feature | Reference / class | Implementation and dependencies | Assets | Acceptance / remaining gap |
|---|---|---|---|---|
| F01 Fixed simulation | I | Fixed-step accumulator, bounded catch-up, interpolation; keep game logic independent of rendering | None | Same seeded input trace at 30/60/120 render FPS has bounded state deviation; no current result |
| F02 Havok Physics V2 | User requirement / I | Initialize real WASM, correct units, collision layers, disposal; inspect installed API | Runtime/WASM | Dynamic body settles, pushes and collides in production build; failure shows useful load error |
| F03 WebGPU | User requirement / I | Capability probe and initialization guard; renderer-independent gameplay | Materials/shaders | Real browser WebGPU run with backend recorded; API existence alone insufficient |
| F04 WebGL2 fallback | User requirement / I | Explicit selectable fallback, equivalent physics/input/GUI | Compatible materials | Complete central loop on WebGL2; retained screenshot and log |
| F05 Quality / settings | A | Shadows/LOD/density/sound choices and persistence; do not change physics dt | UI | Apply presets live, reload preferences, acceptable readability; backend limitations exposed |
| F06 Stable entities | I | Seeded IDs, component state, removal, serialization, ownership/disposal | None | Reload produces same IDs and honors deleted/damaged objects |
| F07 Streaming | I | Async chunk lifecycle, authored overrides, physics/nav residency and vehicle continuity | Chunk modules/LODs | Repeated boundary crossing has no fall-through, duplicate entities, missing AI route or growing memory |
| F08 Spatial queries | I | Nearby/LOS/sweeps and layer filtering shared by gameplay | Collision shapes | Occluded targets rejected; fast movements cannot skip blockers |
| F09 Road navigation | I | Directed lane graph, turn connections, stop lines and route choice | Road/intersection kit | Connected routes through intersections and district boundaries; wrong-way rules explicit |
| F10 Pedestrian navigation | I | Sidewalk/portal graph or navmesh, crossing edges and destruction updates | Sidewalk/interior kit | NPC reaches distinct destinations without walking through walls or standing forever |
| F11 Loading/errors | I | Progress state, recoverable asset failures, deterministic startup | UI | Fresh cached/uncached start reaches controls; rejected load shows useful recovery |
| F12 Keyboard rebinding | A | Action map, conflict feedback, persistence, reset | UI | Rebind movement/enter/fire then play normal loop; UI does not steal held input |
| F13 Gamepad | User requirement / I | Standard mapping, dead zones, connect/disconnect and menu focus | Prompt icons | Normal loop and creative panel through physical gamepad or documented emulation; test still missing |
| F14 Pause / focus | I | Freeze simulation on pause/focus loss; clear keys and pointer lock | Pause UI | Resume without time jump, stuck throttle, accidental shot or overlay drift |
| W01 Central roads | C VI-PLACES identity + I layout | Atlas 72 m grid, proper lane widths/intersections, curb ramps | ARCH/road/props | Several connected driveable blocks, no decorative roads without collision/nav |
| W02 Central facades | C VI-PLACES theme + I geometry | Varied Art Deco/commercial/residential frontage, entrances/roof details | ARCH-DECO/URBAN | Street/aerial captures have deliberate variation; primitive box frontage stays a visual gap |
| W03 Beach / ocean | O VI postcard + I dimensions | Beach slope, shore collision, water volume, promenade, swim/boat access | VEG/MAT/water/props | Player crosses dry/wet boundary correctly; boats launch without shoreline clipping |
| W04 Interiors | I, official location appearance ≠ accessibility | Shop and garage portals, physical rooms, camera fit, sound transitions | INT-SHOP/GARAGE | Enter/interact/exit through normal controls, with coherent exterior alignment |
| W05 Vice City expansion | C VI-PLACES + I layout | Downtown, inner commercial/residential, port and airport; atlas connections | Distinct ARCH kits | District gates pass and contiguous travel works; central slice cannot satisfy full city |
| W06 Keys | C/O VI-PLACES + I mechanics | Island settlements, bridges, sea routes, marinas, marine activities | ARCH-REGIONAL/VEG/watercraft | Connected roads and water travel, distinct local detail; currently unbuilt |
| W07 Grassrivers | C/O VI-PLACES + I mechanics | Shallow channels, mangroves, raised roads, airboat navigation, wildlife | VEG-WET/FAUNA/AIRBOAT | Road/boat/foot traversal with habitat variation; currently unbuilt |
| W08 Port Gellhorn | C VI-PLACES + I layout | Worn motel/commercial coast, alleys, dirt paths, ambient populations | ARCH-REGIONAL/props | Independent district gates; currently unbuilt |
| W09 Ambrosia | C VI-PLACES + I layout | Industry, fields, service roads, rail provision, rural housing | Refinery/farm kits | Distinct terrain and activities with connected travel; currently unbuilt |
| W10 Mount Kalaga | C/O VI-PLACES + I dimensions | Northern terrain, trail graph, stream/bridge, wildlife | Forest/rock/FAUNA | Road and off-road traversal, collision slopes, boat/foot boundaries; currently unbuilt |
| W11 GIS reconstruction | I fallback workflow | OSM vector/elevation pipeline, CRS and license record, editable overrides | GIS data | Import provenance, graph validation and hand-finished geometry; no import yet |
| W12 Coverage / map | A | Region status, uncertainty, waypoint/path and creative teleport index | UI map | Distinguish detailed/provisional/unbuilt without treating empty terrain as completed |

## Character and combat systems

| ID / feature | Reference / class | Implementation and dependencies | Assets | Acceptance / remaining gap |
|---|---|---|---|---|
| C01 Jason / Lucia switching | C VI-PLACES identities + V/I switching | Separate identities, persistent character health/outfit, safe transitions and camera | CHAR-JASON/LUCIA | Twenty switches on foot/in allowed vehicle states preserve state and control; rig fidelity missing |
| C02 Locomotion | V/I; direct fallback footage pending | Walk/run/sprint with acceleration, slopes, stairs and collision | Rig/locomotion clips | Real-control route includes sidewalks and doorway; no wall penetration |
| C03 Jump / crouch | V/I | Ground check, jump arc, clearance check and reduced capsule | Jump/crouch clips | Jump cannot repeat in air; uncrouching under obstacle blocked; camera consistent |
| C04 Climb / vault | I; VI secondary interview lead | Detect reachable ledge, collision-safe arc, animation root alignment | Vault/climb clips | At least low fence vault and taller climb with failed-clearance behavior |
| C05 Swim / underwater | O VI-PLACES captions + I mechanics | Water volume, buoyancy movement, shore transitions, breath/recovery rules | Swim/dive clips | Swim from shore, exit at beach, underwater camera and breath rules coherent |
| C06 Character animation | User requirement / I | Rigged blend tree, aim layers, entry/exit, hit/death; animation ownership | Skinned meshes/clips | No sliding/teleport limbs; switch walk/aim/vehicle states without bind-pose pop |
| C07 Camera collision | I | Sphere sweep toward desired camera; damping and minimum distance | None | Tight alley/interior/reverse vehicle view never penetrates structural walls |
| C08 Health / armor | V/I | Shared damage channels, armor allocation, UI, invulnerability override | UI/hit FX | Distinct armor/health effects, clear feedback and no negative values |
| C09 Death / recovery | V/I | Release vehicle/control, death state, safe recovery point, inventory rule | Death/recovery UI/clips | Repeated deaths resume controllable play without scene leaks |
| C10 Arrest / recovery | V/I | Surrender/close contact conditions, resistance cancellation, recovery penalty | Arrest clip/UI | Low-level surrender arrests fairly; recovery permits the full loop again |
| B01 Weapon select / inventory | V/I | Slot/state machine, equip/holster, ammo/reserve and wheel/menu | Weapon meshes/UI | Every supported weapon selectable through normal UI; holster stops threat signal |
| B02 Aim / fire | V/I | Camera ray and muzzle obstruction, rate limit, recoil/spread, visible firing | Aim/fire clips/audio | Crosshair target hit; nearby muzzle wall blocks shot even if camera sees past it |
| B03 Reload / ammo | V/I | Reload state and interruption rules, magazine/reserve, infinite ammo toggle | Reload clips | Empty trigger, tactical reload and death/switch interruption don't duplicate ammo |
| B04 Projectile impact | I | Swept hit query, material response, shared damage and witness event | Impact/decal/audio | Glass/metal/character outcomes differ; high-speed projectiles don't tunnel |
| B05 Melee | V/I | Short-range swing timing, contact volume, stagger and witness integration | Melee/hit clips | Hit only within reach/arc; walls stop hits; civilian reaction and crime coherent |
| B06 Cover | V/I | Valid cover surfaces, align/move/peek, aim transitions | Cover clips | Enter and exit a real low/high cover position; no bullets through solid cover |
| B07 Pickups | V/I | Spatial prompt, ammo/health/armor/weapon transfer, respawn configuration | Pickup props/UI | One pickup grants once, save/load respects state |

## Vehicle catalog and dynamics

All vehicle classes require source-aware catalog entries. An official named model and an authored class substitute are different records. Broad category existence in promotional imagery does not verify its free-roam controls.

| ID / feature | Reference / class | Implementation and dependencies | Assets | Acceptance / remaining gap |
|---|---|---|---|---|
| T01 Sedan | I baseline | Dynamic Havok chassis, suspension/tire forces, seats, component state | VEH-SEDAN | Accelerate/brake/turn/crash using physical body, no scripted transform through obstacles |
| T02 Sports car | C official catalog lead + I substitute | Different geometry/mass/power/grip/steering, not recolored sedan | VEH-SPORT | Measurably distinct acceleration and turn response; model fidelity separately reviewed |
| T03 SUV / pickup | I catalog target | Two distinct wheelbase/body/cargo profiles, ride height and rollover response | VEH-SUV/PICKUP | Cross curb and corner behavior differs; functional distinct meshes required |
| T04 Van / truck / bus | I catalog target | Three class profiles, turning clearance and larger mass/inertia | VEH-VAN/TRUCK/BUS | Fit lane network, body collisions, heavier crash response and seat rules |
| T05 Motorcycle | C VI-GALLERY title + I mechanics | Two-wheel contact, rider lean/balance, falling/recovery | VEH-MOTO/rider | Ride, corner, brake, crash, fall and re-enter; four-wheel car scaling fails |
| T06 ATV | O VI-PLACES captions + I mechanics | Short wheelbase off-road chassis, rider pose and suspension | VEH-ATV | Off-road route and rollover/recovery; distinguish from motorcycle |
| T07 Police / SWAT transport | V/I | Distinct catalog profiles, sirens, equipment, dispatch/passenger hooks | VEH-POLICE/SWAT | Officers arrive, disembark and engage; tactical transport differs from ordinary car |
| T08 Military / emergency transport | A / V-inspired fallback | Guard/service role profiles, occupants, lights and alarms | VEH-MIL/EMS/FIRE | Corresponding facility/emergency interaction; no inferred VI military escalation |
| T09 Boat | C/O official catalog/captions + I mechanics | Multiple buoyancy samples, propulsion, drag, shoreline collision | VEH-BOAT | Launch, float, steer, collide and dock through normal controls |
| T10 Personal watercraft | O official caption + I mechanics | Low hull, high agility, rider pose, water contact and fall recovery | VEH-PWC | Distinct from boat, shoreline-safe and persistent across chunks |
| T11 Airboat | O official caption + I mechanics | Shallow-water and land boundary, fan thrust, drag and seats | VEH-AIRBOAT | Traverse wetland channels and turn without deep-water hull assumptions |
| T12 Kayak | C official catalog title + I mechanics | Light hull, paddle impulses, drag and animation | VEH-KAYAK | Alternating paddle strokes translate/turn; collision and entry work |
| T13 Helicopter | O official captions + I mechanics | Rotor lift/thrust/torque, damping, cyclic/collective controls, grounded skid collision | VEH-HELI | Take off, hover, translate, land and crash physically; not noclip flight |
| T14 Fixed-wing aircraft | O official caption + I mechanics | Lift curve vs airspeed/angle, thrust/drag, stall, controls and gear contact | VEH-PLANE | Taxi, take off, fly, stall/recover, land and collide; flight cheats not acceptance |
| T15 Suspension / tire forces | I physical model | Wheel ray/shape casts, compression/damping, normal loads, friction ellipse, anti-roll | Wheel/chassis parts | Curb, braking pitch, skid and lift-off-wheel tests; record units and tuning |
| T16 Steering / drivetrain | I | Speed-sensitive steering, throttle/brake/reverse, power delivery and engine damage | Audio/steering/wheels | Stable at low/high speed and different dt presentation; controllable reverse |
| T17 Seat / passenger system | V/I | Seat transforms, occupancy, entry/exit sweeps, NPC driver handoff | Cabin/door clips | Driver plus passengers; occupied seat refusal and blocked exit fallback |
| T18 Lights / horns / sirens | V/I | Input/state/sound + AI yielding influence, nighttime lighting | Light geometry/audio | Controls work, responders signal, sound spatial; switches persist correctly |
| T19 Vehicle cameras | V/I | Chase/look-back/interior if furnished, collision avoidance | Cabin/UI | Usable during rollover/reverse/air/water; no uncontrolled spin |
| T20 Recovery / repair | A + V/I garages | Right vehicle, repair components, safe recall, customization persistence | Garage/UI | Repair tires/windows/engine visibly and functionally; geometry/collision restored |

## Damage and world interaction

| ID / feature | Reference / class | Implementation and dependencies | Assets | Acceptance / remaining gap |
|---|---|---|---|---|
| D01 Shared material damage | I | Impact/projectile/explosion/fire events, contact position/severity/material and response class | Material profiles | Same event damages eligible vehicle/character/prop consistently; static exceptions listed |
| D02 Vehicle dents | V/I | Local component deformation, bounded mesh updates and collider policy | Deformable body panels | Impact position visibly changes local geometry; color/HP changes alone fail |
| D03 Glass / lights | V/I | Break/remove relevant pane/lamp, debris and lighting failure | Glass/lamp components | Broken window changes geometry/collision; destroyed headlight stops light |
| D04 Tire damage | V/I | Per-wheel pressure/health, grip/radius/drag change, visual collapse | Tire mesh variants | Same corner with puncture has measurable handling change; repair restores it |
| D05 Detachable parts | V/I | Joint/attachment failure, independent rigid bodies, ownership transfer | Doors/bumpers/hinges | Crash detaches a component that collides independently; persistence tracks absence |
| D06 Mechanical damage | V/I | Engine/power/cooling or simplified documented power-loss model | Smoke/engine audio | Severe crash reduces propulsion or stalls; repair restores functionality |
| D07 Breakable routes | I | Fence/sign/window fracture, old collider removal, nav edge update | PROP-STREET/fragments | Player/car/NPC can pass newly opened route; no invisible fence remains |
| D08 Movable objects | I | Correct mass/friction/inertia, pushes, pickup/throw where suitable | Crates/bins/cones | Push, knock over, throw and strike with vehicle; bounded sleep/residency |
| D09 Ragdoll | V/I | Rig-to-rigid-body transition, joint limits, hit impulse and return to locomotion | Rig/physics joints | Fall/hit, settle and stand without exploding joints; generic disappearance fails |
| D10 Explosions | V/I | Distance/occlusion falloff, impulses, damage and debris | FX/audio | Cover reduces effect; moving props react; no through-wall full-strength blast |
| D11 Fire | V/I | Ignition/exposure/fuel or lifetime, bounded spread, damage, extinguishing | Fire/smoke/material FX | Ignite eligible material, spread under rules, extinguish, save/reload fire state |
| D12 Debris budgets | I | Colliding fragments, sleep and lifetime limits; disposal metrics | Debris models | Repeated destruction keeps body/mesh/memory counts bounded |
| D13 Damage persistence | I | Save component state and broken geometry by stable ID | None | Unload/reload chunk and save/reload browser; dents/tires/missing parts/routes persist |
| D14 Fast impact stability | I | Fixed physics, verified CCD/swept safeguards and collision shapes | Collision proxies | High-speed frontal/glancing/pileup/rollover tests no tunneling or NaNs |
| D15 Full soft bodies / collapse | Requested scope tracking / I | Separate research and system; not supplied by Havok rigid-body setup | Specialized geometry | **Not implemented; do not imply authored dents equal soft-body simulation or building collapse** |

## Living world, police and emergency services

| ID / feature | Reference / class | Implementation and dependencies | Assets | Acceptance / remaining gap |
|---|---|---|---|---|
| L01 Pedestrian destinations | O appearance + I AI | Individual origin/destination/activity, sidewalk routing, schedule weighting | CHAR-CIV/clips | People reach varied shops/beach/cafe/stops and later choose another route |
| L02 Pedestrian reactions | I; VI secondary lead | Threat/traffic/collision/weather perception; flee/cower/report states | Reaction clips | Visible weapon changes behavior; blocked routes reroute, no omniscient panic |
| L03 Traffic lanes | I | Road-graph trips, following distance, acceleration limits, turns | Vehicles/driver rigs | Vehicles travel multiple connected streets instead of looping decorative paths |
| L04 Intersection negotiation | I | Stop/yield/signal rules, conflicting movements, pedestrians and emergency yielding | Signal/markings | Controlled multi-vehicle scenario clears without collisions or permanent gridlock |
| L05 Obstacles / jams | I | Spatial look-ahead, braking, alternate route, bounded stuck recovery | None | Disabled car blocks lane; traffic slows/reroutes and restores flow |
| L06 Population scaling | I | Spawn budgets by district/time/weather, distance simulation tiers | Crowd/catalog | Density changes preserve existing nearby activity; far agents don't teleport into view |
| L07 Wildlife | O official captions + I AI | Habitat spawn, wander/flee/predator limits and water/land locomotion | FAUNA/VEG | Regional species use believable surfaces and react; individual rigs/behaviors missing |
| L08 Spatial ambience | I | Zone emitters, engine/step/impact/weapon/siren/weather mixing | AUDIO-* | Direction/distance audible; no runaway oscillators after repeated spawning |
| P01 Crime / witnesses | I, VI-POLICE-SECONDARY lead | Event location/type/severity, witness LOS/range, report delay, alarm events | CHAR-CIV/UI | Identical isolated vs witnessed crimes produce different reports and dispatch |
| P02 Identification | I, VI-POLICE-SECONDARY lead | Known face/outfit/vehicle/paired clues as separate data; perception updates | HUD/character/vehicles | Swap unseen vehicle helps only when valid; police cannot know the current hidden position |
| P03 Wanted profiles | V-inspired / I configurable | Data-defined star count, thresholds and composition; see profile table below | HUD | Every supported level produces distinct behavior and evidence; six-star VI claim still primary-unverified |
| P04 Dispatch | I | Delayed units from valid offscreen connected routes; unit budget | Police cars/officers | Source route traversable; police don't materialize in front of camera |
| P05 Pursuit | V/I | Officer LOS/hearing, foot/vehicle mode, last-known position and shared reports | Police rigs/cars | Pursue observed target, lose contact behind occlusion; continuous exact position knowledge fails |
| P06 Search / escape | V/I | Last-known area search, contact-loss grace, decay and cooldown | HUD/AI | Hide after LOS break, escape eventually; reacquisition returns pursuit coherently |
| P07 Interception / roadblocks | V/I | Road-graph intercept goals and safe obstacle placement | Police cars/barriers | At least two coordinated units, reachable block and alternate evasion route |
| P08 Helicopter search | V/I | Flight/LOS/search orbit, spotlight and ground-unit reports | VEH-HELI/police | Support increases exposure but cannot see through solid roofs |
| P09 SWAT deployment | V/I | Tactical dispatch, vehicle arrival, dismount and equipment profile | CHAR-RESP/VEH-SWAT | Higher profile visibly distinct tactics and equipment; repeated generic patrols fail |
| P10 Military restriction | A / V-inspired facility | Restricted volume, warning/access rules, guards/alarms and vehicles | Base/CHAR-MIL/VEH-MIL | Legal approach vs unauthorized entry differ; alarm dispatch and exit/recovery work |
| P11 Medical / fire response | V/I | Injury/fire report, dispatch, arrival, scene task and departure | CHAR-EMS/FIRE/vehicles | Responders reach incident and perform task; stationary decorative ambulance fails |

### Explicit provisional wanted defaults

This first tuning profile is **project-gta-v-inspired**, not a verified GTA V simulator and not confirmed GTA VI mechanics. A configurable VI-reported profile may add level 6 after primary verification. Score thresholds **20/50/100/170/260** and all times/counts are authored. Cap total active responder population separately.

| Level | Default composition | Distinct response | Search duration after valid loss of contact |
|---:|---|---|---:|
| 0 | Ambient patrol only | No dispatch without report/alarm | None |
| 1 | 1 patrol / 2 officers | Approach, attempt arrest at low speed | 20 s |
| 2 | 2 patrols / 4 officers | Vehicle pursuit, coordinated last-known search | 30 s |
| 3 | 3 patrols, optional helicopter | Road-graph interception; helicopter only when its actual system exists | 45 s |
| 4 | 3 patrols + tactical transport | SWAT arrival/dismount, deliberate roadblock | 60 s |
| 5 | Bounded mixed tactical response + helicopter | Multiple approach routes and wider coordinated search | 90 s |
| 6 (experimental) | Unspecified | Do not invent a military response or declare parity from current secondhand star count | Unspecified |

Until a listed responder system exists, label that level **partial**; raising speed or unit count does not implement helicopters or SWAT.

## Creative interface, activities and presentation

| ID / feature | Reference / class | Implementation and dependencies | Assets | Acceptance / remaining gap |
|---|---|---|---|---|
| A01 Spawn / remove catalog | A | Searchable vehicles/characters/weapons/props, placement validity, selection and removal | UI/catalog | Spawn and remove each supported class from normal panel; disposal and save state correct |
| A02 Locations / teleport | A | Search atlas destinations, status labels, grounded safe placement | UI/map | Teleport never traps inside geometry; unbuilt destinations visibly marked |
| A03 Time / weather | A | Sliders/presets, smooth blend, environment/audio/tire linkage | Sky/water/FX/UI | Change noon/night/rain through UI and save/load exact configuration |
| A04 Density / police setup | A | Bounded traffic/ped sliders, wanted level, response enable/composition | UI | Each setting affects real systems; unsupported settings disabled/labeled |
| A05 Cheats | A | Invulnerability, infinite ammo, flight/noclip; clear mode isolation | UI | Toggling on/off restores normal collision/damage; noclip is not aircraft/swim acceptance |
| A06 Simulation control | A | Pause, speed factor 0.25–2 and reset encounter | UI | Stable fixed-step handling at each rate; reset clears wanted without orphan entities |
| A07 Repair / recover | A | Repair selected/occupied vehicle and safe reset | UI | Restores parts and function; flip/recall uses collision-safe placement |
| A08 Sandbox save/load | A | Named/versioned configs, browser persistence, validation/error fallback | UI | Normal-panel round trip restores world diffs and settings; corrupt save handled |
| A09 Shops / garages | V/I, VI location-title leads | Pickups/purchase/repair/customization, inventory and saved changes | INT/UI/catalog | Enter, select operation, observe actual change, exit/reload; menu shell fails |
| A10 Races | V/I | Repeatable timed checkpoints, route validity, restart and result | Markers/UI/audio | Full drivable course and finish/result using normal controls; no narrative mission |
| A11 Stunts | V/I | Authored ramps/route, scoring/completion/reset, safe respawn | Ramp kit/UI | Controlled attempt, landing/failure detection and repeat attempt |
| A12 Encounters | A | Configure actors/vehicles/weapons/location/rules, reset/save | UI/catalog | Two repeatable distinct configurations; props/AI respond through normal systems |
| A13 Additional activities | O VI captions; usability inferred | Fishing, pool, mini-golf, kayaking/off-road leads indexed separately when authored | Dedicated equipment/clips | **Not implemented by background scenery; each needs controls, success/failure and restart** |
| G01 Materials / lighting | O appearance + I rendering | Consistent PBR scale, direct/environment light, shadows/reflections and exposure | MAT/lighting | Street/coast/interior day/night reference review; PBR label alone not fidelity |
| G02 Day / night | I | Sun/moon/sky progression, street/vehicle/interior lights and schedules | Lights/sky | Smooth transition without unreadable gameplay or broken shadows |
| G03 Weather | I | Rain/wetness, visibility/clouds/audio and traction; quality-independent simulation | FX/MAT/audio | Rain changes actual grip while bounded particles and visibility remain usable |
| G04 Minimap / world map | V/I | Player/vehicle/wanted/waypoint positioning, orientation and district status | UI | Accurate relative directions, reachable path and clear unbuilt-region labels |
| G05 HUD / prompts | V/I | Health/armor/ammo/speed/wanted/search/interaction state, responsive layout | UI | Readable at 1080p and smaller viewport, no overlapping panel; input actions disclosed |
| G06 Audio coverage | I | Spatial engines/tires/impacts/destruction/steps/weapons/sirens/weather/ambient | AUDIO-* | Verify each emitter through real gameplay; synthetic sources remain art gap |
| G07 Performance | User targets / I | Instrument frame times, memory/body/entity counts, actual hardware/context | Instrumentation | 60 FPS median, 30 FPS 1% low at 1080p; 30-minute traversal/pursuit memory evidence |
| G08 Independent playtest | User requirement / I | Separate reviewer, real controls plus deterministic tests, screenshots/logs | Evidence artifacts | Reviewer reproduces central loop and major failures; agent report alone not proof |

## Verification record format and continuation

### Independently observed implementation status — 2026-09-09

Evidence **N1**: [normal-control production audit JSON](evidence/audit-results-retest.json) and [review narrative/screenshots](verification-audit.md), Chrome 152 / Apple M5 Pro / WebGL2 / 1920×1080 / high. Evidence **N2**: [arrest/recovery and sandbox-assisted escape audit](evidence/audit-results-outcomes.json), same device/render configuration in a separate isolated session. Stable production snapshot served at port 4175; no repository commit existed at time of these audits. Evidence **U1**: independent `npm test` rerun, **15 passed, 0 failed**, retained in [unit output](evidence/audit-unit-results.txt) with [tested-source hashes](evidence/audit-unit-source-sha256.txt). Unit/Havok headless tests do not replace normal aircraft, police or rendering controls.

Evidence **N3**: [refreshed checkpoint audit](evidence/audit-results-checkpoint.json), same device/render configuration, full normal-control baseline plus six passing assertions for map/civilian fixes and UI-generated save comparisons. No gameplay mutation hooks used. Zero runtime exceptions/failed requests/console warnings; actual screenshot observations are documented in the [independent review](verification-audit.md). N3 supersedes earlier gaps only where stated below. U1 remains evidence for its earlier hashed test revision, not a claim that this reviewer reran every newly added test.

`Partial / verified subset` means only the described behavior is demonstrated. It does **not** mean the full acceptance criterion or reference fidelity is finished. `Implemented / unverified` identifies inspected code that still needs an appropriate real-control test. IDs not listed retain their baseline status and requirements.

| Feature ID | Current status and evidence | Verified subset | Still missing / unverified |
|---|---|---|---|
| F01 | Partial / U1 | Fixed Havok substeps produced identical recorded sedan speed/position at 30, 60 and 144 Hz render cadence in the test | Whole-world determinism, bounded catch-up and visible interpolation not fully verified |
| F02 | Partial / N1 + U1 | Real Havok WASM initialized in browser/Node, bodies settle/accelerate/collide | Full collision/disposal/streaming stress coverage |
| F03 | Implemented / not independently verified here | Capability selection exists in inspected renderer code | This reviewer did not complete a WebGPU run; parent evidence must be linked separately |
| F04 | Partial / N1 | Production WebGL2 launch, walking, driving, crash/repair, police arrival and UI round trips | Full required transport/combat/world loop on fallback |
| F05 | Implemented / unverified | Quality/audio/settings controls exist | Normal preset/reload/quality comparison not tested |
| F06 | Partial / U1 + N3 | Seeded RNG repeatability; four vehicle IDs survive normal UI save/load/save reconstruction | Complete entity identity, versioned world diffs and streamed overrides incomplete |
| F07 | Partial / source review | World has chunk-related visibility handling | Full chunk resource unload/reload, physics/nav residency and entity persistence not demonstrated |
| F08 | Partial / U1 | Rectangle LOS open/blocked/parallel cases pass | Camera/muzzle/fast body query matrix and nav changes unverified |
| F09 | Partial / N1 | Traffic and response vehicles traverse central connected roads and reach player | Rules at every turn, gridlock recovery, region crossing and lane fidelity incomplete |
| F10 | Partial / source + screenshot | Ambient people move on basic local targets with obstacle checks | Destination/service navigation, crossings and destruction updates incomplete |
| F11 | Partial / N1 + N2 + N3 | Fresh production launch succeeds; previous favicon warning absent in N3, which has no resource errors | Asset failure recovery and offline/external font behavior unverified |
| F12 | Partial / updated source | Menu now offers movement/interaction rebindings with code-based keys and swap wording | Independent normal rebinding/conflict/gameplay test missing |
| F13 | Partial / updated source | Gamepad axes, deadzones, action buttons, aim/fire triggers and disconnect handling exist | This reviewer did not exercise a real controller; menu focus and complete gamepad loop unverified |
| F14 | Partial / N1 | Pause holds simTime constant for1.5s and resumes through UI | Focus-loss and held-input regression coverage incomplete |
| W01 | Partial / N1 | Central multiple blocks, visible roads/crossings/sidewalks and working car collisions | Complete district gates and real geographic reconstruction missing |
| W02 | Partial / visual N1 | Facade modules, roof details, palms and street furnishing rendered | Repetition, flat material detail and primitive geometry fail final realistic art target |
| W03 | Partial / source | Beach/ocean/coastal assets rendered | This reviewer has not independently tested shore/swim/boat transitions |
| W04 | Implemented / unverified | Authored shop/garage geometry and location actions exist | Physical entrance/interior/service/exit loop needs normal-control evidence |
| W05–W11 | Planned / incomplete | Atlas and reference hierarchy exist | Full city expansion, five other regions, GIS imports and district completion remain unbuilt/incomplete |
| W12 | Partial / N1 + N3 | Map displays central locations/unbuilt-region caveat; Palmetto query hides every other result | Full regional coverage geometry and geographic gates missing |
| C01 | Partial / N1 + N3 | Tab changes Jason to Lucia; E hides/shows character; replacement skinned character renders | Realistic final assets, per-character inventory/health and repeated transition gates missing |
| C02 | Partial / N1 | W moves the player2.405m at stable ground height; physics capsule present | Full slopes/stairs/sprint/control matrix and locomotion quality unverified |
| C03 | Implemented / unverified | Jump/crouch capsule code exists | Actual low-clearance/air-jump tests and animation fidelity missing |
| C04 | Planned / missing | No verified climb/vault implementation | Ledge detection, motion, collisions and clips required |
| C05 | Partial / source | Simple ocean-X swimming rule exists | General water volumes, pools, underwater/breath and shore exit not verified |
| C06 | Partial / N3 visual + source | One authored skinned mesh with17bones replaces primitive assembly; clothed torso/limbs, face, hands and shoes rendered | Stylized appearance; complete realistic fidelity, blend/interaction/vehicle/hit clips and transition tests missing |
| C07 | Partial / source | Ray-based camera obstruction handling exists | Tight interior/sphere-sweep coverage and clearance reliability unverified |
| C08 | Partial / N1 | Physical crash reduced player health88.2 and UI updated; invulnerability checkbox used | Full armor/death/damage-channel tests missing |
| C09 | Implemented / unverified | Death recovery state code exists | Normal-control WASTED/death/recovery result not independently established |
| C10 | Partial / N2 | Stationary one-star response produced BUSTED, then health100/wanted0/start-position recovery and $300 penalty | Other levels, officer arrest animation and inventory/vehicle outcomes unverified |
| B01–B03 | Implemented / unverified | Weapon slots, firing, ammo and reload state code inspected | Normal combat aim/muzzle/reload/empty-ammo tests missing in this independent audit |
| B04–B05 | Partial / source | Projectile damage and melee-related gameplay code require detailed audit | Do not infer shared material or melee completeness from weapon UI |
| B06 | Planned / missing | No verified cover system | Surface detection, peeking/animation and input tests required |
| B07 | Partial / source | Supplies via location interaction exist | Physical pickup grant-once/persistence not verified |
| T01–T02 | Partial / N1 + U1 | Coupe entered/driven/crashed normally; sedan Havok test settles, steers and hits wall | Distinct named-model fidelity, full seat/handling/body component quality incomplete |
| T03 | Partial / source/N1 imagery | SUV and pickup model/tuning options and ambient instances exist | Distinct full-class controls and handling acceptance not independently tested |
| T04 | Planned / missing classes | Existing `truck` is a pickup | Van, heavy truck and bus do not become implemented through pickup naming |
| T05 | Partial / source | Motorcycle model and upright-assist dynamics exist | Rider/balance/fall/entry normal controls unverified |
| T06 | Planned / missing | No verified ATV | Separate vehicle/rider/physics work remains |
| T07 | Partial / N1 | Police cruisers physically reach and surround player | Officers/passengers/driver rigs, SWAT transports and tactics missing |
| T08 | Planned / missing | No independently verified response classes | Military, ambulance, fire and facility role behavior remain |
| T09 | Partial / U1 | Boat floated, propelled17.98m/s and was blocked by a solid shoreline proxy | Full normal-interface sea/shore/marina loop not independently tested here; reference hull fidelity incomplete |
| T10–T12 | Planned / missing | No separate verified PWC/airboat/kayak | Boat prototype does not fulfill these classes |
| T13 | Partial / U1 | Helicopter took off, translated5.23m/s and landed survivably in isolated Havok test | Normal UI controls, obstacles/pursuit/crew and final airframe fidelity unverified here |
| T14 | Partial / U1 | Trainer accelerated36.51m/s on runway and rose62.08m under aerodynamic model | Normal runway loop, landing and stall recovery remain unverified |
| T15–T16 | Partial / U1 + N1 | Friction-circle limits, static suspension equilibrium, power/damage/reverse caps, dynamic acceleration/steering | Full skid/rollover/weight-transfer behavior matrix and all class tuning not complete |
| T17 | Partial / N1 | Instant driver occupancy and exit function | Passengers, visible driver, door animation and clearance-safe exit missing |
| T18 | Partial / N1/source | Police lightbars rendered and siren calculation fixed after crash | Distinct actual light/sound/AI-yield controls and headlight behavior unverified |
| T19 | Partial / N1 | Chase camera follows driving and switches back to foot | Full vehicle-class camera/collision/cabin matrix missing |
| T20 | Partial / N1 + U1 + N3 | G repairs health; isolated recovery restores upright driving; current vehicle components round-trip normally | Garaged customization and every damaged-component repair case incomplete/unverified |
| D01 | Partial / N1/source | Crash feeds vehicle/player/witness effects | All materials and damage causes not integrated/verified |
| D02–D03 | Partial / U1 + N1 | Impact changed body vertices and disabled window mesh in test; fragments visible after real crash | Detailed localized dents, distinct pane collision openings and lamp failure matrix incomplete |
| D04 | Partial / source + N3 | Per-wheel damage alters tire scaling/grip code; tire flags now serialize and round-trip in current state | Deliberate normal puncture and damaged-tire save/load test missing here |
| D05 | Partial / N1 + source | Glass/bumper fragments detach as extra rigid bodies | Door detachment, per-part collider updates and persistent attachment state incomplete |
| D06 | Partial / U1 + N1 | Damage lowers driveForce; real crash reduces condition25%, G restores100% | Full engine/mechanical audiovisual behavior and failure cases incomplete |
| D07–D11 | Partial / source, no independent completed gate | Breakable props/explosion/fire code exists in varying scope | Normal obstruction-aware explosion, ragdoll, route breakage/nav, ignition/extinguishing matrix missing |
| D12 | Partial / source/N1 | Fragment lifetimes reduce transient body counts after collisions |30-minute stress and bounded material/audio/body allocation not established |
| D13 | Partial / N3 + updated source | Normal UI save/load/save preserves vehicle IDs/HP/panel vertices/component flags; props/custom civilians restore | All-component damage, ignition/broken-world cases, removed doors and streamed reload matrix incomplete/unverified |
| D14 | Partial / U1 |62m/s car did not cross8cm wall; maximum centerZ9.741 at wallZ12; repair/recovery resumes driving | Glancing/pileup/rollover/aircraft/prop sweeps and wider stability matrix required |
| L01–L06 | Partial / N1 + source | Ambient population/traffic visible and moving; basic threat, obstacle, signal and density logic | Coherent contextual destinations, full traffic rules, jam recovery and region/time/weather populations missing |
| L07 | Planned / missing behavior | Regional fauna reference leads exist | Actual animal rigs, habitats and simulation missing |
| L08 | Partial / N1/source | Procedural engine/impact/siren sources wired; critical NaN fixed | Complete spatial footsteps/destruction/weather/ambient library and licensing/fidelity work missing |
| P01 | Partial / U1 + N1 | Unwitnessed crime unit no-dispatch; LOS unit checks; normal crash generated report | Independent normal-control witnessed/unwitnessed pair and delayed civilian report interruption missing |
| P02 | Partial / U1 + N1 | Explicit copied last-known position and simple vehicle/character identification | Face/outfit/paired identity evidence and recognition weighting incomplete |
| P03 | Partial / U1 + N1 | Configurable maximum unit test passes; levels1/3 exercised normally | Every supported level/tactic not verified; no six-star primary VI parity claim |
| P04–P05 | Partial / N1 | Cruisers dispatch, drive toward observed position and arrive visibly | Offscreen spawn fairness, foot officers and coordinated routes incomplete |
| P06 | Partial / U1 + N1 + N2 | Search/reacquisition, one-star arrest/recovery, and search→cooldown→clear after normal map teleport observed | Continuous walking/driving escape, car-switch evasion and all-level timing matrix still unverified |
| P07–P11 | Planned / missing major scope | More generic cruisers may appear at higher stars | Coordinated roadblocks, search helicopters, SWAT, military base and emergency services not implemented to criteria |
| A01 | Partial / N1 + N3 | Sedan/crate spawn through F2; civilian visibly renders/moves at density1; load removes post-save additions | Full search/catalog/removal lifecycle and spawn placement matrix incomplete |
| A02 | Partial / N1 + N2 + N3 | Normal Sunset Customs teleport settles; Palmetto query displays only matching result | Safe grounding/interior/outside-world matrix and regional destinations missing |
| A03 | Partial / N1 | Weather Clear/Rain UI changes; RAIN survives save/load | Time transition fidelity and rain physical/audio effects need full tests |
| A04–A07 | Partial / N1/source | Wanted selection, invulnerability, repair/reset controls exercised in subset | All density/police/noclip/simulation-speed interactions not verified |
| A08 | Partial / N1 + N3 | UI save/load/save restores Rain, Lucia identity, vehicle IDs/HP/component arrays,19props and one custom civilian | Full config UI reflection, all destruction states, invalid saves, named configs and streaming incomplete/unverified |
| A09–A12 | Partial / source, unverified | Shop/garage actions and basic checkpoint race code exist | Normal service loop, completed race and distinct stunt/encounter editor acceptance missing |
| A13 | Planned / missing | Reference activities indexed | Dedicated repeatable activity systems remain |
| G01–G03 | Partial / N1 visual/source | Day lighting/materials and rain/fog presentation exist | Realistic art/sky/weather/wetness/shadow/reference gates not met |
| G04–G05 | Partial / N1 + N3 | Readable HUD/prompts/central map; search defect fixed and visually retested | Full waypoints/regional paths/backend/resolution/controller coverage missing |
| G06 | Partial / source/N1 | Procedural audio paths exist | Full required sounds and high-quality sample provenance incomplete |
| G07 | Partial / N3 | Last1800 raw frames:59.88FPS median,39.57FPS slowest1% average at1080p/WebGL2; max73.50ms; used JS heap~742MiB | Not30-minute, no full-world traversal/bounded-memory/independent WebGPU gate; concurrent browser workload |
| G08 | Partial / N1 + N2 + N3 + U1 | Independent audit caught runtime/map/civilian bugs and retested fixes; screenshots actually viewed | Full remaining scope and acceptance cannot be certified |


For each tested item append `feature ID; status; revision; device/OS/browser; backend; resolution/quality; normal-input reproduction; expected; observed; evidence path; open difference`. A screenshot validates only the visible frame. A unit test validates only its stated behavior. Preserve both where needed. Never label an entire category verified because one class works.

Required next gates are the integrated central loop, true dynamic collision/damage, witness-sensitive reporting and pursuit/search/recovery, production WASM loading, and normal-interface creative round trips. Following that, every remaining transport class, region and detailed system above still belongs to the goal. A runnable milestone does not close unbuilt geography, missing rigged assets, absent damage classes or unmeasured performance.

## 2026-09-09 second checkpoint ledger

This ledger supersedes only the named partial implementations. The full map and visual/parity acceptance criteria remain open. Every numeric behavior below is a project choice unless separately attributed.

| IDs | Current implemented/tested subset | Evidence and remaining gap |
|---|---|---|
| F01/F08 | Render interpolation with authoritative restoration; capsule overlap/sweeps; buffered physics jump input; five-step default catch-up cap | Input/interpolation/movement Havok tests. Engine accumulator is a pinned Babylon internal dependency. |
| F06/F07 | Stable creative civilian IDs, full prop vertices and per-weapon inventory; actual GPU mesh and Havok collider disposal/reconstruction | Persistence/combat/world tests and browser save/restore. CPU geometry remains resident (~58 MB); no network asset partition/loading yet. |
| F09/W05 | Expanded 508-node directed network; market, bungalow and workshop blocks contiguous west/south; A* map routes | Strong connectivity/pavement tests and five-place WebGPU visual review. This remains a small authored Vice City study. |
| F13/F14 | D-pad/stick menu focus, A/B activation/back, range/select controls; pause look gating; jump survives render frames without physics | Synthetic input tests. Physical controller and complete controller-only loop still pending. |
| Character movement | Low ledge mantle with supported landing and staged capsule sweeps; crouch headroom; visible seated player; entry blend; safe exit candidates | Real Havok controller climb, blocked exits/ceiling tests and browser driving/exit. Door opening, exit clip, cover, ladders and passengers remain incomplete. |
| Combat B01–B05 | Original hand-attached weapons, conserved per-weapon ammo, muzzle/reticle cover, physical grenade, short-range melee, recoil | Combat tests and actual mouse controls destroy a crate; grenade observed in flight and removed on detonation. Weapon wheel, ballistic penetration, full animation and broad arsenal remain open. |
| Police | Visible patrol/SWAT crews, collidable foot pursuit, compliance/resistance, bounded directed dispatch, remembered cars/faces, roadblocks and physical air observer | Real Havok escalation and normal WebGL2 compliant arrest/recovery. All numeric tuning and identity rules are authored fallback, not GTA VI specifications. Advanced tactics and military units remain incomplete. |
| Damage/destruction | Material-aware geometry damage, breakable fence/gate collision and nav removal, obstruction-snapshotted blast, bounded fire and debris, constrained ragdoll/recovery/reset | Combat Havok tests cover complete outcomes and resources. Generic model deformations, structural collapse and full soft-body physics remain distinct gaps. |
| Environment/audio | Local native rain particles, sheltered-emitter check, evolving wet grip, time-dependent sky/IBL, four nearby street lamps; bounded spatial audio/effects | Browser night/rain, Web Audio runtime and source resource budgets. No recorded dialogue/music, volumetric storm system or final acoustic fidelity. |
| Creative | Barrier/material placement, ignite/extinguish, full inventory refill/clear, stable saved settings and civilian IDs | Combined browser audit and strict malformed-save tests. Transform gizmos, undo/redo, bulk editing and complete regional state remain open. |

Detailed implementation specifications: `police-design.md`, `combat-design.md`, `movement-interaction-design.md`, `world-streaming.md`. Browser audit instrumentation is read-only during normal-control tests; targeted hook-assisted tests must be labeled separately. Earlier screenshots and failed harness attempts are retained rather than silently presented as successes.

## Third checkpoint addendum — integration remains in progress

This addendum updates the named subsets; it does not mark the broader goal or any complete region finished.

| Subset | New evidence | Current limit |
|---|---|---|
| Urban police navigation | Production-manifest/Havok tests reproduce and fix the prior oscillating foot route, test connected street turns and recover a deflected cruiser through actual reverse forces | No teleport recovery; broad live congestion and every intersection/vehicle combination remain unverified |
| Coastal Reserve annex | Four stable military guards, physical animated gate, normal E visitor access, normal walking collision/entry, armed warning and three-star alarm verified independently in WebGL2 | Creative local annex, not VI-confirmed regional military base. Guards still use stylized common body/blue trousers; detailed firearm grip and browser damage/detention coverage remain open |
| Streamed world packages | Real compressed Babylon packages and material/texture downloads, CPU geometry disposal, loaded-package diagnostics and asynchronous fast-travel preparation exist | Initial fetch receiver bug was fixed. Independent WebGL2 screenshots then exposed invalid exported indices causing missing annex scenery; exporter correction/regeneration and visual retest are underway |
| Vehicle interaction/lighting | Normal E visibly opens a coupe door, mounts and exits; L toggles light state and lamp appearance. Root's separate UI audit exercises garage paint/service | Seated feet visibly protrude below the chassis in the independent side view. Root is correcting the pose; full door/seat/class/collision visual matrix remains open |
| Licensed geographic foundation | OSM Miami Beach/Ocean Drive building and road/path data retained with source/query/license and local metric transformation | Runtime map remains authored. Dataset preparation does not fulfill reconstructed regional geography |
| Licensed detailed vehicle candidate | Debranded Car Concept GLB prepared with reproducible script, attribution, payload removal, exact bounds and CPU Babylon import verification | Not yet drivable; no GPU visual/LOD/performance, wheel/seat, damage or component adapter acceptance |

See `verification-facility-checkpoint.md`, `facility-design.md`, `geodata.md` and `car-concept-adapter.md`. Prior ledger phrases such as “no network asset partition/loading” or “door opening missing” describe the second checkpoint and are superseded only to the extent documented here.

## Detailed-car checkpoint addendum

| Subset | Verified behavior | Remaining gap |
|---|---|---|
| Aster Concept licensed vehicle | Lazy verified GLB, detailed cabin/PBR body and wheels, Havok driving, hinged and detachable components, damage lattice, compact save/load, fresh continuation and paid paint; both renderer audits pass 13 normal-control stages | No LOD derivatives or detailed ambient traffic; generic concept design, not VI identity; full hand/seat contacts remain open |
| Long-run baseline | 1805-second third-checkpoint run with zero browser errors and no transport recoveries | Performance failed: 59.52 median / 19.45 slowest-1% FPS, max stall 1026.3 ms; bounded memory unproven; see performance-stability.md |

The latest user reports aircraft staying grounded and widespread rapid respawning. These remain active defects requiring normal-interface reproduction; fixture flight tests do not dismiss them. Character and broader vehicle/world realism remain priority work.
