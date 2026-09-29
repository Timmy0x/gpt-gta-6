import test from 'node:test';
import assert from 'node:assert/strict';
import { Camera, Frustum, Matrix, TransformNode, UniversalCamera, Vector3 } from '@babylonjs/core';
import { blankView, originalTileView, tileViewFixture } from './fixtures/miami-tile-view';

test('native core traversal has exact original view decisions through changing camera, projection, framebuffer, viewport and group states', async () => {
  const f = await tileViewFixture(), parent = new TransformNode('rigid-tile-parent', f.scene);
  const replacement = new UniversalCamera('replacement-game-camera', new Vector3(-12, -4, 44), f.scene);
  const cameraParent = new TransformNode('rigid-camera-parent', f.scene);
  replacement.setTarget(new Vector3(30, -20, -200)); replacement.minZ = .3; replacement.maxZ = 2200;
  let compared = 0, visible = 0, hidden = 0, infinite = 0;
  f.renderer.onView = (tile, actual) => {
    assert.deepEqual(actual, originalTileView(f.renderer, f.scene, tile));
    compared++; actual.inView ? visible++ : hidden++; if (actual.error === Infinity) infinite++;
  };
  try {
    for (let state = 0; state < 20; state++) {
      const camera = state % 5 === 4 ? replacement : f.camera;
      f.scene.activeCamera = camera;
      camera.unfreezeProjectionMatrix(); camera.mode = state % 2 ? Camera.ORTHOGRAPHIC_CAMERA : Camera.PERSPECTIVE_CAMERA;
      camera.position.set(20 + state * 3, -18 + state % 4, -7 - state * 2);
      camera.setTarget(new Vector3(state % 3 ? 0 : 80, -20, state % 3 ? 100 : -100));
      camera.fov = .65 + (state % 4) * .12;
      camera.fovMode = state % 3 ? Camera.FOVMODE_VERTICAL_FIXED : Camera.FOVMODE_HORIZONTAL_FIXED;
      camera.minZ = .1 + state * .01; camera.maxZ = 900 + state * 80;
      camera.orthoLeft = -60 - state; camera.orthoRight = 60 + state * 2;
      camera.orthoTop = 40 + state; camera.orthoBottom = -40 - state * 2;
      camera.viewport.x = state % 2 ? .15 : 0; camera.viewport.y = state % 2 ? .2 : 0;
      camera.viewport.width = state % 3 ? 1 : .6; camera.viewport.height = state % 4 ? 1 : .5;
      f.engine.framebufferWidth = state % 3 ? 1512 : 990; f.engine.framebufferHeight = state % 3 ? 812 : 610;
      f.engine.setHardwareScalingLevel(state % 3 + 1);
      f.renderer.group.position.set(state % 2 ? 123 : 0, state % 2 ? -12 : 0, state % 2 ? 88 : 0);
      f.renderer.group.rotation.y = state % 2 ? .32 : 0;
      f.renderer.group.setPreTransformMatrix(Matrix.RotationY(state * .015).multiply(Matrix.Scaling(1, 1, -1)));
      f.renderer.group.parent = state % 4 === 3 ? parent : null;
      parent.position.set(state, -state / 2, 3 * state); parent.rotation.y = .13;
      camera.parent = state % 4 === 2 ? cameraParent : null;
      cameraParent.position.set(-8, 3, 12); cameraParent.rotation.y = -.12;
      if (state === 11) camera.freezeProjectionMatrix(Matrix.OrthoOffCenterLH(-23, 77, -33, 19, .4, 1777));
      if (state === 12) camera.freezeProjectionMatrix(Matrix.PerspectiveFovLH(.73, 1.78, .17, 2300));
      const before = compared, preparations = f.renderer.preparations;
      f.renderer.update();
      assert.equal(f.renderer.preparations, preparations + 1);
      assert.equal(compared - before, f.tiles.length + 1, 'actual pinned traversal visited the entire synthetic root/child set');
    }
    assert.equal(compared, 20020); assert.ok(visible > 0 && hidden > 0 && infinite > 0);
  } finally { f.dispose(); }
});

