# Aircraft controls on the detailed-street checkpoint

Verified on 9 September 2026 against the frozen `.local-builds/metre-uv-v5` build served on port 5174, after the optimized starter/traffic cars, detailed player models, metre-scale road textures, and aircraft exit input reset were integrated.

Both aircraft took off, returned to the ground, and allowed normal `E` exit on both rendering paths. All four fresh UI-spawned aircraft started at 100 health. No runtime or physics edits were needed for this verification.

| Renderer | Aircraft | Time until body centre exceeded 8 m | Highest recorded body centre | Health after landing | Normal exit with throttle held |
| --- | --- | ---: | ---: | ---: | --- |
| WebGPU | Mistral Helicopter | 3.93 s | 9.53 m | 97.44 | Passed |
| WebGPU | Pelican Trainer | 12.97 s | 13.01 m | 100.00 | Passed |
| WebGL2 | Mistral Helicopter | 4.08 s | 10.19 m | 96.39 | Passed |
| WebGL2 | Pelican Trainer | 12.89 s | 12.26 m | 98.32 | Passed |

Plane times include runway acceleration. Heights are world-space body-centre values over the flat test area. Continuous helicopter `C` descent causes a small landing impact; this check does not claim a zero-impact landing. All aircraft stopped below 1.5 m/s horizontal speed before exit. Every exit cleared throttle, steer, and lift to zero, set brake to one, and cleared the occupied flag even though `W` was held when `E` was pressed. Browser page errors and assertion failures: zero.

## Method and reproduction

The new [audit harness](../tests/aircraft-current-street-audit.mjs) starts a fresh game for each aircraft, opens the normal Creative interface, selects the aircraft, presses Spawn, closes the interface, and enters using `E`. It uses the visible flight controls:

- Helicopter: hold `Space` to rise, release it, then hold `C` to descend and land.
- Plane: hold `W` to accelerate, add `Space` after reaching 25 m/s, then use keyboard throttle/elevator adjustments and `S` braking to land.
- At rest: hold `W`, press `E`, release `W`, and inspect the abandoned aircraft's input state.

Landing the plane uses a read-only telemetry feedback loop to choose ordinary keyboard inputs. The harness does not write game state, set aircraft transforms, change physics values, or use teleport hooks. It tests this short takeoff/landing route, not every flight manoeuvre, airfield, or weather condition. Separate fresh read-only engine probes immediately afterward confirmed actual engine names `WebGPU` and `WebGL2`; those probes are included in the result JSON. The reusable harness now also checks the actual renderer during entry.

```sh
AUDIT_BACKEND=webgpu node tests/aircraft-current-street-audit.mjs
AUDIT_BACKEND=webgl node tests/aircraft-current-street-audit.mjs
```

The server must serve the stated frozen build. The harness defaults to `http://127.0.0.1:5174` and rejects a different world build identifier.

## Fingerprint and evidence

- Main script: `/assets/index-DmvLSStP.js`
- Main-script SHA-256: `0aee98c6fa62e720e6ab663cdc5f3ccdf2821c722deeb8bd61b1dead2d6ee16d`
- World build: `authored-860409-v4-metre-uv`
- [WebGPU result and raw telemetry](evidence/aircraft-controls-metre-uv-v5-webgpu/result.json)
- [WebGL2 result and raw telemetry](evidence/aircraft-controls-metre-uv-v5-webgl/result.json)
- [WebGPU helicopter in flight](evidence/aircraft-controls-metre-uv-v5-webgpu/helicopter-airborne.png)
- [WebGPU plane in flight](evidence/aircraft-controls-metre-uv-v5-webgpu/plane-airborne.png)
- [WebGL2 helicopter after landing and exit](evidence/aircraft-controls-metre-uv-v5-webgl/helicopter-exited.png)
- [WebGL2 plane after landing and exit](evidence/aircraft-controls-metre-uv-v5-webgl/plane-exited.png)

Each renderer folder also contains spawn, airborne, landed and exited captures for both aircraft. The two flight images were visually inspected. The aircraft models remain simplified authored substitutes, and the plane capture shows the character's head/upper body protruding through the cockpit area. These remain visual fidelity defects; successful flight controls do not resolve aircraft model or seating quality.
