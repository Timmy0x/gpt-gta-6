# Shared environment lighting

PBR surfaces use a local prefiltered light probe prepared from [Wide Street 02](https://polyhaven.com/a/wide_street_02), by Sergej Majboroda / Poly Haven, under [CC0](https://polyhaven.com/license). The depicted street is a generic lighting reference; it does not establish Leonida geography. Metadata and original HDR are retained in `data/lighting`; the output license, provenance and hash are in `public/lighting`.

`scripts/assets/prepare-lighting.mjs` runs Babylon's HDR conversion and environment prefilter offline through `prepare-lighting.ts`. The 1,519,162-byte HDR produces a 897,853-byte `.env` with 256-pixel faces, roughness mip levels and spherical harmonics. SHA-256: `7c05d4ac97c2cf6c8b5b9580da74d0ef6e8dcf662676808b99d9cc7ac73423d1`.

At startup, `prepareEnvironmentLighting` loads and validates the local file, rotates it by 0.65 radians and releases the previous fallback texture after success. Download, integrity and decoding failures keep the authored sky probe so play can continue. No remote API or asset request is made by the game. Existing exposure and contrast are retained; the separately captured ACES experiment was not adopted.

Actual WebGL2 and WebGPU evidence in `docs/evidence/lighting-*` reports ready 256-pixel textures, available harmonics and zero browser errors. Integrated character/car and casualty audits also use this lighting. Early WebGPU comparison images contain the subsequently fixed car-spawn overlap; they are not clean composition comparisons. The probe is static and cannot reflect nearby changing objects. These functional checks do not prove the outstanding 30-minute performance gate.
