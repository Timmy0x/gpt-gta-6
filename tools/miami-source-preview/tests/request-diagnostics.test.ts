import test from 'node:test';
import assert from 'node:assert/strict';
import { RequestDiagnostics, endpointCredits, isIonEndpoint } from '../src/request-diagnostics';

test('transport evidence survives final403 but clears after successful auth refresh', () => {
  const diagnostic = new RequestDiagnostics();
  const url = 'https://tile.googleapis.com/v1/3dtiles/root.json?key=dummy&session=old';
  diagnostic.response(url, 401, false);
  assert.match(diagnostic.messageFor(url)!, /Root\/auth request: HTTP 401/);
  diagnostic.response(url.replace('old', 'new'), 200, false);
  assert.equal(diagnostic.messageFor(url), undefined);
  diagnostic.response(url, 403, false);
  const final = diagnostic.messageFor(url)!;
  assert.match(final, /HTTP 403/);
  assert.ok(!final.includes('dummy'));
  assert.ok(!final.includes('session='));
});

test('intentional tile aborts do not become transport failures', () => {
  const diagnostic = new RequestDiagnostics();
  diagnostic.rejected('https://example.org/a.glb', new DOMException('Cancelled by eviction', 'AbortError'), 'dummy');
  assert.equal(diagnostic.messageFor('https://example.org/a.glb'), undefined);
  diagnostic.rejected('https://example.org/b.glb?key=dummy', new Error('Network failure dummy'), 'dummy');
  assert.equal(diagnostic.messageFor('https://example.org/b.glb'), 'Network failure [redacted]');
  assert.equal(diagnostic.messageFor('https://example.org/a.glb'), undefined);
});

test('external ion endpoint credits are preserved alongside renderer credits', () => {
  const endpoint = { externalType: 'GOOGLE_3D_TILES', options: { url: 'https://tile.googleapis.com/v1/3dtiles/root.json?key=dummy' }, attributions: [{ html: '<a href="https://example.org/">Required endpoint credit</a>', collapsible: false }, { html: 'Second credit' }] };
  assert.deepEqual(endpointCredits(endpoint), [{ type: 'html', value: endpoint.attributions[0].html }, { type: 'html', value: 'Second credit' }]);
  assert.deepEqual(endpointCredits({ attributions: [null, {}, { html: 3 }] }), []);
  assert.deepEqual(endpointCredits(null), []);
  assert.equal(isIonEndpoint('https://api.cesium.com/v1/assets/2275207/endpoint?access_token=dummy'), true);
  assert.equal(isIonEndpoint('https://api.cesium.com.attacker.example/v1/assets/1/endpoint'), false);
});
