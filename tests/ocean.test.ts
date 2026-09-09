import test from 'node:test';
import assert from 'node:assert/strict';
import { Color3, Material, MeshBuilder, NullEngine, Plane, Scene, UniversalCamera, Vector3, VertexData } from '@babylonjs/core';
import { Ocean, OCEAN_LIMITS, oceanNormalPixels } from '../src/world/Ocean';
import { underwaterFragment, waterTransmission } from '../src/world/OceanWaterMaterial';
import { ShaderLanguage, ShaderStore } from '@babylonjs/core';
import { waterPixelShader as waterGLSL } from '@babylonjs/materials/water/water.fragment.js';
import { waterPixelShaderWGSL as waterWGSL } from '@babylonjs/materials/water/wgsl/water.fragment.js';

test('water dielectric transmits near-normal rays and reflects beyond the critical water-to-air angle', () => {
  const expected = 4 * 1.333 / ((1.333 + 1) ** 2);
  assert.ok(waterTransmission(1, true) > .97, 'upward view cannot retain native35% seabed ceiling');
  assert.ok(Math.abs(waterTransmission(1, true) - expected) < 1e-12);
  assert.equal(waterTransmission(1, false), waterTransmission(1, true));
  assert.ok(waterTransmission(Math.cos(40 * Math.PI / 180), true) > .9);
  assert.equal(waterTransmission(Math.cos(49 * Math.PI / 180), true), 0, 'total internal reflection from water');
  assert.ok(waterTransmission(Math.cos(49 * Math.PI / 180), false) > .9, 'air-to-water does not share that critical angle');
  assert.equal(waterTransmission(0, true), 0); assert.equal(waterTransmission(0, false), 0);
});

test('scoped optical extension modifies the exact pinned expression without changing global native shaders', () => {
  for (const [language, source] of [[ShaderLanguage.GLSL, waterGLSL.shader], [ShaderLanguage.WGSL, waterWGSL.shader]] as const) {
    const store = ShaderStore.GetShadersStore(language), original = store.waterPixelShader;
    const extended = underwaterFragment(source, language);
    assert.ok(extended.includes('oceanTransmission(viewDirectionW,normalW,'));
    assert.ok(extended.includes('sin2 >= 1.0')); assert.ok(!extended.includes('abs(pow(dot(viewDirectionW,upVector),3.0))'));
    assert.ok(extended.includes('projectedRefractionTexCoords'), 'native projected refraction retained');
    assert.ok(extended.includes('projectedReflectionTexCoords'), 'native planar reflection retained');
    assert.equal(store.waterPixelShader, original, 'global publisher shader unchanged');
    assert.throws(() => underwaterFragment(source.replace('0.05,0.65', '0.01,0.99'), language), /Pinned Babylon/);
  }
});

test('ocean surface/depth use explicit bounded physical coordinates and original periodic normal data', () => {
  // Native WaterMaterial9.25 refers to the browser global name during RTT creation.
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'name'); Object.defineProperty(globalThis, 'name', { value: '', configurable: true });
  const engine = new NullEngine(), scene = new Scene(engine); scene.defaultMaterial = new Material('test/default', scene);
  try {
    const ocean = new Ocean(scene, { shorelineX: 210, bounds: { minX: 210, maxX: 1000, minZ: -500, maxZ: 500 }, floorHeightAt: x => -.18 - Math.max(0, x - 210) * .1 });
    assert.equal(ocean.contains(209, 0), false); assert.equal(ocean.contains(210, 0), true); assert.equal(ocean.contains(1001, 0), false); assert.equal(ocean.contains(500, 501), false);
    assert.equal(ocean.surfaceHeight(300, 0), -.18); assert.equal(ocean.surfaceHeight(0, 0), null); assert.ok(Math.abs(ocean.depthAt(250, 0) - 4) < .0001); assert.equal(ocean.depthAt(209, 0), 0);
    assert.equal(ocean.contains(NaN, 0), false); assert.equal(ocean.depthAt(Infinity, 0), 0);
    assert.equal(ocean.mesh.position.y, -.18); assert.equal(ocean.material.useWorldCoordinatesForWaveDeformation, true);
    for (const mesh of [ocean.mesh, ocean.foam]) { const computed: number[] = []; VertexData.ComputeNormals(mesh.getVerticesData('position')!, mesh.getIndices()!, computed); assert.ok(computed.filter((_, index) => index % 3 === 1).every(y => y > .99), 'water and foam winding faces upward in Babylon coordinates'); }
    const pixels = oceanNormalPixels(32); assert.deepEqual(pixels, oceanNormalPixels(32)); assert.equal(pixels.length, 4096);
    const r = [...pixels].filter((_, index) => index % 4 === 0); assert.ok(Math.max(...r) - Math.min(...r) > 70, 'normal field contains visible crossed ripple slopes');
    for (let index = 3; index < pixels.length; index += 4) assert.equal(pixels[index], 255);
    ocean.dispose();
  } finally { scene.dispose(); engine.dispose(); if (descriptor) Object.defineProperty(globalThis, 'name', descriptor); else Reflect.deleteProperty(globalThis, 'name'); }
});

