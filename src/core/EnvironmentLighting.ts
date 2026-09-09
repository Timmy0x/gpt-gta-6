import { Color3, Constants, CubeTexture, RawCubeTexture, type Scene } from "@babylonjs/core";

/** Shared prefiltered urban radiance. The source is a generic CC0 lighting reference. */
export async function prepareEnvironmentLighting(scene: Scene): Promise<boolean> {
  const faces = Array.from({ length: 6 }, (_, face) => {
    const pixels = new Uint8Array(32 * 32 * 4);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      const t = face === 2 ? 1 : face === 3 ? 0 : 1 - y / 31;
      const c = Color3.Lerp(new Color3(0.26, 0.29, 0.25), new Color3(0.58, 0.77, 0.9), t);
      const i = (y * 32 + x) * 4;
      pixels[i] = c.r * 255; pixels[i + 1] = c.g * 255; pixels[i + 2] = c.b * 255; pixels[i + 3] = 255;
    }
    return pixels;
  });
  const fallback = new RawCubeTexture(scene, faces, 32, Constants.TEXTUREFORMAT_RGBA, Constants.TEXTURETYPE_UNSIGNED_BYTE, true, false);
  fallback.name = "authored sky fallback";
  scene.environmentTexture = fallback;
  let texture: CubeTexture | undefined;
  try {
    const response = await fetch("/lighting/coastal-street.env", { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Lighting download: HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map(n => n.toString(16).padStart(2, "0")).join("");
    if (hash !== "7c05d4ac97c2cf6c8b5b9580da74d0ef6e8dcf662676808b99d9cc7ac73423d1") throw new Error("Lighting asset integrity mismatch");
    await new Promise<void>((resolve, reject) => {
      texture = new CubeTexture("/lighting/coastal-street.env", scene, {
        buffer: bytes, prefiltered: true, forcedExtension: ".env", createPolynomials: true,
        onLoad: resolve, onError: (message, error) => reject(error ?? new Error(message)),
      });
    });
    if (scene.isDisposed) throw new Error("Scene disposed while loading lighting");
    texture!.name = "Wide Street 02 / Poly Haven / CC0";
    texture!.rotationY = 0.65;
    scene.environmentTexture = texture!;
    fallback.dispose();
    return true;
  } catch (error) {
    texture?.dispose();
    console.warn("Using the authored lighting fallback", error);
    return false;
  }
}
