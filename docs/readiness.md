# Second playable checkpoint

**Ready for further local playtesting; the full requested goal remains incomplete.** Nothing has been pushed, deployed or configured for hosting.

## Playable additions

The original coastal district now connects to an authored western market, bungalow neighborhood, southern workshops and a small explicitly creative training compound. Real GPU mesh and Havok collider residency rebuilds scenery as needed. A 508-node road graph powers traffic and user map routes.

Jason/Lucia can mantle low ledges, respect crouch headroom, blend into a visible driver seat and exit only through a capsule-clear path. Combat now has hand-attached weapons, conserved magazines, muzzle obstruction, melee, physical grenades, breakable barriers, material-aware fire/destruction and Babylon constrained ragdoll reactions. Visible patrol/SWAT crews, foot pursuit, compliance/resistance, vehicle/face memory, roadblocks and a physical observation helicopter deepen police response.

Creative controls add material/barrier placement, ignition/extinction and complete weapon refill/clear. Saves preserve armor, stable civilians, all weapon magazines/reserves, damaged prop geometry and current settings. Controller menu navigation, render interpolation, rain, night illumination and bounded spatial audio are integrated.

## Verification

- **70 tests pass**, including actual Havok movement, vehicles, officers, grenades, barrier/destruction/navigation, ragdoll recovery/reset, streaming lifecycle and resource limits; input, interpolation, routing and malformed-save tests also pass.
- TypeScript and production build pass. The large initial JS bundle still triggers a size warning.
- Combined normal-control WebGPU audit at1920×1080 verifies visible seated driving (~23m/s), service braking/safe exit, map search/road route, pistol destruction of a physics crate, grenade flight/detonation, conserved ammunition, saved barrier/civilian/inventory restoration and night rain. Both final WebGPU and WebGL2 combined audits pass eight stages with zero errors, including grenade timers while creative is open. Consult `combined-webgpu.json`, `combined-webgl.json` and their logs.
- Independent WebGL2 police audits verify physical arrival, visible dismount and compliant BUSTED/recovery at all five levels. A separate normal threat run verifies officer gunfire (health100→59.5), four tactical officers and a helicopter reaching58.27m. Initial failed mouse attempts are preserved; the first-press compatibility issue has since been fixed with pointer events. Some urban cruiser/foot routing remains rough.
- Independent WebGPU world review at1440×900 traversed five places with zero errors. Real mesh/collider disposals and reload counters changed while retained CPU geometry bytes stayed constant. This is a short functional review, not a long-run memory result.

Browser evidence is under `docs/evidence/`. Initial harness mistakes (wrong projectile field and exit attempted above the safe-speed limit) are retained. They were corrected before the passing combined audit. Unit physics tests do not substitute for normal-controls browser evidence.

## Remaining scope and risk

Only a small part of the planned Leonida map is built. The other five regions and most of Vice City remain unbuilt. Procedural assets remain visibly stylized and do not satisfy the requested final realism. Current police/tactical, weapon, melee/reload/door/passenger, swimming/water-region, service/activity and acoustic systems remain partial implementations, not GTA VI parity.

GPU/physics residency is real, but CPU geometry remains resident (~58MB for current authored records), all procedural content code loads initially, and network asset modules are not implemented. Browser localStorage is still quota-limited. The 30-minute mixed traversal/pursuit/destruction stability and memory gate has not run to completion. Short near60FPS observations cannot establish that gate or the1080p median60/slowest1%30FPS target.

Read `goal-objective.md`, `feature-index.md`, the dedicated implementation design documents and `continuation.md` before continuing. This checkpoint preserves a playable base for the full outstanding scope.
