import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

// Publisher texture files only. Google Maps and Street View are never sources
// for this asset pipeline. Offline metadata is retained for reproducibility.
const root=resolve(import.meta.dirname,'../../../..');
const records=resolve(root,'data/world/miami/references/materials'),output=resolve(root,'public/world/miami/materials');
const definitions=[
 {id:'asphalt_02',usage:'road-surface',note:'Weathered asphalt candidate; road wear and markings remain separate measured geometry/decals.'},
 {id:'brushed_concrete',usage:'sidewalk-and-curb',note:'Continuous brushed concrete candidate; expansion joints, curb faces and ramps require authored geometry.'},
 {id:'concrete_pavement',usage:'rectangular-sidewalk-pavers',note:'Rectangular pavement candidate, only for mapped areas where compatible source reference confirms pavers.'},
 {id:'concrete_pavers',usage:'interlocking-plaza-pavers',note:'Interlocking paver option, not an assertion that this exact pattern exists on the first block.'},
 {id:'granite_tile',usage:'dark-stone-plinth',note:'Granite cladding/plaza candidate. Does not replace the documented green marble finish at 801 Brickell.'},
 {id:'white_stucco',usage:'painted-concrete-facade',note:'Textured pale rendered-concrete candidate. Does not establish façade panel spacing or exact surface finish.'},
 {id:'dense_sand',usage:'sand-and-waterbed',note:'Compacted sand candidate for unobstructed ground; surveyed underwater terrain and wet material response remain separate.'},
 {id:'brown_mud_leaves_01',usage:'planting-soil',note:'Soil with leaf litter for planting beds; do not carpet paved parcels or landscaped grass with this material.'},
];
const hash=(algorithm,bytes)=>createHash(algorithm).update(bytes).digest('hex');
await mkdir(output,{recursive:true});const entries=[];
for(const definition of definitions){
 const info=JSON.parse(await readFile(resolve(records,definition.id+'-info.json'))),files=JSON.parse(await readFile(resolve(records,definition.id+'-files.json'))),levels=[];
 for(const resolution of ['1k','2k']){
  const maps=[];await mkdir(resolve(output,definition.id,resolution),{recursive:true});
  for(const [channel,name,colorSpace] of [['Diffuse','color','srgb'],['nor_gl','normal','linear'],['arm','arm','linear']]){
   const source=files[channel][resolution].jpg;assert.equal(new URL(source.url).hostname,'dl.polyhaven.org');
   const file=resolve(output,definition.id,resolution,name+'.jpg');let bytes;
   try{bytes=await readFile(file);}catch{const response=await fetch(source.url);assert.ok(response.ok,source.url+' '+response.status);bytes=Buffer.from(await response.arrayBuffer());}
   assert.equal(bytes.length,source.size);assert.equal(hash('md5',bytes),source.md5);await writeFile(file,bytes);
   maps.push({channel,colorSpace,url:`/world/miami/materials/${definition.id}/${resolution}/${name}.jpg`,bytes:bytes.length,source:source.url,md5:source.md5,sha256:hash('sha256',bytes)});
  }
  levels.push({resolution,maps});
 }
 entries.push({...definition,name:info.name,authors:info.authors,source:`https://polyhaven.com/a/${definition.id}`,license:'CC0-1.0',tileMetres:info.dimensions.map(value=>value/1000),levels,normalConvention:'OpenGL +Y',armChannels:{red:'ambient-occlusion',green:'roughness',blue:'metalness'},metallicFactor:0,normalStrength:definition.id==='asphalt_02'?.45:.35,scaleStatus:'Publisher measured texture tile, not a survey of a Miami surface.'});
 console.log(JSON.stringify({id:definition.id,tileMetres:entries.at(-1).tileMetres,bytes:levels.flatMap(level=>level.maps).reduce((sum,map)=>sum+map.bytes,0)}));
}
const bindings={asphalt:'asphalt_02',sidewalk:'brushed_concrete',curb:'brushed_concrete',soil:'brown_mud_leaves_01',sand:'dense_sand',waterbed:'dense_sand','facade-stone':'granite_tile','facade-concrete':'white_stucco','pavers-rectangular':'concrete_pavement','pavers-interlocking':'concrete_pavers'};
const manifest={version:1,acquired:'2026-09-12',credit:'Powered by Poly Haven',license:'https://polyhaven.com/license',scope:'Reusable first-block material candidates. No façade, street width or landmark accuracy is implied by material acquisition.',modifications:'Publisher 1K/2K JPEG maps copied unchanged; no photographs, preview renders, Google imagery or map tiles are included.',bindings,unavailable:{'facade-glass':'Requires an authored glazing assembly with dielectric reflection/refraction, correctly modeled interior/spandrels and measured pane/mullion dimensions. No flat-color replacement is supplied.'},entries};
await writeFile(resolve(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
await writeFile(resolve(records,'acquisition.json'),JSON.stringify({assets:entries.length,files:entries.flatMap(entry=>entry.levels.flatMap(level=>level.maps)).length,bytes:entries.flatMap(entry=>entry.levels.flatMap(level=>level.maps)).reduce((sum,map)=>sum+map.bytes,0)},null,2)+'\n');
