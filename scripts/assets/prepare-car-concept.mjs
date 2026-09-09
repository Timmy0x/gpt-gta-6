/** Reproducible CC-BY asset preparation. No raster editing or runtime gameplay changes. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const COMMIT = '44b6f9bdb08a5b16e92b91857ec3c87de9401dfa';
const ROOT = `https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/${COMMIT}`;
const DOCUMENT_COMMIT = '90d7ede14c7e280af263824604b427a1ca02cb66';
const DOCUMENT_ROOT = `https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/${DOCUMENT_COMMIT}`;
const SOURCE_URL = `${ROOT}/Models/CarConcept/glTF-Binary/CarConcept.glb`;
const SOURCE_SHA256 = 'c272098089d78c5cd9fd9f24ff50ee8acf8d932c55f2d55fc10adb6c8998966b';
const project = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const output = resolve(project, 'public/vehicles/concept');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceArgument = process.argv.indexOf('--source');
async function download(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} while downloading ${url}`);
  return Buffer.from(await response.arrayBuffer());
}
function parseGLB(bytes) {
  assert.equal(bytes.readUInt32LE(0), 0x46546c67, 'GLB magic');
  assert.equal(bytes.readUInt32LE(4), 2, 'GLB version');
  assert.equal(bytes.readUInt32LE(8), bytes.length, 'complete GLB');
  const jsonLength = bytes.readUInt32LE(12);
  assert.equal(bytes.readUInt32LE(16), 0x4e4f534a);
  const binHeader = 20 + jsonLength;
  assert.equal(bytes.readUInt32LE(binHeader + 4), 0x004e4942);
  return { gltf: JSON.parse(bytes.subarray(20, binHeader).toString()), bin: bytes.subarray(binHeader + 8, binHeader + 8 + bytes.readUInt32LE(binHeader)) };
}
function encodeGLB(gltf, bin) {
  const json = Buffer.from(JSON.stringify(gltf));
  const jsonPad = Buffer.alloc((4 - json.length % 4) % 4, 0x20);
  const binPad = Buffer.alloc((4 - bin.length % 4) % 4);
  const header = Buffer.alloc(20), binaryHeader = Buffer.alloc(8);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + json.length + jsonPad.length + 8 + bin.length + binPad.length, 8);
  header.writeUInt32LE(json.length + jsonPad.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
  binaryHeader.writeUInt32LE(bin.length + binPad.length, 0); binaryHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, json, jsonPad, binaryHeader, bin, binPad]);
}
function multiply(a, b) {
  const c = Array(16).fill(0);
  for (let column = 0; column < 4; column++) for (let row = 0; row < 4; row++)
    for (let k = 0; k < 4; k++) c[column * 4 + row] += a[k * 4 + row] * b[column * 4 + k];
  return c;
}
function localMatrix(node) {
  if (node.matrix) return node.matrix;
  const [x,y,z,w] = node.rotation ?? [0,0,0,1], s = node.scale ?? [1,1,1], t = node.translation ?? [0,0,0];
  return [(1-2*y*y-2*z*z)*s[0],(2*x*y+2*z*w)*s[0],(2*x*z-2*y*w)*s[0],0,(2*x*y-2*z*w)*s[1],(1-2*x*x-2*z*z)*s[1],(2*y*z+2*x*w)*s[1],0,(2*x*z+2*y*w)*s[2],(2*y*z-2*x*w)*s[2],(1-2*x*x-2*y*y)*s[2],0,...t,1];
}
function geometrySummary(gltf, bin) {
  const parents = new Map(), matrices = new Map();
  gltf.nodes.forEach((node, i) => node.children?.forEach(child => { assert.ok(gltf.nodes[child]); assert.ok(!parents.has(child)); parents.set(child,i); }));
  function worldMatrix(i) { if (!matrices.has(i)) matrices.set(i,parents.has(i) ? multiply(worldMatrix(parents.get(i)),localMatrix(gltf.nodes[i])) : localMatrix(gltf.nodes[i])); return matrices.get(i); }
  const min=[Infinity,Infinity,Infinity], max=[-Infinity,-Infinity,-Infinity];
  let vertices=0, triangles=0, primitives=0;
  for (const [i,node] of gltf.nodes.entries()) {
    if (node.mesh === undefined) continue;
    const matrix=worldMatrix(i);
    for (const primitive of gltf.meshes[node.mesh].primitives) {
      const accessor=gltf.accessors[primitive.attributes.POSITION], view=gltf.bufferViews[accessor.bufferView];
      assert.equal(accessor.componentType,5126); assert.equal(accessor.type,'VEC3');
      assert.equal(primitive.mode ?? 4,4); assert.ok(!accessor.sparse);
      vertices+=accessor.count; triangles+=(primitive.indices===undefined?accessor.count:gltf.accessors[primitive.indices].count)/3; primitives++;
      for (let v=0;v<accessor.count;v++) {
        const offset=(view.byteOffset??0)+(accessor.byteOffset??0)+v*(view.byteStride??12);
        const x=bin.readFloatLE(offset),y=bin.readFloatLE(offset+4),z=bin.readFloatLE(offset+8);
        const p=[matrix[0]*x+matrix[4]*y+matrix[8]*z+matrix[12],matrix[1]*x+matrix[5]*y+matrix[9]*z+matrix[13],matrix[2]*x+matrix[6]*y+matrix[10]*z+matrix[14]];
        p.forEach((value,axis)=>{assert.ok(Number.isFinite(value));min[axis]=Math.min(min[axis],value);max[axis]=Math.max(max[axis],value);});
      }
    }
  }
  return {nodes:gltf.nodes.length,meshes:gltf.meshes.length,primitives,vertices,triangles,bounds:{min,max,dimensions:max.map((v,i)=>v-min[i])}};
}
function textureReferences(value, callback) {
  if (!value || typeof value !== 'object') return;
  for (const [key,child] of Object.entries(value)) {
    if (/texture$/i.test(key) && child && typeof child.index === 'number') callback(value,key,child);
    else textureReferences(child,callback);
  }
}

const source = sourceArgument >= 0 ? await readFile(process.argv[sourceArgument + 1]) : await download(SOURCE_URL);
assert.equal(sha256(source),SOURCE_SHA256,'pinned source SHA-256');
const {gltf:original,bin:originalBin}=parseGLB(source), gltf=structuredClone(original);
const before=geometrySummary(original,originalBin);
const removedImages=new Set([3,10,11]); // Khronos_C, Tireside_C, Tireside_N; visually inspected against the glTF names.
const removedViews=new Set([...removedImages].map(i=>original.images[i].bufferView));
const removedPayloads=[...removedImages].map(image=>{
  const view=original.bufferViews[original.images[image].bufferView];
  const payload=originalBin.subarray(view.byteOffset,view.byteOffset+view.byteLength);
  return {image,bufferView:original.images[image].bufferView,payload,sha256:sha256(payload),bytes:payload.length};
});
const imageMap=new Map(),textureMap=new Map();
gltf.images=original.images.filter((image,i)=>{if(removedImages.has(i))return false;imageMap.set(i,imageMap.size);return true;}).map(image=>({...image}));
gltf.textures=original.textures.filter((texture,i)=>{if(removedImages.has(texture.source))return false;textureMap.set(i,textureMap.size);return true;}).map(texture=>({...texture,source:imageMap.get(texture.source)}));
const removedSlots=[];
for (const [materialIndex,material] of gltf.materials.entries()) textureReferences(material,(parent,key,info)=>{
  if(!textureMap.has(info.index)){removedSlots.push({material:materialIndex,name:material.name??null,slot:key,texture:info.index});delete parent[key];if(key==='emissiveTexture')material.emissiveFactor=[0,0,0];}
  else info.index=textureMap.get(info.index);
});
gltf.materials[9].pbrMetallicRoughness.baseColorFactor=[.22,.24,.22,1]; // blank plate
gltf.materials[18].pbrMetallicRoughness.baseColorFactor=[.025,.028,.03,1]; // generic sidewall rubber
gltf.materials[18].pbrMetallicRoughness.roughnessFactor=.86;

const viewMap=new Map(),newViews=[],parts=[];let byteOffset=0;
for(const [i,view] of original.bufferViews.entries()){
  if(removedViews.has(i))continue;
  assert.equal(view.buffer,0);
  const padding=Buffer.alloc((4-byteOffset%4)%4);parts.push(padding);byteOffset+=padding.length;
  const bytes=originalBin.subarray(view.byteOffset??0,(view.byteOffset??0)+view.byteLength);
  viewMap.set(i,newViews.length);newViews.push({...view,buffer:0,byteOffset});parts.push(bytes);byteOffset+=bytes.length;
}
gltf.bufferViews=newViews;
for(const accessor of gltf.accessors){if(accessor.bufferView!==undefined){assert.ok(viewMap.has(accessor.bufferView));accessor.bufferView=viewMap.get(accessor.bufferView);}assert.ok(!accessor.sparse);}
for(const image of gltf.images){assert.ok(viewMap.has(image.bufferView));image.bufferView=viewMap.get(image.bufferView);}
const bin=Buffer.concat(parts);gltf.buffers=[{byteLength:bin.length}];
gltf.asset.copyright='© 2024 Darmstadt Graphics Group GmbH. Model and textures by Eric Chadwick, CC BY 4.0. Modified for Leonida: excluded logos removed; generic sidewalls and blank plate.';
gltf.asset.extras={...gltf.asset.extras,leonidaPreparation:{sourceUrl:SOURCE_URL,sourceSha256:SOURCE_SHA256,license:'CC-BY-4.0',modifications:'Removed Khronos/3DCommerce logo images and all their texture references and binary payloads; generic rubber sidewalls and blank plate; removed logo emissive contributions.'}};
const prepared=encodeGLB(gltf,bin),parsed=parseGLB(prepared),after=geometrySummary(parsed.gltf,parsed.bin);
assert.deepEqual(after,before,'exact vertex-derived transformed bounds and geometry counts preserved');
assert.deepEqual(gltf.nodes,original.nodes,'door/wheel pivots and complete hierarchy preserved');
assert.deepEqual(gltf.scenes,original.scenes);
for(const name of ['BodyDoorLColor1','BodyDoorRColor1','BodyHood','BodyRearPanelsColor1','WheelFrontL','WheelFrontR','WheelRearL','WheelRearR'])assert.ok(gltf.nodes.some(n=>n.name===name));
textureReferences(gltf,(_parent,_key,info)=>assert.ok(gltf.textures[info.index]));
for(const texture of gltf.textures)assert.ok(gltf.images[texture.source]);
for(const image of gltf.images)assert.ok(gltf.bufferViews[image.bufferView]);
for(const removed of removedPayloads){assert.equal(prepared.indexOf(removed.payload),-1,'removed logo PNG payload must not remain anywhere');for(const image of gltf.images){const view=gltf.bufferViews[image.bufferView];assert.notEqual(sha256(bin.subarray(view.byteOffset,view.byteOffset+view.byteLength)),removed.sha256);}}
assert.equal(gltf.images.length,11);assert.equal(gltf.textures.length,12);
assert.equal(gltf.materials[18].normalTexture,undefined);assert.equal(gltf.materials[18].pbrMetallicRoughness.baseColorTexture,undefined);
assert.equal(gltf.materials[9].pbrMetallicRoughness.baseColorTexture,undefined);

await mkdir(output,{recursive:true});
const documents=[['SOURCE-LICENSE.md',`${DOCUMENT_ROOT}/Models/CarConcept/LICENSE.md`],['SOURCE-metadata.json',`${DOCUMENT_ROOT}/Models/CarConcept/metadata.json`],['SOURCE-TRADEMARK.txt',`${DOCUMENT_ROOT}/LICENSES/LicenseRef-LegalMark-Khronos.txt`]];
const documentProvenance=[];
for(const [filename,url] of documents){const bytes=await download(url);await writeFile(resolve(output,filename),bytes);documentProvenance.push({filename,url,sha256:sha256(bytes)});}
const provenance={sourceUrl:SOURCE_URL,originalDownloadUrl:'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/CarConcept/glTF-Binary/CarConcept.glb',sourceCommit:COMMIT,documentCommit:DOCUMENT_COMMIT,sourceSha256:SOURCE_SHA256,sourceBytes:source.length,sourceCopyright:original.asset.copyright,license:'CC-BY-4.0',author:'Eric Chadwick',copyrightOwner:'Darmstadt Graphics Group GmbH',copyrightYear:2024,outputSha256:sha256(prepared),outputBytes:prepared.length,modifications:gltf.asset.extras.leonidaPreparation.modifications,removedImages:removedPayloads.map(({payload,...entry})=>entry),removedTextureSlots:removedSlots,verification:{geometry:after,hierarchyPreserved:true,remainingImages:gltf.images.length,remainingTextures:gltf.textures.length,removedPayloadsAbsent:true},documents:documentProvenance};
await writeFile(resolve(output,'car.glb'),prepared);
await writeFile(resolve(output,'provenance.json'),JSON.stringify(provenance,null,2)+'\n');
await writeFile(resolve(output,'ATTRIBUTION.md'),`# Car Concept — modified local asset\n\nModel and textures by **Eric Chadwick**, © 2024 **Darmstadt Graphics Group GmbH**, licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). [Original asset](${SOURCE_URL}).\n\nModified for Leonida: Khronos and 3DCommerce logo texture references and image payloads removed; generic tire sidewalls and blank license plate; logo emissive contributions removed. Door, wheel, cabin and body geometry/hierarchy retained. No endorsement by the original creators or Khronos is implied. Original licensing notices and exact source/output hashes are retained beside this file.\n\nReproduce: \`node scripts/assets/prepare-car-concept.mjs\`. Optionally pass \`--source /path/to/original.glb\`; the source SHA-256 is always checked.\n`);
console.log(JSON.stringify({output,bytes:prepared.length,sourceSha256:SOURCE_SHA256,outputSha256:provenance.outputSha256,verification:provenance.verification},null,2));
