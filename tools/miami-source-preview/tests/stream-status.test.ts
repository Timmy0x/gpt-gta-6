import test from 'node:test';
import assert from 'node:assert/strict';
import { NullEngine, Scene } from '@babylonjs/core';
import { TilesRenderer } from '3d-tiles-renderer/babylonjs';
import { DownloadPriorityQueue, LRUCache, PriorityQueue } from '3d-tiles-renderer/core';
import { readStreamStatus, StreamStatus, streamStatusPlugin } from '../src/stream-status';
import { streamStatusLines } from '../src/stream-status-panel';

// Host scheduling is controlled; actual pinned queue algorithms execute via tryRunJobs().
globalThis.requestAnimationFrame ??= () => 0;
globalThis.cancelAnimationFrame ??= () => {};
globalThis.window ??= { location: { href: 'https://fixture.invalid/' }, addEventListener() {}, removeEventListener() {} } as unknown as Window & typeof globalThis;
function native() {
  const engine = new NullEngine(), scene = new Scene(engine);
  const renderer = new TilesRenderer('https://fixture.invalid/root.json?key=never-report-this', scene);
  renderer.lruCache = new LRUCache(); renderer.downloadQueue = new DownloadPriorityQueue();
  renderer.parseQueue = new PriorityQueue(); renderer.processNodeQueue = new PriorityQueue();
  renderer.lruCache.maxSize = 240; renderer.lruCache.minSize = 160;
  renderer.parseQueue.autoUpdate = renderer.processNodeQueue.autoUpdate = false;
  return { renderer, dispose() { renderer.dispose(); scene.dispose(); engine.dispose(); } };
}
const tick = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

test('real pinned LRU admission/settlement/protection counts stay distinct from renderer models and visibility', () => {
  const h = native(), { renderer: r } = h;
  try {
    const items = Array.from({ length: 240 }, () => ({}));
    for (const item of items) assert.equal(r.lruCache.add(item, () => {}), true);
    r.lruCache.setLoaded(items[0], true); r.lruCache.setLoaded(items[1], true);
    r.lruCache.markUnused(items[1]);
    const before = readStreamStatus(r);
    assert.equal(before.cache.admitted, 240); assert.equal(before.cache.countLimit, 240);
    assert.equal(before.cache.countLimitReached, 1); assert.equal(before.cache.protectedUsed, 239);
    assert.equal(before.cache.settledIncludingFailed, 2);
    assert.equal(before.renderer.successfulContents, 0); assert.equal(before.renderer.visible, 0);
    assert.equal(r.lruCache.add({}, () => {}), false);
    assert.deepEqual(readStreamStatus(r), before); // repeated inspection mutates no counters or admission state.
    r.lruCache.remove(items[0]);
    assert.equal(readStreamStatus(r).cache.admitted, 239); assert.equal(readStreamStatus(r).cache.countLimitReached, 0);
    r.lruCache.maxBytesSize = 5; r.lruCache.setMemoryUsage(items[1], 5);
    assert.equal(readStreamStatus(r).cache.trackedByteLimitReached, 1);
  } finally { h.dispose(); }
});

