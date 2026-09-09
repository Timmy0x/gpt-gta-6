# Shared character injury system

Status: implementation and validation in progress. This is authored game behavior; the dimensions, thresholds and recovery times are not medical guidance or unpublished Rockstar specifications.

The reported defects are concrete: every weapon hit starts a ragdoll, knees and elbows can fold without useful limits, and police equipment remains attached to the upright character root. A shared health bar alone cannot distinguish these outcomes. The replacement separates regional impairment, physical falling, and locomotion. NPCs, police, guards and the playable character use the same regional rules.

## Hit location and damage

Six persistent regions are head, torso, left arm, right arm, left leg and right leg. Ray tests use spheres/capsules attached to the current animated bones, including seated and fallen poses. The nearest anatomical hit competes with the real world collision hit; walls, car bodies and furniture continue to stop shots. Empty space between limbs is a miss. An effect can carry a world impact point and direction for a localized reaction and physical impulse. Collisions and explosions without a precise ray choose the nearest affected region or apply an explicitly distributed impact.

Raw weapon damage, remaining health and regional impairment are separate values. Armor protects the covered torso; it does not absorb a shot to an exposed leg. Head and torso hits receive explicit game-balance multipliers. A light leg injury shortens the affected stride, reduces weight bearing and prevents sprinting as impairment increases. Injured arms slow weapon handling; severe impairment blocks aiming. Torso damage produces a guarded, hunched pose and slower travel. Small repeated hits accumulate in the struck region.

## State and movement

`Character.bodyInjuries` holds versioned severity and healing delay for each region, plus fall and rise timing. It is independent of the old casualty marker, so a limping survivor remains an active character. `bodyInjuryEffects` supplies the same movement and handling restrictions to player controls, pedestrian navigation and police movement.

Modes are healthy, limping, hunched, down, crawling and recovering. A critical injury starts a controlled physical fall. Once settled, a living survivor can crawl at a bounded speed while seriously impaired. A three-second rise is permitted only after the recovery threshold is met and the standing capsule has enough space. Recovery thresholds use hysteresis so the character cannot flicker between crawling and standing. Sprinting, jumping, climbing, vehicle entry and weapon handling respect the resulting capabilities.

Healing uses simulation time, with 35/90/180-second initial delays and gradual impairment reduction over minutes. It never restores a character a few seconds after a serious hit. Pausing, leaving a chunk, switching the playable character, or loading a save cannot clear injuries. Fatal casualties remain fatal; explicit sandbox resets retain their documented scope. Health restoration and regional healing are coordinated without silently changing critical injuries into healthy actors.

## Physical fall and presentation

Babylon/Havok ragdolls remain responsible for collision and impact response. Explicit knee and elbow limits prevent backward folding; hips, shoulders, spine and neck have bounded motion. Body mass, damping, local impulse and adjacent-body collision policy are reviewed with the actual skin. Police helmets, patches, labels, belts, vests and carried equipment follow their anatomical bones.

Physical falls, controlled crawling and rising must hand over without snapping the pelvis, feet or root. Ordinary locomotion does not overwrite a physical fall. Conversely, a minor hit does not create a ragdoll. The player collision capsule and camera must follow the lowered posture, with a clearance test before standing. Hit feedback is localized and brief; it must not hide broken poses behind particles or screen effects.

## Persistence and integration

Save validation accepts finite, bounded region states. Existing casualty versions retain their fatal/incapacitated meaning; the new version also saves standing partial injuries. Player injuries survive character switching. NPC regional states persist through distance culling and save/load. Damage is routed from weapons, melee, vehicle impacts, fire, explosions and police gunfire rather than through unrelated visual-only effects.

The implementation is divided between anatomical hit routing and gameplay integration, injury state and poses, and physical fall constraints/equipment binding. Car assets and the weapon-wheel checkpoint continue independently. Vehicle-entry work remains an unfinished checkpoint until its own overlap review passes.

## Acceptance

- Independent left/right leg shots produce distinct limps and measurable speed changes without an automatic collapse.
- Torso and arm damage affect movement and weapon handling; repeated regional damage accumulates.
- Severe nonfatal damage causes fall → crawl → guarded recovery; fatal damage never recovers automatically.
- Player and NPC behavior obey the same restrictions, including after save/load, switching and chunk round trips.
- Every rendered frame of representative falls, limps, crawls and rises is captured for Jason, Lucia, civilians and equipped police. Check bone lengths, one-way joints, foot/ground clearance, accessory attachment and handoff continuity.
- Actual keyboard/mouse weapon hits and movement verify these outcomes on WebGPU and WebGL2. Test hooks and isolated rigs are supplementary evidence, not substitutes for the normal game.
- Ragdoll budgets, resident skin counts and disposal remain bounded. The separate long-run performance gate still requires a passing benchmark.

No part of this document claims that the full character fidelity target has already been achieved.
