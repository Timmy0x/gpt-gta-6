# R5 scene-owned source detail profiles

Based on pushed `9cf3af6`. This checkpoint exposes requested framebuffer screen-space error (SSE) profiles on the existing scene-owned source renderer. The accepted default stays **Balanced / 20 px**. High / 12 px and Ultra / 8 px are explicit selections, awaiting the parent's normal browser A/B evaluation. They request finer available tiles; they do not certify source detail, current capture dates, photorealistic close-ups or exact whole-Miami parity.

## API

`StreamedMiamiVisuals` exports `VisualDetailProfile` (`balanced | high | ultra`) and the frozen `VISUAL_DETAIL_PROFILES` mapping. `VisualOptions.detailProfile` optionally selects a constructor profile. `setDetailProfile(profile)` returns true for an open owner's changed selection, false for the same value or a disposed owner, and rejects unsupported runtime values with a fixed `RangeError`. Snapshot fields `detailProfile` and `errorTargetPixels` report the requested target.

A connected change updates the existing renderer target and immutable snapshot. The next ordinary renderer update selects the new frontier. There is no reconnect, scene/camera replacement, cache reset, automatic failure reset or credential persistence. Selection survives a scene-owned disconnect/reconnect or explicit retry; credentials continue to exist only in the existing connection memory. Disconnection and disposal still clear credentials through the unchanged transport lifetime.

The framebuffer/viewport convention and cached LH view math remain unchanged. Geometry, source transforms, bounds, error scaling, concurrency, 960/640 count limits, byte tracker safeguards, credit/branding and independent physical collision readiness are retained. High and Ultra cannot repair missing source geometry or imagery, manufacture independent trees, or provide collision assets.

## Failed child coverage correction

The actual pinned 0.5.2 traversal treats both LOADED and FAILED content as download-finished. The native fixture reproduced a hole after Balanced → High: a terminal 503 on the finer child removed its already loaded coarse ancestor, leaving no visible model.

`FailedTileFallback` tracks weak references received from actual load-error events, rather than scanning or eagerly preprocessing the source hierarchy. During synchronous traversal only, known FAILED content uses a private unavailable marker (-2), so it does not count as complete replacement coverage and cannot be re-requested as UNLOADED. The private scene renderer restores the genuine FAILED state before **every outgoing callback**, resumes protection when traversal continues, and restores in `finally`, manual preparation and disposal paths. It prunes dead/reset/unloaded entries and does not retain a source hierarchy through its weak references.

The correction preserves the requested profile/SSE, fixed error, failed counters, queue limits and existing session. It neither retries failures nor freezes whole-session traversal. A healthy deeper child can still replace the fallback beyond a failed intermediate when its complete content is available. A failed root with no independently loaded ancestor is still a real unavailable source; no coverage is fabricated. This compatibility seam is tied to pinned 0.5.2 and must be revisited with a renderer upgrade.

## Native evidence

```sh
node --import tsx --test tests/miami-detail-profile.test.ts tests/miami-streamed-visuals.test.ts tests/miami-tile-view.test.ts
npm run typecheck
node --import tsx docs/evidence/miami-fidelity-r5/source-detail/reproduce.ts
```

The parent integrated `native-tests.txt` records all 401 passing game tests, including 20 renderer/profile/view/transport tests (seven profile tests and 13 accepted checks). These use the actual pinned core traversal, GLB importer and scoped transport with independently authored three-vertex fixtures. No provider request, imagery, mesh extraction, browser or real token was used.

The new checks establish actual loaded frontiers at 20/12/8 for both direct-Google and ion-to-Google fixture connections; exact original SSE through camera/projection/framebuffer/viewport changes; existing camera/scene/cache/credits preserved without reconnect; same-value notification suppression; delayed-child parent coverage and late inflight content staying hidden after a coarser selection; HTTP/network/unsupported-GLB failure coverage with truthful observer states and no repeated failed request; and the actual production 960-item cap under a 1,000-child request. The last case keeps the coarse parent because capacity cannot cover the requested frontier. It proves a cap/fallback mechanism, not the real memory cost of Google content.

Native checks also preserve privacy, provenance, explicit retry, disconnect/reconnect, disposal, independent collision readiness, root/child cancellation and bounded auth renewal. `reproduce.ts/json` provide numeric synthetic frontier/failure/cap results. `source-files.json` freezes this source cohort; parent UI/main files and browser evaluation are outside its manifest.

The seventh profile check covers callback reentrancy, exceptions, disconnect and owner replacement. Reentrant updates return before changing traversal state; disconnect/replacement from an update callback makes zero old-owner content requests. Genuine FAILED state is restored for all outgoing observers. The actual fixture and repaired production renderer are exercised together.
