import {
  AssetContainer, Bone, BoundingInfo, LoadAssetContainerAsync, Matrix, Mesh,
  PBRMaterial, Quaternion, Skeleton, TransformNode, Vector3,
  type Scene, type ShadowGenerator,
} from '@babylonjs/core';

export type CivilianSkin = 'male-adult-03' | 'female-adult-06';
type AssetKey = 'player-male' | 'player-female' | CivilianSkin;
type AssetGroup = 'players' | 'civilians';
type AssetLoader = (url: string) => Promise<AssetContainer>;
type Prepared = { assets: Map<AssetKey, AssetContainer>; loading: Map<AssetGroup, Promise<void>>; live: Set<RocketboxSkin> };
const libraries = new WeakMap<Scene, Prepared>();
export const CIVILIAN_DETAIL_LIMIT = 12;
export const CIVILIAN_DETAIL_DISTANCE = 70;
const CIVILIAN_DETAIL_EXIT_DISTANCE = 80;

function library(scene: Scene): Prepared {
  const existing = libraries.get(scene); if (existing) return existing;
  const prepared: Prepared = { assets: new Map(), loading: new Map(), live: new Set() };
  libraries.set(scene, prepared);
  // Havok Ragdoll copies bodies into driver bones during onBeforeRender. Select
  // visual detail and retarget after that, before active meshes/skeletons evaluate.
  const observer = scene.onBeforeActiveMeshesEvaluationObservable.add(() => {
    const eye = scene.activeCamera?.globalPosition;
    const nearby: { skin: RocketboxSkin; score: number; reacting: boolean }[] = [];
    for (const skin of prepared.live) {
      if (!skin.civilian || !skin.enabled) continue;
      const distance = eye ? Vector3.Distance(skin.worldPosition, eye) : 0;
      if (distance <= (skin.detailed ? CIVILIAN_DETAIL_EXIT_DISTANCE : CIVILIAN_DETAIL_DISTANCE))
        nearby.push({ skin, score: distance - (skin.detailed ? 8 : 0), reacting: skin.reacting });
    }
    // Keep nearby casualties/reactions recognizable as live pedestrians move
    // around them. More than twelve nearby casualties still obey the draw cap.
    nearby.sort((a, b) => Number(b.reacting) - Number(a.reacting) || a.score - b.score);
    const detailed = new Set(nearby.slice(0, CIVILIAN_DETAIL_LIMIT).map(candidate => candidate.skin));
    for (const skin of prepared.live) {
      if (skin.civilian) skin.setDetailed(detailed.has(skin));
      skin.sync();
    }
  });
  scene.onDisposeObservable.addOnce(() => {
    scene.onBeforeActiveMeshesEvaluationObservable.remove(observer);
    prepared.live.clear();
    for (const container of prepared.assets.values()) container.dispose();
    prepared.assets.clear(); prepared.loading.clear(); libraries.delete(scene);
  });
  return prepared;
}

function prepareGroup(scene: Scene, group: AssetGroup, files: [AssetKey, string][], baseUrl: string, load: AssetLoader): Promise<void> {
  if (scene.isDisposed) return Promise.reject(new Error('Character scene disposed'));
  const prepared = library(scene), existing = prepared.loading.get(group); if (existing) return existing;
  const promise = (async () => {
    await import('@babylonjs/loaders/glTF/index.js');
    const loaded = await Promise.allSettled(files.map(async ([key, file]) => {
      const container = await load(new URL(file, baseUrl).href);
      try {
        const names = new Set(container.skeletons.flatMap(skeleton => skeleton.bones.map(bone => bone.name)));
        if (JOINTS.some(([, name]) => !names.has(name)) || !container.meshes.some(mesh => mesh.getTotalVertices() > 0)) throw new Error(`Invalid ${key} character rig`);
      } catch (error) { container.dispose(); throw error; }
      for (const material of container.materials) if (material instanceof PBRMaterial) {
        material.imageProcessingConfiguration = scene.imageProcessingConfiguration;
        material.environmentIntensity = .65;
      }
      return { key, container };
    }));
    const failed = loaded.find(x => x.status === 'rejected');
    if (failed?.status === 'rejected') {
      for (const result of loaded) if (result.status === 'fulfilled') result.value.container.dispose();
      throw failed.reason;
    }
    const assets = loaded.map(result => (result as PromiseFulfilledResult<{ key: AssetKey; container: AssetContainer }>).value);
    if (scene.isDisposed) { assets.forEach(asset => asset.container.dispose()); throw new Error('Character scene disposed'); }
    for (const { key, container } of assets) prepared.assets.set(key, container);
  })().catch(error => { prepared.loading.delete(group); throw error; });
  prepared.loading.set(group, promise); return promise;
}

/** Existing player library stays independent from optional civilian loading. */
export function prepareCharacterAssets(scene: Scene, baseUrl = new URL('characters/rocketbox/', document.baseURI).href, load: AssetLoader = url => LoadAssetContainerAsync(url, scene, { pluginExtension: '.glb' })): Promise<void> {
  return prepareGroup(scene, 'players', [['player-male', 'male.glb'], ['player-female', 'female.glb']], baseUrl, load);
}