test('native ocean bounds RTT work, excludes water/self and disposed sources, and disposes repeated instances', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'name'); Object.defineProperty(globalThis, 'name', { value: '', configurable: true });
  const engine = new NullEngine(), scene = new Scene(engine); scene.defaultMaterial = new Material('test/default', scene);
  const sky = MeshBuilder.CreateBox('test/sky', { size: 1000 }, scene); sky.metadata = { sky: true };
  const objects = Array.from({ length: 80 }, (_, i) => { const mesh = MeshBuilder.CreateBox(`test/shore-${i}`, { size: 3 }, scene); mesh.position.set(220 + i * 2, i % 2 ? 3 : -2, 0); mesh.computeWorldMatrix(true); return mesh; });
  const original = { meshes: scene.meshes.length, materials: scene.materials.length, textures: scene.textures.length, targets: scene.customRenderTargets.length, observers: scene.imageProcessingConfiguration.onUpdateParameters.observers.length };
  try {
    for (let cycle = 0; cycle < 3; cycle++) {
      const ocean = new Ocean(scene), initial = ocean.stats;
      assert.equal(scene.meshes.length, original.meshes + 3); assert.equal(scene.materials.length, original.materials + 3); assert.equal(scene.textures.length, original.textures + 4);
      assert.ok(initial.triangles < 40000 && initial.foamPatches < 850);
      for (let frame = 0; frame < 180; frame++) ocean.update(1 / 60, new Vector3(230, 1.5, 0), frame % 2 ? 'Rain' : 'Clear');
      assert.ok(Math.abs(ocean.stats.elapsed - 3) < .0001, 'fixed delta time advances native shader time');
      assert.ok(ocean.stats.reflectionMeshes <= OCEAN_LIMITS.reflectionMeshes); assert.ok(ocean.stats.refractionMeshes <= OCEAN_LIMITS.refractionMeshes);
      assert.ok(ocean.material.reflectionTexture!.renderList!.includes(sky));
      for (const target of [ocean.material.reflectionTexture!, ocean.material.refractionTexture!]) {
        assert.deepEqual([target.getSize().width, target.getSize().height], [512, 512]); assert.equal(target.refreshRate, 2); assert.equal(target.samples, 1); assert.equal(target.renderParticles, false); assert.equal(target.renderSprites, false);
        assert.ok(target.renderList!.every(mesh => !mesh.metadata?.ocean && !mesh.isDisposed()));
      }
      ocean.setRenderSources([sky, ...objects.slice(0, 3)]); ocean.update(.01, new Vector3(230, 2, 0));
      assert.ok(ocean.stats.reflectionMeshes <= 4); assert.ok(ocean.stats.refractionMeshes <= 3);
      const transient = MeshBuilder.CreateBox('test/transient', { size: 3 }, scene); transient.position.set(230, 3, 0); transient.computeWorldMatrix(true);
      ocean.setRenderSources([sky, transient]); ocean.update(.01, new Vector3(230, 2, 0)); assert.ok(ocean.material.reflectionTexture!.renderList!.includes(transient));
      transient.dispose(); ocean.setRenderSources([sky, transient]); ocean.update(.01, new Vector3(230, 2, 0)); assert.ok(!ocean.material.reflectionTexture!.renderList!.includes(transient));
      assert.equal(scene.textures.length, original.textures + 4);
      ocean.dispose(); ocean.dispose(); await new Promise(resolve => setTimeout(resolve, 10));
      assert.deepEqual({ meshes: scene.meshes.length, materials: scene.materials.length, textures: scene.textures.length, targets: scene.customRenderTargets.length, observers: scene.imageProcessingConfiguration.onUpdateParameters.observers.length }, original);
    }
  } finally { scene.dispose(); engine.dispose(); if (descriptor) Object.defineProperty(globalThis, 'name', descriptor); else Reflect.deleteProperty(globalThis, 'name'); }
});

