import { Engine, Scene, HDRCubeTexture } from "@babylonjs/core";
import { CreateEnvTextureAsync, GetEnvInfo } from "@babylonjs/core/Misc/environmentTextureTools";

/** Offline Babylon conversion: prefilter once, ship the small mip chain instead of filtering at game startup. */
export async function prepareLighting() {
  const canvas = document.createElement("canvas"); canvas.width = 256; canvas.height = 256;
  document.body.append(canvas);
  const engine = new Engine(canvas, false), scene = new Scene(engine);
  let texture: HDRCubeTexture | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      texture = new HDRCubeTexture("/data/lighting/wide_street_02_1k.hdr", scene, 256, false, true, false, true, resolve, (message, error) => reject(error ?? new Error(message)));
    });
    const bytes = new Uint8Array(await CreateEnvTextureAsync(texture!));
    const info = GetEnvInfo(bytes);
    let binary = "";
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return { base64: btoa(binary), info, sourceSize: texture!.getSize(), engine: engine.webGLVersion };
  } finally { texture?.dispose(); scene.dispose(); engine.dispose(); canvas.remove(); }
}
