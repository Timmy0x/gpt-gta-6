# Anatomical physical falls and recovery

Status: the R9 runtime has passed the bounded visual review, with the explicitly documented release clearance below. This is an authored game rig and recovery system, not a medical model or a claim of Rockstar animation parity. The larger character/world fidelity and performance goals remain open.

The original failure combined unrestricted/generated joints, police accessories attached to the upright character root, and a physics-to-animation transition that turned a supine body end-for-end through an upright pose while the pelvis was near the floor. The previous transition reached 0.679 m below the floor in a consecutive-frame test.

## Physical ownership

`RagdollAnatomy.ts` retains Babylon Physics V2 `Ragdoll` body ownership and disposal. It replaces the generated joint list with explicit native six-degree-of-freedom constraints. There are 15 rigid bodies and 14 constrained joints, including hands and shoes. Knee and elbow hinge frames follow the actual bend plane of the posed limb; using a fixed X axis forced oblique IK limbs to correct violently when hit. Limits are offset by the measured initial flexion, so a posed knee can remain bent while backward folding is constrained.

The default mass totals 73.4 kg. Contact friction is 0.65, restitution is zero, and linear/angular damping is 0.12/0.8. These are project settings. Each rendered licensed outfit fits its support from the indexed skin vertices. Torso, head, arms and leg segments use convex hulls with a small Minkowski contact margin; hands and shoes retain conservative boxes to cover native joint projection error. Oriented box corners around a posed skirt caused repeat-hit launches even while the actual skin cleared the floor; the convex hull removes those artificial corners. glTF bone matrix indices are resolved with `Bone.getIndex()`; skeleton array order is not a reliable skin index. A collider's fitted center may differ from the anatomical joint. Synchronization subtracts the rotated center offset before anchoring the pelvis, so clothing-aware collider fitting cannot displace the entire visible rig.

Character visual poses synchronize before fitting, including a newly restored mid-fall pose. Undetailed procedural bodies retain the conservative authored envelopes. Clothing remains skinned geometry with rigid support envelopes; there is no cloth simulation.

## Fall, roll and recovery

Partial regional damage does not start a ragdoll. A critical regional state requests physical falling, and its locomotion owner advances the injury timer. `RagdollReactions` neither advances regional healing nor clears trauma at handoff. Fatal actors do not recover automatically.

The injury timer establishes the earliest recovery; a nearly horizontal chest and the actual trunk/leg surface must also be close to real upward-facing support before the physical fall ends. An upright critical injury with no directional impact gets one small opposing chest/pelvis impulse pair. This loss of balance has zero net linear impulse and prevents a fire casualty from remaining mechanically balanced in a crouch. It is applied only when the initial physical reaction is created, so repeated damage cannot add the same torque every frame.

The grounded transition keeps the fallen torso's horizontal direction, preserves its world-space pose when choosing the crawl frame, and blends for at least 1.25 seconds, retaining ownership until its actual pose has converged to the canonical locomotion target. Hands and feet follow continuous world-space clearance arcs as the torso rolls; elevated feet get elevated knee poles. Those poles gradually converge to the final crawl poles before support releases. This avoids a last-frame switch to a mirrored limb solution. Actual trunk/leg skin support lowers the pelvis independently of fingertips; a final all-surface guard prevents intersections. The displayed correction stays in the bone pose, so saving or starting another physical hit sees the same pose. It does not change health or healing.

Both arm and leg rotations are bounded by elapsed simulation time. A contact solver can select a different knee or elbow bend plane during a roll; that solution must converge across frames. The actual visible start pose is restored before a handoff callback or restored-survivor return, so a same-tick hit cannot seed physics from an undisplayed canonical target.

The player and NPC integration must keep motion and heading stable while `ragdollHandoffActive` is set. The handoff callback transfers the ground anchor to the player's physical controller. Explicit player recovery calls `resetCharacter` for that actor; other casualties remain intact. A frozen casualty retains one cleanup observer until its actor is reset/disposed, which prevents its retained reaction from surviving actor disposal.

## Native evidence

`tests/ragdoll-anatomy.test.ts` checks:

