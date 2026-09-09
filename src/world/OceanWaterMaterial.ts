import { ShaderLanguage, type AbstractMesh, type Effect, type SubMesh } from '@babylonjs/core';
import { WaterMaterial } from '@babylonjs/materials/water/waterMaterial.js';

/** Unpolarized dielectric interface. Project seawater index; no claim of spectral dispersion. */
export function waterTransmission(cosine: number, fromWater: boolean): number {
  const c = Math.max(0, Math.min(1, Math.abs(cosine))), eta = fromWater ? 1.333 : 1 / 1.333;
  const sin2 = eta * eta * (1 - c * c);
  if (sin2 >= 1) return 0;
  const ct = Math.sqrt(1 - sin2), rs = (eta * c - ct) / (eta * c + ct), rp = (eta * ct - c) / (eta * ct + c);
  return Math.max(0, Math.min(1, 1 - (rs * rs + rp * rp) * .5));
}

/** Patch only the separate Fresnel expression in the exact pinned native source.
 * No global ShaderStore changes: each material gets an explicitly named effect variant.
 * A changed publisher expression fails loudly instead of silently losing the correction.
 */
export function underwaterFragment(source: string, language: ShaderLanguage): string {
  const wgsl = language === ShaderLanguage.WGSL;
  const original = wgsl
    ? 'var fresnelTerm: f32=clamp(abs(pow(dot(viewDirectionW,upVector),3.0)),0.05,0.65);'
    : 'float fresnelTerm=clamp(abs(pow(dot(viewDirectionW,upVector),3.0)),0.05,0.65);';
  if (source.split(original).length !== 2 || !source.includes('#define CUSTOM_FRAGMENT_DEFINITIONS'))
    throw new Error('Pinned Babylon water Fresnel expression changed; review underwater optics');
  const fn = wgsl ? `
fn oceanTransmission(view: vec3f, normal: vec3f, eyeHeight: f32) -> f32 {
  let c = clamp(abs(dot(view, normal)), 0.0, 1.0);
  let eta = select(1.333, 1.0 / 1.333, eyeHeight >= 0.0);
  let sin2 = eta * eta * (1.0 - c * c);
  if (sin2 >= 1.0) { return 0.0; }
  let ct = sqrt(max(0.0, 1.0 - sin2));
  let rs = (eta * c - ct) / max(0.000001, eta * c + ct);
  let rp = (eta * ct - c) / max(0.000001, eta * ct + c);
  return clamp(1.0 - 0.5 * (rs * rs + rp * rp), 0.0, 1.0);
}
` : `
float oceanTransmission(vec3 view, vec3 normal, float eyeHeight) {
  float c = clamp(abs(dot(view, normal)), 0.0, 1.0);
  float eta = eyeHeight >= 0.0 ? 1.0 / 1.333 : 1.333;
  float sin2 = eta * eta * (1.0 - c * c);
  if (sin2 >= 1.0) return 0.0;
  float ct = sqrt(max(0.0, 1.0 - sin2));
  float rs = (eta * c - ct) / max(0.000001, eta * c + ct);
  float rp = (eta * ct - c) / max(0.000001, eta * ct + c);
  return clamp(1.0 - 0.5 * (rs * rs + rp * rp), 0.0, 1.0);
}
`;
  const replacement = wgsl
    ? 'var fresnelTerm: f32=oceanTransmission(viewDirectionW,normalW,uniforms.cameraPosition.y-fragmentInputs.vPositionW.y);'
    : 'float fresnelTerm=oceanTransmission(viewDirectionW,normalW,cameraPosition.y-vPositionW.y);';
  return source.replace('#define CUSTOM_FRAGMENT_DEFINITIONS', fn + '\n#define CUSTOM_FRAGMENT_DEFINITIONS').replace(original, replacement);
}

/** Native material and readiness/binding/RTTs, with a scoped underwater Fresnel effect.
 * Public Effect source/interface accessors avoid copying native readiness internals or
 * monkey-patching the engine. Above-water rendering stays on the native default branch.
 */
export class OceanWaterMaterial extends WaterMaterial {
  private variants = new Map<string, { native: Effect; variant: Effect }>();
  private owned = new Set<Effect>();
  get opticsStats() { return { variants: this.variants.size, model: 'dielectric-underwater' }; }

  override isReadyForSubMesh(mesh: AbstractMesh, subMesh: SubMesh, useInstances?: boolean): boolean {
    if (!super.isReadyForSubMesh(mesh, subMesh, useInstances)) return false;
    const native = subMesh.effect!;
    if (this.owned.has(native)) return native.isReady();
    let cached = this.variants.get(native.key);
    if (!cached) {
      const variant = this.getScene().getEngine().createEffect({
        vertexSource: native.rawVertexSourceCode,
        fragmentSource: underwaterFragment(native.rawFragmentSourceCode, native.shaderLanguage),
        spectorName: 'ocean/native-water-dielectric',
      }, {
        attributes: native.getAttributesNames().slice(), uniformsNames: native.getUniformNames().slice(),
        uniformBuffersNames: native.getUniformBuffersNames().slice(), samplers: native.getSamplers().slice(),
        defines: native.defines, shaderLanguage: native.shaderLanguage,
        indexParameters: native.getIndexParameters(), fallbacks: null, onCompiled: this.onCompiled, onError: this.onError,
      }, this.getScene().getEngine());
      cached = { native, variant }; this.variants.set(native.key, cached); this.owned.add(variant);
    } else {
      // The native readiness path acquired this cached engine effect again. Retain
      // exactly the first acquisition until dispose, and release this duplicate.
      native.dispose();
    }
    subMesh.setEffect(cached.variant, subMesh.materialDefines);
    return cached.variant.isReady();
  }
  override dispose(forceDisposeEffect?: boolean): void {
    for (const { native, variant } of this.variants.values()) { native.dispose(); variant.dispose(); }
    this.variants.clear(); this.owned.clear();
    super.dispose(forceDisposeEffect);
  }
}
