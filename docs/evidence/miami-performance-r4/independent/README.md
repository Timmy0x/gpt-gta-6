# Independent R4 review

Read-only runtime review of `.local-builds/miami-performance-r4-source` against accepted R3 `b0bb9b71c920a3fd855e03189d1a9999cb9519c2`. No agent-owned runtime/tests, root Git files, browser, server or provider content were changed by this reviewer. All review fixtures use synthetic native geometry and synthetic tile bounds.

No confirmed correctness blocker found. Runtime hashes after verification matched the owners' frozen handoff:

- `src/core/CameraMeshQueries.ts`: `a1e9713dc6fd21a76f0ff5925040d634ecdef3a938ec7fc3f5a12fdc1fa4f3eb`
- `src/world/miami/visuals/LHTilesRenderer.ts`: `6ffeed370305f1ab486a10e5ff39ebcc1856765a92071d7f088af7ed0aeb2cab`
- `tests/miami-tile-view.test.ts`: `1f13d96a4b34a8a8451a8918a73fcc2a6152e5510d30c984252dc81f1336712e`
- `tests/fixtures/miami-tile-view.ts`: `9886da328f75df9d12f25311949c3dcf906104735d577f297ddbedec29015dfc`

## Native correctness evidence

`camera-semantics.test.ts`: 10/10 pass. Native Babylon9.25.0 ray oracle, signed/nonuniform scale and affine shear finite lengths/two-sided hits; ordinary instanced geometry; native indexed/nonindexed submesh selection; ordering across submeshes; interleaved Float32 storage with both vertex and typed-view offsets; normalized Int16 storage; active position/index/buffer mutation; native morphology/skeleton/triangle-strip fallback; thin instances; off-center2cm endpoint blocker; native Havok body and original render-buffer/submesh/material preservation. Eligible cases explicitly check that optimized queries do not produce Geometry's native `Vector3[]` point cache. Oracle distance tolerance is10µm absolute or1e-5 relative because native Float32 inverse/world composition gives micrometre rounding under nonuniform transforms.

`tile-view-lifecycle.test.ts`: 3/3 pass. Uses the imported accepted R3 application renderer as its oracle, not a duplicated formula. Real 3d-tiles-renderer0.5.2 core visits3,096 root/child bounds across24 states: replacement cameras, camera/tile parents, rigid reflected tile placement, perspective/orthographic/frozen projections, framebuffer options, hardware scaling, and viewport changes. Exact equality for distance/error/visibility. Also exercises real before/after callbacks, plugin-skipped and rootless updates, a traversal exception, direct/manual-prepare queries, and callback invalidation. Stable65-query update captures one native frustum.

## Matched full resolver profile

`dense-resolver-profile.ts/json`: synthetic500,000-triangle vertical wall with251,001vertices; full resolver includes five boom rays plus exact endpoint clearance.80 warm samples per run, sequential reversed order. Accepted R3 cold78.34/51.29ms; R4 cold31.94/33.49ms. Accepted R3 warm medians4.59/4.29ms and p95 6.01/5.80ms; R4 medians3.94/4.20ms and p95 4.62/5.12ms. R4 creates zero native point objects versus R3's251,001, and preserves original render parts/buffers and resolved camera position.

These are Node22/NullEngine CPU measurements on the current machine, not live browser FPS, GPU cost, or provider-tile measurements. Warm timings are close and context-dependent; the strong measured result is lower cold cost and elimination of the retained native point cache for eligible geometry. Unsupported morphology keeps Babylon's native fallback. Arbitrary direct camera mutation inside third-party per-tile plugins without dispatching an event is outside the current snapshot contract; no installed game callback does this. Overall live game/source geometry quality remains outside this bounded optimization review.

Commands from the repository root:

```
R4_ENFORCE_TYPED=1 node --import tsx --test .local-builds/miami-performance-r4-review/camera-semantics.test.ts
node --import tsx --test .local-builds/miami-performance-r4-review/tile-view-lifecycle.test.ts
node --import tsx .local-builds/miami-performance-r4-review/dense-resolver-profile.ts
```

Full logs: `/tmp/miami-performance-r4-camera-independent.log`, `/tmp/miami-performance-r4-tile-independent.log`, `/tmp/miami-performance-r4-resolver-independent.log`.
