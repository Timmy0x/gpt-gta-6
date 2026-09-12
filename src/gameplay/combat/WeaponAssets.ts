import '@babylonjs/core/Loading/Plugins/babylonFileLoader';
import { AssetContainer, LoadAssetContainerAsync, Mesh, PBRMaterial, type Scene, type TransformNode } from '@babylonjs/core';
type Library = { assets: Map<number, AssetContainer>; pending?: Promise<void> };
const libraries = new WeakMap<Scene, Library>();
const ASSETS = [[0, 'pistol'], [3, 'carbine'], [5, 'sniper']] as const;
export async function prepareWeaponAssets(scene: Scene, read: (url: string) => Promise<Uint8Array> = async url => {
  const response = await fetch(url); if (!response.ok) throw new Error(`Weapon asset ${response.status}`); return new Uint8Array(await response.arrayBuffer());
}): Promise<void> {
  let library = libraries.get(scene);
  if (!library) {
    library = { assets: new Map() }; libraries.set(scene, library);
    const owned = library; scene.onDisposeObservable.addOnce(() => { for (const asset of owned.assets.values()) asset.dispose(); owned.assets.clear(); libraries.delete(scene); });
  }
  const owned = library;
  return owned.pending ??= Promise.all(ASSETS.map(async ([index, name]) => {
    if (owned.assets.has(index)) return;
    const bytes = await read(`/weapons/${name}/model.babylon.gz`);
    // Fetch already decodes Content-Encoding:gzip; file readers can return the raw archive.
    const compressed = bytes[0] === 0x1f && bytes[1] === 0x8b;
    const text = compressed ? await new Response(new Blob([new Uint8Array(bytes).buffer]).stream().pipeThrough(new DecompressionStream('gzip'))).text() : new TextDecoder().decode(bytes);
    const container = await LoadAssetContainerAsync('data:' + text, scene, { pluginExtension: '.babylon' });
    if (scene.isDisposed) { container.dispose(); return; }
    for (const material of container.materials) if (material instanceof PBRMaterial) material.imageProcessingConfiguration = scene.imageProcessingConfiguration;
    owned.assets.set(index, container);
  })).then(() => undefined).catch(error => { owned.pending = undefined; throw error; });
}
export function instantiateWeaponAsset(scene: Scene, index: number, parent: TransformNode): Mesh[] | null {
  const asset = libraries.get(scene)?.assets.get(index); if (!asset) return null;
  const instance = asset.instantiateModelsToScene(name => `held/${name}`, false, {doNotInstantiate: true});
  for (const root of instance.rootNodes) root.parent = parent;
  const meshes = instance.rootNodes.flatMap(root => [root, ...root.getDescendants()]).filter((node): node is Mesh => node instanceof Mesh);
  for (const mesh of meshes) { mesh.isPickable = false; mesh.metadata = {...mesh.metadata, weaponVisual: true}; }
  return meshes;
}