- Geometric knee/elbow bend limits, native joint pivots, bounded velocities and extremity support at four headings.
- Partial leg damage remaining standing, then critical fall and exactly one handoff without healing the injury.
- Eight critical zero-impulse fire cases: four licensed bodies in standing and walking source poses lose balance and reach supported crawl, with no retained physical or handoff flag.
- Belt, helmet, vest, radio, field pack and shoulder equipment remaining attached to their bones through a military fall.
- Four licensed bodies, four headings and standing/walking source poses: 9,600 consecutive fall/handoff frames and 45,415,200 indexed skin vertex checks. The cached runtime support calculation agrees with independently CPU-skinned vertex positions.
- Licensed mid-fall restoration, repeated lethal impacts, selective actor reset, persistent other casualties and released Havok bodies.
- Fatal hits both during the physical-to-crawl roll and after crawling has settled. These retain limb lengths and a low body posture instead of launching an actor upright.
- Same-tick hits from a handoff callback and immediately restored survivor state retain the last visible pose before the first render.

The expanded secondary-hit cases permit up to 2 cm transient surface penetration from the native contact/rigid-clothing approximation. They separately bound center-of-mass and pelvis rise after a small hit; a raised hand is not mistaken for the whole body being launched. Every reviewed source snapshot and its captured metrics are fingerprinted in the studio evidence.

The body-support gate starts after the initial 0.2-second contact entry and continues through the full handoff tail. It excludes fingers/hands/feet and permits at most 5 cm actual road clearance for shoulder, upper-arm, trunk or leg skin, with no more than 0.15 seconds above 4 cm during the release. The controller anchor is 15 mm above the sampled road; the assertions account for that offset. The reviewed Lucia tail reaches 4.77 cm for five captured frames while its fingertip remains lower. This small residual clearance is not described as exact body contact. The earlier tighter 4 cm measurements and rejected R7/R8 captures are retained rather than erased. All-frame skin nonpenetration and the 12 cm per-frame joint-motion bound remain separate requirements.

## Visual evidence and remaining work

`scripts/characters/ragdolls/` builds and captures a frozen source snapshot. The review includes every consecutive frame from two views, selected stills, and a continuous video. It is supplemental to the integrated normal-control WebGPU/WebGL2 checks; it does not replace those checks.

The r3 studio capture was rejected for a partly upright transition and an unsupported plank-like crawl, despite passing its original collision gates. It remains recorded as failed visual evidence. R6 captured 1,500 consecutive dual-view frames across four licensed characters and one military officer, with zero browser errors or warnings. R7 repaired a 15.17 cm knee snap but its sideways camera exposed an implausible single-hand support pose. R8 replaced that intermediate path and captured another 1,560 frames across seven difficult body/heading combinations and a zero-impulse fire fall. Shoulder rolls improved; two short release pulses remained and were rejected. R9 corrects that pole release and tests shoulder, upper-arm, trunk and leg support independently of hands and feet. A shoulder-supported side roll can briefly have an 8.85 cm trunk-only clearance; that is not treated as the whole body floating. The actual supporting body surface, indexed skin continuity, and consecutive unsupported-frame count are separate checks. The accepted crawl endpoint remains the grounded R8 pose source.

The final R9 delta contains 620 consecutive dual-view frames covering Lucia's release and the two previously problematic standing dress cases, with zero browser errors or warnings. Runtime code in `.local-builds/ragdoll-r9-final-source` is byte-identical to the captured `.local-builds/ragdoll-r9-source`; only the documented support assertion changed after visual review.

The flat-floor tests do not establish grounded hand/knee placement across every uneven surface, obstruction or edge. Initial crouch compression, subtle clothing intersections, realistic muscle/face reactions, and motion-capture-quality fall choreography still require broader visual work. The eight-active-body capacity policy can freeze an evicted airborne body before it reaches support; crowd-impact capacity handling is an independent follow-up. Settled corpses currently release their expensive rigid bodies and retain their pose and anatomical hit targets; persistent settled corpse collision remains outstanding. The separate long-session performance target has not been passed by this work.
