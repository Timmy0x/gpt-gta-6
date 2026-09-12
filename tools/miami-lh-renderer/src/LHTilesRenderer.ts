import { TilesRenderer } from '3d-tiles-renderer/babylonjs';
import type { Tile, Tileset } from '3d-tiles-renderer/core';
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader';
import { Frustum } from '@babylonjs/core/Maths/math.frustum';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Scene } from '@babylonjs/core/scene';
import type { AssetContainer } from '@babylonjs/core/assetContainer';
import '@babylonjs/loaders/glTF/2.0';

export interface LHRendererOptions {
  /** Rigid, orientation-reversing map from RH tile metres into LH scene metres. No geodesy is inferred. */
  tileToLocal: Matrix;
}
export interface TileView { inView: boolean; error: number; distanceFromCamera: number; }
interface TileBounds {
  obb: { points: Vector3[] } | null;
  sphere: { centerWorld: Vector3; radiusWorld: number } | null;
  distanceToPoint(point: Vector3): number;
  intersectsFrustum(planes: unknown[]): boolean;
}
export interface LHTile extends Tile {
  engineData: { transform: Matrix; transformInverse: Matrix; boundingVolume: TileBounds; scene: TransformNode | null; container: AssetContainer | null; metadata: unknown; };
}
// These runtime hooks are absent from 0.5.2's public declarations. Version pin + real traversal tests guard this seam.
interface BackendHooks {
  loadRootTileset(): Promise<Tileset & {asset: {gltfUpAxis?:string}}>;
  preprocessNode(tile: Tile, directory: string, parent?: Tile | null): void;
  disposeTile(tile: Tile): void;
  calculateTileViewError(tile: Tile, target: TileView): void;
}
const backend = TilesRenderer.prototype as unknown as BackendHooks;
interface RootPlugin { loadRootTileset?: () => Promise<Tileset | undefined>; preprocessURL?: (url:string,tile:null)=>string; }
interface RootState {
  rootLoadingState: number; rootTileset: Tileset | null; rootURL: string;
  invokeOnePlugin(callback:(plugin:RootPlugin)=>Promise<Tileset|undefined>|undefined):Promise<Tileset|undefined>;
  invokeAllPlugins(callback:(plugin:RootPlugin)=>void):void;
}
// Pinned core states: FAILED=-1, UNLOADED=0, LOADING=2, LOADED=4.
const ROOT = {failed:-1,unloaded:0,loading:2,loaded:4} as const;
function rigid(matrix: Matrix, handedness: 1 | -1, name: string) {
  const m = matrix.asArray();
  if (m.some(v => !Number.isFinite(v)) || Math.abs(m[3]) + Math.abs(m[7]) + Math.abs(m[11]) + Math.abs(m[15] - 1) > 1e-6) throw new Error(`${name} must be a finite affine metre transform.`);
  const axes = [new Vector3(m[0],m[1],m[2]), new Vector3(m[4],m[5],m[6]), new Vector3(m[8],m[9],m[10])];
  if (axes.some(axis => Math.abs(axis.lengthSquared() - 1) > 1e-5) || Math.abs(Vector3.Dot(axes[0],axes[1])) + Math.abs(Vector3.Dot(axes[0],axes[2])) + Math.abs(Vector3.Dot(axes[1],axes[2])) > 1e-5 || Math.abs(matrix.determinant() - handedness) > 1e-5) throw new Error(`${name} must preserve metres with determinant ${handedness}; scale/shear are outside this adapter's scope.`);
}

