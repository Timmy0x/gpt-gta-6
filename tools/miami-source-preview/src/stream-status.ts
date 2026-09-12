import type { TilesRendererBase } from '3d-tiles-renderer/core';

type Count = number | null;
export interface StreamSnapshot {
  schemaVersion: 1;
  state: 'ready' | 'partial' | 'disposed';
  /** Pinned runtime collections: LRU includes pending and external JSON content. */
  cache: { admitted: Count; countLimit: Count; countLimitReached: Count; protectedUsed: Count; settledIncludingFailed: Count; trackedByteLimitReached: Count };
  /** Renderer-local stages: parsing includes pending parses; downloads include response-body work. */
  renderer: { cached: Count; successfulContents: Count; queuedDownloads: Count; downloading: Count; pendingOrParsing: Count; failedSinceReset: Count; visible: Count; active: Count; traversalUsed: Count; inFrustum: Count; processedThisUpdate: Count; processLimit: Count; frame: Count; rootReady: Count };
  /** These queue objects can be shared across renderers. No origin keys or task values are read. */
  queues: { downloadPending: Count; downloadRunning: Count; downloadOriginQueues: Count; downloadLimitPerOrigin: Count; parsePending: Count; parseRunning: Count; parseLimit: Count; nodePending: Count; nodeRunning: Count; nodeLimit: Count; originScanLimitReached: number };
  events: { rootErrors: number; tileErrors: number; unclassifiedErrors: number; renderErrors: number; modelLoads: number; modelDisposals: number };
}

const setSize = Object.getOwnPropertyDescriptor(Set.prototype, 'size')!.get!;
const mapSize = Object.getOwnPropertyDescriptor(Map.prototype, 'size')!.get!;
const MAX_ORIGIN_QUEUES = 1024;
function own(value: unknown, key: string): unknown {
  try { return value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined; }
  catch { return undefined; }
}
function count(value: unknown): Count { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null; }
function size(value: unknown, kind: 'set' | 'map'): Count {
  try { return count((kind === 'set' ? setSize : mapSize).call(value)); } catch { return null; }
}
function length(value: unknown): Count { return Array.isArray(value) ? count(own(value, 'length')) : null; }
function plus(a: Count, b: Count): Count { return a === null || b === null ? null : count(a + b); }
function reached(a: Count, b: Count): Count { return a === null || b === null ? null : Number(a >= b); }
function stage(queue: unknown) { return { pending: length(own(queue, 'items')), running: count(own(queue, 'currJobs')), limit: count(own(queue, 'maxJobs')) }; }
function emptyEvents(): StreamSnapshot['events'] { return { rootErrors: 0, tileErrors: 0, unclassifiedErrors: 0, renderErrors: 0, modelLoads: 0, modelDisposals: 0 }; }

