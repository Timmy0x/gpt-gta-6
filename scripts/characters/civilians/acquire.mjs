import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, resolve } from 'node:path';
import { commit, variants } from './config.mjs';

const root=resolve(import.meta.dirname,'../../..'),target=resolve(root,'data/characters/civilians');
const tree=JSON.parse(await readFile(resolve(root,'data/characters/rocketbox/upstream-tree.json'),'utf8')).tree;
const records=[];
await mkdir(target,{recursive:true});
await writeFile(resolve(target,'.gitignore'),'/source/\n');
for(const variant of variants){
 const {name,prefix}=variant;
 const paths=[`Export/${name}.fbx`,`${name}.png`,...['body_color','body_normal','head_color','head_normal','opacity_color'].map(part=>`Textures/${prefix}_${part}.tga`)];
 for(const relative of paths){
  const source=`Assets/Avatars/Adults/${name}/${relative}`,entry=tree.find(file=>file.path===source);
  if(!entry?.sha)throw new Error(`Pinned source tree is missing ${source}`);
  const local=relative.endsWith('.png')?`reference/${basename(relative)}`:`source/${name}/${basename(relative)}`;
  const destination=resolve(target,local),url=`https://raw.githubusercontent.com/microsoft/Microsoft-Rocketbox/${commit}/${source}`;
  await mkdir(resolve(destination,'..'),{recursive:true});
  let bytes;try{bytes=await readFile(destination);}catch{const response=await fetch(url);if(!response.ok)throw new Error(`${response.status} ${url}`);bytes=Buffer.from(await response.arrayBuffer());}
  const gitBlobSha=createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  if(bytes.length!==entry.size||gitBlobSha!==entry.sha)throw new Error(`Pinned content mismatch: ${source}`);
  await writeFile(destination,bytes);
  records.push({source,url,local,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),gitBlobSha});
  console.log(name,basename(relative),bytes.length);
  await writeFile(resolve(target,'source-manifest.json'),JSON.stringify({upstream:'https://github.com/microsoft/Microsoft-Rocketbox',commit,retrievedAt:new Date().toISOString(),license:'MIT',copyright:'Copyright (c) 2020 Microsoft',variants,files:records},null,2)+'\n');
 }
}
const license=await readFile(resolve(root,'data/characters/rocketbox/LICENSE.md'));
const licenseEntry=tree.find(file=>file.path==='LICENSE.md'),licenseBlob=createHash('sha1').update(`blob ${license.length}\0`).update(license).digest('hex');
if(licenseBlob!==licenseEntry?.sha)throw new Error('License differs from the pinned source tree');
await writeFile(resolve(target,'LICENSE.md'),license);
await mkdir(resolve(root,'public/characters/civilians'),{recursive:true});
await writeFile(resolve(root,'public/characters/civilians/LICENSE.txt'),license);
const manifest=JSON.parse(await readFile(resolve(target,'source-manifest.json'),'utf8'));
manifest.licenseFile={source:'LICENSE.md',url:`https://raw.githubusercontent.com/microsoft/Microsoft-Rocketbox/${commit}/LICENSE.md`,local:'LICENSE.md',bytes:license.length,sha256:createHash('sha256').update(license).digest('hex'),gitBlobSha:licenseBlob};
await writeFile(resolve(target,'source-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
