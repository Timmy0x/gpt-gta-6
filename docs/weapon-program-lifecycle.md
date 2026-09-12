# WebGL weapon program warning investigation

The original frozen weapons-v18 WebGL run completed 22 control checkpoints but recorded twelve `GL_INVALID_VALUE: glGetProgramiv: Program object expected` warnings. Its source is `.local-builds/weapons-v18-source`; entry `/assets/index-DQXt_5iT.js` has SHA-256 `7e05f6ab639f946477ac28b40cd1dbf57147bb92b58c5f5df0a48a65ea8536c7`.

Two additional normal-input runs did not reproduce the warning:

- `docs/evidence/weapons-program-trace-v18/result.json`: 22 checkpoints, zero errors, warnings or invalid/deleted-program queries.
- `docs/evidence/weapons-program-stress-v18/result.json`: 23 checkpoints, zero errors, warnings or invalid/deleted-program queries. This run disabled the Chrome GPU shader disk cache and added four bounded cycles of ordinary weapon-selection keys and character switches.

The optional `AUDIT_GL_TRACE=1` mode in `tests/weapons-controls-audit.mjs` records program creation, deletion and invalid/null parameter-query results, together with stacks and the actual weapon/handling phase. It forwards every original GL call and does not suppress errors or change game state. `AUDIT_COLD_SHADER=1` disables the shader disk cache; `AUDIT_SWITCH_STRESS=1` adds the bounded input sequence.

Installed Babylon 9.25 source contains a plausible pending-compilation disposal path: `Effect._checkIsReady` asks for readiness before checking its disposed flag, while `ThinEngine._deletePipelineContext` deletes a GL program without marking its pipeline context disposed. That observation does **not** establish the source of the original warning. HeldWeapon rebuilds and disposes meshes on owner/side/selection changes, but character skins and streamed scene resources also release effects. No speculative weapon runtime patch was made. The original warning remains unreproduced; these runs should not be represented as proof that its underlying cause was fixed.

## R6 integrated reproduction

The integrated R6 WebGL2 weapon run again passes22 normal controls but records12 `glGetProgramiv` warnings. The original opt-in program trace is empty, so it does not establish that no invalid native call occurred. The matching WebGPU22 controls and regional/player WebGL2 injury flows are clean. An expanded diagnostic that records wrapped methods, query counts and native `isProgram` validity is in development; no speculative engine fix is included in this checkpoint. Vehicle window firing has native coverage, but these on-foot weapon audits do not validate the normal-input drive-by flow.
