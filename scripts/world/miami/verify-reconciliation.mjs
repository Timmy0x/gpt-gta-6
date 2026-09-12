import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('../../../data/world/miami/', import.meta.url);
const read = async path => JSON.parse(await readFile(new URL(path, root), 'utf8'));
const source = await read('building-meshes.json');
const footprints = await read('building-mesh-footprints.json');
const reconciliation = await read('building-spatial-reconciliation.json');
const sections = await read('701-source-sections.json');
const raw = await read('raw/county-buildings.geojson');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(hash(await readFile(new URL(source.binary, root))), source.sha256);
for (const derived of [footprints, reconciliation, sections]) assert.equal(derived.sourceBinarySha256, source.sha256);
assert.deepEqual(footprints.failures, []);
assert.deepEqual(reconciliation.sourceMeshFootprintFailures, []);
assert.equal(footprints.buildings.length, source.buildings.length);
assert.equal(reconciliation.rows.length, raw.features.length);
const sourceIds = new Set(source.buildings.map(building => building.id));
assert.equal(new Set(footprints.buildings.map(building => building.id)).size, sourceIds.size);
for (const building of footprints.buildings) {
  assert.ok(sourceIds.has(building.id));
  assert.ok(Number.isFinite(building.areaM2) && building.areaM2 > 0);
  for (const polygon of building.polygons) for (const ring of polygon) {
    assert.ok(ring.length >= 4);
    assert.deepEqual(ring[0], ring.at(-1));
    assert.ok(ring.every(point => point.length === 2 && point.every(Number.isFinite)));
  }
}
const rawById = new Map(raw.features.map(feature => [feature.properties.GlobalID, feature]));
const exact = [];
for (const row of reconciliation.rows) {
  const feature = rawById.get(row.id.replace('county-buildings:', ''));
  assert.ok(feature, `Missing current footprint ${row.id}`);
  assert.equal(row.uniqueId, feature.properties.UNIQUEID);
  for (const candidate of row.candidates) {
    assert.ok(sourceIds.has(candidate.id));
    for (const key of ['fractionOfInput', 'fractionOfMesh', 'intersectionOverUnion'])
      assert.ok(Number.isFinite(candidate[key]) && candidate[key] > 0 && candidate[key] <= 1 + 1e-8, `${row.id} ${key}`);
  }
  if (row.uniqueId) {
    const match = row.candidates.find(candidate => candidate.sourceUniqueId === row.uniqueId);
    assert.ok(match, `Exact source identity has no geometric intersection: ${row.id}`);
    assert.equal(row.candidates[0].id, match.id, `Another building overlaps more than the exact source identity: ${row.id}`);
    assert.ok(match.intersectionOverUnion > .98, `Exact footprint differs materially: ${row.id}`);
    exact.push(match);
  }
}
const newer = reconciliation.rows.filter(row => !row.uniqueId);
const covered = newer.filter(row => row.candidates[0]?.fractionOfInput > .95);
assert.equal(reconciliation.summary.newerParts, newer.length);
assert.equal(reconciliation.summary.newerPartsAtLeast95PercentCovered, covered.length);
assert.equal(reconciliation.summary.newerPartsRequiringReview, newer.length - covered.length);
assert.equal(sections.sourceId, 'county-i3s:316');
assert.equal(sections.sourceUniqueId, 'D1_MDC_Building_426');
assert.equal(sections.sections.length, 8);
for (const section of sections.sections) {
  assert.deepEqual(section.openPaths, []);
  assert.ok(Number.isFinite(section.areaM2) && section.areaM2 > 0);
  for (const polygon of section.polygons) for (const ring of polygon) {
    assert.ok(ring.length >= 4);
    assert.deepEqual(ring[0], ring.at(-1));
    assert.ok(ring.every(point => point.every(Number.isFinite)));
  }
}
const result = {
  version: 1, status: 'pass', scope: 'Source identity and geometric reconciliation; not contemporary architectural fidelity acceptance',
  sourceBinarySha256: source.sha256, sourceMeshes: footprints.buildings.length,
  currentFootprints: reconciliation.rows.length, exactSourceMatches: exact.length,
  minimumExactIntersectionOverUnion: Math.min(...exact.map(match => match.intersectionOverUnion)),
  minimumExactInputCoverage: Math.min(...exact.map(match => match.fractionOfInput)),
  newerParts: reconciliation.summary.newerParts,
  newerPartsAtLeast95PercentCovered: reconciliation.summary.newerPartsAtLeast95PercentCovered,
  newerPartsRequiringReview: reconciliation.summary.newerPartsRequiringReview,
  closed701InspectionSections: sections.sections.length,
  gaps: ['Horizontal overlap alone does not prove unchanged height, facade, address or physical building identity.', '701 source massing lacks rounded corners visible in the licensed reference and contains nested volumes.'],
};
await writeFile(new URL('spatial-verification.json', root), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
