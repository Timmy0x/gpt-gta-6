# R4 tile view math cache

This checkpoint removes repeated camera and group matrix work from the existing left-handed tile adapter. It retains the original bounds, frustum rules, distance calculation, framebuffer pixel convention, geometric error scaling and arithmetic order. It does not change tiles, loading thresholds, model detail, collision checks, residency, credentials or attribution.

The candidate starts from pushed commit `b0bb9b7`. `source-files.json` identifies the frozen source files and pinned renderer lifecycle implementation. The profile JSON also records its exact source hashes.

## Lifecycle

Pinned `3d-tiles-renderer` 0.5.2 returns early without events when no root exists. With a root, plugin `doTilesNeedUpdate` runs first; a skipped update still emits `update-before` and `update-after`. A normal update invokes `prepareForTraversal` after all `update-before` listeners and immediately before traversal.

The adapter creates its shared view snapshot in that preparation hook. The existing game calls the renderer update after `Player.render` finishes positioning the game camera. Each traversal captures the current active camera, projection mode and matrix, framebuffer and viewport dimensions, rigid group world transform, local camera position and six transformed frustum planes. The snapshot is never carried across updates.

Every outgoing event clears the snapshot before listener execution. Queries in those listeners, and any remaining queries after a listener could have changed view state, use a fresh one-off calculation. The `finally` block clears the snapshot even when traversal throws. Skipped and rootless updates retain no cache. Standalone `calculateTileViewError` calls also calculate from current state; manually calling the public preparation seam outside an update cannot leave a stale cache.

There is no dependency patch. The hook follows the pinned 0.5.2 implementation, whose base `prepareForTraversal` is empty. The scope assumes the renderer's normal synchronous traversal; arbitrary camera mutation inside a third-party per-tile view-error plugin is not an installed game behavior and is not claimed as a tested extension contract.

## Native checks

Run from the repository root:

```sh
node --import tsx --test tests/miami-tile-view.test.ts tests/miami-streamed-visuals.test.ts
npm run typecheck
node --import tsx docs/evidence/miami-performance-r4/tile-view/profile.ts
```

`native-tests.log` records 13 passing tests: four new tile-view tests plus nine existing streamed-renderer/transport/lifecycle tests. The new tests run the actual initialized pinned core traversal over an independently authored root and 1,000 child boxes/spheres. They check 20,020 exact result comparisons across 20 states, including perspective and orthographic modes, frozen projections, active camera replacement, camera parents, viewport and framebuffer changes, hardware scaling, group transforms and group parents. They exercise zero-distance infinite error, visible and hidden bounds, callback ordering, skipped/rootless updates, exception cleanup, standalone freshness and outgoing callback invalidation. A separate instrumented test counts exactly one frustum construction per stable 1,001-tile update.

The existing streamed tests cover the real pinned GLB importer and actual synthetic root/child loading, coverage hide/restore, credits, disconnect/reconnect, cancellation, disposal and bounded auth renewal. They use fixture-only transport and make no provider requests.

## Synthetic method-work profile

`profile.ts` is a reproducible successor to the R3 `performance-followups/tile-view-profile.ts` investigation. It compares the original per-tile application method with the production snapshot path on identical synthetic local bounds and reusable result objects. Cached timing includes one validated snapshot in the actual core preparation hook and 1,000 evaluations; remaining core traversal/loading work is outside that timer. Both paths are warmed for 10 batches, then measured for 100 batches with alternating order. Another 4,000 exact comparisons precede timing.

The recorded Node 22.23.2 / Apple M5 Pro run has median method work of 1.463 ms before and 0.222 ms after, an 84.8% reduction for this synthetic workload. These are native CPU method measurements. They do not establish browser FPS, live provider traversal cost, GPU performance or photorealistic visual acceptance. Integrated browser performance and visuals remain the parent's verification scope.
