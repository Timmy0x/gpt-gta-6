import { MIAMI_ORIGIN, projectMiami } from './projection';

export type AerometrexPoint = readonly [number, number, number];
export type AerometrexLengthUnit = 'metre' | 'international-foot' | 'us-survey-foot';
export interface AerometrexControlPoint {
  id: string;
  /** Original model coordinates, before axis/unit/origin conversion. */
  source: AerometrexPoint;
  /** Independent control coordinates in the project's east/up/north frame. */
  miami: AerometrexPoint;
}
interface ReferenceBase {
  version: 1;
  id: string;
  sourceUnit: AerometrexLengthUnit;
  /** Delivery documentation must explain the model's axis convention. */
  axisConvention: string;
  sourceMetadata: { document: string; sha256: string };
  controlPointEvidence: { document: string; sha256: string };
  controlPoints: readonly AerometrexControlPoint[];
  maximumControlResidualM: number;
}
export interface AerometrexNativeMiamiReference extends ReferenceBase {
  kind: 'native-miami';
  horizontalFrame: 'projectMiami:WGS84-tangent-ENU';
  verticalFrame: 'EPSG:5703';
  origin: { latitude: number; longitude: number; elevationM: number };
  /** Column-major rigid matrix, applied AFTER source units become metres.
   * Reflection is permitted; shear and scale are not. Translation is metres. */
  sourceMetresToMiami: readonly number[];
}
export interface AerometrexExternalReference extends ReferenceBase {
  kind: 'external';
  horizontalFrame: {
    /** An authority identifier or full supplied WKT; a display name is insufficient. */
    crs: string;
    datumRealization: string;
    coordinateEpoch?: number;
  };
  verticalFrame: {
    crs: string;
    datum: string;
    heightType: 'orthometric' | 'ellipsoidal';
    unit: AerometrexLengthUnit;
  };
  /** Original local origin/axes/projection details remain in supplied metadata.
   * The injected operation is responsible for all of them, not this adapter. */
  coordinateDefinition: string;
}
export type AerometrexReference = AerometrexNativeMiamiReference | AerometrexExternalReference;

export interface AerometrexCoordinateOperation {
  id: string;
  definitionSha256: string;
  sourceReferenceSignature: string;
  target: 'WGS84-horizontal/NAVD88-metres';
  horizontalOperation: { id: string; definitionSha256: string };
  /** Includes the supplied geoid/grid conversion for ellipsoidal heights, or
   * an explicitly documented identity when source heights already are NAVD88. */
  verticalOperation: { id: string; definitionSha256: string };
  reversesWinding: boolean;
  /** Returns [WGS84 longitude degrees, latitude degrees, NAVD88 metres]. */
  toWgs84Navd88(source: AerometrexPoint): AerometrexPoint;
  /** Optional exact local derivative: column-major d[ENU]/d[source coordinate].
   * It is checked against finite differences before being used for normals. */
  jacobianToMiami?(source: AerometrexPoint): readonly number[];
}

const sha256 = /^[a-f\d]{64}$/i;
const unitMetres: Record<AerometrexLengthUnit, number> = {
  metre: 1, 'international-foot': .3048, 'us-survey-foot': 1200 / 3937,
};
const missing = (value: unknown): boolean => typeof value !== 'string' || !value.trim() || /^(unknown|unspecified|assumed|none|tbd)$/i.test(value.trim());
const point = (value: AerometrexPoint): boolean => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
const length = (value: AerometrexPoint): number => Math.hypot(...value);
const subtract = (a: AerometrexPoint, b: AerometrexPoint): [number, number, number] => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: AerometrexPoint, b: AerometrexPoint): [number, number, number] => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: AerometrexPoint, b: AerometrexPoint): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function requireEvidence(value: { document: string; sha256: string } | undefined, name: string): void {
  if (!value || missing(value.document) || !sha256.test(value.sha256)) throw new TypeError(`Missing Aerometrex ${name} document/fingerprint`);
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => JSON.stringify(k) + ':' + canonical(v)).join(',') + '}';
  return JSON.stringify(value);
}
/** Bind an operation to ALL supplied reference fields, not just an ambiguous
 * label such as "NAD83 UTM17N". Callers separately verify source-document hashes. */
export function aerometrexReferenceSignature(metadata: AerometrexReference): string { return canonical(metadata); }

