import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
const origin=process.env.INJURY_URL||'http://127.0.0.1:4212',output=process.env.INJURY_OUTPUT||'docs/evidence/body-injury-poses-r1';
const crawlFrames=process.env.INJURY_CRAWL_FRAMES;
const browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[],warnings=[],results=[];
page.on('pageerror',e=>errors.push(e.stack));page.on('console',m=>{if(['error','warning'].includes(m.type()))warnings.push(m.text());});
try{await page.goto(origin+'/scripts/characters/injuries/preview.html');await page.waitForFunction(()=>window.injuryReview?.ready,null,{timeout:120000});
 for(const variant of ['Jason','Lucia','male-adult-03','female-adult-06']){await page.evaluate(v=>window.injuryReview.setup(v),variant);await mkdir(output+'/'+variant,{recursive:true});
  for(let frame=0;frame<180;frame++){const result=await page.evaluate(f=>window.injuryReview.step(f),frame);if([0,20,40,60,90,130,179].includes(frame)){await page.screenshot({path:`${output}/${variant}/${String(frame).padStart(4,'0')}.png`});results.push({variant,...result});}}
  for(const [index,label,view] of [[3,'crawl-close','front'],[3,'crawl-side','side'],[0,'left-limp-close','front']]){await page.evaluate(({index,view})=>window.injuryReview.focus(index,view),{index,view});await page.screenshot({path:`${output}/${variant}/${label}.png`});}
  if(crawlFrames){await page.evaluate(v=>window.injuryReview.setup(v),variant);await mkdir(`${crawlFrames}/${variant}`,{recursive:true});for(let frame=0;frame<180;frame++){await page.evaluate(f=>{window.injuryReview.step(f);window.injuryReview.focus(3,'side');},frame);await page.screenshot({path:`${crawlFrames}/${variant}/${String(frame).padStart(4,'0')}.png`});}}
 }
}finally{await browser.close();await mkdir(output,{recursive:true});await writeFile(output+'/result.json',JSON.stringify({origin,scope:'Selected visual frames after every consecutive 60Hz pose step. This studio does not test actual physical falls or ordinary input.',results,errors,warnings},null,2));}if(errors.length||warnings.length)process.exitCode=1;
