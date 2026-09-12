import { safeError, safeUrl } from './access';
import type { Credit } from './credits';

/** Pending transport evidence; only the renderer's final load-error promotes it to UI failure. */
export class RequestDiagnostics {
  private pending = new Map<string, string>();
  response(url: string, status: number, rootLoaded: boolean) {
    const path = safeUrl(url);
    if (status >= 200 && status < 300) this.pending.delete(path);
    else this.pending.set(path, `${rootLoaded ? 'Tile request' : 'Root/auth request'}: HTTP ${status} (${path}). Check API access, allowed origins and quota, then retry.`);
  }
  rejected(url: string, error: unknown, secret: string) {
    if (error instanceof Error && error.name === 'AbortError') return;
    this.pending.set(safeUrl(url), safeError(error, secret));
  }
  messageFor(url: string | URL | undefined) {
    return url ? this.pending.get(safeUrl(url)) : undefined;
  }
}

export function isIonEndpoint(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname === 'api.cesium.com' && /^\/v1\/assets\/\d+\/endpoint$/.test(parsed.pathname);
  } catch { return false; }
}

/** Endpoint credits apply to external assets too; 0.5.2 omits that branch. */
export function endpointCredits(json: unknown): Credit[] {
  if (!json || typeof json !== 'object' || !('attributions' in json) || !Array.isArray(json.attributions)) return [];
  return json.attributions.flatMap((item: unknown) => {
    if (!item || typeof item !== 'object' || !('html' in item) || typeof item.html !== 'string' || !item.html.trim()) return [];
    return [{ type: 'html', value: item.html }];
  });
}
