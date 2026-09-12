import test from 'node:test';
import assert from 'node:assert/strict';
import { NullEngine, PBRMaterial, Scene, StandardMaterial } from '@babylonjs/core';
import { LightingBudget } from '../src/core/LightingBudget';

test('late glTF light overrides respect device capacity and explicit water budgets before rendering', () => {
  const engine = new NullEngine(), scene = new Scene(engine);
  const cap = engine.getCaps(); cap.maxUniformBuffersPerShaderStage = 12;
  const paint = new PBRMaterial('paint', scene), water = new StandardMaterial('water', scene);
  water.metadata = {lightBudget: 2}; water.maxSimultaneousLights = 2;
  const before = scene.onBeforeRenderObservable.observers.length;
  const lighting = new LightingBudget(scene);
  try {
    const late = new PBRMaterial('late-glTF', scene);
    // Babylon's glTF loader raises unrelated existing materials too.
    for (const material of [paint, water, late]) material.maxSimultaneousLights = 10;
    scene.onBeforeRenderObservable.notifyObservers(scene);
    assert.equal(paint.maxSimultaneousLights, 8); assert.equal(late.maxSimultaneousLights, 8);
    assert.equal(water.maxSimultaneousLights, 2);
    cap.maxUniformBuffersPerShaderStage = 8;
    scene.onBeforeRenderObservable.notifyObservers(scene);
    assert.equal(paint.maxSimultaneousLights, 4); assert.equal(water.maxSimultaneousLights, 2);
    cap.maxUniformBuffersPerShaderStage = undefined;
    scene.onBeforeRenderObservable.notifyObservers(scene);
    assert.equal(paint.maxSimultaneousLights, 8, 'WebGL retains the authored eight-light budget');
  } finally {
    lighting.dispose();
    assert.equal(scene.onBeforeRenderObservable.observers.filter(o => !o._willBeUnregistered).length, before);
    scene.dispose(); engine.dispose();
  }
});
