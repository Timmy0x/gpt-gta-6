import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, resolve } from 'node:path';
const commit='0943055db6ec570bcef9f2c8b41c9e5467c808f9';
const root=resolve(import.meta.dirname,'../..'),source=resolve(root,'data/characters/rocketbox/source');
const files=[];
for(const [name,prefix] of [['Male_Adult_01','m002'],['Female_Adult_01','f001']]){
 for(const path of [`Export/${name}.fbx`,...['body_color','body_normal','head_color','head_normal','opacity_color'].map(s=>`Textures/${prefix}_${s}.tga`)])files.push({name,path:`Assets/Avatars/Adults/${name}/${path}`});
}
await mkdir(source,{recursive:true});
const records=[];
for(const file of files){
 const url=`https://raw.githubusercontent.com/microsoft/Microsoft-Rocketbox/${commit}/${file.path}`;
 const destination=resolve(source,file.name,basename(file.path));await mkdir(resolve(source,file.name),{recursive:true});
 let bytes;try{bytes=await readFile(destination);}catch{const response=await fetch(url);if(!response.ok)throw new Error(`${response.status} ${url}`);bytes=Buffer.from(await response.arrayBuffer());await writeFile(destination,bytes);}
 records.push({source:file.path,url,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),local:`source/${file.name}/${basename(file.path)}`});console.log(basename(file.path),bytes.length);
}
await writeFile(resolve(root,'data/characters/rocketbox/source-manifest.json'),JSON.stringify({upstream:'https://github.com/microsoft/Microsoft-Rocketbox',commit,retrievedAt:new Date().toISOString(),license:'MIT',copyright:'Copyright (c) 2020 Microsoft',characters:['Male_Adult_01','Female_Adult_01'],files:records},null,2));