/** Pinned 0.5.2 local-metre adapter. One LH scene; original AUTO roots and GLTF node transforms stay untouched. */
export class LHTilesRenderer extends TilesRenderer {
  private readonly localScene: Scene;
  private readonly up = Matrix.Identity();
  private closed = false;
  private rootRequest: AbortController | null = null;
  private rootGeneration = 0;
  constructor(url: string, scene: Scene, options: LHRendererOptions) {
    if (scene.useRightHandedSystem) throw new Error('LHTilesRenderer requires an existing left-handed scene.');
    rigid(options.tileToLocal, -1, 'tileToLocal');
    super(url, scene);
    this.localScene = scene;
    this.group.setPreTransformMatrix(options.tileToLocal.clone());
    this.group.computeWorldMatrix(true);
    this.checkCollisions = false;
    this.lruCache.maxSize = 128;
    this.lruCache.minSize = 96;
  }
  async loadRootTileset() {
    const root = await backend.loadRootTileset.call(this);
    const axis = (root.asset?.gltfUpAxis ?? 'Y').toUpperCase();
    if (!['X','Y','Z'].includes(axis)) throw new Error(`Unsupported glTF up axis: ${axis}`);
    this.up.copyFrom(axis === 'X' ? Matrix.RotationY(-Math.PI / 2) : axis === 'Y' ? Matrix.RotationX(Math.PI / 2) : Matrix.Identity());
    return root;
  }
  preprocessNode(tile: Tile, directory: string, parent: Tile | null = null) {
    const bounds = tile.boundingVolume as Record<string, unknown>;
    if (!bounds || ('region' in bounds) || (!bounds.box && !bounds.sphere)) throw new Error('Local adapter requires a tile box or sphere; geographic regions are unsupported.');
    const contentUri = tile.content?.uri ?? tile.content?.url;
    if (contentUri && !new URL(contentUri, directory + '/').pathname.toLowerCase().endsWith('.glb')) throw new Error('Only GLB content is supported; external tilesets need a per-tileset up-axis gate.');
    if ('contents' in tile || tile.implicitTiling) throw new Error('Multiple content and implicit tiling require a separate adapter gate.');
    if (tile.transform) {
      if (tile.transform.length !== 16) throw new Error('Tile transform must have 16 elements.');
      rigid(Matrix.FromArray(tile.transform), 1, 'Tile transform');
    }
    if (bounds.sphere && (!Array.isArray(bounds.sphere) || bounds.sphere.length !== 4 || !bounds.sphere.every(Number.isFinite) || bounds.sphere[3] < 0)) throw new Error('Invalid local tile sphere.');
    if (bounds.box && (!Array.isArray(bounds.box) || bounds.box.length !== 12 || !bounds.box.every(Number.isFinite))) throw new Error('Invalid local tile box.');
    backend.preprocessNode.call(this, tile, directory, parent);
  }
  /** Extension point used only to test cancellation after the actual importer resolves. */
  protected importGlb(buffer: Uint8Array, metadata: (json: unknown) => void) {
    return LoadAssetContainerAsync(buffer, this.localScene, {
      pluginExtension: '.glb',
      pluginOptions: { gltf: { onParsed: data => metadata(data.json) } },
    });
  }
  async parseTile(buffer: ArrayBuffer, tile: LHTile, extension: string, _url: string, signal: AbortSignal) {
    if (this.closed || signal.aborted) return;
    const bytes = new Uint8Array(buffer);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (extension.toLowerCase() !== 'glb' || bytes.length < 20 || view.getUint32(0,true) !== 0x46546c67 || view.getUint32(4,true) !== 2 || view.getUint32(8,true) !== bytes.length || view.getUint32(16,true) !== 0x4e4f534a) throw new Error('This adapter accepts embedded GLB2 tile content only.');
    const jsonLength = view.getUint32(12,true);
    if (jsonLength > bytes.length - 20) throw new Error('Invalid GLB JSON chunk length.');
    const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20,20+jsonLength))) as { buffers?: Array<{ uri?: string }>; images?: Array<{ uri?: string }>; extensionsUsed?: string[]; };
    if ([...(json.buffers ?? []),...(json.images ?? [])].some(resource => resource.uri !== undefined)) throw new Error('External GLB resources require an authenticated resource-loader gate.');
    if (json.extensionsUsed?.some(name => ['CESIUM_RTC','KHR_draco_mesh_compression','EXT_meshopt_compression'].includes(name))) throw new Error('RTC and compressed GLB extensions require a separate adapter gate.');
    let metadata: unknown = json;
    let container: AssetContainer | null = null;
    let wrapper: TransformNode | null = null;
    try {
      container = await this.importGlb(bytes, value => { metadata = value; });
      if (this.closed || signal.aborted) { container.dispose(); return; }
      if (container.rootNodes.length !== 1 || !(container.rootNodes[0] instanceof TransformNode)) throw new Error('Expected one AUTO glTF import root.');
      const imported = container.rootNodes[0];
      const conversion = imported.computeWorldMatrix(true).clone();
      if (Math.abs(conversion.determinant()) < 1e-8) throw new Error('The glTF import root is not invertible.');
      wrapper = new TransformNode('lh-tile-placement', this.localScene);
      // Babylon multiplication composes left-to-right: original nodes * C * (C^-1 * up * tile) * local frame.
      // A pre-transform preserves the complete affine matrix; no TRS decomposition or root quaternion overwrite.
      wrapper.setPreTransformMatrix(conversion.invert().multiply(this.up).multiply(tile.engineData.transform));
      wrapper.parent = this.group;
      wrapper.setEnabled(false);
      container.addAllToScene();
      imported.parent = wrapper;
      tile.engineData.scene = wrapper;
      tile.engineData.container = container;
      tile.engineData.metadata = metadata;
    } catch (error) {
      container?.dispose(); wrapper?.dispose(); throw error;
    }
  }
  calculateTileViewError(tile: Tile, target: TileView) {
    const camera = this.localScene.activeCamera!;
    const engine = this.localScene.getEngine();
    // Screen-space error is in actual framebuffer pixels, not logical CSS pixels.
    const width = engine.getRenderWidth(true) * camera.viewport.width;
    const height = engine.getRenderHeight(true) * camera.viewport.height;
    const projection = camera.getProjectionMatrix().m;
    const inverseGroup = this.group.computeWorldMatrix(true).clone().invert();
    const planes = Frustum.GetPlanes(camera.getViewMatrix(true).multiply(camera.getProjectionMatrix())).map(plane => plane.transform(inverseGroup));
    const position = Vector3.TransformCoordinates(camera.globalPosition, inverseGroup);
    const bounds = (tile as LHTile).engineData.boundingVolume;
    const distance = bounds.distanceToPoint(position);
    target.inView = bounds.intersectsFrustum(planes);
    target.distanceFromCamera = distance;
    if (projection[15] === 1) {
      target.error = tile.geometricError / Math.max(2 / Math.abs(projection[0]) / width, 2 / Math.abs(projection[5]) / height);
    } else {
      target.error = distance === 0 ? Infinity : tile.geometricError * height * Math.abs(projection[5]) / (2 * distance);
    }
  }
  private beginRootRequest() {
    const state = this as unknown as RootState;
    const generation = ++this.rootGeneration;
    const controller = this.rootRequest = new AbortController();
    const previousOptions = this.fetchOptions;
    const signal = previousOptions.signal ? AbortSignal.any([previousOptions.signal,controller.signal]) : controller.signal;
    const activeOptions = this.fetchOptions = {...previousOptions,signal};
    state.rootLoadingState = ROOT.loading;
    // Own this one async seam: the pinned core otherwise settles root state and emits events after dispose().
    Promise.resolve().then(() => {
      if (this.closed || generation !== this.rootGeneration) throw new DOMException('Root request cancelled','AbortError');
      return state.invokeOnePlugin(plugin => plugin.loadRootTileset?.());
    }).then(root => {
      if (this.closed || generation !== this.rootGeneration) return;
      if (!root) throw new Error('The root-loader plugin completed without a tileset.');
      let url = state.rootURL;
      state.invokeAllPlugins(plugin => { if (plugin.preprocessURL) url = plugin.preprocessURL(url,null); });
      state.rootTileset = root; state.rootLoadingState = ROOT.loaded;
      this.dispatchEvent({type:'needs-update'});
      if (this.closed || generation !== this.rootGeneration) return;
      this.dispatchEvent({type:'load-tileset',tileset:root,url});
      if (this.closed || generation !== this.rootGeneration) return;
      this.dispatchEvent({type:'load-root-tileset',tileset:root,url});
    }).catch((error:unknown) => {
      if (this.closed || generation !== this.rootGeneration) return;
      state.rootTileset = null; state.rootLoadingState = ROOT.failed;
      this.dispatchEvent({type:'load-error',tile:null,error:error instanceof Error ? error : new Error(String(error)),url:state.rootURL});
    }).finally(() => {
      if (this.fetchOptions === activeOptions) this.fetchOptions = previousOptions;
      if (this.rootRequest === controller) this.rootRequest = null;
    });
  }
  update() {
    if (this.closed) return;
    if (this.localScene.useRightHandedSystem) throw new Error('Scene handedness changed while the LH adapter was active.');
    if (!this.localScene.activeCamera) throw new Error('The LH adapter requires an active local camera.');
    rigid(this.group.computeWorldMatrix(true), -1, 'Tile group world transform');
    this.localScene.activeCamera.getViewMatrix(true);
    this.localScene.activeCamera.getProjectionMatrix();
    if ((this as unknown as RootState).rootLoadingState === ROOT.unloaded) this.beginRootRequest();
    super.update();
  }
  disposeTile(tile: LHTile) {
    const wrapper = tile.engineData.scene;
    backend.disposeTile.call(this,tile);
    wrapper?.dispose();
  }
  dispose() {
    if (this.closed) return;
    this.closed = true; this.rootGeneration++; this.rootRequest?.abort();
    super.dispose();
    (this as unknown as RootState).rootTileset = null;
  }
}
