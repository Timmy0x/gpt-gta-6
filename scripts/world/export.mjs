import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
const root=resolve(import.meta.dirname,'../..'),out=resolve(root,'public/world');
const server=await createServer({root,server:{host:'127.0.0.1',port:4182,strictPort:true}});
await server.listen();
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--disable-gpu']});
try{
 const page=await browser.newPage();
 await page.exposeFunction('writeWorldAsset',async(name,text,kind)=>{
  if(name.includes('..')||name.startsWith('/'))throw new Error('Invalid export path');
  const raw=kind==='png'?Buffer.from(text.split(',')[1],'base64'):Buffer.from(text);
  const bytes=name.endsWith('.gz')?gzipSync(raw,{level:9}):raw;
  const path=resolve(out,name);await mkdir(dirname(path),{recursive:true});await writeFile(path,bytes);
  return {bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
 });
 await page.goto('http://127.0.0.1:4182/scripts/world/export.html');
 const result=await page.evaluate(async()=>{const module=await import('/scripts/world/export-browser.ts');return module.exportWorld();});
 console.log(JSON.stringify(result,null,2));
}finally{await browser.close();await server.close();}
