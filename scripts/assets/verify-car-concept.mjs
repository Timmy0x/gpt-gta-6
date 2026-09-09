/** CPU-only loader check: geometry/hierarchy, not PBR rendering or runtime performance. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NullEngine, Scene, LoadAssetContainerAsync, Vector3 } from '@babylonjs/core';
import '@babylonjs/loaders/glTF/index.js';
const directory = new URL('../../public/vehicles/concept/', import.meta.url);
const source = await readFile(new URL('car.glb', directory));
const provenance = JSON.parse(await readFile(new URL('provenance.json', directory), 'utf8'));
assert.equal(createHash('sha256').update(source).digest('hex'), provenance.outputSha256);
const engine = new NullEngine(), scene = new Scene(engine);
try {
  const container = await LoadAssetContainerAsync(new Uint8Array(source), scene, { pluginExtension: '.glb', name: 'car.glb', pluginOptions: { gltf: { skipMaterials: true, createInstances: false, animationStartMode: 0 } } });
  const nodes = [...container.meshes, ...container.transformNodes];
  const hinges = ['BodyDoorLColor1','BodyDoorRColor1','BodyHood','BodyRearPanelsColor1'];
  const wheels = ['WheelFrontL','WheelFrontR','WheelRearL','WheelRearR'];
  const inspected = [];
  for (const name of [...hinges,...wheels]) {
    const node = nodes.find(node=>node.name===name); assert.ok(node, name);
    node.computeWorldMatrix(true);
    inspected.push({ name, children: node.getChildren().map(child=>child.name), position: node.getAbsolutePosition().asArray() });
    assert.ok(node.getChildren().length >= (hinges.includes(name) ? 5 : 4));
  }
  let min = new Vector3(Infinity,Infinity,Infinity), max = new Vector3(-Infinity,-Infinity,-Infinity);
  for (const mesh of container.meshes) if (mesh.getTotalVertices()) {mesh.computeWorldMatrix(true);const b=mesh.getBoundingInfo().boundingBox;min=Vector3.Minimize(min,b.minimumWorld);max=Vector3.Maximize(max,b.maximumWorld);}
  const dimensions=max.subtract(min); assert.ok(dimensions.x>2&&dimensions.x<3&&dimensions.y>1&&dimensions.y<2&&dimensions.z>4&&dimensions.z<5);
  const report={method:'Babylon 9.25 NullEngine glTF import, skipMaterials; no GPU or texture rendering',outputSha256:provenance.outputSha256,meshes:container.meshes.length,transformNodes:container.transformNodes.length,skeletons:container.skeletons.length,animationGroups:container.animationGroups.length,importedBoundingBox:{min:min.asArray(),max:max.asArray(),dimensions:dimensions.asArray()},inspected};
  await writeFile(new URL('loader-verification.json', directory),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));container.dispose();
} finally {scene.dispose();engine.dispose();}