test('submerged native water reverses RTT media and restores atmosphere, clipping and visibility after each pass', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'name'); Object.defineProperty(globalThis, 'name', { value: '', configurable: true });
  const engine = new NullEngine(), scene = new Scene(engine); scene.defaultMaterial = new Material('test/default', scene);
  const camera = new UniversalCamera('test/camera', new Vector3(245, 2, 0), scene); camera.maxZ = 1800; camera.setTarget(new Vector3(230, 1, 15));
  const sky = MeshBuilder.CreateBox('sky', { size: 1000 }, scene); sky.metadata = { sky: true };
  const above = MeshBuilder.CreateBox('above', { size: 2 }, scene); above.position.set(242, 4, 0); above.computeWorldMatrix(true);
  const below = MeshBuilder.CreateBox('below', { size: 2 }, scene); below.position.set(242, -4, 0); below.computeWorldMatrix(true);
  const observerCount = scene.onBeforeCameraRenderObservable.observers.length;
  const ocean = new Ocean(scene); ocean.setRenderSources([sky, above, below]);
  try {
    const view = (y: number) => { camera.position.y = y; camera.getViewMatrix(true); scene.updateTransformMatrix(true); scene.onBeforeCameraRenderObservable.notifyObservers(camera); };
    ocean.update(.1, camera.position); view(2);
    assert.equal(ocean.stats.submergedView, false); assert.equal(ocean.material.fresnelSeparate, false);
    assert.ok(ocean.material.reflectionTexture!.renderList!.includes(above));
    assert.ok(ocean.material.refractionTexture!.renderList!.includes(below));
    const extinction = scene.getMeshByName('ocean/underwater-extinction')!;
    assert.equal(extinction.isEnabled(), false);
    scene.fogMode = Scene.FOGMODE_EXP2; scene.fogDensity = .095; scene.fogColor.set(.04, .2, .24);
    ocean.setAtmosphericFog(.00125, new Color3(.56, .7, .8)); view(-1.035);
    assert.equal(ocean.stats.submergedView, true); assert.equal(ocean.material.fresnelSeparate, true);
    assert.equal(extinction.isEnabled(), true); assert.equal(extinction.material!.disableDepthWrite, true); assert.equal(extinction.applyFog, true);
    assert.ok(ocean.material.reflectionTexture!.renderList!.includes(below));
    assert.ok(!ocean.material.reflectionTexture!.renderList!.includes(sky));
    assert.ok(ocean.material.refractionTexture!.renderList!.includes(above));
    assert.ok(ocean.material.refractionTexture!.renderList!.includes(sky));
    assert.ok(!ocean.material.refractionTexture!.renderList!.includes(extinction));
    const originalClip = new Plane(1, 0, 0, -300); scene.clipPlane = originalClip;
    const reflection = ocean.material.reflectionTexture!, refraction = ocean.material.refractionTexture!;
    reflection.onBeforeRenderObservable.notifyObservers(0);
    assert.equal(scene.clipPlane!.normal.y, 1, 'underwater reflection retains below-water geometry');
    reflection.onAfterRenderObservable.notifyObservers(0);
    assert.equal(scene.clipPlane, originalClip);
    refraction.onBeforeRenderObservable.notifyObservers(0);
    assert.equal(scene.clipPlane!.normal.y, -1, 'underwater refraction retains above-water geometry');
    assert.equal(scene.fogDensity, .00125); assert.deepEqual(scene.fogColor.asArray(), [.56, .7, .8]);
    refraction.onAfterRenderObservable.notifyObservers(0);
    assert.equal(scene.clipPlane, originalClip); assert.equal(scene.fogDensity, .095); assert.deepEqual(scene.fogColor.asArray(), [.04, .2, .24]);
    view(2); assert.equal(extinction.isEnabled(), false); assert.equal(ocean.material.fresnelSeparate, false);
    assert.ok(ocean.material.reflectionTexture!.renderList!.includes(sky));
  } finally {
    ocean.dispose(); assert.equal(scene.onBeforeCameraRenderObservable.observers.length, observerCount);
    scene.dispose(); engine.dispose(); if (descriptor) Object.defineProperty(globalThis, 'name', descriptor); else Reflect.deleteProperty(globalThis, 'name');
  }
});
