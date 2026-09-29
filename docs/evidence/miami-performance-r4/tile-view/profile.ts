import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { cpus } from 'node:os';
import { Camera, Logger } from '@babylonjs/core';
import { blankView, originalTileView, tileViewFixture } from '../../../../tests/fixtures/miami-tile-view';

Logger.LogLevels = Logger.NoneLogLevel;
const f = await tileViewFixture(1000), targets = f.tiles.map(blankView);
let equalityChecks = 0;
try {
  for (const orthographic of [false, true]) for (const transformed of [false, true]) {
    f.camera.mode = orthographic ? Camera.ORTHOGRAPHIC_CAMERA : Camera.PERSPECTIVE_CAMERA;
    f.camera.orthoLeft = -60; f.camera.orthoRight = 60; f.camera.orthoTop = 40; f.camera.orthoBottom = -40;
    f.renderer.group.position.set(transformed ? 123 : 0, transformed ? -12 : 0, transformed ? 88 : 0);
    f.renderer.group.rotation.y = transformed ? .32 : 0;
    f.renderer.afterPrepare = () => {
      f.tiles.forEach((tile, i) => {
        f.renderer.calculateTileViewError(tile, targets[i]);
        assert.deepEqual(targets[i], originalTileView(f.renderer, f.scene, tile)); equalityChecks++;
      });
    };
    f.renderer.update();
  }
  f.renderer.afterPrepare = undefined; f.camera.mode = Camera.PERSPECTIVE_CAMERA;
  f.renderer.group.position.setAll(0); f.renderer.group.rotation.setAll(0);
  const originalPrepare = f.renderer.prepareForTraversal.bind(f.renderer);
  let cachedElapsed = 0;
  f.renderer.prepareForTraversal = () => {
    const start = performance.now();
    originalPrepare(); // Timed work includes one validated, native camera/group/frustum snapshot.
    f.tiles.forEach((tile, i) => f.renderer.calculateTileViewError(tile, targets[i]));
    cachedElapsed = performance.now() - start;
  };
  const before: number[] = [], after: number[] = [];
  // Interleave order, warm up both methods, and reuse the same bounds and output objects.
  for (let batch = 0; batch < 110; batch++) {
    const baseline = () => {
      const start = performance.now();
      f.tiles.forEach((tile, i) => originalTileView(f.renderer, f.scene, tile, targets[i]));
      return performance.now() - start;
    };
    let originalMs: number;
    if (batch % 2) { f.renderer.update(); originalMs = baseline(); }
    else { originalMs = baseline(); f.renderer.update(); }
    if (batch >= 10) { before.push(originalMs); after.push(cachedElapsed); }
  }
  const summary = (samples: number[]) => {
    const sorted = [...samples].sort((a, b) => a - b);
    return { batches: sorted.length, medianMs: sorted[Math.floor(sorted.length / 2)], p95Ms: sorted[Math.floor(sorted.length * .95)], maxMs: sorted.at(-1) };
  };
  const hashes: Record<string, string> = {};
  for (const name of ['src/world/miami/visuals/LHTilesRenderer.ts', 'tests/fixtures/miami-tile-view.ts', 'tests/miami-tile-view.test.ts', 'docs/evidence/miami-performance-r4/tile-view/profile.ts']) {
    hashes[name] = createHash('sha256').update(await readFile(new URL('../../../../' + name, import.meta.url))).digest('hex');
  }
  const originalPerTile = summary(before), updateSnapshot = summary(after);
  console.log(JSON.stringify({
    scope: 'Synthetic native CPU-only method work for 1000 independently authored local tile bounds. Not live provider traversal performance, browser FPS, GPU time, visual acceptance or a comparison of quality settings.',
    method: 'Original per-tile application arithmetic versus production snapshot plus the same 1000 evaluations. Cached work is timed inside the actual pinned core prepareForTraversal lifecycle; other core traversal/loading work is excluded. 10 warmup batches, 100 measured batches, alternating before/after order, shared output objects.',
    node: process.version, cpu: cpus()[0]?.model, measuredAt: new Date().toISOString(),
    dependencies: { babylon: '9.25.0', tilesRenderer: '0.5.2' }, tilesPerBatch: f.tiles.length, equivalenceChecks: equalityChecks,
    originalPerTile, updateSnapshot, medianMethodWorkReductionPercent: (1 - updateSnapshot.medianMs / originalPerTile.medianMs) * 100,
    sourceHashes: hashes,
  }, null, 2));
} finally { f.dispose(); }
