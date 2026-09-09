# Aircraft cockpit seating

The trainer's former generic two-seat offset placed the pilot too far left for its tapered canopy. Its opaque fuselage top also crossed the cockpit interior beneath the glass. The helicopter's pilot position was close to the sloping roof, while opaque front fuselage faces covered the front glazing.

The aircraft now supply their own seat positions in `src/vehicles/models.ts`: the plane uses `(0, -0.86, -0.10)` and the helicopter uses `(-0.30, -0.88, 0.35)` in chassis-local metres. These are origins of the standing character rig used by the existing upright seated pose, not cushion heights. Seat cushions and backs support the seated pose. The plane's top surface under the canopy is open; the helicopter's forward roof/sides behind its windscreen are open, with a lower cockpit shell retained beneath the glass. The helicopter canopy starts at the matching fuselage section boundary.

The change is confined to aircraft visual geometry and seat configuration. Handling parameters, flight forces, controls, and collision dimensions are unchanged. Existing damage-panel counts and vertex layouts remain `20/12/16` vertices for the plane and `20/12/8` for the helicopter, so serialized deformation arrays retain their existing layout. The new lower shell and seat furniture do not add serialized deformation panels.

## Geometry verification

`node --import tsx --test tests/aircraft-seating.test.ts tests/aircraft-controls.test.ts` passes all three targeted tests. The seating test evaluates every visible skinned vertex for Jason and Lucia, with both licensed skins and the procedural fallbacks: 79,452 vertex checks across eight combinations in intact aircraft. Rays against the actual cockpit roof/glazing and fuselage floor verify containment, rather than checking only the character origin or unskinned bounding box.

| Aircraft | Minimum roof clearance across both characters and both representations | Minimum floor clearance |
| --- | ---: | ---: |
| Plane | 10.27 cm | 7.90 cm |
| Helicopter | 5.08 cm | 6.37 cm |

## Normal-game verification

Final WebGPU and WebGL2 checks use `tests/aircraft-seating-audit.mjs` against the frozen `.local-builds/aircraft-seat-v3` candidate at `http://127.0.0.1:4197`. The harness uses normal Creative spawns, `E` entry, mouse camera orbit, `Tab` switching, and the displayed takeoff keys. It reads diagnostics without changing game state or camera transforms. Ground captures cover rear/side views of both characters and additional helicopter front views; both characters are also captured airborne.

Candidate fingerprint:

- Main script: `/assets/index-CxJrQY1k.js`
- SHA-256: `0e304f177228f219ba9cc1c5ccad41347655f108c4deedb543f41583541e5dcc`
- World build: `authored-860409-v6-dry-sand`

Both actual renderer paths passed all 16 recorded checks each, with zero assertion or page errors. Every flight capture retained 100 aircraft health; both characters were captured above 8 m in each aircraft on each backend. Side/front and airborne captures were visually inspected: the plane pilot remains inside the canopy and the helicopter pilot is visible through the windscreen without protruding through the shell. The candidate main-script fingerprint is identical to the parent integration build `coastal-detail-v8`.

- [WebGPU results and telemetry](evidence/aircraft-seating-webgpu/result.json)
- [WebGL2 results and telemetry](evidence/aircraft-seating-webgl/result.json)
- [Jason inside the helicopter](evidence/aircraft-seating-webgpu/helicopter-jason-ground-front.png)
- [Lucia inside the helicopter](evidence/aircraft-seating-webgl/helicopter-lucia-ground-front.png)
- [Lucia inside the plane canopy](evidence/aircraft-seating-webgl/plane-lucia-ground-side.png)
- [Jason airborne in the plane](evidence/aircraft-seating-webgpu/plane-jason-airborne.png)
- [Targeted test log](evidence/aircraft-seating-tests.log)
- [Production build log](evidence/aircraft-seating-build.log)

Each renderer folder contains 14 captures covering the two aircraft and both characters. Reproduce with `AUDIT_BACKEND=webgpu node tests/aircraft-seating-audit.mjs` and `AUDIT_BACKEND=webgl node tests/aircraft-seating-audit.mjs` while serving the frozen candidate on port 4197; `AUDIT_URL` can point to the same build on another port.

The aircraft remain simplified authored models. These changes correct cockpit occupancy and visibility; they do not establish final aircraft art fidelity, finished instruments, doors, control grips, or hand-to-control contact.
