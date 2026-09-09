import { DirectionalLight, NullEngine, Scene, ShadowGenerator, Vector3 } from "@babylonjs/core";
import { ConceptCarAssets } from "../../src/vehicles/ConceptCar";

export async function inspectConcept() {
  const engine = new NullEngine(), scene = new Scene(engine);
  const shadows = new ShadowGenerator(128, new DirectionalLight("sun", new Vector3(0, -1, 0), scene));
  const assets = new ConceptCarAssets({ scene, shadows });
  await assets.prepare();
  const car = assets.create(1), other = assets.create(2);
  const counts = () => [scene.meshes.length, scene.materials.length, scene.textures.length, scene.geometries.length, scene.transformNodes.length];
  const before = counts();
  for (let i = 0; i < 8; i++) {
    const temporary = assets.create(3 + i);
    shadows.removeShadowCaster(temporary.root, true); temporary.root.dispose();
    for (const material of temporary.materials) material.dispose();
  }
  const report = {
    method: "Chrome with --disable-gpu and Babylon NullEngine; actual embedded PNG decoding and glTF materials, no GPU render",
    meshes: car.root.getChildMeshes().length, triangles: car.root.getChildMeshes().reduce((sum, mesh) => sum + mesh.getTotalIndices() / 3, 0),
    wheels: car.wheels.length, doors: car.doors.length, windows: car.windows.length, lights: car.lights.length, covers: car.bumpers.length,
    materials: car.materials.map(m => ({ name: m.name, alpha: m.alpha, emissiveIntensity: m.emissiveIntensity, refraction: m.subSurface.isRefractionEnabled, textures: m.getActiveTextures().map(t => ({ name: t.name, width: t.getSize().width, height: t.getSize().height, ready: t.isReady() })) })),
    mutableMaterialsIndependent: car.materials.every(m => !other.materials.includes(m)),
    sharedTextureCount: car.materials.flatMap(m => m.getActiveTextures()).filter(t => other.materials.some(m => m.getActiveTextures().includes(t))).length,
    repeatedCreateRemove: { cycles: 8, before, after: counts() },
  };
  car.root.dispose(); other.root.dispose();
  for (const m of [...car.materials, ...other.materials]) m.dispose();
  assets.dispose(); shadows.dispose(); scene.dispose(); engine.dispose();
  return report;
}
