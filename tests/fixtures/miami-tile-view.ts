import { Frustum, Matrix, NullEngine, Scene, UniversalCamera, Vector3 } from '@babylonjs/core';
import type { Tile, Tileset } from '3d-tiles-renderer/core';
import { LHTilesRenderer, type LHTile, type TileView } from '../../src/world/miami/visuals/LHTilesRenderer';

// Browser queue/URL primitives only; these fixtures never fetch or retain provider content.
globalThis.window ??= { location: { href: 'https://fixture.invalid/' }, addEventListener() {}, removeEventListener() {} } as unknown as Window & typeof globalThis;
globalThis.requestAnimationFrame ??= callback => setTimeout(() => callback(performance.now()), 0) as unknown as number;
globalThis.cancelAnimationFrame ??= id => clearTimeout(id);

export class FramebufferEngine extends NullEngine {
  framebufferWidth = 1512;
  framebufferHeight = 812;
  constructor() { super({ renderWidth: 1512, renderHeight: 812, textureSize: 512, deterministicLockstep: false, lockstepMaxSteps: 4 }); }
  override getRenderWidth() { return this.framebufferWidth; }
  override getRenderHeight() { return this.framebufferHeight; }
}

export class ViewProbeRenderer extends LHTilesRenderer {
  preparations = 0;
  afterPrepare?: () => void;
  onView?: (tile: LHTile, view: TileView) => void;
  override prepareForTraversal() {
    this.preparations++;
    super.prepareForTraversal();
    this.afterPrepare?.();
  }
  override calculateTileViewError(tile: Tile, target: TileView) {
    super.calculateTileViewError(tile, target);
    this.onView?.(tile as LHTile, target);
  }
}

export const blankView = (): TileView => ({ inView: false, error: 0, distanceFromCamera: 0 });

/** Pre-optimization application method, kept verbatim as the independent numerical oracle. */
export function originalTileView(renderer: LHTilesRenderer, scene: Scene, tile: LHTile, target = blankView()): TileView {
  const camera = scene.activeCamera!;
  const engine = scene.getEngine();
  const width = engine.getRenderWidth(true) * camera.viewport.width;
  const height = engine.getRenderHeight(true) * camera.viewport.height;
  const projection = camera.getProjectionMatrix().m;
  const inverseGroup = renderer.group.computeWorldMatrix(true).clone().invert();
  const planes = Frustum.GetPlanes(camera.getViewMatrix(true).multiply(camera.getProjectionMatrix())).map(plane => plane.transform(inverseGroup));
  const position = Vector3.TransformCoordinates(camera.globalPosition, inverseGroup);
  const bounds = tile.engineData.boundingVolume;
  const distance = bounds.distanceToPoint(position);
  const geometricError = tile.geometricError * tile.engineData.errorScale;
  target.inView = bounds.intersectsFrustum(planes);
  target.distanceFromCamera = distance;
  target.error = projection[15] === 1
    ? geometricError / Math.max(2 / Math.abs(projection[0]) / width, 2 / Math.abs(projection[5]) / height)
    : distance === 0 ? Infinity : geometricError * height * Math.abs(projection[5]) / (2 * distance);
  return target;
}

export async function tileViewFixture(count = 1000, loadRoot = true) {
  const engine = new FramebufferEngine(), scene = new Scene(engine);
  const camera = new UniversalCamera('existing-game-camera', new Vector3(20, -18, -7), scene);
  camera.setTarget(new Vector3(0, -20, 10)); camera.minZ = .12; camera.maxZ = 1500; camera.fov = .88;
  const renderer = new ViewProbeRenderer('https://fixture.invalid/root.json', scene, { tileToLocal: Matrix.Scaling(1, 1, -1) });
  const children = Array.from({ length: count }, (_, i) => ({
    geometricError: i % 8,
    boundingVolume: i % 4 === 0
      ? { sphere: [(i % 40) * 35 - 600, -20 + (i % 7) * 15, Math.floor(i / 40) * 35 - 450, 18] }
      : { box: [(i % 40) * 35 - 600, -20 + (i % 7) * 15, Math.floor(i / 40) * 35 - 450, 12, 0, 0, 0, 30, 0, 0, 0, 12] },
    children: [],
  })) as unknown as Tile[]; // Core preprocessing supplies parent/internal/traversal below.
  const tileset: Tileset & { asset: { gltfUpAxis: string } } = {
    asset: { version: '1.0', gltfUpAxis: 'Y' }, geometricError: 1e8,
    root: { geometricError: 1e8, boundingVolume: { sphere: [0, 0, 0, 10000] }, refine: 'REPLACE', children } as unknown as Tile,
  };
  if (loadRoot) {
    renderer.registerPlugin({ name: 'ORIGINAL_VIEW_FIXTURE', async loadRootTileset() {
      renderer.preprocessTileset(tileset, 'https://fixture.invalid/root.json');
      return tileset;
    } });
    renderer.update();
    for (let i = 0; i < 8 && !renderer.root; i++) await Promise.resolve();
    if (!renderer.root) throw new Error('Synthetic root did not initialize.');
    renderer.traverse(() => false, null);
    children.forEach((tile, i) => { (tile as LHTile).engineData.errorScale = 1 + (i % 3) * .1; });
  }
  return { engine, scene, camera, renderer, tiles: children as LHTile[], tileset,
    dispose() { renderer.dispose(); scene.dispose(); engine.dispose(); } };
}
