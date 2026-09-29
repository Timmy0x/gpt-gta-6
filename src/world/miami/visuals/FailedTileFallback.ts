import type { Tile } from '3d-tiles-renderer/core';

// Pinned core 0.5.2 treats FAILED=-1 as download-finished during REPLACE traversal.
// Its readiness checks require LOADED=4 or FAILED=-1; -2 means unavailable only
// during synchronous traversal. It is neither requestable UNLOADED=0 nor fake
// downloading/parsing work, and is restored before observers inspect update-after.
const FAILED = -1, UNAVAILABLE_FOR_TRAVERSAL = -2;

/** Retain existing ancestor coverage without hiding genuine errors or retrying failed content. */
export class FailedTileFallback {
  private known = new Set<WeakRef<Tile>>();
  private references = new WeakMap<Tile, WeakRef<Tile>>();
  private active: Tile[] = [];
  failed(tile: Tile): void {
    if (this.references.has(tile)) return;
    const reference = new WeakRef(tile); this.references.set(tile, reference); this.known.add(reference);
  }
  prepare(): void {
    this.restore();
    for (const reference of this.known) {
      const tile = reference.deref();
      if (!tile || tile.internal.loadingState !== FAILED) {
        this.known.delete(reference); if (tile) this.references.delete(tile); continue;
      }
      tile.internal.loadingState = UNAVAILABLE_FOR_TRAVERSAL; this.active.push(tile);
    }
  }
  restore(): void {
    for (const tile of this.active) if (tile.internal.loadingState === UNAVAILABLE_FOR_TRAVERSAL) tile.internal.loadingState = FAILED;
    this.active.length = 0;
  }
  forgotten(tile: Tile): void {
    const reference = this.references.get(tile);
    if (reference) this.known.delete(reference);
    this.references.delete(tile);
  }
  dispose(): void { this.restore(); this.known.clear(); this.references = new WeakMap(); }
}