test('a stable native update builds one frustum for 1001 tile queries and independent direct calls stay fresh', async () => {
  const f = await tileViewFixture(), original = Frustum.GetPlanes;
  let captures = 0;
  Frustum.GetPlanes = (...args) => { captures++; return original(...args); };
  try {
    for (let i = 0; i < 4; i++) {
      const before = captures; f.renderer.update(); assert.equal(captures - before, 1);
    }
    f.renderer.prepareForTraversal(); // Calling this public backend seam outside update cannot install a stale cache.
    for (let i = 0; i < 12; i++) {
      f.camera.position.x += 11; f.camera.fov += .01; f.camera.viewport.height = .4 + i * .03;
      f.renderer.group.position.z += 7;
      const actual = blankView(), before = captures;
      f.renderer.calculateTileViewError(f.tiles[i], actual); assert.equal(captures - before, 1);
      assert.deepEqual(actual, originalTileView(f.renderer, f.scene, f.tiles[i]));
    }
  } finally { Frustum.GetPlanes = original; f.dispose(); }
});

test('before/after listeners, plugin-skipped updates, rootless updates and exceptions cannot retain stale view math', async () => {
  const f = await tileViewFixture(48), rootless = await tileViewFixture(1, false);
  let skip = false, before = 0, after = 0, compared = 0;
  f.renderer.registerPlugin({ name: 'NATIVE_SKIP_FIXTURE', doTilesNeedUpdate() { return !skip; } });
  f.renderer.onView = (tile, actual) => { assert.deepEqual(actual, originalTileView(f.renderer, f.scene, tile)); compared++; };
  f.renderer.addEventListener('update-before', () => {
    before++;
    f.camera.position.x += 13; f.camera.setTarget(new Vector3(-40, -22, 130)); f.camera.fov = .72;
    f.camera.mode = Camera.ORTHOGRAPHIC_CAMERA; f.camera.orthoLeft = -27; f.camera.orthoRight = 82;
    f.camera.orthoTop = 35; f.camera.orthoBottom = -19;
    f.camera.viewport.width = .55; f.engine.framebufferWidth = 1222;
    f.renderer.group.position.set(31 + before, -8, 61); f.renderer.group.rotation.y = .16;
  });
  f.renderer.addEventListener('update-after', () => {
    after++;
    f.camera.position.z -= 47; f.camera.mode = Camera.PERSPECTIVE_CAMERA; f.camera.fov = .95;
    f.renderer.group.position.z -= 21;
    f.renderer.calculateTileViewError(f.tiles[3], blankView());
  });
  try {
    f.renderer.update(); assert.equal(compared, 50); assert.equal(before, 1); assert.equal(after, 1);
    skip = true;
    const prep = f.renderer.preparations, previous = compared;
    f.renderer.update(); assert.equal(f.renderer.preparations, prep); assert.equal(compared, previous + 1);
    assert.equal(before, 2); assert.equal(after, 2);
    f.camera.position.y += 19; f.renderer.group.position.x -= 15;
    f.renderer.calculateTileViewError(f.tiles[4], blankView());

    let rootlessEvents = 0;
    rootless.renderer.addEventListener('update-before', () => { rootlessEvents++; });
    rootless.renderer.registerPlugin({ name: 'PENDING_ROOT_FIXTURE', loadRootTileset() { return new Promise(() => {}); } });
    rootless.renderer.update(); assert.equal(rootlessEvents, 0); assert.equal(rootless.renderer.preparations, 0);
    rootless.camera.position.set(99, 4, -70);
    const direct = blankView(); rootless.renderer.calculateTileViewError(f.tiles[8], direct);
    assert.deepEqual(direct, originalTileView(rootless.renderer, rootless.scene, f.tiles[8]));

    skip = false;
    f.renderer.afterPrepare = () => { throw new Error('original synthetic traversal exception'); };
    assert.throws(() => f.renderer.update(), /synthetic traversal exception/);
    f.renderer.afterPrepare = undefined; f.camera.position.x += 80;
    f.renderer.calculateTileViewError(f.tiles[5], blankView());
    f.renderer.update();
  } finally { rootless.dispose(); f.dispose(); }
});

test('outgoing traversal events invalidate the cached view before listeners query a moved camera', async () => {
  const f = await tileViewFixture(12);
  let expectedEvent = false;
  f.renderer.addEventListener('native-fixture-view-change', () => {
    expectedEvent = true; f.camera.position.x += 70; f.camera.fov = .68; f.renderer.group.position.z -= 53;
    const actual = blankView(); f.renderer.calculateTileViewError(f.tiles[0], actual);
    assert.deepEqual(actual, originalTileView(f.renderer, f.scene, f.tiles[0]));
  });
  f.renderer.afterPrepare = () => { f.renderer.dispatchEvent({ type: 'native-fixture-view-change' }); };
  f.renderer.onView = (tile, actual) => { assert.deepEqual(actual, originalTileView(f.renderer, f.scene, tile)); };
  try { f.renderer.update(); assert.equal(expectedEvent, true); } finally { f.dispose(); }
});
