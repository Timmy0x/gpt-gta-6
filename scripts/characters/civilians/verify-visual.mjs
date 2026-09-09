import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
const output='data/characters/civilians/evidence';await mkdir(output,{recursive:true});
const server=await createServer({server:{host:'127.0.0.1',port:4189,strictPort:true}});await server.listen();
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=metal','--ignore-gpu-blocklist']}),page=await browser.newPage({viewport:{width:1600,height:1100}}),errors=[],warnings=[],states=[];
page.on('pageerror',error=>errors.push(error.stack));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());if(message.type()==='warning')warnings.push(message.text());});
let lifecycle,passed=false;
try{
 await page.goto('http://127.0.0.1:4189/scripts/characters/civilians/preview.html');await page.waitForFunction(()=>window.civilianReview?.ready,{},{timeout:120000});
 for(const mode of ['idle','walk','run','crouch','aim','seated']){
  await page.evaluate(value=>window.civilianReview.setMode(value),mode);await page.waitForTimeout(1200);await page.screenshot({path:`${output}/${mode}.png`});
  states.push({mode,...await page.evaluate(()=>{const r=window.civilianReview;return {backend:`WebGL ${r.scene.getEngine().webGLVersion}`,counts:r.counts(),parts:[r.male,r.female].map(c=>({name:c.root.name,meshes:c.parts.slice(1).map(m=>({vertices:m.getTotalVertices(),triangles:m.getTotalIndices()/3,bones:m.skeleton.bones.length,material:m.material.name,textures:m.material.getActiveTextures().map(t=>({name:t.name,ready:t.isReady()}))}))}))};})});
 }
 lifecycle=await page.evaluate(()=>window.civilianReview.cycleClones());assert.deepEqual(lifecycle.before,lifecycle.after,'cloning/disposing does not retain render resources');
 assert.equal(errors.length,0);assert.ok(states.every(state=>state.parts.every(part=>part.meshes.every(mesh=>mesh.textures.every(texture=>texture.ready)))),'all imported material texture slots are ready');
 passed=true;
 console.log(JSON.stringify({pass:true,errors,warnings,lifecycle,states},null,2));
}finally{
 await writeFile(`${output}/visual-verification.json`,JSON.stringify({scope:'Isolated Babylon asset studio; actual imported models and existing retargeter; no gameplay integration/performance claim.',pass:passed,errors,warnings,lifecycle,states},null,2)+'\n');
 await browser.close();await server.close();
}
