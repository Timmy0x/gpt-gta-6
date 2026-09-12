# Local Aerometrex delivery inspection

This checkpoint prepares local OBJ deliveries and coordinate transformations. It does not contain a Miami delivery, an Aerometrex mesh importer or a finished city. The provider access request and initial coverage polygon are in `aerometrex-access.md` and `data/world/miami/aerometrex/request-aoi.geojson`.

Put an authorized delivery in `.private-data/aerometrex/miami/` or a separate private local directory. The repository ignores `.private-data/`; nothing from a delivery belongs in `public/` or the public Git repository. Keep generated inventory reports and any URLs containing delivery credentials private as well.

The inspector accepts a JSON descriptor with `version: 1`, `provider: "Aerometrex"`, `use: "personal-local"`, `format: "obj"`, an `id`, the actual `capture` and `source`, a `models` array of relative OBJ filenames, and relative filenames for `coordinateMetadata` and `accessRecord`. Those two reference files must be present. An access record is retained documentation, not an automated license approval.

```sh
node --import tsx scripts/world/miami/aerometrex/inspect-delivery.ts \
  .private-data/aerometrex/miami \
  .private-data/aerometrex/miami/delivery.json \
  > .private-data/aerometrex/miami/inventory.json
```

The command reads local files only. It checks the supported OBJ/MTL profile, material and texture dependencies, contained paths and file hashes. Unsupported material semantics must be converted explicitly; they must not disappear silently. Passing these checks does not prove that images decode correctly, that the geometry matches Miami, or that geographic transforms and gameplay collision are complete.

The coordinate adapter contract is documented in `aerometrex-transform.md`. It carries declared units, axes, horizontal and vertical references, and independent control points through transformation. The eventual importer must verify the actual metadata/operation document hashes, preserve original texture coordinates and material assignments, and choose local chunk origins before serializing Float32 positions.

After receiving a real sample, implement the parser/conversion path against that package, check geographic control residuals, compare source and rendered views, and test walking/driving clearance. Only then integrate its streamed render and collision packages into a local game build. Synthetic fixtures in the tests validate code behavior; they are not evidence of Miami reconstruction.
