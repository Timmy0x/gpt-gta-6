# Anatomical injury poses and contact correction

This is the authored animation portion of the shared player/NPC injury system. The regional damage state and native physical fall are separate systems. The timings and motion targets are project choices, not measured GTA V/VI animation data.

## Behavior

- A left or right leg wound shortens that leg's stride, reduces foot lift and transfers the pelvis toward the supporting side. Opposite wounds produce mirrored poses.
- Torso wounds bend the spine forward and keep the arms near the ribs. Arm wounds guard the affected side.
- Critical survivors keep their trunk near the ground, reach with one arm and advance the opposite knee outward. Palms face the floor; knees bend toward their intended pole instead of flipping backward.
- The same skeleton lowers into the authored recovery target and rises over the injury system's full three-second recovery interval. No bone translation is scaled or stretched.
- Injured occupants use `Character.applySeatedInjuryPose` after the seated base pose. The upper body slumps/guards while the pelvis and legs stay in the seat. Critical injury never selects a crawl pose inside a car.
- Low/reclined driving poses plant shoes within the existing cabin's pedal space instead of bending the calves through its floor.

## Contact details

`CharacterContactIK` uses Babylon's two-bone solver with optional world-space elbow/knee poles. The solver operates on helper bones and transfers rotations to the gameplay skeleton while preserving its segment lengths. Left/right palm orientations include the different roll needed to turn inward-facing relaxed palms down toward the floor.

`InjuryPose` checks an anatomical envelope during lowering and rising, then uses `CharacterSkinSupport` for the exact indexed visible surface. Cached bind positions and skin matrices avoid allocating a full CPU-skinned mesh. During prone support this exact clothing query replaces the coarse joint envelope, which previously held the whole torso too high. The pelvis receives any required lift and the hands are replanted afterward. Targets and correction weights vary continuously during lowering and rising.

The crawl requests a pelvis height of 0.135 m before outfit clearance, wrists at 0.080 m and trailing ankles at 0.160 m above the actor's local ground plane. The trunk lies nearly horizontal; one knee advances outward while the opposite arm reaches. The prone ankle uses +0.25 rad local plantarflexion. Shoes can lift while the trunk and legs support the body. The solver preserves limb reach, and exact visible clearance varies with each licensed outfit.

## Verification

`tests/injury-pose.test.ts` evaluates actual indexed skinned vertices, not joint positions alone, for Jason, Lucia and two licensed civilian bodies. It checks left/right leg, torso, left/right arm and head wounds, every consecutive 60 Hz lowering/crawling frame, all 180 recovery frames, and idle critical poses at twelve phases for every body region. It also checks unchanged limb lengths, finite bone matrices, separated knees, mirrored limp direction and guarded torso posture.

Current result: **18,771,616 indexed vertex checks passed**; minimum visible surface height **+0.00600 m**; maximum standing extent **1.84789 m**. Crawl planted hand/finger gap is at most **0.01306 m**, active hand/finger stroke gap **0.05355 m**, and foot/toe gap **0.08780 m**. The trunk/leg surface stays within **0.02380 m** of the floor in every crawl frame, excluding hands and feet from that measure. Maximum consecutive crawl-joint movement is **0.06435 m per 60 Hz frame**. The loose civilian clothing is included.

`tests/character-assets.test.ts` and `tests/characters.test.ts` verify both existing low/reclined cabin bounds with licensed and fallback skins. The critical seated overlay preserves pelvis/leg matrices exactly and keeps the whole visible skin above the floor and below the roof.

The R8 source fingerprint, skin-test log and selected images are in `docs/evidence/body-injury-poses-r8`. The studio captured every one of 720 consecutive side-view frames plus 28 overview frames and twelve closeups, with zero browser errors or warnings. Dense frames remain in `.local-builds/body-injury-r8-frames`. R6/R7 side views exposed a hovering trunk despite acceptable fingertip gaps and were rejected. The new body-support assertion prevents that false pass. Earlier R3/R4 results remain rejected evidence of vertical palms and garment penetration.

## Remaining verification and fidelity limits

The studio is a flat-ground authored-pose review. Normal gameplay controls, native fall impulses, ragdoll-to-animation handoff, injuries in traffic, save/load and both rendering backends require the integrated game audit. Uneven terrain and obstacles under individual limbs still need terrain-specific contact sampling. The measured hand/finger minimum is not a full flat palm contact patch. Finger articulation and cloth deformation remain limited by the current driver rig and source assets. These assets are licensed generic people, not exact Jason/Lucia likenesses or a claim of GTA VI-level character fidelity.
