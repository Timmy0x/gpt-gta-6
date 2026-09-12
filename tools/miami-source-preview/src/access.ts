export type Provider = 'fixture' | 'google' | 'ion';
export interface Configuration { provider: Provider; credential: string; assetId: string; fixtureCase: 'normal' | 'root-error' | 'node-error'; }
export function validateConfiguration(provider: string, credential: string, assetId: string, fixtureCase: string): Configuration {
  if (!['fixture', 'google', 'ion'].includes(provider)) throw new Error('Choose a supported source.');
  if (!['normal', 'root-error', 'node-error'].includes(fixtureCase)) throw new Error('Choose a fixture case.');
  if (provider !== 'fixture' && (!credential.trim() || /\s/.test(credential.trim()) || credential.length > 4096)) throw new Error('Enter your own valid API key or token before connecting.');
  if (provider === 'ion' && (!/^\d+$/.test(assetId) || !Number.isSafeInteger(Number(assetId)) || Number(assetId) <= 0)) throw new Error('Enter a positive Cesium ion asset ID.');
  return { provider: provider as Provider, credential: provider === 'fixture' ? '' : credential.trim(), assetId, fixtureCase: fixtureCase as Configuration['fixtureCase'] };
}
export function ecef(latDegrees: number, lonDegrees: number, altitudeM = 0): [number, number, number] {
  const lat = latDegrees * Math.PI / 180, lon = lonDegrees * Math.PI / 180, e2 = 6.6943799901413165e-3;
  const n = 6378137 / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
  return [(n + altitudeM) * Math.cos(lat) * Math.cos(lon), (n + altitudeM) * Math.cos(lat) * Math.sin(lon), (n * (1 - e2) + altitudeM) * Math.sin(lat)];
}
export function safeUrl(value: string | URL) { try { const u = new URL(String(value), 'http://127.0.0.1'); return `${u.host}${u.pathname}`.slice(0, 400); } catch { return 'request'; } }
export function safeError(error: unknown, secret = '') {
  let text = error instanceof Error ? error.message : 'The request could not be completed.';
  if (secret) text = text.split(secret).join('[redacted]');
  return text.replace(/https?:\/\/[^\s"'<>]+/g, value => safeUrl(value)).replace(/((?:key|token|session|access_token)=)[^\s&]+/gi, '$1[redacted]').replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').slice(0, 700);
}
export function rootUrl(config: Configuration) {
  if (config.provider === 'google') return 'https://tile.googleapis.com/v1/3dtiles/root.json';
  if (config.provider === 'ion') return '';
  return `/fixture/${config.fixtureCase === 'root-error' ? 'missing-root.json' : config.fixtureCase === 'node-error' ? 'node-error.json' : 'tileset.json'}`;
}
