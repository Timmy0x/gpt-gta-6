import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

// Metadata is retained from Poly Haven's official /info and /files API endpoints.
// Download only the publisher's 1K maps, unchanged; no preview renders are redistributed.
const assets = ['asphalt_02', 'sand_03'];
const hash = (type, bytes) => createHash(type).update(bytes).digest('hex');
const entries = [];
for (const id of assets) {
  const info = JSON.parse(await readFile(`data/surfaces/${id}/info.json`));
  const files = JSON.parse(await readFile(`data/surfaces/${id}/files.json`));
  const maps = [];
  await mkdir(`public/surfaces/${id}`, { recursive: true });
  for (const [channel, output] of [['Diffuse', 'color'], ['nor_gl', 'normal'], ['arm', 'arm']]) {
    const file = files[channel]['1k'].jpg;
    assert.equal(new URL(file.url).hostname, 'dl.polyhaven.org');
    const response = await fetch(file.url); assert.ok(response.ok, `${file.url}: ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(bytes.length, file.size); assert.equal(hash('md5', bytes), file.md5);
    const path = `${id}/${output}.jpg`; await writeFile(`public/surfaces/${path}`, bytes);
    maps.push({ channel, path, source: file.url, bytes: bytes.length, md5: file.md5, sha256: hash('sha256', bytes) });
  }
  entries.push({ id, name: info.name, authors: info.authors, source: `https://polyhaven.com/a/${id}`, license: 'CC0-1.0', tileMetres: info.dimensions.map(n => n / 1000), maps });
}
const manifest = { version: 1, provider: 'Poly Haven', providerCredit: 'Powered by Poly Haven', license: 'https://polyhaven.com/license', acquired: '2026-09-09', modifications: 'Publisher-provided 1K JPEG maps copied unchanged. Albedo, OpenGL normals and packed red AO / green roughness / blue metalness are interpreted by Babylon PBR at source scale.', entries };
await writeFile('public/surfaces/manifest.json', JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ assets: entries.map(e => ({ id: e.id, tileMetres: e.tileMetres, bytes: e.maps.reduce((sum, m) => sum + m.bytes, 0) })) }));
