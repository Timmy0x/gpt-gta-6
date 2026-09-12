import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {NullEngine,RawTexture,Scene,Texture} from '@babylonjs/core';
import {createMiamiMaterialLibrary,type MiamiMaterialManifest} from '../src/world/miami/MiamiMaterials';

const manifest=JSON.parse(await readFile(new URL('../public/world/miami/materials/manifest.json',import.meta.url),'utf8')) as MiamiMaterialManifest;

test('Miami PBR channels keep their measured metre scale, linear data and shared scene resources',()=>{
 const engine=new NullEngine(),scene=new Scene(engine),requests:string[]=[],owned:Texture[]=[];
 const load=(url:string)=>{requests.push(url);const texture=RawTexture.CreateRGBATexture(new Uint8Array([128,128,255,255]),1,1,scene);owned.push(texture);return texture;};
 const library=createMiamiMaterialLibrary(scene,manifest,'1k',load);
 try{
  const asphalt=library.get('asphalt'),sidewalk=library.get('sidewalk');
  assert.equal(library.get('curb'),sidewalk);assert.equal(library.get('asphalt'),asphalt);assert.equal(requests.length,6);
  for(const [key,material] of [['asphalt',asphalt],['sidewalk',sidewalk]] as const){
   const entry=manifest.entries.find(entry=>entry.id===manifest.bindings[key])!;
   assert.equal(material.albedoTexture!.gammaSpace,true);assert.equal(material.bumpTexture!.gammaSpace,false);assert.equal(material.metallicTexture!.gammaSpace,false);
   for(const texture of [material.albedoTexture,material.bumpTexture,material.metallicTexture] as Texture[]){
    assert.ok(Math.abs(texture.uScale*entry.tileMetres[0]-1)<1e-12);assert.ok(Math.abs(texture.vScale*entry.tileMetres[1]-1)<1e-12);
    assert.equal(texture.wrapU,Texture.WRAP_ADDRESSMODE);assert.equal(texture.wrapV,Texture.WRAP_ADDRESSMODE);
   }
   assert.equal(material.useAmbientOcclusionFromMetallicTextureRed,true);assert.equal(material.useRoughnessFromMetallicTextureGreen,true);assert.equal(material.useRoughnessFromMetallicTextureAlpha,false);assert.equal(material.useMetallnessFromMetallicTextureBlue,true);
   assert.equal(material.bumpTexture!.level,entry.normalStrength);assert.equal(material.maxSimultaneousLights,4);
  }
  assert.throws(()=>library.get('facade-glass'),/authored glazing assembly/);assert.equal(requests.length,6);
  library.dispose();for(const texture of owned)assert.equal(scene.textures.includes(texture),false);assert.equal(scene.materials.filter(material=>material.name.startsWith('miami/')).length,0);
 }finally{library.dispose();scene.dispose();engine.dispose();}
});

test('all 48 Miami material maps retain publisher checksums and expected channel/resolution pairs',async context=>{
 let files=0,bytes=0;
 for(const entry of manifest.entries){
  assert.equal(entry.license,'CC0-1.0');assert.ok(entry.tileMetres.every(metres=>metres>0&&metres<10));
  for(const resolution of ['1k','2k']){
   const level=entry.levels.find(level=>level.resolution===resolution)!;assert.ok(level);assert.deepEqual(level.maps.map(map=>map.channel).sort(),['Diffuse','arm','nor_gl']);
   for(const map of level.maps){
    const content=await readFile(new URL('../public'+map.url,import.meta.url));assert.equal(content.length,map.bytes);assert.equal(createHash('sha256').update(content).digest('hex'),map.sha256);
    assert.equal(content[0],0xff);assert.equal(content[1],0xd8);files++;bytes+=content.length;
   }
  }
 }
 assert.equal(files,48);context.diagnostic(JSON.stringify({files,bytes}));
});

test('an incomplete material fails before allocating scene textures or a partial material',()=>{
 const engine=new NullEngine(),scene=new Scene(engine),broken=structuredClone(manifest);let loads=0;
 broken.entries.find(entry=>entry.id===broken.bindings.asphalt)!.levels[0].maps.pop();
 const library=createMiamiMaterialLibrary(scene,broken,'1k',()=>{loads++;throw new Error('unexpected allocation');});
 try{assert.throws(()=>library.get('asphalt'),/Missing arm/);assert.equal(loads,0);assert.equal(scene.materials.filter(material=>material.name.startsWith('miami/')).length,0);}
 finally{library.dispose();scene.dispose();engine.dispose();}
});
