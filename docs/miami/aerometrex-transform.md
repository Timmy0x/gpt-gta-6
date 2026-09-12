# Supplied Aerometrex coordinates

This adapter prepares a delivered model for this project's existing geographic frame. It has not imported or verified an actual Aerometrex delivery. No public viewer internals, textures or tiles were extracted.

The official [Miami 3D model page](https://aerometrex.com/models/miami-3d-model-2cm/) advertises a January–April 2021 capture, 2 cm GSD, 9.1 km² coverage, 5 cm absolute XYZ RMSE, NAD83 horizontal coordinates, NAVD88 heights and UTM zone 17N. It lists OBJ, FBX, Cesium 3D Tiles and Esri I3S–SLPK. These are advertised product specifications, not measurements of a delivery or evidence of current building conditions. The public labels do not establish the precise NAD83 realization, coordinate epoch where applicable, model-local origin, axes, units or control coordinates needed by an importer.

## Contract

`src/world/miami/AerometrexTransform.ts` exports `createAerometrexTransform(reference, operation?)`. It returns:

- `position([a,b,c])`: JavaScript double-precision `[eastM, NAVD88M, northM]` in the frame defined by `projectMiami`.
- `normal([nx,ny,nz], [a,b,c])`: a unit surface normal transformed by the inverse transpose of the local coordinate Jacobian.
- `reversesWinding`: whether the coordinate operation reverses handedness. The parser must combine this with its source and Babylon triangle-front convention.
- `provenance`: the complete canonical reference signature, declared document/operation fingerprints, control residuals, target origin and vertical datum.

Every reference requires explicit model units (`metre`, `international-foot` or `us-survey-foot`), axis documentation, source metadata and independent control-evidence documents with SHA-256 fingerprints, at least three noncollinear controls, and a stated control tolerance. Controls contain both original source coordinates and independently established Miami coordinates. They must not be calculated from the operation being checked in a real delivery.

The module validates fingerprint syntax; the importer must read the referenced files and verify their actual bytes against those fingerprints. `aerometrexReferenceSignature(reference)` is canonical JSON containing every reference field, not a cryptographic hash. The importer can SHA-256 this string for a compact package fingerprint. Preserve the source metadata and coordinate-operation definitions beside the generated package.

## Explicit native delivery

Use `kind: 'native-miami'` only for a delivery already prepared for this project's frame. It must declare:

- `horizontalFrame: 'projectMiami:WGS84-tangent-ENU'`.
- `verticalFrame: 'EPSG:5703'` (NAVD88).
- An origin exactly equal to `MIAMI_ORIGIN`: longitude −80.193°, latitude 25.765°, elevation 0 m.
- `sourceMetresToMiami`: a column-major rigid 4×4 matrix. Original model coordinates are first converted using `sourceUnit`; matrix translation is metres. Reflections are allowed and reported. Unexplained scale, shear and projective matrices are rejected.

The project uses a WGS84 horizontal tangent-plane calculation and carries the supplied NAVD88 survey elevation through as the vertical coordinate. It does not use ellipsoidal ECEF-up as a substitute for NAVD88. A provider's projected UTM delivery is therefore not a native-Miami delivery simply because its units are metres.

## Externally georeferenced delivery

Use `kind: 'external'` with an authority CRS identifier or supplied WKT, explicit horizontal datum realization, epoch when needed, vertical CRS/datum/height type/unit, and the original model origin/axis/projection definition. A display label such as “NAD83 UTM 17N” is rejected.

The separately supplied `AerometrexCoordinateOperation` must be bound to the full reference signature and contain identified, fingerprinted horizontal and vertical operations. `toWgs84Navd88(sourcePoint)` must return `[longitudeDegrees, latitudeDegrees, NAVD88Metres]`; the adapter then calls `projectMiami` for each point. This module supplies no NAD83-to-WGS84 conversion, guessed EPSG code, geoid grid or approximate height correction. If delivered heights already are NAVD88, the vertical operation should be a documented identity with any explicit unit conversion included.

An optional analytic `jacobianToMiami(sourcePoint)` is checked against central differences of the position operation. Without it, stable finite differences are used. Singular derivatives, inconsistent derivatives and changed winding are rejected. Control points and every requested normal are checked; this is not an exhaustive certification of an arbitrary callback at every unsampled location.

## Import integration

Preserve the model's UVs, material assignments and source texture semantics. Apply the coordinate transform in double precision before choosing a local chunk origin and serializing local Float32 vertices. Transform supplied normals at their associated source positions, or recompute normals from transformed geometry when the source has none. Do not apply a second axis, unit or height conversion inside the rendering loader.

The installed `@babylonjs/loaders` 9.25.0 includes both `OBJ/objFileLoader.js` and `FBX/fbxFileLoader.js`; FBX does not inherently require conversion before Babylon can load it. The current bounded local delivery inspector covers an OBJ/MTL profile; an actual mesh importer has not yet been implemented or tested against a provider delivery. No general delivery-compatible I3S/3D Tiles importer is established by this module; the existing County-specific I3S decoder is a separate source pipeline.

## Verification and limits

`node --import tsx --test tests/aerometrex-transform.test.ts`: 6 tests pass. They cover unit/axis/height preservation, reflection, matrix isolation, rejected missing reference fields, actual control misalignment, collinear controls, supplied horizontal and vertical operations, inverse-transpose normals and invalid Jacobians. Full project `tsc --noEmit` also passes for this source candidate.

The external operation fixture is deliberately synthetic. It does not demonstrate a real UTM/geoid conversion or validate Aerometrex survey accuracy. Final acceptance still requires the authorized delivery, its actual metadata and coordinate operations, independent controls across the area and elevation range, and visual/physical checks of the delivered geometry.