/** No tile, GLB, URL, error message or source metadata is inspected. Runtime fields are pinned to 0.5.2. */
export function readStreamStatus(source: unknown, events = emptyEvents()): StreamSnapshot {
  const lru = own(source, 'lruCache'), stats = own(source, 'stats');
  // 0.5.2 exposes downloadQueue through a prototype getter backed by this own field.
  const download = own(source, '_downloadQueue'), origins = own(download, 'originQueues');
  const originCount = size(origins, 'map');
  let downloadPending: Count = 0, downloadRunning: Count = 0;
  const originScanLimitReached = Number(originCount !== null && originCount > MAX_ORIGIN_QUEUES);
  if (originCount === null || originScanLimitReached) downloadPending = downloadRunning = null;
  else {
    try {
      const iterator = Map.prototype.values.call(origins) as MapIterator<unknown>;
      for (let i = 0; i < originCount; i++) {
        const next = iterator.next();
        if (next.done) { downloadPending = downloadRunning = null; break; }
        const q = stage(next.value);
        downloadPending = plus(downloadPending, q.pending); downloadRunning = plus(downloadRunning, q.running);
      }
    } catch { downloadPending = downloadRunning = null; }
  }
  const parse = stage(own(source, 'parseQueue')), node = stage(own(source, 'processNodeQueue'));
  const admitted = size(own(lru, 'itemSet'), 'map'), limit = count(own(lru, 'maxSize'));
  const readStat = (key: string) => count(own(stats, key));
  const root = own(source, 'rootTileset');
  const result: StreamSnapshot = {
    schemaVersion: 1, state: 'ready',
    cache: { admitted, countLimit: limit, countLimitReached: reached(admitted, limit), protectedUsed: size(own(lru, 'usedSet'), 'set'), settledIncludingFailed: size(own(lru, 'loadedSet'), 'set'), trackedByteLimitReached: reached(count(own(lru, 'cachedBytes')), count(own(lru, 'maxBytesSize'))) },
    renderer: { cached: readStat('inCache'), successfulContents: readStat('loaded'), queuedDownloads: readStat('queued'), downloading: readStat('downloading'), pendingOrParsing: readStat('parsing'), failedSinceReset: readStat('failed'), visible: size(own(source, 'visibleTiles'), 'set'), active: size(own(source, 'activeTiles'), 'set'), traversalUsed: readStat('used'), inFrustum: readStat('inFrustum'), processedThisUpdate: readStat('tilesProcessed'), processLimit: count(own(source, 'maxTilesProcessed')), frame: count(own(source, 'frameCount')), rootReady: root === null ? 0 : root && typeof root === 'object' ? 1 : null },
    queues: { downloadPending, downloadRunning, downloadOriginQueues: originCount, downloadLimitPerOrigin: count(own(download, '_maxJobsPerOrigin')), parsePending: parse.pending, parseRunning: parse.running, parseLimit: parse.limit, nodePending: node.pending, nodeRunning: node.running, nodeLimit: node.limit, originScanLimitReached },
    // Copy only whitelisted nonnegative integers, even if called with an untrusted object.
    events: Object.fromEntries(Object.keys(emptyEvents()).map(key => [key, count(own(events, key)) ?? 0])) as StreamSnapshot['events'],
  };
  if ([result.cache, result.renderer, result.queues].some(group => Object.values(group).some(value => value === null))) result.state = 'partial';
  return result;
}

/** Connection-local event counters and a maximum 1 Hz sampler. Disposal clears counters permanently. */
export class StreamStatus {
  private events = emptyEvents();
  private renderer: TilesRendererBase | null = null;
  private lastSample = -Infinity;
  private closed = false;
  private error = (event: unknown) => {
    const tile = own(event, 'tile');
    this.increment(tile === null ? 'rootErrors' : tile && typeof tile === 'object' ? 'tileErrors' : 'unclassifiedErrors');
  };
  private loaded = () => this.increment('modelLoads');
  private unloaded = () => this.increment('modelDisposals');
  private increment(key: keyof StreamSnapshot['events']): void { if (!this.closed) this.events[key] = Math.min(Number.MAX_SAFE_INTEGER, this.events[key] + 1); }
  attach(renderer: TilesRendererBase): void {
    if (this.closed || this.renderer === renderer) return;
    this.detach(); this.reset(); this.renderer = renderer;
    renderer.addEventListener('load-error', this.error);
    renderer.addEventListener('load-model', this.loaded);
    renderer.addEventListener('dispose-model', this.unloaded);
  }
  private detach(): void {
    this.renderer?.removeEventListener('load-error', this.error);
    this.renderer?.removeEventListener('load-model', this.loaded);
    this.renderer?.removeEventListener('dispose-model', this.unloaded);
    this.renderer = null;
  }
  renderError(): void { this.increment('renderErrors'); }
  reset(): void { this.events = emptyEvents(); this.lastSample = -Infinity; }
  dispose(): void { this.closed = true; this.detach(); this.reset(); }
  snapshot(): StreamSnapshot {
    const result = readStreamStatus(this.closed ? null : this.renderer, this.events);
    if (this.closed) result.state = 'disposed';
    return result;
  }
  sample(nowMs: number): StreamSnapshot | null {
    if (!Number.isFinite(nowMs) || nowMs - this.lastSample < 1000) return null;
    this.lastSample = nowMs;
    return this.snapshot();
  }
}

export function streamStatusPlugin(status: StreamStatus) {
  return { name: 'READ_ONLY_STREAM_STATUS', init(tiles: TilesRendererBase) { status.attach(tiles); }, dispose() { status.dispose(); } };
}