/** Optional shared civilian templates; await before constructing Population. */
export function prepareCivilianAssets(scene: Scene, baseUrl = new URL('characters/civilians/', document.baseURI).href, load: AssetLoader = url => LoadAssetContainerAsync(url, scene, { pluginExtension: '.glb' })): Promise<void> {
  return prepareGroup(scene, 'civilians', [['male-adult-03', 'male-adult-03.glb'], ['female-adult-06', 'female-adult-06.glb']], baseUrl, load);
}

const JOINTS: [string, string, string?][] = [
  ['pelvis', 'Bip01_Pelvis', 'spine'], ['spine', 'Bip01_Spine1', 'chest'],
  ['chest', 'Bip01_Spine2', 'neck'], ['neck', 'Bip01_Neck', 'head'], ['head', 'Bip01_Head'],
  ['leftArm', 'Bip01_L_UpperArm', 'leftForearm'], ['leftForearm', 'Bip01_L_Forearm', 'leftHand'], ['leftHand', 'Bip01_L_Hand'],
  ['rightArm', 'Bip01_R_UpperArm', 'rightForearm'], ['rightForearm', 'Bip01_R_Forearm', 'rightHand'], ['rightHand', 'Bip01_R_Hand'],
  ['leftThigh', 'Bip01_L_Thigh', 'leftCalf'], ['leftCalf', 'Bip01_L_Calf', 'leftFoot'], ['leftFoot', 'Bip01_L_Foot'],
  ['rightThigh', 'Bip01_R_Thigh', 'rightCalf'], ['rightCalf', 'Bip01_R_Calf', 'rightFoot'], ['rightFoot', 'Bip01_R_Foot'],
];
type Mapping = { node: TransformNode; driver: Bone; alignedBind: Matrix; depth: number };

