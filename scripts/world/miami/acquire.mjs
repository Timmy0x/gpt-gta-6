import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// Public feature services, never a basemap image/tile or Google-derived geometry.
const root = new URL('../../../data/world/miami/', import.meta.url);
const bbox = [-80.199, 25.7596, -80.187, 25.7704];
const sources = [
  { id: 'city-streets', item: '7b7976cac8b34db29213d87ca2b65f05', kind: 'roads' },
  { id: 'city-shoreline', item: '8dac762373f743ce8e0e814966dd160d', kind: 'shoreline' },
  { id: 'city-water', item: '8af681a358bc48a7aeade4ad7669258f', kind: 'water' },
  { id: 'city-boundary', item: 'b583ea2da62445b195ddeb0c3f479e7d', kind: 'boundary', complete: true },
  { id: 'county-buildings', item: 'd511e9ebc5aa4f49a23ff5fa2fb99786', kind: 'buildings' },
  { id: 'county-ubid', item: '7abe7f01391b4113b05030414669fef5', kind: 'building-addresses', fields: 'OBJECTID,UBID,UNIQUEID,ADDRESS,SOURCE,TYPE,BLDG_HEIGHT,FLOORS,YEAR_BUILT,BLDG_TYPE' },
];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
async function download(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const json = JSON.parse(bytes.toString());
  if (json.error) throw new Error(JSON.stringify(json.error));
  return { bytes, json };
}
function query(url, parameters) { return `${url}/query?${new URLSearchParams(parameters)}`; }
await mkdir(new URL('raw/', root), { recursive: true });
await mkdir(new URL('metadata/', root), { recursive: true });
const manifest = {
  version: 1, id: 'brickell-core-r1', retrieved: new Date().toISOString(),
  bboxWgs84: bbox, origin: { longitude: -80.193, latitude: 25.765, elevationM: 0 },
  projection: 'src/world/miami/projection.ts WGS84 ECEF horizontal ENU; X east, Z north, Y independent survey elevation; no distance compression',
  geometryPolicy: 'All source features intersecting AOI retained in full without simplification or clipping; adjacent tiles deduplicate by stable source ID. City boundary is complete.',
  heightPolicy: 'County HEIGHT retained raw: unit and height-vs-elevation semantics absent from authoritative metadata; do not silently interpret as metres.',
  sources: [],
};
for (const source of sources.filter(s => !process.env.MIAMI_SOURCE || s.id === process.env.MIAMI_SOURCE)) {
  const itemUrl = `https://www.arcgis.com/sharing/rest/content/items/${source.item}?f=pjson`;
  const item = await download(itemUrl);
  await writeFile(new URL(`metadata/${source.id}-item.json`, root), item.bytes);
  const license = item.json.licenseInfo ?? '';
  if (source.id.startsWith('city-') && !license.includes('creativecommons.org/licenses/by/4.0')) throw new Error(`City license changed: ${source.id}`);
  if (source.id === 'county-buildings' && !license.includes('provides this data for use')) throw new Error('County terms changed');
  const layerUrl = `${item.json.url}/0`;
  const layer = await download(`${layerUrl}?f=pjson`);
  await writeFile(new URL(`metadata/${source.id}-layer.json`, root), layer.bytes);
  const spatial = source.complete ? {} : { geometry: bbox.join(','), geometryType: 'esriGeometryEnvelope', inSR: '4326', spatialRel: 'esriSpatialRelIntersects' };
  const idUrl = query(layerUrl, { f: 'json', where: '1=1', returnIdsOnly: 'true', ...spatial });
  const idsResult = await download(idUrl);
  const ids = (idsResult.json.objectIds ?? []).sort((a, b) => a - b);
  const features = [], requests = [{ url: idUrl, sha256: sha256(idsResult.bytes) }];
  for (let offset = 0; offset < ids.length; offset += 200) {
    const url = query(layerUrl, { f: 'geojson', objectIds: ids.slice(offset, offset + 200).join(','), outFields: source.fields ?? '*', outSR: '4326', returnGeometry: 'true' });
    const batch = await download(url);
    if (batch.json.exceededTransferLimit) throw new Error(`Truncated batch ${source.id}`);
    features.push(...batch.json.features); requests.push({ url, sha256: sha256(batch.bytes) });
  }
  const oid = layer.json.objectIdField;
  features.sort((a, b) => a.properties[oid] - b.properties[oid]);
  const actualIds = features.map(f => f.properties[oid]).sort((a, b) => a - b);
  if (JSON.stringify(actualIds) !== JSON.stringify(ids)) throw new Error(`Incomplete IDs ${source.id}: ${actualIds.length}/${ids.length}`);
  const data = JSON.stringify({ type: 'FeatureCollection', name: source.id, features }) + '\n';
  const path = `raw/${source.id}.geojson`;
  await writeFile(new URL(path, root), data);
  manifest.sources.push({ ...source, title: item.json.title, url: layerUrl, itemUrl, sourceModified: new Date(item.json.modified).toISOString(), retrieved: manifest.retrieved, license: source.id.startsWith('city-') ? 'CC-BY-4.0' : 'Miami-Dade County custom public-data as-is terms', licenseInfo: license, attribution: item.json.accessInformation, objectIdField: oid, featureCount: features.length, path, sha256: sha256(data), requests });
  console.log(source.id, features.length, sha256(data));
}
if (process.env.MIAMI_SOURCE) {
  const previous=JSON.parse(await readFile(new URL('manifest.json',root),'utf8'));
  previous.sources=previous.sources.filter(s=>s.id!==process.env.MIAMI_SOURCE).concat(manifest.sources);
  await writeFile(new URL('manifest.json',root),JSON.stringify(previous,null,2)+'\n');
} else await writeFile(new URL('manifest.json', root), JSON.stringify(manifest, null, 2) + '\n');
