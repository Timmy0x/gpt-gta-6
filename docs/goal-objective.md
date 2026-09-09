Build a substantial, polished, genuinely playable GTA VI recreation using Babylon.js and TypeScript, focused on single-player creative/free-roam gameplay. Use publicly documented GTA VI as the primary reference and documented GTA V behavior where GTA VI details are unavailable.

Use [https://github.com/Timmy0x/gpt-gta-6](https://github.com/Timmy0x/gpt-gta-6) as the project repository. Inspect it and preserve useful existing work. Make local commits at meaningful, tested checkpoints. Do not push or configure deployment yet; first produce the initial playable build, then report its readiness so we can decide deployment.

The target is a detailed, living open world with realistic characters and vehicles, physically grounded interactions, damage and destruction, pedestrians, traffic, crime detection, wanted stars, police pursuits, SWAT, military facilities, boats, helicopters, airplanes, combat, environmental simulation, and a powerful creative mode.

Exclude narrative missions and cutscenes. Include the interactions and activities that make free roaming enjoyable.

This is an implementation task. Research, specify, build, integrate, playtest, and improve the actual game. A feature list, attractive screenshot, empty city, or basic driving prototype does not complete the goal.

ENGINE AND TECHNICAL DIRECTION

Use Babylon.js and TypeScript as the browser game foundation, with Havok physics through Babylon’s Physics V2 integration.

Use WebGPU where supported and maintain a tested WebGL2 fallback. Implement capability detection and graceful quality adjustments. Core gameplay must work on both supported rendering paths.

Use Babylon’s existing rendering, animation, physics, GUI, asset-loading, and inspection tools before building custom equivalents. Implement vehicle handling, damage, destruction, world streaming, traffic, and police as dedicated game systems.

Use Vite or a similarly lightweight build tool. Keep the game deployable as a static web application on Vercel, with simulation and rendering running on the player’s device. Avoid requiring a server for core single-player gameplay.

Keep large assets modular and load them as needed. Do not require the player to download the entire map before entering the game.

Check current official documentation and compatibility before selecting dependencies:

- [https://doc.babylonjs.com/](https://doc.babylonjs.com/)
- [https://www.babylonjs.com/specifications/](https://www.babylonjs.com/specifications/)
- Official Babylon.js Physics V2 and Havok documentation.

REFERENCE RESEARCH AND FEATURE INDEX

Inspect project instructions, existing code, assets, available tools, and runtime before implementation.

Research current official Rockstar pages, trailers, screenshots, gameplay demonstrations, and published interviews. Start with:

- [https://www.rockstargames.com/VI](https://www.rockstargames.com/VI)
- [https://www.rockstargames.com/VI/only-in-leonida](https://www.rockstargames.com/VI/only-in-leonida)
- Rockstar’s official Newswire and video channels.
- Official GTA V material for identified fallbacks.

Inspect sources rather than relying on search snippets. Record URLs, publication dates, and video timestamps. Distinguish gameplay evidence from cinematic footage.

Compile a comprehensive, continuously maintained index of systems and content. Include characters, identifiable vehicle models, weapons, animations, landmarks, building types, interiors, activities, environmental details, audio, interfaces, police behavior, physics, damage, and world interactions.

For each item, record:

- Reference behavior and supporting evidence.
- Classification: confirmed GTA VI, observed GTA VI, GTA V fallback, inferred reconstruction, or creative-mode addition.
- Concrete implementation requirements and dependencies.
- Required assets.
- Acceptance criteria and verification status.
- Remaining differences from the reference.

Break broad categories into implementable features. “Vehicles implemented” is insufficient when boats, motorcycles, aircraft, damage, passengers, or distinct handling are missing.

Make implementation specifications precise: physical units, dimensions, speeds, interaction ranges, animation states, simulation rules, and configurable thresholds. When reference values are unpublished, choose explicit defaults and label them as project decisions.

Do not invent exact GTA VI specifications or claim an exhaustive inventory without evidence. Keep unavailable details visible and implement documented fallbacks while continuing independent work. Research must support implementation rather than indefinitely delay it.

DELEGATION AND INTEGRATION

Use subagents for substantial independent work throughout development, within available concurrency limits. Assign clear responsibilities, interfaces, file ownership, and acceptance criteria.

Delegate work across:

- Reference research and map reconstruction.
- World building, streaming, and environmental art.
- Character control, animation, and combat.
- Physics, vehicles, damage, and destruction.
- Pedestrians, traffic, police, and emergency services.
- Creative tools, interface, and persistence.
- Independent gameplay testing, visual review, and profiling.

The parent agent owns architecture, integration, and the complete playable experience. Keep useful implementation moving while subagents work. Integrate frequently and verify contributions in the actual game. A subagent’s completion report is not verification evidence.

GAME FOUNDATION

Build:

- Fixed-step simulation with interpolated rendering.
- Modular, data-driven gameplay systems.
- Spatial queries, vehicle navigation graphs, and pedestrian navigation.
- Streamed world chunks and distance-based simulation detail.
- Seeded generation with persistent authored overrides.
- Stable entity IDs and versioned saves.
- Browser persistence suitable for world changes and sandbox configurations.
- Reliable asset loading, error handling, and resource disposal.
- Rebindable keyboard/mouse controls and gamepad support.
- Pause, settings, loading feedback, and understandable controls.

Use Babylon instances or thin instances, LOD, compressed assets, culling, bounded AI populations, and workers where profiling justifies them. Select representations appropriate to whether objects are static, animated, interactive, or destructible.

Document the rendering backend strategy and test every supported backend. Keep physics and gameplay behavior independent of graphical quality settings.

Keep simulation sufficiently separate from rendering for deterministic behavior tests. Avoid a monolithic scene file containing the entire game.

PHYSICS, DAMAGE, AND DESTRUCTION

Implement physically grounded interactions using Havok with consistent meters, kilograms, seconds, gravity, mass, inertia, friction, restitution, forces, and impulses.

Run physics at a fixed timestep with appropriate substeps and available collision safeguards for fast-moving objects. Verify the installed physics API’s capabilities. Where necessary, use swept queries or other tested measures to prevent tunneling.

Player vehicles and nearby interactive objects must respond to physics rather than pass through collisions using scripted transforms.

Vehicles require suspension, tire grip, weight transfer, braking, steering, skidding, rollover behavior, and collision response. Boats require buoyancy, propulsion, and drag. Aircraft require lift, thrust, drag, and stall behavior. Tune these for responsive gameplay while preserving physical consistency.

Implement these vehicle-specific systems explicitly; integrating Havok alone does not provide complete vehicle simulation.

Implement a shared, material-aware damage system driven by impacts, projectiles, explosions, and fire. Impact damage should consider severity, contact location, and material response. Damage must produce visible and functional consequences.

Include:

- Localized vehicle dents or deformation.
- Broken windows and lights.
- Tire damage affecting grip and handling.
- Detachable doors, bumpers, and other appropriate components.
- Engine and mechanical damage affecting vehicle operation.
- Breakable windows, fences, signs, street furniture, crates, and other suitable props.
- Movable objects that can be pushed, knocked over, thrown, and struck by vehicles.
- Ragdoll reactions and transitions back to animation where appropriate.
- Explosion impulses with distance falloff and obstruction checks.
- Fire damage, ignition, and extinguishing behavior for appropriate objects.
- Debris with collision, sensible lifetimes, and performance budgets.
- Persistent damage across chunk unloading and save/load.

Assign every interactive object a physical material and response class: movable, breakable, deformable, or structural/static. Structural objects may resist destruction but must block movement and respond appropriately to impacts. Track exceptions explicitly.

Update collision shapes and navigation when destruction changes the environment. Broken fences must become passable; detached objects must behave independently.

Damage cannot consist only of reducing hit points, changing color, or playing particles. Demonstrate actual changes to geometry, movement, collision, or functionality.

Implement physically convincing rigid-body behavior and authored deformation. Track full soft-body simulation and large-scale structural collapse separately; do not claim them unless implemented and tested.

MAP SOURCES AND GEOGRAPHIC PLAN

Reconstruct the documented Leonida setting, including Vice City, Leonida Keys, Grassrivers, Port Gellhorn, Ambrosia, and Mount Kalaga.

Use this source hierarchy:

1. Verified GTA VI geography and landmarks.
2. Corroborated reconstruction from official footage and screenshots.
3. Real-world Miami and South Florida geography where GTA VI references are insufficient.
4. Clearly documented authored connections where neither source resolves the layout.

Use Google Maps and Street View, within their permitted uses, to inspect architecture, street proportions, vegetation, storefront patterns, and neighborhood character. Do not treat Google imagery or 3D tiles as freely reusable game assets.

Use OpenStreetMap and appropriately licensed public GIS/elevation data for importable roads, building footprints, coastlines, waterways, and terrain. Preserve source attribution and licensing information.

Use Miami and Miami Beach as urban fallback references, the Florida Keys for island environments, and the Everglades for wetland environments. Choose and document suitable references for other regions rather than forcing all of Leonida into Miami’s geography.

Treat fan maps as hypotheses requiring corroboration. Real Florida geography is useful fallback material but is not automatically GTA VI geography.

Create a reference atlas covering:

- Coastline, islands, waterways, terrain, and elevation.
- Region boundaries and transportation connections.
- Confirmed landmarks and visual references.
- Estimated positions, dimensions, and uncertainty.
- Roads, bridges, railways, airports, ports, and marinas.
- District architecture, vegetation, street character, and population.

Establish the overall geographic plan and connections before extensive local construction. Maintain a source and confidence record for every district and landmark.

Preserve realistic local street and building scale. If regional travel distances need compression, document the transformation and apply it consistently. Do not arbitrarily shrink individual streets or buildings.

CENTRAL SPAWN AND MAP EXPANSION

Choose a central Vice City location and establish a local coordinate system measured in meters. Build a compact, detailed neighborhood containing several connected blocks and the complete gameplay loop.

Expand outward through adjacent completed areas while preserving the overall geographic plan. Development order must not arbitrarily rearrange reference geography.

Convert geographic data into editable roads, intersections, sidewalks, building volumes, terrain, collision, and navigation. Geographic footprints are a foundation, not finished art.

Every completed district must include:

- Connected, drivable roads with proper intersections.
- Sidewalks, crossings, alleys, and pedestrian routes.
- Working collision and navigation.
- Appropriate terrain, architecture, and building variation.
- Detailed facades, roofs, entrances, and materials.
- Signs, markings, street furniture, lighting, vegetation, and surface detail.
- Traffic, pedestrians, ambient sound, and contextual activity.
- Functioning entrances and interiors where specified.
- Reliable streaming and persistence.

Use procedural generation to fill between authored constraints. Repeated generic blocks do not demonstrate fidelity. Landmarks and major streets need deliberate reconstruction.

Include dense urban areas, beachfront, residential neighborhoods, commercial districts, industrial areas, countryside, wetlands, islands, hills, airports, docks, and military facilities according to the reference index or explicitly labeled fallbacks.

Maintain a coverage map showing detailed, provisional, inferred, and unbuilt areas. Rendered terrain alone does not count as completed geography.

Complete the full planned map with connected transportation and appropriate regional detail. Do not silently substitute a small map and report full parity. Describe geography as an exact GTA VI reconstruction only where evidence supports that claim.

CHARACTERS AND MOVEMENT

Implement:

- Playable Jason and Lucia representations with character switching.
- Third-person movement, sprinting, jumping, crouching, climbing, and swimming.
- Responsive camera control with collision avoidance.
- Rigged characters, locomotion blending, aiming, hit reactions, and vehicle entry/exit.
- Health, armor, death, arrest, and recovery.
- Varied civilian, police, SWAT, military, and emergency-service characters.

Character appearance, clothing, proportions, animation, and interactions should follow available references. Track visual or behavioral substitutions explicitly.

VEHICLES AND TRANSPORT

Build an expandable catalog of individually researched vehicles covering:

- Cars, sports cars, SUVs, pickups, vans, trucks, and buses.
- Motorcycles and other documented small vehicles.
- Police, SWAT, military, and emergency vehicles.
- Boats and personal watercraft.
- Helicopters and fixed-wing aircraft.

Implement seats, passengers, entry/exit, lights, horns, sirens, vehicle cameras, damage, repair, and recovery.

Watercraft must launch, float, steer, collide, and interact with shorelines. Aircraft must take off, fly, land, and interact with the ground. Vehicles must remain usable across streamed world boundaries.

Different classes must feel and behave differently. Renamed or recolored copies of one model do not satisfy vehicle variety.

LIVING WORLD

Implement pedestrians with destinations and contextual activities. Give them reactions to traffic, collisions, threats, weapons, crimes, weather, and emergency services.

Traffic must follow lanes, negotiate intersections, respond to obstacles, yield where appropriate, and recover from jams. Vehicles should travel through the road network rather than orbit decorative paths.

Implement witnesses, reporting, emergency dispatch, and appropriate responder behavior. Preserve coherent nearby activity while simplifying distant simulation.

Populate each district according to its character, time of day, and conditions. Include wildlife and regional details identified in the reference index.

WANTED SYSTEM, POLICE, SWAT, AND MILITARY

Research the current documented GTA VI wanted system before fixing the number of stars or escalation rules. Use a clearly identified GTA V fallback profile where needed.

Implement:
crime → detection/reporting → dispatch → identification → pursuit → loss of contact → search → reacquisition or escape → cooldown.

Police must act on perception, reports, and last-known information rather than always knowing the player’s position.

Include:

- Distinct, configurable behavior at every wanted level.
- Patrol vehicles and officers.
- Foot and vehicle pursuits.
- Coordinated interception and roadblocks.
- Helicopter support and search behavior.
- SWAT deployment and appropriate equipment.
- Arrest, resistance, escalation, and recovery.
- Fair spawning outside immediate view, using traversable routes.

Implement restricted military facilities with guards, access rules, alarms, and appropriate vehicles. Label creative military escalation separately from verified reference behavior.

Verify that changing vehicles, breaking line of sight, hiding, and other supported evasion methods interact coherently with identification and pursuit.

COMBAT AND WORLD INTERACTIONS

Implement weapon selection, aiming, firing, reloading, ammunition, recoil, hit detection, damage, cover, and melee.

Integrate combat with the shared damage system, physics, character reactions, witnesses, and emergency response.

Include pickups, shops, garages, repair/customization, and accessible interiors.

Build repeatable free-roam activities such as races, stunt routes, and configurable encounters. Add further documented activities to the feature index and implement them progressively.

Systems must interact: a collision damages vehicles and affects nearby pedestrians; a witnessed crime can trigger a report; a report triggers police; an escape changes pursuit state; destruction changes available routes.

CREATIVE MODE

Provide a usable in-game interface to:

- Spawn and remove vehicles, characters, weapons, and props.
- Search locations and teleport.
- Change time and weather.
- Adjust pedestrian and traffic density.
- Set wanted levels and configure police response.
- Toggle invulnerability, unlimited ammunition, and flight/noclip.
- Pause or adjust simulation speed.
- Repair vehicles and reset encounters.
- Save and load sandbox configurations.

These tools must work through the normal interface and support exploration, experimentation, and testing.

GRAPHICS, AUDIO, AND INTERFACE

Target realistic proportions, detailed geometry, coherent materials, convincing animation, dense environments, and strong lighting.

Use Babylon’s PBR materials, appropriate shadows and reflections, atmospheric effects, water, vegetation, decals, and restrained post-processing. Include day/night and weather transitions.

Use a consistent art direction, material scale, exposure, and color treatment. Prioritize believable assets and lighting over excessive visual effects.

Track asset provenance and permitted use. Create or obtain usable assets and record replacements as fidelity gaps. Primitive geometry is acceptable during development but does not satisfy final character, vehicle, or landmark quality.

Establish reference viewpoints at street level, inside buildings, along the coast, and from the air. Compare daytime, nighttime, and rain captures against reference material. Maintain specific visual defects and fix them.

Implement spatial audio for engines, tires, impacts, destruction, footsteps, weapons, sirens, weather, and ambient activity.

Provide a readable minimap, world map, waypoints, wanted indicators, health, ammunition, vehicle information, and interaction prompts.

Do not claim GTA VI-level graphics merely because the scene uses PBR materials, WebGPU, or post-processing.

IMPLEMENTATION MILESTONES

First establish a complete playable loop in the central neighborhood:
spawn → walk → enter a vehicle → drive through traffic → crash and observe physical damage → commit a witnessed crime → police pursue → escape or be arrested → resume play.

Then deepen simulation and visual quality, expand contiguous districts, add transport classes and activities, and complete the feature index.

Keep a working build throughout. Make meaningful tested local checkpoints. Early milestones demonstrate progress; they do not replace the full objective.

Keep setup reproducible with a lockfile and documented development, build, and preview commands. Prepare for future GitHub-to-Vercel deployment without configuring or publishing it yet.

TESTING AND ACCEPTANCE

Test the integrated game through real player controls as well as deterministic test hooks. Test hooks must not substitute for verifying the normal interface and controls.

Cover:

- Fresh launch, loading, settings, and understandable controls.
- WebGPU initialization and WebGL2 fallback.
- Walking, swimming, driving, boating, and flying.
- Repeated character switching and vehicle entry/exit.
- Crimes with and without witnesses.
- Every supported wanted level.
- Pursuit, search, escape, and reacquisition.
- SWAT deployment and restricted-base interactions.
- Combat, death, arrest, and recovery.
- High-speed crashes, glancing impacts, pileups, skidding, and rollover.
- Glass breakage, damaged tires, detached parts, and functional vehicle damage.
- Projectile impacts, explosions behind cover, fire, and debris.
- Blocked routes and navigation changes caused by destruction.
- Damage persistence across streaming and save/load.
- Travel between every region and across streaming boundaries.
- Creative tools and save/load round trips.
- Day/night/weather transitions.
- Sustained traffic, destruction, and police activity.
- Physics stability at different rendering frame rates.
- Production builds, asset paths, and physics WASM loading.

Run relevant build, type, behavior, integration, browser, and visual checks. Fix failures before considering affected features complete.

Measure frame times and memory. Record hardware, browser, rendering backend, resolution, and quality settings.

Initial project targets are 60 FPS median and 30 FPS 1% low at 1080p on the documented reference device, with bounded memory during a 30-minute traversal and pursuit session. These are project targets, not claimed Rockstar specifications.

Profile failures and optimize. Do not silently lower targets or report unmeasured performance. Keep physics and gameplay coherent when reducing graphical detail.

Retain screenshots, test results, reproduction steps, and profiling evidence. Use a subagent to independently review the integrated gameplay, physics, and visual quality.

PERSISTENCE AND COMPLETION

Maintain durable records of sources, the feature index, architecture, asset catalog, map coverage, uncertainties, defects, verification evidence, and next actions.

Continue autonomously through routine decisions, implementation, integration, and fixes. Ask only when a missing input materially blocks progress.

Do not mark the goal complete because the game launches, a milestone passes, or a run is ending. Complete the defined map and feature scope and pass the gameplay, physics, visual, stability, and performance gates.

Do not reduce scope silently, mark placeholders as finished, or manufacture evidence of exact parity. Clearly distinguish implemented behavior, verified fidelity, approximations, and unavailable reference details.

If runtime limits or external blockers interrupt work, preserve a runnable build and an accurate continuation checkpoint. Report what remains without calling the full goal complete.

Begin now: inspect the repository, establish the initial reference index and geographic plan, delegate independent tasks, and build the central playable neighborhood while research continues.