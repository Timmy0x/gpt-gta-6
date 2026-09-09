# Performance evidence — initial checkpoint

Reference hardware actually inspected: MacBook Pro, Apple M5 Pro (15 CPU cores, 16 GPU cores), 24 GB RAM, macOS 26.5.1. Browser automation used installed Google Chrome 152.0.7977.83 at 1920 × 1080, high graphics quality. Tests used headless browser rendering; they do not describe every user's device.

## Measurements

- WebGL2 independently reviewed short stationary/pursuit/outcome sample: median 59.88 FPS; average slowest 1% 53.02 FPS, p99 frame 17.70 ms. JavaScript heap at the endpoint was approximately 191 MiB. See `evidence/audit-results-outcomes.json`.
- WebGPU updated normal-control mixed smoke: last 1,800 frames, median 59.88 FPS, p99-equivalent 34.36 FPS, worst frame 136.1 ms, zero console errors after favicon fix. See `evidence/webgpu-smoke.json`. This original script reported reciprocal p99 under an imprecise `onePercentLow` key; the preserved result now names it `p99EquivalentFps`. The script has been corrected to retain raw frames and report average slowest 1% separately on future runs.
- Before character consolidation the startup scene had 2,074 meshes. Updated single-mesh skinned characters plus detailed props reduced the count to 1,535; visible counts vary by viewpoint. This is a geometry/count observation, not an isolated FPS improvement claim.
- Startup shader warmup can stall. The loading overlay now remains visible through eight healthy render frames (with a 20-second ceiling). Save/load rebuilds also cause measurable frame-time spikes.

Production smoke tests may overlap other browser audits and development work. These short samples have different routes, lengths and scenes; comparing them as a controlled before/after benchmark would be misleading.

## Gate status

The requested targets remain **60 FPS median and 30 FPS 1% low at 1080p**, with bounded memory during a **30-minute traversal and pursuit session**. That complete gate has **not been run or passed**. No target is lowered. Unbounded world expansion, repeated destruction/spawning, long pursuits, actual frame interpolation and real asset streaming remain to be tested.

Havok deterministic tests are separate from graphics measurements: the same controls under simulated 30, 60 and 144 Hz render cadence resulted in 299 physics steps, 17.623 m/s and Z=36.987 m in the recorded test scenario.

Next profiling should isolate one browser, retain every raw frame, measure JavaScript heap plus browser/process memory where available, traverse all completed areas, repeatedly create/remove/damage entities and save/load, and compare entity/resource counts and memory trends. A single endpoint heap number cannot demonstrate bounded memory.

## Second checkpoint functional measurements

The current world traversal record (`docs/evidence/streaming-world.json`) is a short1440×900WebGPU five-destination review, with approximately60FPS sampled at each stop. It records actual GPU mesh disposal/reload and collider disposal/reload rather than distance disable alone. Retained CPU geometry is58,206,120bytes and remains constant by design; this does not measure the whole JS/GPU heap. Traffic anchors intentionally keep collision alive away from the player.

The combined1920×1080WebGPU control audit samples approximately60FPS across driving/combat/rain/save-load. Concurrent independent browser work occurred during some samples, so no performance target result is inferred. Frame telemetry and scene counts are diagnostic only; no30-minute stability or bounded-total-memory claim is made. The final initial JS module remains about6.9MB uncompressed/1.54MB gzip plus bundled physics/shader WASM. Asset/code partitioning remains an important open loading gate.
