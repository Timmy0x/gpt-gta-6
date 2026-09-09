import test from 'node:test';
import assert from 'node:assert/strict';
import { NullEngine, Scene, UniversalCamera, Vector3 } from '@babylonjs/core';
import { Sky, skyState } from '../src/core/Sky';

test('authored sun crosses the horizon at 06:00/18:00 and light direction stays finite through wraparound', () => {
  for (const hour of [-24, 0, 6, 9, 12, 18, 21, 24, 100000, NaN]) {
    const state = skyState(hour);
    assert.ok(state.sunDirection.asArray().every(Number.isFinite)); assert.ok(Math.abs(state.sunDirection.length() - 1) < 1e-10);
    assert.ok(state.daylight >= 0 && state.daylight <= 1); assert.ok(state.night >= 0 && state.night <= 1);
  }
  assert.ok(skyState(6).sunDirection.x > .99); assert.ok(skyState(18).sunDirection.x < -.99);
  assert.ok(skyState(12).sunDirection.y > .9); assert.ok(skyState(0).sunDirection.y < -.9);
  assert.ok(skyState(6).daylight < 1e-8); assert.ok(skyState(18).daylight < 1e-8);
  assert.equal(skyState(12).night, 0); assert.equal(skyState(0).night, 1);
  assert.deepEqual(skyState(2), skyState(26));
});

test('native sky updates sun/weather without growing resources and releases its background nodes', () => {
  const engine = new NullEngine(), scene = new Scene(engine), camera = new UniversalCamera('camera', Vector3.Zero(), scene);
  camera.maxZ = 1500;
  const counts = () => [scene.meshes.length, scene.materials.length, scene.textures.length, scene.onBeforeRenderObservable.observers.length];
  const baseline = counts();
  for (let cycle = 0; cycle < 4; cycle++) {
    const sky = new Sky(scene), resources = counts();
    assert.equal(sky.stats.triangles, sky.mesh.getTotalIndices() / 3 + sky.stars.getTotalIndices() / 3);
    for (let frame = 0; frame < 480; frame++) {
      const state = sky.update(frame / 20, frame % 3 ? 'Clear' : 'Haze');
      assert.ok(Vector3.Dot(state.sunDirection, sky.material.sunPosition.normalizeToNew()) > .999999);
      scene.onBeforeRenderObservable.notifyObservers(scene);
    }
    assert.deepEqual(counts(), resources); assert.equal(sky.mesh.isPickable, false); assert.equal(sky.mesh.applyFog, false);
    sky.update(0); assert.equal(sky.stats.visibleStars, 160);
    sky.update(0, 'Rain'); assert.equal(sky.stats.visibleStars, 0);
    sky.update(12); assert.equal(sky.stats.visibleStars, 0);
    assert.ok(sky.material.turbidity < 5); assert.equal(sky.material.useSunPosition, true);
    sky.dispose(); sky.dispose();
    assert.deepEqual(counts(), baseline);
  }
  scene.dispose(); engine.dispose();
});
