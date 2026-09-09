// Offline only: npm install --prefix /tmp/leonida-character-tools three@0.180.0
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {createHash} from 'node:crypto';
const tools=process.env.CHARACTER_TOOL_ROOT||'/tmp/leonida-character-tools/node_modules/three';
const three=await import(pathToFileURL(resolve(tools,'build/three.module.js')).href);
const {FBXLoader}=await import(pathToFileURL(resolve(tools,'examples/jsm/loaders/FBXLoader.js')).href);
const {GLTFExporter}=await import(pathToFileURL(resolve(tools,'examples/jsm/exporters/GLTFExporter.js')).href);
const {mergeVertices}=await import(pathToFileURL(resolve(tools,'examples/jsm/utils/BufferGeometryUtils.js')).href);
const {TextureLoader,Texture,LoadingManager,MeshStandardMaterial,Group,Box3}=three;
TextureLoader.prototype.load=function(){return new Texture();};
const manager=new LoadingManager();manager.addHandler(/\.tga$/i,{setPath(){return this;},load(){return new Texture();}});
globalThis.FileReader=class {readAsArrayBuffer(blob){blob.arrayBuffer().then(x=>{this.result=x;this.onloadend?.();});}readAsDataURL(blob){blob.arrayBuffer().then(x=>{this.result=`data:${blob.type};base64,${Buffer.from(x).toString('base64')}`;this.onloadend?.();});}};
const root=resolve(import.meta.dirname,'../..'),out=resolve(root,'public/characters/rocketbox');await mkdir(out,{recursive:true});
const records=[];
for(const [name,label] of [['Male_Adult_01','male'],['Female_Adult_01','female']]){
 const bytes=await readFile(resolve(root,'data/characters/rocketbox/source',name,name+'.fbx'));
 const fbx=new FBXLoader(manager).parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
 const remove=[];fbx.traverse(m=>{if(m.isLight||m.isCamera)remove.push(m);if(m.isMesh){
  const materials=Array.isArray(m.material)?m.material:[m.material];m.material=materials.map(x=>new MeshStandardMaterial({name:x.name,color:0xffffff,metalness:0,roughness:x.name.includes('head')?.67:.9}));
  // Repack noncontiguous source material groups into three contiguous draw ranges.
  const geometry=m.geometry,attributes=Object.fromEntries(Object.entries(geometry.attributes).map(([k,v])=>[k,{array:[],source:v}]));
  const groups=[];let offset=0;
  for(let mat=0;mat<materials.length;mat++){const start=offset;for(const group of geometry.groups.filter(g=>g.materialIndex===mat))for(let n=group.start;n<group.start+group.count;n++){for(const a of Object.values(attributes)){for(let c=0;c<a.source.itemSize;c++)a.array.push(a.source.array[n*a.source.itemSize+c]);}offset++;}groups.push({start,count:offset-start,materialIndex:mat});}
  const packed=new three.BufferGeometry();for(const [k,a]of Object.entries(attributes)){const ctor=a.source.array.constructor;packed.setAttribute(k,new three.BufferAttribute(new ctor(a.array),a.source.itemSize,a.source.normalized));}
  packed.groups=groups;const uv=packed.getAttribute('uv');for(let i=0;i<uv.count;i++)uv.setY(i,1-uv.getY(i));m.geometry=mergeVertices(packed,1e-5);m.geometry.computeBoundingBox();m.geometry.computeBoundingSphere();
 }});remove.forEach(x=>x.removeFromParent());fbx.animations=[];
 const wrapper=new Group();wrapper.name=`rocketbox-${label}-metres`;wrapper.scale.setScalar(.01);wrapper.add(fbx);wrapper.updateMatrixWorld(true);
 const json=await new GLTFExporter().parseAsync(wrapper,{binary:false,onlyVisible:true,includeCustomExtensions:false});
 const binary=Buffer.from(json.buffers[0].uri.split(',')[1],'base64');delete json.buffers[0].uri;
 json.images=[];json.textures=[];json.samplers=[{magFilter:9729,minFilter:9987,wrapS:10497,wrapT:10497}];
 function tex(uri){const index=json.images.length;json.images.push({uri:`${label}/${uri}`});json.textures.push({source:index,sampler:0});return index;}
 for(const material of json.materials){const opacity=material.name.includes('opacity'),part=material.name.includes('head')?'head':'body';material.pbrMetallicRoughness={baseColorFactor:[1,1,1,1],metallicFactor:0,roughnessFactor:opacity?.85:part==='head'?.67:.9,baseColorTexture:{index:tex(opacity?'opacity-color.png':`${part}-color.jpg`)}};if(opacity){material.alphaMode='MASK';material.alphaCutoff=.45;material.doubleSided=true;}else material.normalTexture={index:tex(`${part}-normal.png`),scale:.65};}
 json.asset.extras={source:'Microsoft Rocketbox',character:name,license:'MIT',copyright:'Copyright (c) 2020 Microsoft',changes:'Converted FBX to metre-scaled glTF; grouped and welded vertices; converted diffuse/normal/alpha textures; PBR roughness authored.'};
 const text=Buffer.from(JSON.stringify(json)),jsonPad=Buffer.alloc(Math.ceil(text.length/4)*4,32);text.copy(jsonPad);const binPad=Buffer.alloc(Math.ceil(binary.length/4)*4);binary.copy(binPad);const header=Buffer.alloc(12),jheader=Buffer.alloc(8),bheader=Buffer.alloc(8);header.writeUInt32LE(0x46546c67);header.writeUInt32LE(2,4);header.writeUInt32LE(12+8+jsonPad.length+8+binPad.length,8);jheader.writeUInt32LE(jsonPad.length);jheader.writeUInt32LE(0x4e4f534a,4);bheader.writeUInt32LE(binPad.length);bheader.writeUInt32LE(0x004e4942,4);const glb=Buffer.concat([header,jheader,jsonPad,bheader,binPad]);await writeFile(resolve(out,`${label}.glb`),glb);
 const meshes=[];fbx.traverse(m=>{if(m.isMesh)meshes.push({vertices:m.geometry.attributes.position.count,triangles:m.geometry.index.count/3,groups:m.geometry.groups.length,bones:m.skeleton?.bones.length});});records.push({name,label,file:`${label}.glb`,bytes:glb.length,sha256:createHash('sha256').update(glb).digest('hex'),meshes,bounds:new Box3().setFromObject(wrapper)});
}
await writeFile(resolve(out,'manifest.json'),JSON.stringify({format:'glTF2 GLB with external textures',license:'MIT',copyright:'Copyright (c) 2020 Microsoft',assets:records},null,2));console.log(JSON.stringify(records,null,2));
