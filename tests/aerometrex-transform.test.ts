import test from 'node:test';
import assert from 'node:assert/strict';
import { aerometrexReferenceSignature, createAerometrexTransform, validateAerometrexReference, type AerometrexCoordinateOperation, type AerometrexExternalReference, type AerometrexNativeMiamiReference, type AerometrexPoint } from '../src/world/miami/AerometrexTransform';
import { MIAMI_ORIGIN, projectMiami } from '../src/world/miami/projection';

const hash = 'a'.repeat(64), evidence = { document: 'test-fixture-control-survey.json', sha256: hash };
function native(): AerometrexNativeMiamiReference {
  const feet = 1200 / 3937;
  return {
    version: 1, id: 'explicit-native-fixture', kind: 'native-miami', sourceUnit: 'us-survey-foot',
    axisConvention: 'source X east, Y north, Z up; output X east, Y up, Z north',
    sourceMetadata: { document: 'test-fixture-reference.json', sha256: hash }, controlPointEvidence: evidence,
    horizontalFrame: 'projectMiami:WGS84-tangent-ENU', verticalFrame: 'EPSG:5703', origin: { ...MIAMI_ORIGIN },
    sourceMetresToMiami: [1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 100, 4, -30, 1],
    maximumControlResidualM: 1e-8,
    controlPoints: [
      { id: 'origin', source: [0, 0, 0], miami: [100, 4, -30] },
      { id: 'east', source: [100, 0, 0], miami: [100 + 100 * feet, 4, -30] },
      { id: 'north', source: [0, 100, 0], miami: [100, 4, -30 + 100 * feet] },
      { id: 'height', source: [0, 0, 100], miami: [100, 4 + 100 * feet, -30] },
    ],
  };
}
const close = (actual: AerometrexPoint, expected: AerometrexPoint, tolerance = 1e-8) => actual.forEach((n, i) => assert.ok(Math.abs(n - expected[i]) < tolerance, `${actual} != ${expected}`));

test('native delivery preserves declared metric origin, US survey feet, vertical datum and source-axis orientation', () => {
  const reference = native(), transform = createAerometrexTransform(reference);
  close(transform.position([3937, 0, 0]), [1300, 4, -30]);
  close(transform.position([0, 0, 3937]), [100, 1204, -30]);
  close(transform.normal([0, 0, 1], [0, 0, 0]), [0, 1, 0]);
  close(transform.normal([1, 0, 0], [0, 0, 0]), [1, 0, 0]);
  assert.equal(transform.reversesWinding, true);
  assert.equal(transform.provenance.maximumControlResidualM, 0); assert.equal(transform.provenance.targetVerticalDatum, 'EPSG:5703');
  assert.equal(transform.provenance.referenceSignature, aerometrexReferenceSignature(reference));
  // Construction captures the declared matrix; later importer scene transforms
  // cannot silently move this established geographic reference.
  (reference.sourceMetresToMiami as number[])[12] += 1000;
  close(transform.position([0, 0, 0]), [100, 4, -30]);
});

test('native transform refuses origin/datum omissions, projection guesses, shear and uncontrolled scale', () => {
  assert.throws(() => createAerometrexTransform({ ...native(), origin: { ...MIAMI_ORIGIN, longitude: -80.2 } } as AerometrexNativeMiamiReference), /Miami origin/);
  assert.throws(() => createAerometrexTransform({ ...native(), verticalFrame: 'ellipsoid' } as unknown as AerometrexNativeMiamiReference), /NAVD88/);
  for (const sourceUnit of [undefined, 'feet', '__proto__']) assert.throws(() => createAerometrexTransform({ ...native(), sourceUnit } as unknown as AerometrexNativeMiamiReference), /units/);
  for (const edit of [(m: number[]) => m[0] = 2, (m: number[]) => m[4] = .1, (m: number[]) => m[3] = .1]) {
    const reference = native(), matrix = [...reference.sourceMetresToMiami]; edit(matrix); reference.sourceMetresToMiami = matrix;
    assert.throws(() => createAerometrexTransform(reference), /scale or shear|rigid matrix/);
  }
  assert.throws(() => createAerometrexTransform({ ...native(), controlPointEvidence: { document: '', sha256: hash } }), /control-point evidence/);
});

test('control points reject actual placement/height errors and underdetermined alignment', () => {
  const wrong = native(), matrix = [...wrong.sourceMetresToMiami]; matrix[13] += .03; wrong.sourceMetresToMiami = matrix;
  assert.throws(() => createAerometrexTransform(wrong), /residual 0.030000 m/);
  const line = native(); line.controlPoints = [0, 1, 2].map(i => ({ id: 'line' + i, source: [i, 0, 0], miami: [i, 0, 0] }));
  assert.throws(() => createAerometrexTransform(line), /collinear/);
  assert.throws(() => createAerometrexTransform({ ...native(), maximumControlResidualM: NaN }), /residual tolerance/);
});