/** Licensed visual skin follows the existing gameplay rig; collision and weapon anchors remain stable. */
export class RocketboxSkin {
  readonly parts: Mesh[];
  readonly skeletons: Skeleton[];
  private readonly roots: TransformNode[];
  private readonly mappings: Mapping[] = [];
  private disposed = false;
  private detailEnabled = true;
  private readonly desired = Matrix.Identity();
  private readonly inverse = Matrix.Identity();
  private readonly local = Matrix.Identity();
  private readonly scale = Vector3.One();
  private readonly rotation = Quaternion.Identity();
  private readonly position = Vector3.Zero();
  private constructor(private readonly root: TransformNode, private readonly driver: Skeleton, container: AssetContainer, name: string, private readonly shadows: ShadowGenerator, private readonly live: Set<RocketboxSkin>, readonly civilian: boolean, private readonly fallback?: Mesh) {
    const instance = container.instantiateModelsToScene(source => `${name}/rocketbox/${source}`, false, { doNotInstantiate: true });
    this.roots = instance.rootNodes as TransformNode[];
    this.skeletons = instance.skeletons;
    for (const node of this.roots) { node.parent = root; node.rotationQuaternion = Quaternion.RotationAxis(Vector3.Up(), Math.PI); }
    this.parts = this.roots.flatMap(node => node.getChildMeshes()).filter((mesh): mesh is Mesh => mesh instanceof Mesh && mesh.getTotalVertices() > 0);
    root.computeWorldMatrix(true);
    const inverseRoot = root.getWorldMatrix().clone().invert();
    const nodes = new Map<string, TransformNode>();
    for (const skeleton of this.skeletons) for (const bone of skeleton.bones) {
      const node = bone.getTransformNode(); if (node) nodes.set(bone.name.split('/').at(-1)!, node);
    }
    const drivers = new Map(driver.bones.map(bone => [bone.name.split('/').at(-1)!, bone]));
    driver.computeAbsoluteMatrices(true);
    const sourceBind = new Map<string, Matrix>();
    for (const [key, source] of JOINTS) { const node = nodes.get(source); if (node) sourceBind.set(key, node.computeWorldMatrix(true).multiply(inverseRoot)); }
    const alignments = new Map<string, Quaternion>();
    for (const [key,, child] of JOINTS) {
      const bind = sourceBind.get(key), from = drivers.get(key);
      if (!bind || !from) continue;
      let alignment = Quaternion.Identity();
      if (child && sourceBind.has(child) && drivers.has(child)) {
        const sourceDirection = sourceBind.get(child)!.getTranslation().subtract(bind.getTranslation()).normalize();
        const targetDirection = drivers.get(child)!.getAbsoluteMatrix().getTranslation().subtract(from.getAbsoluteMatrix().getTranslation()).normalize();
        alignment = Quaternion.FromUnitVectorsToRef(sourceDirection, targetDirection, Quaternion.Identity());
      } else if (key.endsWith('Hand')) alignment = alignments.get(key.replace('Hand', 'Forearm'))?.clone() ?? alignment;
      alignments.set(key, alignment);
    }
    for (const [key, source] of JOINTS) {
      const node = nodes.get(source), from = drivers.get(key), bind = sourceBind.get(key);
      if (!node || !from || !bind) throw new Error(`Rocketbox rig is missing ${key} / ${source}`);
      const linear = bind.clone(); linear.setTranslationFromFloats(0, 0, 0);
      const alignment = Matrix.Identity(); alignments.get(key)!.toRotationMatrix(alignment);
      let depth = 0; for (let parent = node.parent; parent; parent = parent.parent) depth++;
      this.mappings.push({ node, driver: from, alignedBind: linear.multiply(alignment), depth });
    }
    this.mappings.sort((a, b) => a.depth - b.depth);
    for (const mesh of this.parts) {
      mesh.isPickable = true; mesh.receiveShadows = true;
      // Conservative pose bounds include sitting, swimming and physically moved limbs.
      const toMesh = root.getWorldMatrix().multiply(mesh.computeWorldMatrix(true).clone().invert());
      const corners: Vector3[] = [];
      for (const x of [-2.2, 2.2]) for (const y of [-2.5, 2.4]) for (const z of [-2.2, 2.2]) corners.push(Vector3.TransformCoordinates(new Vector3(x, y, z), toMesh));
      const minimum = new Vector3(Infinity, Infinity, Infinity), maximum = new Vector3(-Infinity, -Infinity, -Infinity);
      for (const corner of corners) { minimum.minimizeInPlace(corner); maximum.maximizeInPlace(corner); }
      mesh.setBoundingInfo(new BoundingInfo(minimum, maximum)); shadows.addShadowCaster(mesh, false);
    }
    this.sync();
    if (civilian) this.setDetailed(false);
    live.add(this);
  }
  static create(scene: Scene, root: TransformNode, driver: Skeleton, name: string, female: boolean, shadows: ShadowGenerator, enabled = false, civilian?: CivilianSkin, fallback?: Mesh): RocketboxSkin | undefined {
    const prepared = libraries.get(scene); if (!prepared) return undefined;
    const key: AssetKey | undefined = enabled ? female ? 'player-female' : 'player-male' : civilian;
    const container = key && prepared.assets.get(key); if (!container) return undefined;
    return new RocketboxSkin(root, driver, container, name, shadows, prepared.live, !enabled && !!civilian, fallback);
  }
  get enabled(): boolean { return !this.disposed && !this.root.isDisposed() && this.root.isEnabled(); }
  get detailed(): boolean { return this.detailEnabled; }
  get reacting(): boolean { return !!this.root.metadata?.ragdollActive; }
  get worldPosition(): Vector3 { this.root.computeWorldMatrix(true); return this.root.getAbsolutePosition(); }
  setDetailed(detailed: boolean): void {
    if (!this.civilian || this.disposed || detailed === this.detailEnabled) return;
    this.detailEnabled = detailed;
    // Visibility changes retain the same private source skeleton and the same
    // gameplay driver. Returning casualties therefore keep their settled pose.
    for (const root of this.roots) root.setEnabled(detailed);
    for (const mesh of this.parts) {
      mesh.isVisible = detailed;
      if (detailed) this.shadows.addShadowCaster(mesh, false);
      else this.shadows.removeShadowCaster(mesh, false);
    }
    if (this.fallback) {
      this.fallback.isVisible = !detailed;
      if (detailed) this.shadows.removeShadowCaster(this.fallback, false);
      else this.shadows.addShadowCaster(this.fallback, false);
    }
  }
  sync(): void {
    if (this.disposed) return;
    if (this.root.isDisposed()) { this.dispose(); return; }
    if (!this.detailEnabled || !this.root.isEnabled()) return;
    this.driver.computeAbsoluteMatrices(true); this.root.computeWorldMatrix(true);
    for (const mapping of this.mappings) {
      mapping.alignedBind.multiplyToRef(mapping.driver.getAbsoluteMatrix(), this.desired);
      this.desired.multiplyToRef(this.root.getWorldMatrix(), this.local);
      (mapping.node.parent as TransformNode).computeWorldMatrix(true).invertToRef(this.inverse);
      this.local.multiplyToRef(this.inverse, this.desired);
      this.desired.decompose(this.scale, this.rotation, this.position);
      mapping.node.position.copyFrom(this.position);
      mapping.node.rotationQuaternion ??= Quaternion.Identity(); mapping.node.rotationQuaternion.copyFrom(this.rotation);
      mapping.node.scaling.copyFrom(this.scale); mapping.node.computeWorldMatrix(true);
    }
    for (const skeleton of this.skeletons) skeleton.prepare();
  }
  dispose(): void {
    if (this.disposed) return; this.disposed = true;
    this.live.delete(this);
    for (const mesh of this.parts) this.shadows.removeShadowCaster(mesh, false);
    if (this.fallback) this.shadows.removeShadowCaster(this.fallback, false);
    for (const root of this.roots) root.dispose(false, false);
    for (const skeleton of this.skeletons) skeleton.dispose();
  }
}
