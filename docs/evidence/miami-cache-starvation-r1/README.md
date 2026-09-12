Re-run the adapted script after npm ci in tools/miami-lh-renderer: `node scripts/reproduce-cache-starvation.mjs`. It resolves the same pinned package through its public export and prints results; the original review below retains its frozen-checkout provenance.

# Pinned 0.5.2 traversal/cache starvation reproduction

Run from the repository root:

```sh
node .local-builds/miami-lru-starvation-review-r1/reproduce.mjs
```

This imports the exact clean preview's unmodified `TilesRendererBase` and its traversal, queue and LRU dependencies. The original synthetic input contains a REPLACE coarse model, 90 external JSON content nodes, and three model leaves per external document. Each external root is empty, with the same error as the coarse conditional ancestor, exercising the pinned unconditional-refinement rule. One leaf per branch is in the synthetic view. Content fetch/parse resolves from generated local objects; no network, graphics engine, real camera, provider metadata or credentials are used. Each model is charged one byte, matching the pinned Babylon backend's placeholder accounting. This does not represent actual memory use.

All three assertions pass. `result.json` retains the complete numerical results:

| Ancestor loading | Capacity | Resident JSON / models | Protected entries | Visible result |
| --- | ---: | ---: | ---: | --- |
| true | 240 | 90 / 150 | 240 | 1 coarse model; no pending work; stable for 200 additional updates |
| true | 512 | 90 / 271 | 361 | 90 selected leaves |
| false | 240 | 90 / 90 | 180 | 90 selected leaves |

`loadSiblings=false` in every case. Upstream `markUsedTiles` expands REPLACE siblings when **either** `loadSiblings` **or** `loadAncestors` is true. `toggleTiles` retains/downloads all used content with ancestor loading, including external JSON. `markVisibleTiles` keeps the coarse parent when used descendants are not all ready. LRU protects the entire used set; a full protected cache cannot admit the missing content that would make the replacement frontier ready. Increasing a capacity may prove the diagnosis, but it does not make this traversal strategy bounded for arbitrary hierarchies.

The synthetic view-change check switches every branch to its previously off-screen second leaf. Capacity 512/ancestor loading keeps all 90 leaves available immediately. Capacity 240/no ancestor loading drops to **zero visible tiles temporarily**, then recovers all 90; the retained run took 47 simulated updates. This duration depends on the mock scheduler and is not a network/GPU frame-time measurement. It demonstrates a real readiness tradeoff: disabling ancestors prevents this deadlock but does not establish gap-free camera movement. An accepted runtime policy needs both a bounded working set and tested fallback coverage.

This reproduces the observed numerical symptom, not the private Google hierarchy. Confirm the live diagnosis using whitelist aggregate counts: LRU admitted content count, protected count, resident JSON/model split, `isFull`, queued/downloading/parsing counts and readiness of the selected replacement frontier. The current preview's `session.loaded` is cumulative `load-model` events and excludes JSON; it is not cache occupancy. `stats.loaded` counts resident successful content, including external JSON. LRU `loadedSet` also includes failed terminal requests and must not be labelled successful content. `visibleTiles` is not the same as the protected set.

`manifest.json` hashes this source/result and the exact pinned upstream files that establish the mechanism. No production files were changed. Camera equivalence and the adapter's local AABB versus source OBB distance are independently being examined by the renderer owner.