/** A deliberately synthetic operation, not a UTM/geoid implementation. It
 * lets the tests prove that the adapter invokes the supplied height operation
 * and transforms sloping normals instead of silently using raw elevation. */
function external(): { reference: AerometrexExternalReference; operation: AerometrexCoordinateOperation } {
  const toGeographic = ([x, y, z]: AerometrexPoint): AerometrexPoint => [MIAMI_ORIGIN.longitude + x / 100000, MIAMI_ORIGIN.latitude + y / 100000, z - 24 + .1 * x];
  const reference: AerometrexExternalReference = {
    version: 1, id: 'synthetic-external-fixture', kind: 'external', sourceUnit: 'metre', axisConvention: 'X east,Y north,Z height',
    sourceMetadata: { document: 'synthetic-reference.json', sha256: hash }, controlPointEvidence: evidence,
    horizontalFrame: { crs: 'EPSG:32617', datumRealization: 'WGS84(G2139)', coordinateEpoch: 2024 },
    verticalFrame: { crs: 'EPSG:4979', datum: 'WGS84 ellipsoid', heightType: 'ellipsoidal', unit: 'metre' },
    coordinateDefinition: 'Synthetic affine test coordinates only; not a real projection operation.', maximumControlResidualM: .001,
    controlPoints: [[0, 0, 25], [100, 0, 25], [0, 100, 25]].map((source, i) => ({ id: 'synthetic-' + i, source: source as unknown as AerometrexPoint, miami: projectMiami(...toGeographic(source as unknown as AerometrexPoint)) })),
  };
  return { reference, operation: {
    id: 'synthetic-test-operation', definitionSha256: hash, sourceReferenceSignature: aerometrexReferenceSignature(reference), target: 'WGS84-horizontal/NAVD88-metres', reversesWinding: true,
    horizontalOperation: { id: 'synthetic-test-horizontal', definitionSha256: hash }, verticalOperation: { id: 'synthetic-test-sloping-height-correction', definitionSha256: hash }, toWgs84Navd88: toGeographic,
  } };
}

test('external geometry uses the supplied horizontal and vertical operations and local inverse-transpose normal', () => {
  const { reference, operation } = external(), transform = createAerometrexTransform(reference, operation);
  close(transform.position([0, 0, 25]), [0, 1, 0]);
  assert.equal(transform.reversesWinding, true); assert.equal(transform.provenance.verticalOperation.id, 'synthetic-test-sloping-height-correction');
  const source: AerometrexPoint = [20, 40, 25], normal = transform.normal([0, 0, 1], source), p = transform.position(source);
  assert.ok(normal[1] > .98 && normal[0] < -.08, 'normal tilts with supplied height correction');
  for (const q of [[20.01, 40, 25], [20, 40.01, 25]] as const) {
    const tangent = transform.position(q).map((n, i) => n - p[i]);
    assert.ok(Math.abs(tangent.reduce((sum, n, i) => sum + n * normal[i], 0)) < 1e-6, 'transformed normal is perpendicular to the transformed surface');
  }
  assert.ok(Math.abs(Math.hypot(...normal) - 1) < 1e-10);
});

test('external references cannot turn a CRS label or incomplete datum operation into georeferencing', () => {
  const { reference, operation } = external();
  assert.throws(() => createAerometrexTransform(reference), /matching supplied/);
  assert.throws(() => validateAerometrexReference({ ...reference, horizontalFrame: { crs: 'NAD83 UTM17N', datumRealization: 'NAD83' } }), /projection label/);
  assert.throws(() => validateAerometrexReference({ ...reference, horizontalFrame: { crs: 'EPSG:26917', datumRealization: 'NAD83' } }), /realization/);
  assert.throws(() => createAerometrexTransform(reference, { ...operation, verticalOperation: undefined } as unknown as AerometrexCoordinateOperation), /vertical datum operation/);
  assert.throws(() => createAerometrexTransform({ ...reference, axisConvention: 'different axes' }, operation), /matching supplied/);
  assert.throws(() => createAerometrexTransform(reference, { ...operation, reversesWinding: false }), /winding/);
});

test('external normals reject singular, false and unstable supplied derivatives', () => {
  const { reference, operation } = external();
  assert.throws(() => createAerometrexTransform(reference, { ...operation, jacobianToMiami: () => [1, 0, 0, 0, 1, 0, 0, 0, 1] }), /Jacobian disagrees/);
  const singular = { ...operation, toWgs84Navd88: (p: AerometrexPoint) => { const g = operation.toWgs84Navd88(p); return [g[0], g[1], 1] as const; } };
  assert.throws(() => createAerometrexTransform(reference, singular), /singular/);
  const transform = createAerometrexTransform(reference, operation);
  assert.throws(() => transform.normal([0, 0, 0], [0, 0, 0]), /source normal/);
  assert.throws(() => transform.position([Infinity, 0, 0]), /source point/);
});
