import {
  AssetContainer, Bone, BoundingInfo, LoadAssetContainerAsync, Matrix, Mesh,
  PBRMaterial, Quaternion, Skeleton, TransformNode, Vector3,
  type Scene, type ShadowGenerator,
} from '@babylonjs/core';

type Prepared = { male: AssetContainer; female: AssetContainer; live: Set<RocketboxSkin> };
const libraries = new WeakMap<Scene, Prepared>();
const preparing = new WeakMap<Scene, Promise<void>>();

/** Two licensed local assets, loaded once per scene before constructing characters. */
export function prepareCharacterAssets(scene: Scene, baseUrl = new URL('characters/rocketbox/', document.baseURI).href, load = (url: string) => LoadAssetContainerAsync(url, scene, { pluginExtension: '.glb' })): Promise<void> {
  const existing = preparing.get(scene); if (existing) return existing;
  const promise = (async () => {
    await import('@babylonjs/loaders/glTF/index.js');
    const loaded = await Promise.allSettled((['male', 'female'] as const).map(async sex => {
      const container = await load(new URL(`${sex}.glb`, baseUrl).href);
      try {
        const names = new Set(container.skeletons.flatMap(skeleton => skeleton.bones.map(bone => bone.name)));
        if (JOINTS.some(([, name]) => !names.has(name)) || !container.meshes.some(mesh => mesh.getTotalVertices() > 0)) throw new Error(`Invalid ${sex} character rig`);
      } catch (error) { container.dispose(); throw error; }
      for (const material of container.materials) if (material instanceof PBRMaterial) {
        material.imageProcessingConfiguration = scene.imageProcessingConfiguration;
        material.environmentIntensity = .65;
      }
      return container;
    }));
    const failed = loaded.find(x => x.status === 'rejected');
    if (failed?.status === 'rejected') {
      for (const result of loaded) if (result.status === 'fulfilled') result.value.dispose();
      preparing.delete(scene); throw failed.reason;
    }
    const [male, female] = loaded.map(x => (x as PromiseFulfilledResult<AssetContainer>).value);
    if (scene.isDisposed) { male.dispose(); female.dispose(); throw new Error('Character scene disposed'); }
    const live = new Set<RocketboxSkin>();
    libraries.set(scene, { male, female, live });
    // Havok Ragdoll copies bodies into driver bones during onBeforeRender.
    // Run after that phase, immediately before active meshes and skeletons evaluate.
    const observer = scene.onBeforeActiveMeshesEvaluationObservable.add(() => { for (const skin of live) skin.sync(); });
    scene.onDisposeObservable.addOnce(() => { scene.onBeforeActiveMeshesEvaluationObservable.remove(observer); live.clear(); male.dispose(); female.dispose(); libraries.delete(scene); preparing.delete(scene); });
  })();
  preparing.set(scene, promise); return promise;
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
  private readonly desired = Matrix.Identity();
  private readonly inverse = Matrix.Identity();
  private readonly local = Matrix.Identity();
  private readonly scale = Vector3.One();
  private readonly rotation = Quaternion.Identity();
  private readonly position = Vector3.Zero();
  private constructor(private readonly root: TransformNode, private readonly driver: Skeleton, container: AssetContainer, name: string, private readonly shadows: ShadowGenerator, private readonly live: Set<RocketboxSkin>) {
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
    live.add(this);
  }
  static create(scene: Scene, root: TransformNode, driver: Skeleton, name: string, female: boolean, shadows: ShadowGenerator, enabled = false): RocketboxSkin | undefined {
    const prepared = libraries.get(scene); if (!prepared) return undefined;
    if (!enabled) return undefined;
    return new RocketboxSkin(root, driver, prepared[female ? 'female' : 'male'], name, shadows, prepared.live);
  }
  sync(): void {
    if (this.disposed) return;
    if (this.root.isDisposed()) { this.dispose(); return; }
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
    for (const root of this.roots) root.dispose(false, false);
    for (const skeleton of this.skeletons) skeleton.dispose();
  }
}
