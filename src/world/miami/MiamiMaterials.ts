import {Color3,PBRMaterial,Texture,type Scene} from '@babylonjs/core';

export type MiamiMaterialQuality='1k'|'2k';
export interface MiamiTextureMap {channel:string;colorSpace:string;url:string;sha256:string;bytes:number}
export interface MiamiMaterialEntry {id:string;name:string;source:string;license:string;tileMetres:number[];normalStrength:number;levels:{resolution:string;maps:MiamiTextureMap[]}[]}
export interface MiamiMaterialManifest {bindings:Record<string,string>;unavailable:Record<string,string>;entries:MiamiMaterialEntry[]}
type TextureLoader=(url:string,scene:Scene)=>Texture;

/** One scene-owned library; textures are shared by physical material identity.
 * Input mesh UVs are metre coordinates. No dependence on the retired map. */
export function createMiamiMaterialLibrary(scene:Scene,manifest:MiamiMaterialManifest,quality:MiamiMaterialQuality='1k',load:TextureLoader=(url,scene)=>new Texture(url,scene,false,false,Texture.TRILINEAR_SAMPLINGMODE)){
 const materials=new Map<string,PBRMaterial>();
 return {
  get(key:string):PBRMaterial{
   const id=manifest.bindings[key];if(!id)throw new Error(`Miami material ${key} is unavailable: ${manifest.unavailable[key]??'no authored source'}`);
   const existing=materials.get(id);if(existing)return existing;
   const entry=manifest.entries.find(entry=>entry.id===id);if(!entry||entry.tileMetres.length!==2||entry.tileMetres.some(value=>!Number.isFinite(value)||value<=0))throw new Error(`Invalid metre scale for ${id}`);
   const level=entry.levels.find(level=>level.resolution===quality);if(!level)throw new Error(`Missing ${quality} maps for ${id}`);
   for(const channel of ['Diffuse','nor_gl','arm'])if(!level.maps.some(map=>map.channel===channel))throw new Error(`Missing ${channel} map for ${id}`);
   const material=new PBRMaterial(`miami/${id}`,scene);material.albedoColor=Color3.White();material.metallic=0;material.roughness=1;material.maxSimultaneousLights=4;
   const texture=(channel:string)=>{const map=level.maps.find(map=>map.channel===channel);if(!map)throw new Error(`Missing ${channel} map for ${id}`);const texture=load(map.url,scene);texture.gammaSpace=map.colorSpace==='srgb';texture.uScale=1/entry.tileMetres[0];texture.vScale=1/entry.tileMetres[1];texture.wrapU=Texture.WRAP_ADDRESSMODE;texture.wrapV=Texture.WRAP_ADDRESSMODE;texture.anisotropicFilteringLevel=8;return texture;};
   material.albedoTexture=texture('Diffuse');material.bumpTexture=texture('nor_gl');material.bumpTexture.level=entry.normalStrength;
   material.metallicTexture=texture('arm');material.useAmbientOcclusionFromMetallicTextureRed=true;material.useRoughnessFromMetallicTextureGreen=true;material.useRoughnessFromMetallicTextureAlpha=false;material.useMetallnessFromMetallicTextureBlue=true;
   material.metadata={miamiMaterial:id,source:entry.source,license:entry.license,tileMetres:entry.tileMetres,quality,scope:'Acquired surface candidate; block-specific finish remains subject to reference review.'};materials.set(id,material);return material;
  },
  dispose(){for(const material of materials.values())material.dispose(false,true);materials.clear();},
 };
}
