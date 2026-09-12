import type { StreamSnapshot } from './stream-status';
const n = (value: number | null) => value === null ? '?' : String(value);

/** Fixed vocabulary and numeric values only. Write with textContent, never innerHTML. */
export function streamStatusLines(s: StreamSnapshot | null): string[] {
  if (!s || s.state === 'disposed') return ['Streaming · disconnected'];
  const c = s.cache, r = s.renderer, q = s.queues, e = s.events;
  return [
    `Streaming · ${s.state} · update ${n(r.frame)} · root ${n(r.rootReady)}`,
    `LRU admitted: ${n(c.admitted)} / ${n(c.countLimit)} · count full ${n(c.countLimitReached)} · tracked-byte full ${n(c.trackedByteLimitReached)}`,
    `LRU protected: ${n(c.protectedUsed)} · settled incl. failed: ${n(c.settledIncludingFailed)}`,
    `Renderer: ${n(r.visible)} visible · ${n(r.active)} active · ${n(r.traversalUsed)} used · ${n(r.inFrustum)} in frustum`,
    `Content: ${n(r.cached)} cached · ${n(r.successfulContents)} successful · ${n(r.failedSinceReset)} failed since reset`,
    `Renderer stages: ${n(r.queuedDownloads)} waiting · ${n(r.downloading)} downloading/body · ${n(r.pendingOrParsing)} waiting/parsing`,
    `Download queues: ${n(q.downloadPending)} waiting · ${n(q.downloadRunning)} running · ${n(q.downloadOriginQueues)} groups · ${n(q.downloadLimitPerOrigin)} limit/group`,
    `Parse queue: ${n(q.parsePending)} waiting · ${n(q.parseRunning)} running / ${n(q.parseLimit)}`,
    `Node queue: ${n(q.nodePending)} waiting · ${n(q.nodeRunning)} running / ${n(q.nodeLimit)} · ${n(r.processedThisUpdate)} processed / ${n(r.processLimit)}`,
    `Events: ${e.rootErrors} root errors · ${e.tileErrors} tile errors · ${e.unclassifiedErrors} other errors · ${e.renderErrors} update errors · ${e.modelLoads} model loads · ${e.modelDisposals} disposals`,
    ...(q.originScanLimitReached ? ['Download queue inspection limit reached; totals unavailable.'] : []),
    'Queues/LRU may be shared. Admitted includes pending and JSON; protected is not visible. Tracked bytes are not VRAM.',
  ];
}
