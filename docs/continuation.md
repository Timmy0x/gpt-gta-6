# Continuation checkpoint

Full goal remains active. This is an early central-neighborhood build, not full scope completion. Do not push, configure hosting or deploy before the user's later deployment decision.

## Repository and commands

The workspace and remote `https://github.com/Timmy0x/gpt-gta-6` were empty at inspection. Initialized local `main`, configured only that Git origin, installed pinned dependencies and retained lockfile. `npm test`, `npm run typecheck`, `npm run build`, `npm run dev`, `npm run preview` are the reproducible entry points.

During development the game server is at `http://127.0.0.1:5174` because an unrelated server occupied 5173. A frozen production snapshot under `/tmp/leonida-audit-build` is served at port 4175 for uninterrupted audits. Tests in `tests/browser-audit.mjs` and `tests/production-smoke.mjs` use that snapshot. Refresh it deliberately after a production build; editing source should not change an active audit.

## Current evidence

- Actual Havok behavior tests cover road suspension, acceleration, steering, solid/thin-wall collisions, deformation/glazing/debris, boat flotation/shore, helicopter ascent/descent, trainer runway takeoff, explicit recovery and identical physics outcomes under 30/60/144 Hz render cadence.
- Normal-control WebGL2 audit covers launch, walking, car entry, physical crash/damage, wanted reporting, switching, actual police arrival/reacquisition, weather save/load and pause. Independent screenshots and initial failure records are retained.
- Normal-control WebGPU production smoke covers car entry/driving/crash, repair/recovery/exit/switch, three-star pursuit, save/load, powered boat travel and helicopter takeoff.
- Initial WebGPU material warmup briefly stalls; later 1080p control tests are near 60 FPS. Raw measurements are short runs, not the required stability gate. Record actual JSON evidence rather than extrapolating.
- The two resource 404s were favicon requests. An explicit local SVG favicon fixes them; updated WebGPU smoke has zero console errors.

## Integrated corrections

Map search used `hidden` but button CSS overrode it; source now enforces `[hidden]`. Creative civilians were hidden by the ambient population budget; source now tracks explicit creative spawns separately. Both passed the final independent WebGL2 checkpoint retest. Siren NaN and lost police coordinates are fixed and retested. Detailed street props, marina-aligned boats, gamepad controls, 17-bone skinned characters and full vehicle component serialization are integrated. Both updated WebGPU smoke and independent WebGL2 checkpoint audits pass; all 29 behavior/rig/input/Havok tests and the production build pass. Read docs/readiness.md and the exact JSON records.

## Next gates, in order

1. Arrest/recovery is now verified; sandbox-assisted loss-of-contact completes search/cooldown/escape. Verify continuous driving/walking evasion next.
2. Continue loading/performance optimization and physical-device gamepad/menu verification. Missing favicon resources and both UI defects are resolved; production core paths pass on both backends.
3. Initial tested local checkpoint includes README, source/feature index and concrete evidence. Continue making tested commits; do not mark the full goal complete.
4. Deepen whole-world save/load and stable pedestrian IDs, interaction/exit safety, player/AI animation, combat/ragdoll, visible responders and tactical escalation. Keep feature status granular.
5. Acquire/create better licensed detailed assets; current procedural meshes do not meet requested final fidelity. Maintain provenance.
6. Expand adjacent finished districts following the geographic atlas, then all six planned regions with real streaming and complete content.
7. Perform isolated 30-minute traversal/pursuit/destruction profiling at 1080p, median60/1%low30 targets and bounded memory. Resolve failures rather than lowering targets.

The full source objective is copied to `docs/goal-objective.md`; read it and the feature index before continuing. Evidence of one passing loop never replaces the full map, feature, visual and stability requirements.
