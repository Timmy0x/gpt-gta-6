Archived independent review. The original frozen-checkout paths below are provenance. The reviewed runtime and same-capacity regression tests are committed under tools/miami-lh-renderer. The retained NumPy oracle can also validate numerical-samples.json directly from this directory.

# Independent R2.2 distance review

Accepted runtime file: `../miami-lh-renderer-r2-2-source/src/LocalTileBounds.ts`, SHA-256 `548a9f6900153974de125808a292a92b467194e6a2a425eff1307464d9aee90b`.

The source-oriented orthonormal basis and support-projected half extents conservatively enclose every source half-edge, including rounded/sheared boxes. This replaces the loose world AABB distance without changing source-corner frustum testing. Zero/tiny directions fall back to a completed coordinate basis; direct double-precision direction transforms avoid cancellation from subtracting Earth-scale corners. The previously reviewed near-orthogonality threshold could return 1 cm for a source-box boundary point; this revision fixes that case.

Independent tests: 102 original boxes and 1,809 points, including thin, zero, tiny (down to 1e-180 m), sheared, near-orthogonal, large-collinear and 21 Earth-rebased cases. Source-inside points have a maximum residual of 1.0031e-8 m. A separate NumPy oracle enumerates all 27 box face/free-coordinate active sets and solves each free least-squares problem: 618 outside checks have maximum excess over the true-box distance of 1.5656e-10 m, within numerical tolerances. All returned distances are finite. `result.json` preserves the exact counts/tolerances; these are arithmetic checks, not surveying accuracy.

The owner's same-capacity traversal test is meaningful: a 2 m half-thickness tilted slab lies 1,234 m from the camera while its world AABB contains the camera. Correct distance meets the configured SSE target after the coarse tile; the former zero distance endlessly requests unnecessary detail until the cache fills. The retained asymmetric fixture's source vertices, after the default up-axis conversion, have slab-normal coordinates 0…1.8952 m and fit that slab. The test proves removal of this over-refinement trigger; it does not eliminate generic cache deadlocks where the genuinely required protected frontier exceeds capacity. The separate starvation reproduction documents that limit and the temporary-gap tradeoff of disabling ancestor loading.

Reproduce from the repository root, without network or graphics:

```sh
node --import ./.local-builds/miami-lh-renderer-r2-2-source/node_modules/tsx/dist/loader.mjs .local-builds/miami-obb-distance-review-r1/probe.ts
/tmp/codex-miami-geo/bin/python .local-builds/miami-obb-distance-review-r1/oracle.py
```

No production or renderer-owner files were changed. `manifest.json` hashes the reviewed source/tests and independent evidence. No material remaining issue was found within this geographic-scale distance review.
