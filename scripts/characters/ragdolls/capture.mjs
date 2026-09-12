import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const origin=process.env.RAGDOLL_URL||'http://127.0.0.1:4280',output=process.env.RAGDOLL_OUTPUT||'docs/evidence/ragdoll-recovery-r1',allFrames=process.env.RAGDOLL_FRAMES||'.local-builds/ragdoll-recovery-r1-frames';
const selected=process.env.RAGDOLL_VARIANTS?.split(','),heading=Number(process.env.RAGDOLL_YAW||0);
const scenarios=process.env.RAGDOLL_SCENARIOS?JSON.parse(process.env.RAGDOLL_SCENARIOS):['Jason','Lucia','male-adult-03','female-adult-06','military'].filter(variant=>!selected||selected.includes(variant)).map(variant=>({variant,heading,fatal:variant==='military',id:variant}));
const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({viewport:{width:1600,height:900},recordVideo:{dir:output+'/video',size:{width:1600,height:900}}}),page=await context.newPage(),errors=[],warnings=[],results=[];
let videoPath=null;
page.on('pageerror',e=>errors.push(e.stack));page.on('console',m=>{if(['error','warning'].includes(m.type()))warnings.push(m.text());});
try{
 const fingerprint=await (await page.request.get(origin+'/source-fingerprint.json')).json();
 if(process.env.RAGDOLL_EXPECTED_SOURCE&&fingerprint.source!==resolve(process.env.RAGDOLL_EXPECTED_SOURCE))throw new Error('Frozen source fingerprint does not match the expected candidate');
 await mkdir(output,{recursive:true});await writeFile(output+'/source-fingerprint.json',JSON.stringify(fingerprint,null,2));
 await page.goto(origin+'/scripts/characters/ragdolls/preview.html');await page.waitForFunction(()=>window.ragdollReview?.ready,null,{timeout:120000});
 for(const scenario of scenarios){
  const {variant,heading=0,fatal=false,id=variant,sourcePose='standing',zeroImpulse=false,frames=300}=scenario;
  console.log('Capturing',id);
  await page.evaluate(({variant,heading,fatal,sourcePose,zeroImpulse})=>window.ragdollReview.setup(variant,heading,fatal,sourcePose,zeroImpulse),{variant,heading,fatal,sourcePose,zeroImpulse});await mkdir(output+'/'+id,{recursive:true});await mkdir(allFrames+'/'+id,{recursive:true});
  for(let frame=0;frame<frames;frame++){
   results.push({variant,heading,id,sourcePose,zeroImpulse,...await page.evaluate(f=>window.ragdollReview.step(f),frame)});
   const buffer=await page.screenshot({type:'jpeg',quality:80,path:`${allFrames}/${id}/${String(frame).padStart(4,'0')}.jpg`});
   if([0,20,40,60,69,72,76,80,84,88,92,98,110,114,130,144,155,170,195,210,239,241,248,260,280,299,...(scenario.selectedFrames||[])].includes(frame))await writeFile(`${output}/${id}/${String(frame).padStart(4,'0')}.jpg`,buffer);
  }
  console.log('Completed',id);
 }
}finally{
 const video=page.video();await context.close();videoPath=video?await video.path():null;await browser.close();await mkdir(output,{recursive:true});await writeFile(output+'/result.json',JSON.stringify({origin,allFrames,videoPath,scope:'Each consecutive 60Hz native physics/render frame is captured from two views. This is a studio physics review, not ordinary gameplay input.',results,errors,warnings},null,2));
}
if(errors.length||warnings.length)process.exitCode=1;
