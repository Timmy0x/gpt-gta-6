# Miami police elevation and performance report

Police helicopter hover, spotlights, exits, body placement and foot-route vehicle blocking now use the current source ground frame. The Miami survey origin places streets below absolute Y=0; earlier fixed positive heights caused hovering and exits in the wrong place. Helicopters keep the existing 58m project hover target above supported terrain. Unknown terrain does not create an arbitrary ground anchor. Officer exit selection checks native walkable ground, the exact officer capsule, and its swept path. Existing tall-building flight avoidance is not solved here.

Building sight tests now use each independent public collider's minimum Y rather than assuming its base is zero. Legacy world obstacles still default to zero. Tests compare 18 actual Havok rays at three translated elevations, and retain the source bounding-box plumbing.

Pause → Export performance opens a read-only JSON report and a direct Download JSON link. It contains the newest 108000 unpaused raw frame durations, the median FPS and the reciprocal mean of the slowest 1% durations. Paused menus, travel and vehicle model loads are excluded; unpaused collision and visual streaming holds remain included. Settings, scene counts and memory values are current at export, so older samples may use different settings. A short report is not the 30-minute 1080p performance gate. Heap information is JavaScript-only and unavailable on some browsers; it is not measured VRAM or whole-process memory.

The report excludes credentials, provider payloads, source URLs and personal files. Export stays local. Independent source review and native tests are retained in `docs/evidence/miami-police-perception-r3`.

This is a bounded gameplay correction on the existing Brickell region. It does not add Miami geography or establish full Miami, terrain, prop, visual or GTA fidelity.
