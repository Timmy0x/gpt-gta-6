# Leonida — Free Roam

A local Babylon.js / TypeScript single-player open-world recreation project. The current playable area connects an authored Vice City beachfront district with a western market, bungalow neighborhood and southern workshops. This is a development build with original procedural assets, **not a finished GTA VI recreation or an exact reconstruction of Rockstar geography**.

## Run locally

Requires Node.js 22.12+ (tested with Node 24.18.0).

```sh
npm ci
npm run dev
```

Open the local URL Vite prints. Select **Enter Free Roam**, walk toward the coupe, and press **E**. For a static production check:

```sh
npm test
npm run build
npm run preview
```

Vite writes a static application to `dist/`. Havok and shader compiler WASM files are bundled locally. No server is required for gameplay. Nothing has been pushed or deployed, and hosting has not been configured.

## Controls

| Input | Action |
|---|---|
| WASD | Walk / steer and accelerate |
| Shift | Sprint / aircraft climb |
| Space | Jump / mantle low ledge / handbrake |
| C | Crouch / aircraft descend |
| E | Enter or exit a nearby vehicle / contextual interaction |
| Mouse | Look after clicking the game canvas |
| Right / left mouse | Aim / fire |
| 1, 2, 3 / R | Pistol, SMG, grenade / reload |
| F | Melee (RB on controller while on foot) |
| Tab | Switch Jason / Lucia representation |
| G / H | Repair and recover vehicle / horn |
| T | Start coastal sprint while driving |
| M / F2 | Map / creative tools |
| Escape | Pause and settings |

Standard gamepads support movement/look, A jump, Y interact, X reload, B crouch, L3 sprint/lift, LT aim, RT fire, Start map, Select creative, and D-pad up switching. Keyboard actions can be remapped in settings. Controller menus use D-pad/left stick to focus, A to activate/cycle, B to close, and left/right to adjust ranges. Physical-device validation remains pending.

Map routes and fast travel, creative spawning/materials/barriers/fire, wanted level, density, weather/time, invulnerability, ammunition, noclip, simulation speed and browser-local save/load are available in the normal interface. Visible patrol and SWAT crews can pursue, challenge, arrest or engage a resisting player; higher levels add roadblocks and physical helicopter observation. Spawn boats and aircraft from the sandbox panel and press E nearby. Helicopters need a few seconds for their rotor to spool up; use Shift to climb. Planes need runway speed before holding Shift to rotate.

## Rendering and testing

Default startup attempts WebGPU and falls back to WebGL2 if initialization fails. Append `?backend=webgl` to force the fallback. WebGL1 is not supported. Graphics quality changes resolution and shadows; physics uses the same fixed 60 Hz simulation at every quality.

`window.__leonida.snapshot()` exposes read-only runtime evidence. Add `?test` to explicitly enable development mutation hooks. Browser tests also exercise the real buttons and keyboard controls; hooks are not substitutes for those tests.

The tests in `tests/vehicles.test.ts` instantiate actual Havok physics, including suspension, wall impacts, damage geometry, boat flotation, helicopter takeoff/landing, trainer takeoff, high-speed thin-wall collision and different render cadences. Independent normal-control audit evidence is retained under `docs/evidence/`.

## Scope and records

- [Full requested objective](docs/goal-objective.md)
- [Feature index and acceptance status](docs/feature-index.md)
- [Reference sources and uncertainties](docs/references.md)
- [Geographic plan and coverage](docs/map-atlas.md)
- [Asset provenance and fidelity gaps](docs/asset-catalog.md)
- [Architecture](docs/architecture.md)
- [Independent gameplay audit](docs/verification-audit.md)
- [Continuation checkpoint](docs/continuation.md)

The five other Leonida regions remain planned. Major remaining work includes realistic licensed assets, complete character/passenger animations, advanced police tactics and military units, more activities, full regional persistence and full geography and the 30-minute performance/stability gate. World packages now load over HTTP near the player; CPU geometry, GPU meshes, shared materials and Havok colliders unload when no longer needed. Vehicles have animated detachable doors, working headlights and garage paint/repair services. The detailed licensed concept-car asset and OSM reference data are prepared but are not yet runtime vehicle/geography replacements. Short successful tests do not satisfy the full objective.

Rockstar material is used as reference. No extracted Rockstar game assets are included. Geographic dimensions and physics tuning are explicit project decisions where sources do not disclose them.

The user authorized frequent commits and pushes on 2026-09-09. Tested checkpoints are pushed to `origin/main`; hosting and deployment remain unconfigured.
