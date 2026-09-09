# Civilian traffic occupancy and carjacking

The previous traffic controller moved empty cars. Successful E entry removed its `Driver` record immediately; there was no person to eject or react. Civilian traffic now carries a visible, hittable Pedestrian in the model's authored driver seat. A successful theft retains that actor and transfers it to the existing fleeing behavior instead of disposing it.

## Current behavior

- A person in a traffic lane causes approaching civilian traffic to brake. Civilian drivers resume their route when clear and can accelerate away after nearby frightening events.
- Approach a slow car from its left driver door and press E. The player approaches the door, the seated driver moves out, and the player bends into the seat. The transfer takes about 1.8 seconds. Empty-vehicle entry takes about one second.
- The original driver remains a Pedestrian with the same ID, model and hit metadata. After ejection it flees and reports the theft. Traffic AI releases that vehicle only after the ejection.
- Exit opens the door and bends the player out over 0.65 seconds. Existing capsule and swept-path queries choose a safe door/rear exit and are checked again before returning control. An obstruction appearing during dismount returns the player to the seat.
- `Vehicle.controlLocked` forces parked inputs during these transitions, even if W, reverse, steering or aircraft lift is held. The player gets normal driving controls after the seat is attached; leaving the vehicle clears all powered inputs.
- Seats and seating poses are shared by player and traffic. Detailed-car and aircraft-specific seat coordinates remain authoritative. Driver models use world-coordinate positions and vehicle rotation, so existing combat/ragdoll systems can own an injured actor without a moving vehicle parent. They share the existing twelve-character detailed civilian budget; nearby drivers participate in the same distance-based skin selection.

## Reference and limits

This is an authored GTA V-style fallback, not a claim that these exact timings, poses or restrictions are confirmed GTA VI behavior. Rockstar's [GTA V game manual](https://dlassets-ssl.xboxlive.com/public/content/4f0a3089-ba2c-4f3d-9e38-102a41cbd885/GameManual/9dfeb637-1cb0-46c8-b7d7-0c58cf990494/en-GB/index.html) documents the Enter/Exit Vehicle action. Rockstar's [GTA Online starter tips](https://www.rockstargames.com/newswire/article/o349k5525534k7/gta-online-starter-tips) discuss stealing street vehicles and quicker entry through a broken window. Those sources establish the reference interaction, not this implementation's animation detail.

Animation is presently a procedural skinned mount/dismount and lateral driver withdrawal. It is not a captured two-person grapple, handle IK or a complete passenger-seat system. Occupied-car entry from the passenger side asks the player to approach the driver door. Carjacking an incapacitated driver is currently rejected. The existing police crew controller is separate; this change covers civilian road traffic.

The road-car compound collision had missing proxies for protruding wheels and opened doors. Component collision expansion is a separate coordinated change; occupancy itself does not solve those mesh/shape gaps.

## Verification

`node --import tsx --test tests/vehicle-occupancy.test.ts tests/movement.test.ts tests/aircraft-seating.test.ts`

The CPU tests cover actual Havok traffic movement; visible driver registration; identity preservation and fleeing; locked held-throttle input; delayed entry/ejection/exit; blocked-driver-door refusal; opposite-door exit; fully blocked exit; and the existing licensed Jason/Lucia aircraft cockpit fit checks. These are not GPU or visual results.

`tests/vehicle-occupancy-audit.mjs` uses normal UI and keyboard actions, with read-only scene telemetry to walk to a slow traffic vehicle and inspect phase/actor state. It first observes moving traffic, uses the normal Sandbox density slider to stop traffic during the walk, restores full density before pressing E, and then steals, drives and exits the car. It does not teleport, spawn or alter a gameplay state through test hooks.

The frozen `interactions-v10` build passed all 16 checkpoints on both WebGPU and WebGL2 in Chrome 152 at 1600 × 900 on 9 September 2026. The WebGPU run stole a sedan and moved it 22.15 m after the character switch; its original driver remained alive and fled another 3.90 m between the seated and final captures. The WebGL2 run stole the detailed concept car, moved it 33.57 m, and retained the original driver who fled another 18.69 m. Both runs changed from Jason to Lucia while seated and finished on foot.

For each backend a read-only physics observer recorded 19 approach, 52 driver-ejection, 39 entry and 38 exit samples; every transition sample retained the parked inputs and control lock, including held W. Console warnings and errors were zero in both runs. Visually inspected screenshots show the opened door, separate former driver, seated player and final on-foot position. The sliding withdrawal and simplified entry pose remain visible fidelity gaps; these results establish the interaction and identity handoff, not a finished two-person grapple animation.

Evidence is under `docs/evidence/vehicle-occupancy-v10-webgpu/` and `docs/evidence/vehicle-occupancy-v10-webgl/`. The frozen entry is `/assets/index-DSBrBJ_2.js`, SHA-256 `e95167f3234ae901af6966d2bccf8dfa386d340f3474ca60f14533750caaec65`, using `authored-860409-v6-dry-sand`. This verifies the interaction checkpoint before the separate exterior collision and coast changes.

The first WebGPU attempt completed dismount while a screenshot was being captured, then the old harness tried reading `player.vehicle.input` after the vehicle reference was already null. `failed-exit-harness.json` and `harness-exit-completed.png` preserve that failure. The audit now holds W immediately after E, samples transition inputs on actual physics steps, and reads the departed vehicle by its stable ID. No runtime behavior was changed to resolve this test timing defect. These short functional runs do not establish a frame-rate or long-session performance result.
