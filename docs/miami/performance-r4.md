# Miami query preparation and tile view calculations

This checkpoint follows the pushed camera and local population fixes at `b0bb9b7`. It changes presentation query storage and repeated tile view math; map coverage, source detail thresholds and physical collision readiness stay the same.

The camera reads existing position buffers with three scratch vectors and stores scalar bounds for triangle index ranges. Eligible static meshes no longer need one native Vector3 per vertex or detached render submeshes. Native finite-ray and triangle math, exact camera endpoint clearance, mutable geometry, transformed instances and supported packed/interleaved/quantized layouts remain covered by tests. Unsupported layouts use the existing native picking fallback. Cache references remain bounded and are released for disabled/disposed meshes. Other game picking can still allocate native point arrays.

The tile adapter captures camera, projection, framebuffer/viewport, group matrix and frustum state once at the start of actual core traversal. It clears that snapshot before callbacks and on all exit paths. Direct queries remain fresh. The installed 0.5.2 traversal lifecycle and 20,020 exact before/after decisions are tested without changing quality or loading policy.

In a sequential synthetic 500,000-triangle native wall workload, retained camera query preparation heap changed from 32.44 MB to 0.19 MB, and cold time changed from 62.57 ms to 26.32 ms. Warm single-ray median changed from 0.126 ms to 0.246 ms. The tile method workload over 1,000 bounds changed from 1.463 ms median to 0.222 ms. These are specific native CPU/V8 samples, not browser FPS or total process/GPU memory measurements.

A normal-controls follow-up on the preceding live build verified entry, driving and stopped exit in the licensed coupe. Native integration fixtures also cover the actual imported coupe at zero and negative ground elevations. The spawn message now uses the created vehicle's label, removing a stale generic name. These checks do not establish frame-by-frame animation quality.

See `docs/evidence/miami-performance-r4` for the frozen source manifests, reproducible profiles, independent review and integrated results. Exact whole-Miami geometry/terrain parity, street-level visual fidelity, physical/damageable equivalents of all visible objects, the full unique character/vehicle catalog, water gameplay and sustained performance remain incomplete.
