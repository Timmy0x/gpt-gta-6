# Coastal Reserve annex — authored gameplay addition

This local training annex is an original creative addition at the exported `RESTRICTED_COMPOUND` bounds: X −548…−456 m, Z 78…198 m, east entrance near (−452, 144). It does not establish GTA VI military-base geography, units or behavior, and it does not replace the planned regional military area. The perimeter currently evaluates X/Z, without a separate radar or altitude model.

## Current behavior

`RestrictedFacility.ts` owns four stable actors (`reserve-guard-1` through `reserve-guard-4`), an animated Havok access boom and a pulsing alarm beacon. The military role uses the existing 17-bone character with olive clothing, field vest, helmet, pack, armband, carbine and MILITARY marking. These are original stylized uniforms, not replicas of a particular armed force. One guard holds the gate while three follow local patrol circuits; they are separate from the bounded city police response.

At the east gate, `canRequestAccess` exposes the interaction range. `requestAccess()` grants a 90-second visitor pass only when the player has no wanted/reporting state, has lowered their weapon and has no active resistance. The application wires this to E and the HUD prompt. A pass raises the real collision boom. It is temporary encounter state and is not serialized in sandbox saves.

Unauthorized entry gives a six-second warning. Leaving during that interval cancels it without a crime. Ignoring it, attacking a guard or attacking near the annex raises the alarm and reports 300 heat through the existing wanted system. With a clear initial record this becomes the authored three-star fallback response after the normal reporting delay. It is not a reference-derived military escalation threshold. Aiming inside revokes visitor access and starts the warning. The barrier opens for an actor already inside, allowing exit during a warning or alarm.

Guards use actual Havok character controllers, building LOS and obstacle-aware foot routes. An alarm provides an initial reported position; subsequent pursuit updates require observer contact. Outside the perimeter, city identity recognition applies. Guards remain near their local grounds rather than pursuing across the entire city. Lowered weapons, no resistance, stopped movement and nearby contact allow a three-second detention through the shared BUSTED callback. An aimed or actively resisting suspect can receive obstruction-tested carbine damage; passive trespass alone does not trigger gunfire.

Population forwards warnings, arrest and combat ragdoll hooks. The combined `population.officers` includes facility guards for physical/visual hit routing, and `hurtOfficer` delegates to the correct owner. `facility.stats` exposes phase, warning/pass time, inside status, guard counts and gate state. Guard controllers and renders deactivate outside 220 m of the bounds; stable rigs remain available for reactivation. Reset restores four guards and clears access/alarm state; `dispose()` removes their controllers, rigs, gate body and materials. Collision is synchronously prepared before active guard movement against streamed world assets.

## Verification

`tests/facility.test.ts` reads the production `public/world/manifest.json` collider definitions and uses real Havok, without rendering or replacing collision with mocks. Three behavioral cases passed:

- A walking capsule stopped at X −455.45 against the closed gate, then reached X −467.45 through the raised gate after visitor access, without wanted heat.
- Leaving during the warning produced no crime; ignoring it produced three stars and calm detention while health stayed 100.
- A guard moved more than five metres on patrol, aimed trespass revoked access and caused actual damage, hit hooks ran, and reset/reactivation retained four unique stable guard IDs. Controllers were released after leaving the active area.

The focused suite of facility, police and urban navigation tests passed 16 cases. An independent WebGL2 normal-control run subsequently confirmed closed-gate collision, visitor access, physical entry, four active patrol guards, aimed-access revocation and warning-to-three-star escalation. It also exposed missing streamed scenery and incomplete uniform/weapon appearance. A later 13-stage normal-control retest confirms restored scenery, olive trousers and actual armed-response health loss (100 → 81.1); detailed firearm grip and full visual fidelity remain open. See [the browser checkpoint](verification-facility-checkpoint.md) for screenshots, exact observations and harness limitations.

Ordinary player arrest/death recovery now clears the local encounter without healing or recreating dead guards. Explicit Reset encounter deliberately restores them. A bounded casualty ledger preserves their stable IDs and dead state through save/load; range-based reactivation does not revive them. [Casualty lifecycle](casualty-lifecycle.md) describes the distinction from nonfatal knockdowns and the physical/browser verification.

## Limits

This subset has no personnel roster, credentials inventory, military missions, armored transports, tanks, military aircraft, command hierarchy, voice recording library, interior security doors or regional base. Guard patrol and response are simple; no squad tactics, cover selection or suppression is claimed. Close-up guard/gate rendering, dynamic crowd congestion, armed vehicle entry, alert persistence across saves and sustained mixed-world performance need further validation.
