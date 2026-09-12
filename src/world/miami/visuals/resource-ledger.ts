import { AssetContainer } from '@babylonjs/core/assetContainer';
import type { TilesRenderer } from '3d-tiles-renderer/babylonjs';
import { measureTileResources } from './TileResourceBudget';

export interface ResourceSummary {
  schemaVersion: 1;
  state: 'ready' | 'unavailable' | 'disposed';
  residentTileIds: number[];
  residentTiles: number;
  visibleResidentTiles: number;
  hiddenResidentTiles: number;
  uniqueBuffers: number | null;
  uniqueTextures: number | null;
  bufferCapacityBytes: number | null;
  estimatedTextureBytes: number | null;
  knownSubtotalBytes: number | null;
  completeStaticEstimateBytes: number | null;
  unknownResources: number;
  unknownContainers: number;
  encodedGlbBytes: number;
  encodedSizeUnknownTiles: number;
}
interface Resident {
  id: number;
  container: AssetContainer | null;
  encodedGlbBytes: number | null;
}
function own(value: unknown, property: string): unknown {
  return value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, property)?.value : undefined;
}

/** Connection-local resident ledger. IDs reveal only load order; no URLs or metadata are read. */
export class ResourceLedger {
  private resident = new Map<object, Resident>();
  private pendingLength = new WeakMap<object, number | null>();
  private nextId = 1;
  private closed = false;
  private lastSampleMs = -Infinity;

  observeParse(tile: object, value: unknown): void {
    if (this.closed) return;
    let length: number | null = null;
    try {
      if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
        const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
        if (bytes.byteLength >= 12) {
          const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
          if (view.getUint32(0, true) === 0x46546c67 && view.getUint32(8, true) === bytes.byteLength) length = bytes.byteLength;
        }
      }
    } catch { /* Detached/invalid input cannot interrupt the official parser. */ }
    this.pendingLength.set(tile, length); // numeric length only; never retain bytes.
  }

  loaded(tile: object, container: unknown): number | null {
    if (this.closed) return null;
    const actual = container instanceof AssetContainer ? container : null;
    const existing = this.resident.get(tile);
    if (existing && existing.container === actual) { this.pendingLength.delete(tile); return existing.id; }
    if (!Number.isSafeInteger(this.nextId)) return null;
    const entry: Resident = { id: this.nextId++, container: actual, encodedGlbBytes: this.pendingLength.get(tile) ?? null };
    this.pendingLength.delete(tile);
    this.resident.set(tile, entry);
    return entry.id;
  }

  unloaded(tile: object): void {
    this.resident.delete(tile); this.pendingLength.delete(tile);
  }
  reset(): void {
    this.resident.clear(); this.pendingLength = new WeakMap(); this.lastSampleMs = -Infinity;
    // Do not reuse IDs or reopen a disposed ledger, including after a late completion.
  }
  dispose(): void { this.closed = true; this.reset(); }

  /** At most one inspection per 1,000 ms; a slow frame does not trigger catch-up loops. */
  sample(nowMs: number, visibleTiles: ReadonlySet<object>): ResourceSummary | null {
    if (!Number.isFinite(nowMs) || nowMs - this.lastSampleMs < 1000) return null;
    this.lastSampleMs = nowMs;
    return this.snapshot(visibleTiles);
  }

  /** Only fixed numeric aggregates leave this class; helper strings and source names stay private. */
  snapshot(visibleTiles: ReadonlySet<object> = new Set()): ResourceSummary {
    const entries = [...this.resident.entries()];
    const visible = entries.filter(([tile]) => visibleTiles.has(tile)).length;
    const unknownContainers = entries.filter(([, entry]) => entry.container === null).length;
    const encodedGlbBytes = entries.reduce((sum, [, entry]) => sum + (entry.encodedGlbBytes ?? 0), 0);
    const base: ResourceSummary = {
      schemaVersion: 1, state: this.closed ? 'disposed' : 'ready',
      residentTileIds: entries.map(([, entry]) => entry.id), residentTiles: entries.length,
      visibleResidentTiles: visible, hiddenResidentTiles: entries.length - visible,
      uniqueBuffers: null, uniqueTextures: null, bufferCapacityBytes: null, estimatedTextureBytes: null,
      knownSubtotalBytes: null, completeStaticEstimateBytes: null, unknownResources: unknownContainers,
      unknownContainers, encodedGlbBytes, encodedSizeUnknownTiles: entries.filter(([, entry]) => entry.encodedGlbBytes === null).length,
    };
    try {
      const result = measureTileResources(entries.flatMap(([, entry]) => entry.container ? [{
        id: String(entry.id), container: entry.container, encodedGlbByteLength: entry.encodedGlbBytes,
      }] : []));
      return {
        ...base, uniqueBuffers: result.uniqueBufferCount, uniqueTextures: result.uniqueTextureCount,
        bufferCapacityBytes: result.gpuBufferCapacityBytes, estimatedTextureBytes: result.textureAllocationEstimateBytes,
        knownSubtotalBytes: result.knownResourceSubtotalBytes,
        completeStaticEstimateBytes: unknownContainers ? null : result.budgetChargeBytes,
        unknownResources: result.unknownResources.length + unknownContainers,
      };
    } catch {
      // Inspection must not turn source-controlled strings, exceptions or objects into diagnostics.
      return { ...base, state: 'unavailable', unknownResources: base.unknownResources + 1 };
    }
  }
}

/** Passive parse hook plus actual model lifetime events; visibility never removes a cached tile. */
export function resourceLedgerPlugin(ledger: ResourceLedger) {
  let renderer: TilesRenderer | null = null;
  const loaded = (event: { tile: object }) => ledger.loaded(event.tile, own(own(event.tile, 'engineData'), 'container'));
  const disposed = (event: { tile: object }) => ledger.unloaded(event.tile);
  return {
    name: 'READ_ONLY_RESOURCE_ESTIMATES',
    init(tiles: TilesRenderer) {
      renderer = tiles;
      tiles.addEventListener('load-model', loaded);
      tiles.addEventListener('dispose-model', disposed);
    },
    parseTile(buffer: unknown, tile: object) { ledger.observeParse(tile, buffer); return null; },
    dispose() {
      renderer?.removeEventListener('load-model', loaded);
      renderer?.removeEventListener('dispose-model', disposed);
      renderer = null; ledger.dispose();
    },
  };
}
