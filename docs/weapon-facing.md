# Weapon facing and concise controls

The old camera-driven shot could fire behind an idle or moving character. Holding either fire or aim now raises the weapon and turns the body toward the camera's current horizontal ray, at a bounded 10 radians/second. Arms align only within a 60-degree torso cone. Combat waits until the body is within 15 degrees before consuming ammunition or firing. Releasing aim/fire retains the pose for 0.65 seconds, then returns to ordinary locomotion. Swimming, climbing, vehicle occupancy and death prohibit firing.

These angles and timings are explicit project decisions, not published GTA VI specifications. The existing hand attachment, muzzle obstruction sweep, weapon inventory and recoil remain. The procedural gun models, locomotion, reload animation and recoil need further visual development; this does not establish GTA VI firearm fidelity.

The persistent bottom controls paragraph is removed. Context prompts use short verbs, with aircraft lift/descent shown as arrows beside their active bindings. The pause menu retains the action reference and rebinding controls.

## Evidence

The isolated interaction candidate at port4201 used entry `index-DSBrBJ_2.js`, SHA-256 `e95167f3234ae901af6966d2bccf8dfa386d340f3474ca60f14533750caaec65`. Its complete135-test suite and production build pass. It excludes the later map, water and vehicle exterior work.

`tests/weapon-facing-audit.mjs` uses ordinary mouse turns, hip fire, aimed fire and Tab character switching; a read-only physics observer records body angle and shot count. Eight stages pass on each backend. The WebGPU run records21 shots and32 turning frames; WebGL2 records23 shots and32 turning frames. Every recorded shot stays inside the15-degree body cone; the largest observed angle is10.90 degrees. After recoil settles, the barrel is within1 degree of the camera ray. During active fire, the existing0.1-radian visual kick is evaluated separately.

Evidence is under `docs/evidence/weapon-facing-webgpu` and `weapon-facing-webgl`. WebGPU reports no errors or warnings. WebGL2 reports no page/console errors but24 `GL_INVALID_VALUE: glGetProgramiv: Program object expected` browser warnings; their cause remains under investigation. Both screenshots show the intended pose and rendering. This functional check is not a frame-time benchmark.
