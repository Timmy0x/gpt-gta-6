import { TilesRenderer } from '3d-tiles-renderer/babylonjs';
import { TilesRendererBase, B3DMLoaderBase, type Tile, type Tileset } from '3d-tiles-renderer/core';
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader';
import { Frustum } from '@babylonjs/core/Maths/math.frustum';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Scene } from '@babylonjs/core/scene';
import type { AssetContainer } from '@babylonjs/core/assetContainer';
import '@babylonjs/loaders/glTF/2.0';
import { affine, ECEFLocalFrame, identity, maximumStretch, multiply, translation, upRotation, type DoubleMatrix, type EllipsoidOrigin, type Vec3 } from './DoubleFrame';
import { LocalTileBounds } from './LocalTileBounds';
import { prepareGlb } from './GlbRebase';
import { scopePlugin, type Attribution } from './PluginLifetime';

export type LHRendererOptions = {tileToLocal:Matrix;origin?:never} | {origin:EllipsoidOrigin;tileToLocal?:never};
export interface TileView { inView: boolean; error: number; distanceFromCamera: number; }
interface TileBounds {
  obb: { points: Vector3[] } | null;
  sphere: { centerWorld: Vector3; radiusWorld: number } | null;
  distanceToPoint(point: Vector3): number;
  intersectsFrustum(planes: unknown[]): boolean;
}
export interface LHTile extends Tile {
  engineData: { sourceTransform:DoubleMatrix; upAxis:string; errorScale:number; transform: Matrix; transformInverse: Matrix; boundingVolume: TileBounds; scene: TransformNode | null; container: AssetContainer | null; metadata: unknown; };
}
// These runtime hooks are absent from 0.5.2's public declarations. Version pin + real traversal tests guard this seam.
interface BackendHooks {
  loadRootTileset(): Promise<Tileset & {asset: {gltfUpAxis?:string}}>;
  preprocessNode(tile: Tile, directory: string, parent?: Tile | null): void;
  disposeTile(tile: Tile): void;
  preprocessTileset(json:Tileset,url:string,parent?:Tile|null):void;
}
const backend = TilesRenderer.prototype as unknown as BackendHooks;
const core = TilesRendererBase.prototype as unknown as BackendHooks;
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

