import type { ResourceSummary } from './resource-ledger';

export function formatResourceBytes(value: number | null): string {
  if (value === null || !Number.isFinite(value) || value < 0) return 'Unavailable';
  if (value < 1024) return `${Math.round(value)} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / 1024 ** 2).toFixed(1)} MiB`;
}

/** Fixed labels and numeric fields only. Caller uses textContent, never HTML interpolation. */
export function resourcePanelLines(summary: ResourceSummary | null, countSafeguard = 240): string[] {
  if (!summary) return ['No resident tiles', `Count-only safeguard: ${countSafeguard} tiles`];
  const lines = [
    `${summary.residentTiles} resident · ${summary.visibleResidentTiles} visible · ${summary.hiddenResidentTiles} cached`,
    `Count-only safeguard: ${countSafeguard} tiles`,
    `Known subtotal: ${formatResourceBytes(summary.knownSubtotalBytes)}`,
    `Buffer capacities: ${formatResourceBytes(summary.bufferCapacityBytes)}`,
    `Estimated textures: ${formatResourceBytes(summary.estimatedTextureBytes)}`,
    `Unknown resources: ${summary.unknownResources}`,
    `Encoded GLB: ${formatResourceBytes(summary.encodedGlbBytes)} · ${summary.encodedSizeUnknownTiles} unknown sizes`,
  ];
  if (summary.state === 'unavailable') lines.push('Resource inspection unavailable');
  else if (summary.completeStaticEstimateBytes === null) lines.push('Complete static estimate unavailable');
  return lines;
}
