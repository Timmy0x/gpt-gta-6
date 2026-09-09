# Police response implementation

Status: implemented subset; focused Havok/deterministic tests pass. A normal-control WebGL2 neighborhood audit observed arriving cruisers, dismounted uniformed officers and BUSTED/recovery at all five selected levels. A fresh threat retest observed police damage during held aim, four tactical officers and a physical helicopter rising to 58.27 m, using read-only diagnostics alongside normal controls. See [the checkpoint report](verification-police-checkpoint.md) for evidence, the initial pointer-capture issue and remaining navigation/visual limitations. This does not complete the full GTA VI recreation or certify exact reference parity.

## Reference classification

The five-star scale is a **documented GTA V fallback**. The official Xbox-hosted [Grand Theft Auto V game help](https://dlassets-ssl.xboxlive.com/public/content/4f0a3089-ba2c-4f3d-9e38-102a41cbd885/GameManual/9dfeb637-1cb0-46c8-b7d7-0c58cf990494/en-GB/index.html) was opened and read on 2026-09-09: its HUD section describes one through five stars, and its police-station section describes arrest, confiscation and bail. A publication date is not displayed. Its wording does not establish our exact unit thresholds, timings, accuracy, pathfinding or numeric tuning. Those are explicitly **authored project decisions** below. This implementation does not add National Guard troops merely because that phrase appears in the manual.

The primary VI footage inspection constraints and secondary six-star/identity reports remain in [references.md](references.md). This module makes no six-star VI mechanics claim. Clothing identity, paired identification, authentic NOOSE/military tactics and real-world policing doctrine are not reproduced by these rules. There are no invented video timestamps.

## Responsibilities and integration

- `Population.ts` owns ambient traffic/civilians and preserves its existing constructor and public properties. Its `drivers` array continues to include response vehicles with `d.v` and `d.police`, so the application can exclude them from user sandbox saves.
- `police/PoliceDirector.ts` owns response dispatch, observed contact, vehicle/foot pursuit, compliance, weapons, roadblocks, air support and response cleanup. `police/rules.ts` isolates reference classification, budgets, LOS and route decisions. `police/Officer.ts` owns original uniformed Character rigs and Havok character controllers.
- Public additions are `population.officers`, `population.policeStats`, `population.hurtOfficer(officer, amount)`, `population.resist(seconds = 12)`, and nullable `population.onCharacterHit(model, impulse, fatal)`. Rig meshes, equipment and foot-controller bodies carry `metadata.officer`.
- Combat calls resistance when the player attacks and routes officer mesh/physics hits through `hurtOfficer`. Hit hooks permit shared physical ragdolls. Population pauses actor movement during `root.metadata.ragdollActive`; foot controllers are removed during the reaction and reconstructed at the settled position after recovery.
- `spawnPed(position, index?, creative = true, stableId?)` accepts a saved civilian ID as the fourth argument. Default IDs advance monotonically and avoid duplicates, including after deletion. Appearance derives from ID so save restoration does not change its color/body variant. Creative actors remain outside the ambient density cap; disabled or ragdolled civilians do not count as witnesses.
- `reset()` disposes all response rigs/controllers/vehicles/searchlight and clears wanted state. Application-owned arrest penalties, player recovery and UI remain outside this module. Officer damage notifications must distinguish player attacks from arbitrary ambient damage if future callers add that case.

## Authored response profile

| Stars | Pursuit cruisers | Tactical cruisers | Roadblock cruisers | Helicopter | Cruise target / sight |
|---|---:|---:|---:|---:|---|
| 1 | 1 | 0 | 0 | 0 |17m/s /75m |
| 2 | 2 | 0 | 0 | 0 |21m/s /90m |
| 3 | 2 | 1 | 0 | 0 |24m/s /105m |
| 4 | 3 | 1 | 1 | 1 |27m/s /115m |
| 5 | 3 | 2 | 2 | 1 |29m/s /125m |

A patrol or roadblock cruiser has one marked uniform officer. A tactical cruiser has two SWAT-marked officers with vests, helmets, longer weapons and increased health; it is still the existing cruiser model, not a completed armored SWAT transport. The air unit has a visible pilot. Maximum configured response is eight vehicles/ten crew; a hard twelve-officer budget accommodates replacement/dead actors. Spawn intervals are3.6seconds at low levels and2.8seconds at levels3–5. Configurations above five stars use the last fallback response tier without asserting VI parity.

Spawn selection uses connected lane nodes95–245m away, building clearance, separation from existing vehicles, and actual active-camera frustum samples plus building occlusion. If no admissible location exists, dispatch waits. It never places a pursuing vehicle beside the player as a fallback. Roadblock selection favors travel direction and parks the same physical cruiser across the lane with brakes engaged. Barriers can therefore be struck and moved/damaged through existing vehicle physics.

Vehicle pursuit chooses a directed road route to the last reported/seen area and applies VehicleSystem controls. Cruisers brake near a stopped suspect; officers leave only at low speed using a clear side of the vehicle. Foot routes reuse lane connectivity bidirectionally, take direct visible approaches when clear, and stop on unreachable paths. Their actual movement uses Babylon PhysicsCharacterController/Havok collision, gravity and stepping. There is no pursuit position teleport. Officers can walk back to their nearby cruiser if the suspect resumes driving. Boat/off-road suspects beyond the local road-access budget do not induce an invented cross-water foot route.

## Detection, arrest and resistance

Only real observer contact updates the last-known position. Ground observers use3D structure LOS; air observers can see over low structures but not through taller ones. Identity remembers observed cars and characters. A different vehicle masks the occupant at range; recognition of a known face in that vehicle requires a17m close approach. An unidentified incident guides responders to its reported area rather than granting global knowledge of a moved player. This is a deliberately small identity model, not clothing or paired recognition.

A compliant arrest requires a living suspect, no aiming or active resistance, speed below0.65m/s, real LOS and a foot officer within2.65m (4.3m for a stopped vehicle). After2.8continuous seconds the module calls the existing arrest callback. Moving away, aiming, attacking or losing contact resets progress. Police issue a visible stop/lower-weapon instruction. A stationary unarmed player is not automatically shot simply for selecting a higher star count.

Attacks register12seconds of resistance. Aimed/actively resisting suspects can receive visible muzzle flashes and obstruction-tested officer fire: patrol5damage/1.1seconds within32m; tactical7damage/.7seconds within48m. These are game tuning values. Structure/prop/vehicle/officer intersections block the ray; struck vehicles receive component damage. This is simple hitscan with no ballistic penetration, suppression, flank tactics, aim error simulation or independently recorded voice library.

The helicopter is spawned near ground and uses the existing Havok helicopter's rotor, force, torque and control path. Its AI requests a58m target altitude, steers toward the last-known area, and supplies observed contact/searchlight support. It has no mounted gun, rappel, terrain-aware landing planner or rescue crew. Search/cooldown timers remain in WantedSystem. Clear response retires after a bounded delay; dead distant crews are cleaned up and can be replaced. Full continuous offscreen withdrawal and advanced tactical coordination remain gaps.

## Verification and remaining work

### Urban navigation follow-up

The original browser audit exposed two concrete route failures. A production-collision Havok reproduction confirmed the roadblock officer repeatedly returned to a connector behind its position and oscillated at approximately X 68.7, Z 129–134. Foot routes now pull the computed path through the furthest obstacle-visible waypoints, preventing that backwards step on every replan. The same 65-second physical run reached (4.15, −26.24) from (68.7, 193.96), within two metres of the central suspect. No actor position was teleported.

Cruisers now advance approach/departure nodes within 3.5 m rather than 10 m, brake for the next lane turn, and require a vehicle-width clear corridor for direct final approaches. A no-progress timer also runs when a stationary vehicle forces a traffic stop. A bounded reversing maneuver reselects a visible lane connector; repeated failed recoveries stop the car and let the crew continue on foot. `tests/police-urban.test.ts` placed the responder at the observed garage location (−44.4, −52) with a stationary car ahead. It used backing controls, rejoined the road near (−75.5, −92.8), and eventually reached a useful dismount position near the suspect. An unobstructed urban corner route also completed. These tests use the exact exported world manifest colliders with Havok. They do not establish reliability under every live traffic arrangement; a normal browser retest is still required.

The authored annex now has separate guards, entry rules and an alarm; see [facility-design.md](facility-design.md). Its four actors add to, rather than replace, the city police budget. It is not the planned regional military base.

`node --import tsx --test tests/police.test.ts tests/systems.test.ts` exercises fallback budgets/compliance, obstacle routing,3D LOS, identity masking, real Havok officer movement into a solid wall, controller/rig disposal, physical cruiser approach/dismount/arrest, and high-level response. The high-level Havok case produced two tactical cruisers/four tactical officers, two collidable roadblocks and one helicopter that rose to59.03m through forces; peak counts were10officers/eight response vehicles. These are isolated deterministic/NullEngine observations, not browser screenshots or a full urban gameplay gate.

Remaining requirements include robust recovery from blocked urban routes, clear air/roadblock render evidence, occluded pursuit and car switching, officer attacks/ragdoll recovery, visible spawn fairness, automatic withdrawal, interiors/doors, tactical formations, distinct response transports, military units, voice/audio assets, realistic uniform/seat/entry animation fidelity, and sustained mixed-world performance. The authored western restricted compound and its alarm policy are separate application/world integration work; a marked fence does not by itself implement military simulation.