/** Pinned 0.5.2 LH adapter. Source transforms are composed in doubles; static glTF origins are rebased before import. */
export class LHTilesRenderer extends TilesRenderer {
  private readonly localScene: Scene;
  private readonly axes = new WeakMap<object,string>();
  private readonly frame?: ECEFLocalFrame;
  private readonly lifetime = new AbortController();
  private readonly pluginScopes = new Map<object,ReturnType<typeof scopePlugin>>();
  private disposalComplete = false;
  private closed = false;
  private rootRequest: AbortController | null = null;
  private rootGeneration = 0;
  private rootErrorGeneration = -1;
  constructor(url: string, scene: Scene, options: LHRendererOptions) {
    if (scene.useRightHandedSystem) throw new Error('LHTilesRenderer requires an existing left-handed scene.');
    if(options.tileToLocal)rigid(options.tileToLocal, -1, 'tileToLocal');
    super(url, scene);
    this.localScene = scene;
    this.frame=options.origin?new ECEFLocalFrame(options.origin):undefined;
    this.group.setPreTransformMatrix(options.tileToLocal?.clone()??Matrix.Identity());
    this.group.computeWorldMatrix(true);
    this.checkCollisions = false;
    this.lruCache.maxSize = 128;
    this.lruCache.minSize = 96;
  }
  async loadRootTileset() {
    if(this.closed)throw new DOMException('Renderer disposed','AbortError');
    return backend.loadRootTileset.call(this);
  }
  preprocessTileset(json:Tileset & {asset:{gltfUpAxis?:string}},url:string,parent:Tile|null=null){
    if(this.closed)throw new DOMException('Renderer disposed','AbortError');
    const axis=(json.asset?.gltfUpAxis??'Y').toUpperCase();upRotation(axis);
    this.axes.set(json.root,axis);
    core.preprocessTileset.call(this,json,url,parent);
  }
  preprocessNode(tile: LHTile, directory: string, parent: LHTile | null = null) {
    const axis=this.axes.get(tile)??parent?.engineData.upAxis??'Y';
    const own=tile.transform??identity();affine(own);
    const sourceTransform=parent?multiply(parent.engineData.sourceTransform,own):Array.from(own);affine(sourceTransform);
    if ('contents' in tile || tile.implicitTiling) throw new Error('Multiple content and implicit tiling require a separate adapter gate.');
    core.preprocessNode.call(this,tile,directory,parent);
    const local=this.frame?this.frame.matrix(sourceTransform):sourceTransform;
    tile.engineData.sourceTransform=sourceTransform;
    tile.engineData.upAxis=axis;
    tile.engineData.errorScale=maximumStretch(sourceTransform);
    // Bounds are computed from source doubles. Large translations are never put in Babylon matrices first.
    tile.engineData.transform=Matrix.FromArray(local);
    tile.engineData.transformInverse=tile.engineData.transform.clone().invert();
    tile.engineData.boundingVolume=new LocalTileBounds(tile.boundingVolume,sourceTransform,this.frame);
    tile.engineData.container=null;
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
    let bytes=new Uint8Array(buffer),b3dmRTC:Vec3=[0,0,0];
    const magic=new TextDecoder().decode(bytes.subarray(0,4));
    if(magic==='b3dm'){
      const b3dm=new B3DMLoaderBase().parse(buffer);
      bytes=new Uint8Array(b3dm.glbBytes);
      const rtc=b3dm.featureTable.getData('RTC_CENTER',1,'FLOAT','VEC3');
      if(rtc){
        const values=typeof rtc==='object'&&'length' in rtc?Array.from(rtc as unknown as ArrayLike<number>):[];
        if(values.length!==3||!values.every(Number.isFinite))throw new Error('Invalid B3DM RTC_CENTER.');
        b3dmRTC=values as Vec3;
      }
    }else if(magic!=='glTF')throw new Error(`Unsupported content format: ${extension}`);
    const prepared=prepareGlb(bytes),json=prepared.metadata;
    if ([...(json.buffers ?? []),...(json.images ?? [])].some(resource => resource.uri !== undefined && (typeof resource.uri!=='string'||!/^data:/i.test(resource.uri)))) throw new Error('External GLB resources require an authenticated resource-loader gate.');
    if (json.extensionsUsed?.some(name => ['KHR_draco_mesh_compression','EXT_meshopt_compression'].includes(name))) throw new Error('Compressed GLB decoder profile has not yet been validated.');
    const rtc=prepared.rtc.map((v,i)=>v+b3dmRTC[i]);
    const contentDouble=multiply(tile.engineData.sourceTransform,multiply(translation(rtc),multiply(upRotation(tile.engineData.upAxis),translation(prepared.anchor))));
    const localContent=this.frame?this.frame.matrix(contentDouble):contentDouble;
    const placement=Matrix.FromArray(localContent);
    const metadata:unknown=json;
    let container: AssetContainer | null = null;
    let wrapper: TransformNode | null = null;
    try {
      container = await this.importGlb(prepared.bytes, () => {});
      if (this.closed || signal.aborted) { container.dispose(); return; }
      if (container.rootNodes.length !== 1 || !(container.rootNodes[0] instanceof TransformNode)) throw new Error('Expected one AUTO glTF import root.');
      const imported = container.rootNodes[0];
      const conversion = imported.computeWorldMatrix(true).clone();
      if (Math.abs(conversion.determinant()) < 1e-8) throw new Error('The glTF import root is not invertible.');
      wrapper = new TransformNode('lh-tile-placement', this.localScene);
      // Babylon multiplication composes left-to-right: original nodes * C * (C^-1 * up * tile) * local frame.
      // A pre-transform preserves the complete affine matrix; no TRS decomposition or root quaternion overwrite.
      wrapper.setPreTransformMatrix(conversion.invert().multiply(placement));
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
    const geometricError=tile.geometricError*(tile as LHTile).engineData.errorScale;
    target.inView = bounds.intersectsFrustum(planes);
    target.distanceFromCamera = distance;
    if (projection[15] === 1) {
      target.error = geometricError / Math.max(2 / Math.abs(projection[0]) / width, 2 / Math.abs(projection[5]) / height);
    } else {
      target.error = distance === 0 ? Infinity : geometricError * height * Math.abs(projection[5]) / (2 * distance);
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
      if(this.rootErrorGeneration!==generation)this.dispatchEvent({type:'load-error',tile:null,error:error instanceof Error ? error : new Error(String(error)),url:state.rootURL});
    }).finally(() => {
      if (this.fetchOptions === activeOptions) this.fetchOptions = previousOptions;
      if (this.rootRequest === controller) this.rootRequest = null;
    });
  }
  update() {
    if (this.closed) return;
    if (this.localScene.useRightHandedSystem) throw new Error('Scene handedness changed while the LH adapter was active.');
    if (!this.localScene.activeCamera) throw new Error('The LH adapter requires an active local camera.');
    rigid(this.group.computeWorldMatrix(true), this.frame?1:-1, 'Tile group world transform');
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
  registerPlugin(plugin:object){
    if(this.closed)return;
    const name=(plugin as {name?:string}).name;
    if(name==='GOOGLE_CLOUD_AUTH_PLUGIN'){const previous=this.getPluginByName(name);if(previous&&previous!==plugin)this.unregisterPlugin(previous);}
    if(!this.pluginScopes.has(plugin))this.pluginScopes.set(plugin,scopePlugin(plugin,this.lifetime.signal));
    try{super.registerPlugin(plugin);}catch(error){this.pluginScopes.get(plugin)?.restore();this.pluginScopes.delete(plugin);throw error;}
  }
  unregisterPlugin(plugin:object|string){
    const object=typeof plugin==='string'?this.getPluginByName(plugin):plugin;
    const removed=super.unregisterPlugin(plugin);
    if(removed&&object){this.pluginScopes.get(object)?.restore();this.pluginScopes.delete(object);}
    return removed;
  }
  getAttributions(target:Attribution[]=[]){
    super.getAttributions(target);
    if(this.visibleTiles.size)for(const value of this.pluginScopes.values())target.push(...value.credits);
    return target;
  }
  dispatchEvent(event:{type:string;[key:string]:unknown}){
    if(this.disposalComplete)return;
    if(event.type==='load-error'&&event.tile===null&&(this as unknown as RootState).rootLoadingState===ROOT.loading)this.rootErrorGeneration=this.rootGeneration;
    super.dispatchEvent(event);
  }
  dispose() {
    if (this.closed) return;
    this.closed = true; this.rootGeneration++; this.rootRequest?.abort(); this.lifetime.abort();
    super.dispose();
    (this as unknown as RootState).rootTileset = null; this.disposalComplete=true;
  }
}
