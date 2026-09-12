# Shared injury and combat checkpoint

The R6 game build connects anatomical hit detection, regional injury, physical falling, crawling, weapon handling and persistent casualties. These are authored gameplay rules, not medical simulation or a claim of GTA V/VI fidelity.

## Resulting behavior

- Hits resolve against the current animated head, torso and individual limbs, with solid world geometry competing for the nearest hit. Partial hits retain an active, impaired character instead of automatically starting a ragdoll. Torso armor protects the torso.
- Left and right leg injuries produce distinct shortened strides; torso injury guards the body and slows movement; arm injury limits aiming and slows handling. Critical survivors fall with native joint constraints and then crawl until their regional recovery permits a three-second rise. The player uses a real low capsule and cannot rise under a low obstruction.
- Serious damage persists for minutes of simulation time. Saving, loading, character switching and player recovery preserve other casualties. Fatal NPCs do not revive automatically.
- Injured occupants remain supported in moving cabins and cannot continue accelerating. Seated civilian and police casualties retain their vehicle/seat association through repeated save/load. Police equipment follows the appropriate bones through a fall.
- The combat integration includes eight weapon slots, a hold-to-select wheel, timed draw/stow/reload, facing restrictions, supported compact-weapon window fire, and sniper magnification. Three weapon meshes are licensed CC0 assets; other weapon art remains provisional.

## Exact verification cohort

Frozen source: `.local-builds/injury-game-r6-source`. Production entry: `index-BJRmjpwj.js`, SHA-256 `201705ae30ee44b6c7bbbd1d86b0cced48901d1e0d9425f8b41a0741dd1355e1`. World: `authored-860409-v8-street-objects`.

All **230 native tests pass**, including region isolation, world occlusion, low-clearance crawling, repeated physical damage, mounted injury ownership and save/load. Type checking and the production build pass. The build retains the existing large-chunk advisory; this is not a performance acceptance result.

Normal controls on WebGPU pass **22 checkpoints**, covering aimed shots to all six regions, continued critical survival, saving/loading, player fire exposure, crawling away and retained player trauma. The WebGL2 player and NPC flows pass **7** and **16 checkpoints**, respectively, with zero renderer errors or warnings. Final on-foot weapon controls pass **22 checkpoints on each backend**. The WebGPU weapon run is clean; WebGL2 reproduces twelve intermittent `glGetProgramiv` program warnings with no JavaScript errors. Its first program trace is empty and does not establish the cause. The warning remains open, and normal-input vehicle window firing still needs its final check.

The animation review combines 720 consecutive pose frames with the R9 native fall/recovery review. Its 32 physical cases evaluate 9,600 frames and 45.4 million indexed skin positions. The final R9 visual delta has 620 consecutive dual-view frames. See `body-region-injuries.md` and `ragdoll-anatomy.md` for measured limits and retained rejected cases.

## Remaining differences

The reviewed handoff permits a short body-support clearance of up to 5 cm; Lucia's reviewed release reaches 4.77 cm for five captured frames. Rigid clothing support has small transient intersections and is not cloth simulation. Flat-floor checks do not establish full uneven-terrain contact. Settled corpses retain their pose/hit regions but do not retain physical collision; the eight-active-ragdoll capacity can still freeze an airborne evicted casualty.

Supported extraction of critical/dead drivers is a separate candidate: a low concept-car release was rejected for launching the body. The existing dead-driver entry gate remains in this checkpoint. Mid-entry save normalization, complete door/limb choreography and full new-car drive-by visual review remain open.

Police/SWAT/military still use provisional responder art in this frozen cohort. The eight-skin catalog, authored uniform sourcing, real-aircraft replacement and additional branded cars are separate work in progress. This checkpoint does not finish photorealistic characters, all-object simulation, the full map or the long-session performance gate.