test('real per-origin download, parse and node queues report pending and running separately without reading tasks/origin keys', async () => {
  const h = native(), { renderer: r } = h;
  const release: Array<() => void> = [], pending: Promise<unknown>[] = [];
  const job = () => new Promise<void>(resolve => release.push(resolve));
  try {
    r.downloadQueue.maxJobsPerOrigin = 1; r.parseQueue.maxJobs = 2; r.processNodeQueue.maxJobs = 1;
    const secretTask = () => Object.defineProperty({}, 'url', { get() { throw new Error('sensitive-task'); } });
    for (let i = 0; i < 3; i++) pending.push(r.downloadQueue.add('https://private-a.invalid/?token=do-not-copy', secretTask(), job));
    pending.push(r.downloadQueue.add('https://private-b.invalid/?token=do-not-copy', secretTask(), job));
    for (const q of r.downloadQueue.originQueues.values()) { q.autoUpdate = false; q.tryRunJobs(); }
    for (let i = 0; i < 3; i++) pending.push(r.parseQueue.add(secretTask(), job));
    r.parseQueue.tryRunJobs();
    for (let i = 0; i < 2; i++) pending.push(r.processNodeQueue.add(secretTask(), job));
    r.processNodeQueue.tryRunJobs();
    const s = readStreamStatus(r);
    assert.deepEqual([s.queues.downloadPending, s.queues.downloadRunning, s.queues.downloadOriginQueues, s.queues.downloadLimitPerOrigin], [2, 2, 2, 1]);
    assert.deepEqual([s.queues.parsePending, s.queues.parseRunning, s.queues.parseLimit], [1, 2, 2]);
    assert.deepEqual([s.queues.nodePending, s.queues.nodeRunning, s.queues.nodeLimit], [1, 1, 1]);
    assert.equal(s.renderer.downloading, 0); // Queue scope and renderer lifecycle stages are deliberately independent.
    assert.doesNotMatch(JSON.stringify(s) + streamStatusLines(s).join('\n'), /private-|token|do-not-copy|sensitive-task/);
    for (let turn = 0; turn < 5; turn++) {
      release.splice(0).forEach(resolve => resolve()); await tick();
      for (const q of r.downloadQueue.originQueues.values()) q.tryRunJobs();
      r.parseQueue.tryRunJobs(); r.processNodeQueue.tryRunJobs();
    }
    await Promise.all(pending);
    const done = readStreamStatus(r);
    assert.deepEqual([done.queues.downloadPending, done.queues.downloadRunning, done.queues.parsePending, done.queues.parseRunning, done.queues.nodePending, done.queues.nodeRunning], [0, 0, 0, 0, 0, 0]);
  } finally { release.forEach(resolve => resolve()); h.dispose(); }
});

test('actual renderer events, throttling, reset and plugin disposal retain only counters and reject late completions', () => {
  const h = native(), { renderer: r } = h, status = new StreamStatus();
  r.registerPlugin(streamStatusPlugin(status));
  try {
    const dispatch = (event: object) => r.dispatchEvent(event as { type: string });
    dispatch({ type: 'load-error', tile: null, get error() { throw new Error('secret-error'); }, get url() { throw new Error('secret-url'); } });
    dispatch({ type: 'load-error', tile: {}, error: new Error('secret-error'), url: 'https://private.invalid/?key=secret' });
    dispatch({ type: 'load-error', get tile() { throw new Error('secret-tile'); } });
    dispatch({ type: 'load-model', get tile() { throw new Error('secret-model'); } });
    dispatch({ type: 'dispose-model' }); status.renderError();
    const first = status.sample(0)!;
    assert.deepEqual(first.events, { rootErrors: 1, tileErrors: 1, unclassifiedErrors: 1, renderErrors: 1, modelLoads: 1, modelDisposals: 1 });
    assert.equal(status.sample(999), null); assert.equal(status.sample(NaN), null); assert.ok(status.sample(1000));
    assert.doesNotMatch(JSON.stringify(first) + streamStatusLines(first).join('\n'), /secret|https:|private/);
    status.reset(); assert.equal(status.sample(0)!.events.tileErrors, 0);
    r.dispose(); dispatch({ type: 'load-error', tile: null }); status.renderError(); status.attach(r);
    assert.equal(status.snapshot().state, 'disposed'); assert.equal(status.snapshot().events.rootErrors, 0);
    assert.deepEqual(streamStatusLines(status.snapshot()), ['Streaming · disconnected']);
  } finally { status.dispose(); h.dispose(); }
});

test('bounded inspection and missing/malicious accessors produce explicit unknown values, never exceptions or source text', () => {
  const h = native();
  try {
    const source = { ...h.renderer, stats: Object.defineProperty({}, 'failed', { get() { throw new Error('private-query'); } }) };
    const s = readStreamStatus(source);
    assert.equal(s.state, 'partial'); assert.equal(s.renderer.failedSinceReset, null);
    assert.doesNotMatch(JSON.stringify(s), /private-query/);
    const origins = h.renderer.downloadQueue.originQueues;
    for (let i = 0; i < 1025; i++) origins.set(String(i), new PriorityQueue());
    const bounded = readStreamStatus(h.renderer);
    assert.equal(bounded.queues.downloadOriginQueues, 1025); assert.equal(bounded.queues.originScanLimitReached, 1);
    assert.equal(bounded.queues.downloadPending, null); assert.equal(bounded.queues.downloadRunning, null);
    assert.equal(readStreamStatus(new Proxy({}, { getOwnPropertyDescriptor() { throw new Error('private-proxy'); } })).state, 'partial');
  } finally { h.dispose(); }
});
