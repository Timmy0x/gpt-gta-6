import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { GeospatialCamera } from '@babylonjs/core/Cameras/geospatialCamera';
import { GeospatialClippingBehavior } from '@babylonjs/core/Behaviors/Cameras/geospatialClippingBehavior';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { TilesRenderer } from '3d-tiles-renderer/babylonjs';
import { ecef } from '../src/access';

test('real renderer frustum can reach both synthetic tiles from each camera preset', async () => {
  const engine = new NullEngine({ renderWidth: 1440, renderHeight: 900, textureSize: 512, deterministicLockstep: false, lockstepMaxSteps: 1, useHighPrecisionMatrix: true });
  const scene = new Scene(engine);
  scene.useRightHandedSystem = true;
  const camera = new GeospatialCamera('fixture-test', scene, { planetRadius: 6378137 });
  camera.addBehavior(new GeospatialClippingBehavior());
  camera.center = new Vector3(...ecef(25.7662, -80.1907));
  camera.pitch = 1.1;
  camera.yaw = -.25;
  const tiles = new TilesRenderer('/fixture/tileset.json', scene);
  tiles.errorTarget = 20;
  // The pinned JS backend exposes these methods but its public .d.ts omits them.
  const backend = tiles as unknown as {
    preprocessNode(tile: unknown, directory: string, parent?: unknown): void;
    calculateTileViewError(tile: unknown, result: { inView: boolean; error: number; distanceFromCamera: number }): void;
  };
  const root = JSON.parse(await readFile(new URL('../public/fixture/tileset.json', import.meta.url), 'utf8')).root;
  try {
    backend.preprocessNode(root, 'http://localhost/fixture/');
    for (const child of root.children) backend.preprocessNode(child, 'http://localhost/fixture/', root);
    tiles.group.computeWorldMatrix(true);
    for (const radius of [420, 1500]) {
      camera.radius = radius;
      scene.render();
      const rootView = { inView: false, error: 0, distanceFromCamera: 0 };
      backend.calculateTileViewError(root, rootView);
      assert.equal(rootView.inView, true, `root at ${radius} m`);
      assert.ok(rootView.error > tiles.errorTarget, 'empty root must refine to drawable children');
      for (const child of root.children) {
        const childView = { inView: false, error: 0, distanceFromCamera: 0 };
        backend.calculateTileViewError(child, childView);
        assert.equal(childView.inView, true, `${child.content.uri} at ${radius} m`);
        assert.equal(childView.error, 0);
        assert.ok(childView.distanceFromCamera > 0);
      }
    }
  } finally {
    tiles.dispose();
    scene.dispose();
    engine.dispose();
  }
});