export function validateAerometrexReference(metadata: AerometrexReference): void {
  if (!metadata || metadata.version !== 1 || missing(metadata.id) || !Object.hasOwn(unitMetres,metadata.sourceUnit) || missing(metadata.axisConvention)) throw new TypeError('Incomplete Aerometrex reference, units or axes');
  requireEvidence(metadata.sourceMetadata, 'source metadata'); requireEvidence(metadata.controlPointEvidence, 'control-point evidence');
  if (!Number.isFinite(metadata.maximumControlResidualM) || metadata.maximumControlResidualM <= 0 || !Array.isArray(metadata.controlPoints) || metadata.controlPoints.length < 3) throw new TypeError('Aerometrex reference requires at least three independent control points and an explicit residual tolerance');
  const ids = new Set<string>();
  for (const control of metadata.controlPoints) {
    if (missing(control.id) || ids.has(control.id) || !point(control.source) || !point(control.miami)) throw new TypeError('Invalid or duplicate Aerometrex control point');
    ids.add(control.id);
  }
  // Independent points must span a plane in both reference frames. Collinear
  // controls cannot establish rotation about their common axis.
  for (const key of ['source', 'miami'] as const) {
    const origin = metadata.controlPoints[0][key]; let independent = false;
    for (let i = 1; i < metadata.controlPoints.length && !independent; i++) for (let j = i + 1; j < metadata.controlPoints.length; j++) {
      const a = subtract(metadata.controlPoints[i][key], origin), b = subtract(metadata.controlPoints[j][key], origin);
      if (length(a) > 1e-8 && length(b) > 1e-8 && length(cross(a, b)) / (length(a) * length(b)) > 1e-4) { independent = true; break; }
    }
    if (!independent) throw new TypeError('Aerometrex control points are coincident or collinear');
  }
  if (metadata.kind === 'native-miami') {
    if (metadata.horizontalFrame !== 'projectMiami:WGS84-tangent-ENU' || metadata.verticalFrame !== 'EPSG:5703' || !metadata.origin || Object.keys(MIAMI_ORIGIN).some(key => metadata.origin[key as keyof typeof MIAMI_ORIGIN] !== MIAMI_ORIGIN[key as keyof typeof MIAMI_ORIGIN])) throw new TypeError('Native Aerometrex delivery must explicitly match the Miami origin and NAVD88 datum');
    const m = metadata.sourceMetresToMiami;
    if (!Array.isArray(m) || m.length !== 16 || m.some(v => !Number.isFinite(v)) || Math.abs(m[3]) + Math.abs(m[7]) + Math.abs(m[11]) > 1e-12 || Math.abs(m[15] - 1) > 1e-12) throw new TypeError('Invalid Aerometrex rigid matrix');
    const axes = [0, 4, 8].map(i => [m[i], m[i + 1], m[i + 2]] as const);
    if (axes.some(axis => Math.abs(length(axis) - 1) > 1e-8) || Math.abs(dot(axes[0], axes[1])) + Math.abs(dot(axes[0], axes[2])) + Math.abs(dot(axes[1], axes[2])) > 1e-8) throw new TypeError('Aerometrex native transform contains scale or shear; declare units separately');
  } else if (metadata.kind === 'external') {
    const h = metadata.horizontalFrame, v = metadata.verticalFrame;
    const crs = (value: unknown) => typeof value === 'string' && (/^(EPSG:\d+|urn:ogc:def:crs:|https?:\/\/www\.opengis\.net\/def\/crs\/)/i.test(value) || /^(PROJCRS|GEOGCRS|GEODCRS|COMPOUNDCRS|VERTCRS)\[/i.test(value));
    if (!h || !crs(h.crs) || missing(h.datumRealization) || /^NAD83$/i.test(h.datumRealization.trim()) || h.coordinateEpoch !== undefined && !Number.isFinite(h.coordinateEpoch) || !v || !crs(v.crs) || missing(v.datum) || !['orthometric', 'ellipsoidal'].includes(v.heightType) || !Object.hasOwn(unitMetres,v.unit) || missing(metadata.coordinateDefinition)) throw new TypeError('Aerometrex delivery requires explicit horizontal realization and vertical datum metadata; a projection label is insufficient');
  } else throw new TypeError('Unsupported Aerometrex reference kind');
}

/** No CRS or geoid operation is inferred. Native deliveries use their supplied
 * rigid transform; external deliveries require a separately supplied operation. */
export function createAerometrexTransform(metadata: AerometrexReference, operation?: AerometrexCoordinateOperation) {
  validateAerometrexReference(metadata);
  const signature = aerometrexReferenceSignature(metadata), scale = unitMetres[metadata.sourceUnit];
  let map: (source: AerometrexPoint) => [number, number, number], reversesWinding: boolean;
  let nativeJacobian: number[] | undefined;
  if (metadata.kind === 'native-miami') {
    if (operation) throw new TypeError('Native Aerometrex delivery must not also apply an external coordinate operation');
    const m = [...metadata.sourceMetresToMiami];
    map = p => [m[0] * p[0] * scale + m[4] * p[1] * scale + m[8] * p[2] * scale + m[12], m[1] * p[0] * scale + m[5] * p[1] * scale + m[9] * p[2] * scale + m[13], m[2] * p[0] * scale + m[6] * p[1] * scale + m[10] * p[2] * scale + m[14]];
    nativeJacobian = [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]].map(n => n * scale);
    reversesWinding = determinant(nativeJacobian) < 0;
  } else {
    if (!operation || missing(operation.id) || !sha256.test(operation.definitionSha256) || operation.sourceReferenceSignature !== signature || operation.target !== 'WGS84-horizontal/NAVD88-metres' || typeof operation.toWgs84Navd88 !== 'function' || typeof operation.reversesWinding !== 'boolean') throw new TypeError('Aerometrex external reference needs a matching supplied coordinate operation');
    for (const [name, transform] of Object.entries({ horizontal: operation.horizontalOperation, vertical: operation.verticalOperation })) if (!transform || missing(transform.id) || !sha256.test(transform.definitionSha256)) throw new TypeError(`Missing supplied Aerometrex ${name} datum operation`);
    map = p => { const geographic = operation.toWgs84Navd88(p); if (!point(geographic)) throw new TypeError('Non-finite Aerometrex coordinate operation result'); return projectMiami(...geographic); };
    reversesWinding = operation.reversesWinding;
  }
  const position = (source: AerometrexPoint): [number, number, number] => {
    if (!point(source)) throw new TypeError('Invalid Aerometrex source point');
    const value = map(source); if (!point(value)) throw new TypeError('Non-finite transformed Aerometrex point'); return value;
  };
  const jacobian = (source: AerometrexPoint): number[] => {
    if (!point(source)) throw new TypeError('Invalid Aerometrex normal origin');
    const calculated = nativeJacobian ?? finiteDifference(position, source, .1 / scale);
    if (!nativeJacobian) {
      const refined = finiteDifference(position, source, .05 / scale);
      const denominator = Math.max(...refined.map(Math.abs), 1e-12);
      if (refined.some((n, i) => Math.abs(n - calculated[i]) > denominator * 2e-4)) throw new TypeError('Unstable Aerometrex local coordinate Jacobian');
    }
    const exact = operation?.jacobianToMiami?.(source), result = exact ? [...exact] : calculated;
    if (result.length !== 9 || result.some(n => !Number.isFinite(n))) throw new TypeError('Invalid supplied Aerometrex Jacobian');
    if (exact && result.some((n, i) => Math.abs(n - calculated[i]) > Math.max(...calculated.map(Math.abs), 1e-12) * 2e-4)) throw new TypeError('Supplied Aerometrex Jacobian disagrees with position operation');
    const det = determinant(result), norm = Math.max(...result.map(Math.abs));
    if (norm < 1e-12 || Math.abs(det) <= norm ** 3 * 1e-10 || (det < 0) !== reversesWinding) throw new TypeError('Aerometrex coordinate Jacobian is singular or changes winding');
    return result;
  };
  const controlResiduals = metadata.controlPoints.map(control => {
    const residualM = length(subtract(position(control.source), control.miami)); jacobian(control.source);
    if (residualM > metadata.maximumControlResidualM) throw new TypeError(`Aerometrex control ${control.id} residual ${residualM.toFixed(6)} m exceeds supplied tolerance`);
    return { id: control.id, residualM };
  });
  return {
    position, reversesWinding,
    normal(sourceNormal: AerometrexPoint, sourcePoint: AerometrexPoint): [number, number, number] {
      if (!point(sourceNormal) || length(sourceNormal) < 1e-12) throw new TypeError('Invalid Aerometrex source normal');
      const j = jacobian(sourcePoint), a = j.slice(0, 3) as [number, number, number], b = j.slice(3, 6) as [number, number, number], c = j.slice(6, 9) as [number, number, number], det = determinant(j);
      const columns = [cross(b, c), cross(c, a), cross(a, b)];
      const transformed = [0, 1, 2].map(axis => columns.reduce((sum, column, i) => sum + column[axis] * sourceNormal[i] / det, 0)) as [number, number, number], magnitude = length(transformed);
      return transformed.map(n => n / magnitude) as [number, number, number];
    },
    provenance: {
      sourceReferenceId: metadata.id, referenceSignature: signature,
      sourceMetadataSha256: metadata.sourceMetadata.sha256, controlPointEvidenceSha256: metadata.controlPointEvidence.sha256,
      operationId: operation?.id ?? 'supplied-native-miami-rigid-transform', operationDefinitionSha256: operation?.definitionSha256 ?? metadata.sourceMetadata.sha256,
      horizontalOperation: operation?.horizontalOperation ?? { id: 'projectMiami:WGS84-tangent-ENU', definitionSha256: metadata.sourceMetadata.sha256 },
      verticalOperation: operation?.verticalOperation ?? { id: 'documented-NAVD88-identity', definitionSha256: metadata.sourceMetadata.sha256 },
      targetOrigin: { ...MIAMI_ORIGIN }, targetVerticalDatum: 'EPSG:5703', units: 'metre', controlResiduals,
      maximumControlResidualM: Math.max(...controlResiduals.map(c => c.residualM)),
      limitation: 'Checks supplied coordinate operation and controls; does not certify source survey accuracy or invent missing datum transformations.',
    },
  };
}
function determinant(m: readonly number[]): number { return dot(m.slice(0, 3) as [number, number, number], cross(m.slice(3, 6) as [number, number, number], m.slice(6, 9) as [number, number, number])); }
function finiteDifference(map: (source: AerometrexPoint) => AerometrexPoint, source: AerometrexPoint, step: number): number[] {
  const result: number[] = [];
  for (let axis = 0; axis < 3; axis++) {
    const a = [...source] as [number, number, number], b = [...source] as [number, number, number]; a[axis] -= step; b[axis] += step;
    const lo = map(a), hi = map(b); result.push(...subtract(hi, lo).map(n => n / (2 * step)));
  }
  return result;
}
