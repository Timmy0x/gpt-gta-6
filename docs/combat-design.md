# Combat, destruction and physical reactions

Implemented 2026-09-09 against Babylon.js 9.25.0 and Havok 1.3.14. This is an original game system with project-defined tuning. Weapon details, timings, blast strengths, body masses and injury recovery are inferred reconstruction/project defaults, not verified GTA VI specifications. Reference classification remains governed by the project's reference index.

## Player-facing behavior

- Pistol, SMG and grenade have original visible geometry attached to the character's actual right-hand bone. Weapon transforms account for current skin and parent transforms. Firearms animate recoil and lower during reload; weapons hide during vehicle occupancy, mounting/traversal and death.
- Each weapon retains its own magazine and reserve. Switching cancels an unfinished reload without creating or discarding rounds. Reloading transfers only available reserve. Unlimited ammunition bypasses consumption. Existing `ammo`, `reserve`, `weapon`, `reloadTime` and `unlimited` interfaces remain available as accessors.
- Camera/reticle intent is tested first. A second ray from the actual muzzle to that point chooses the first obstruction. Both visible meshes and actual Havok bodies participate, including invisible world collision proxies. Close cover therefore stops bullets even if the offset camera sees around it. Player-owned mesh descendants and the player's character-controller body are excluded.
- `Combat.melee()` performs three short forward collision queries with a 1.7 m reach and a 0.62 s cooldown. Cover blocks the hit. Pedestrian, officer, prop and vehicle damage use the same dispatch path as bullets. Main binds the action to F and gamepad RB.
- Grenades are 0.45 kg Havok spheres with launch velocity, gravity, restitution, angular velocity and a 2.4 s fuse. Detonation occurs at the body's current position. A forward impulse sweep guards the small body against thin-wall tunneling; it does not teleport the grenade. Grenades can bounce and roll before exploding.
- An explosion resolves all target exposure before it destroys cover. The same explosion cannot hit a protected target through a gate it just broke. A later explosion can use the new opening. Queries are three-dimensional, so cover beneath the line of sight does not block an elevated blast.

## Damage, barriers and fire

`DamageSystem.spawn()` preserves its existing position/material/ID/rotation arguments and accepts an optional fifth `kind` (`street`, `fence`, `gate`). `spawnBarrier(position, kind='fence', material='wood', heading=0)` takes a ground position and is the preferred creative interface.

Street props preserve the original crate, wheeled bin and phone-kiosk geometry. Fences and gates use visible posts, rails, pickets/panels, and gate latch/hinges. Their Havok box envelope and navigation obstacle remain until destruction. Destroying a barrier removes the collider and the corresponding world obstacle, exposing the passage.

Material response lives in `combat/materials.ts`. Glass fractures readily; metal resists handgun and melee damage; wood responds strongly to impacts and fire. Nonfatal impacts displace nearby actual vertices. Destruction emits bounded physical fragments with material-appropriate thickness and mass. Fire is visible through animated emissive flame meshes and rising smoke. Wood burns; a metal bin's contents can burn while its shell receives much less heat damage; glass does not ignite. `ignite(prop, duration)` and `extinguish(prop)` expose the interaction. Rain consumes fuel five times faster. Nearby unobstructed characters receive heat damage.

`serialize()` still returns the existing prop fields and adds optional `kind` plus `vertices: number[][]`, one position array per merged visible part. Restore retains actual deformed geometry, material, health, fire, position and rotation. Legacy snapshots without the new fields restore as street props. Duplicate spawn IDs are rejected. Debris is transient, bounded and not saved.

## Character reactions

The implementation uses Babylon's existing Physics V2 `Ragdoll` with the original 17-bone skinned character. Eleven collision bodies and ten connected constraints cover pelvis, chest, head, upper/lower arms and upper/lower legs. Impulses are distributed by body mass. Physics drives bone rotations and root position; living characters settle before a short interpolation returns their captured pose to normal animation. A hit during recovery starts another physical reaction. Fatal reactions settle and then freeze the physical pose after releasing physics resources. `reactions.reset()` releases all remaining bodies and restores captured poses/animation flags, including already-settled fatal reactions, before population reset or load.

Population reports hits through `onCharacterHit(model, impulse, fatal)`. `ragdollActive` prevents locomotion/ambient animation from overriding the physical skeleton; `ragdollRecovering` identifies the return phase. Police dispose their locomotion controller during the reaction and recreate it after recovery. Fire and melee signal resistance, and officer hits call `hurtOfficer`.

Babylon sources inspected before implementation:

- [Physics V2 Ragdoll API](https://doc.babylonjs.com/typedoc/classes/BABYLON.Ragdoll)
- [Official Ragdoll implementation](https://github.com/BabylonJS/Babylon.js/blob/master/packages/dev/core/src/Physics/v2/ragdoll.ts)
- Installed `node_modules/@babylonjs/core/Physics/v2/ragdoll.js`, Physics V2 raycast/body/aggregate declarations and Havok plugin implementation.

The installed runtime accepts named bones and per-body masses even though its `RagdollBoneProperties` declaration omits those fields; a local intersection type describes the runtime-supported config. Babylon's current joint initialization does not apply the declared minimum/maximum angular values, so this implementation does not claim anatomically constrained joint limits.

## Resource ownership and verification

Budgets: 12 live grenades, 8 active ragdolls, 60 physical prop fragments, 48 short-lived combat effects, and 12 visible fires (six meshes each). Fire and projectile materials are shared. Weapon switch cleanup disposes the merged material wrapper and owned materials. Fragment owners survive until fragments expire; deleting or restoring a prop removes its fragments before disposing their shared material. Collision callbacks only queue hits/bounces; body/shape destruction happens during the subsequent system update. Ragdoll cleanup removes bodies, constraints, render synchronization and root-disposal observers.

`node --import tsx --test tests/combat.test.ts` passes 12 tests using the actual packaged Havok WASM and Babylon NullEngine:

1. Magazine conservation, weapon switching and exact reserve transfer.
2. Camera sees target while muzzle hits nearby invisible Havok cover; elevated ray clears cover.
3. Grenade upward arc, thin-wall bounce and timed detonation at its physical position.
4. Fence collision/navigation opening, glass versus metal resistance and debris expiry.
5. Explosion cover exposure captured before destruction, with a second blast using the opening.
6. Visible fire, rain/manual extinction and deformed gate vertex persistence.
7. Eleven-body constrained ragdoll fall and safe living recovery.
8. Hand-attached muzzle follows moved character; repeated switches release materials.
9. Fatal hit during recovery and disposal-observer cleanup.
10. Heavy impact breaks fence through queued collision handling; body/material counts recover on removal.
11. Public Combat fire/melee dispatch to officers, ammunition consumption, cooldown and transition hiding.
12. Reset clears active, fatal and already-settled ragdoll bodies, poses and animation flags.

TypeScript compilation passes. These tests validate physics and state, not visual quality on the browser rendering paths. Integrated normal-control WebGPU/WebGL2 playtests remain the parent integration step.

## Remaining differences

Ragdolls are bounded hit reactions rather than a full injury or procedural get-up system. Joint limits follow the available Babylon constraint implementation. Grenades are the only simulated projectile; bullets use immediate collision rays. Prop fragments are procedural boxes and fences use a solid simplified collision envelope, including gaps between visible pickets. Damage dents visible prop geometry while its collision shape remains the original box until breakage. Fire is a bounded local visual/heat effect, without fluid simulation, wind spread, dynamic flame lighting or a fire-hose tool. Weapon handling has recoil/reload feedback but does not reproduce reference-specific ballistic penetration, ammunition types or authored reload hand choreography.
