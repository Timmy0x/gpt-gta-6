import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const origin=process.env.AUDIT_URL||'http://127.0.0.1:4293';
const output=process.env.AUDIT_OUTPUT||'docs/evidence/miami-streamed-preview-r1';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--disable-background-timer-throttling','--disable-renderer-backgrounding']});
const page=await browser.newPage({viewport:{width:1600,height:900}}),checks=[],errors=[],requests=[],logs=[];
let phase='startup';
const cleanUrl=value=>{const u=new URL(value);return u.origin+u.pathname;};
page.on('request',r=>requests.push({phase,url:cleanUrl(r.url())}));
page.on('pageerror',e=>errors.push({phase,error:e.message}));
page.on('console',m=>{if(['error','warning'].includes(m.type()))logs.push({phase,type:m.type(),text:m.text()});});
const check=async(label)=>{checks.push({label,state:await page.locator('#state').innerText(),metrics:await page.locator('#metrics').innerText(),credits:await page.locator('#credits').innerText()});console.log(JSON.stringify(checks.at(-1)));};
const connect=()=>page.getByRole('button',{name:'Connect',exact:true}).click();
const rendered=()=>page.waitForFunction(()=>Number(document.querySelector('#metrics').dataset.visible)>=2,null,{timeout:20000});
let fingerprint;
try{
 const html=await(await fetch(origin)).text(),entry=html.match(/<script[^>]*src="([^"]+)"/)[1];fingerprint={entry,sha256:createHash('sha256').update(Buffer.from(await(await fetch(new URL(entry,origin))).arrayBuffer())).digest('hex')};
 await page.goto(origin,{waitUntil:'networkidle'});
 assert.equal(await page.locator('#source').inputValue(),'ion');
 assert.equal(requests.filter(r=>!r.url.startsWith(origin)).length,0);
 assert.equal(await page.locator('#state').innerText(),'Waiting for access token');
 await page.screenshot({path:`${output}/waiting-for-token.png`});await check('unconnected-default');
 await connect();await page.locator('#error').waitFor({state:'visible'});assert.match(await page.locator('#error').innerText(),/own valid/);assert.equal(requests.filter(r=>!r.url.startsWith(origin)).length,0);await check('empty-token-rejected-locally');
 phase='fixture';await page.locator('#source').selectOption('fixture');await connect();await rendered();await page.waitForTimeout(2500);
 assert.match(await page.locator('#credits').innerText(),/Synthetic fixture A/);assert.match(await page.locator('#credits').innerText(),/Synthetic fixture B/);assert.equal(await page.locator('#provider-credit').isVisible(),false);assert.equal(await page.locator('#fixture-badge').isVisible(),true);
 await page.screenshot({path:`${output}/synthetic-fixture.png`});await check('both-tiles-and-credits-visible');
 const canvas=page.locator('canvas'),before=createHash('sha256').update(await canvas.screenshot()).digest('hex');await page.getByRole('button',{name:'Overview',exact:true}).click();await page.waitForTimeout(700);await rendered();const after=createHash('sha256').update(await canvas.screenshot()).digest('hex');assert.notEqual(before,after);await page.screenshot({path:`${output}/synthetic-overview.png`});await check('overview-changes-camera');
 await page.getByRole('button',{name:'Brickell',exact:true}).click();await rendered();await page.mouse.move(1050,450);await page.mouse.down({button:'right'});await page.mouse.move(1150,500,{steps:12});await page.mouse.up({button:'right'});await page.waitForTimeout(250);assert.notEqual(createHash('sha256').update(await canvas.screenshot()).digest('hex'),before);await check('mouse-orbit-changes-view');
 await page.getByRole('button',{name:'Disconnect',exact:true}).click();assert.equal(await page.locator('#credits').innerText(),'');assert.equal(await page.locator('#metrics').getAttribute('data-visible'),'0');await check('disconnect-clears-tiles-and-credits');
 await page.locator('summary').click();
 for(const failure of ['root-error','node-error']){phase=failure;await page.locator('#fixture-case').selectOption(failure);await connect();await page.locator('#error').waitFor({state:'visible',timeout:15000});assert.equal(await page.locator('#state').innerText(),'Connection incomplete');await check(failure);await page.getByRole('button',{name:'Retry connection'}).click();await page.locator('#error').waitFor({state:'visible'});await check(`${failure}-retry`);}
 phase='recover';await page.locator('#fixture-case').selectOption('normal');await connect();await rendered();assert.equal(await page.locator('#error').isVisible(),false);await check('reconnect-after-missing-tiles');
 for(const provider of ['google','ion']){phase=`${provider}-mocked-403`;let intercepted=0;await page.route(provider==='google'?'https://tile.googleapis.com/**':'https://api.cesium.com/**',async route=>{intercepted++;await route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({error:{code:403,message:'Synthetic denied response'}})});});await page.locator('#source').selectOption(provider);await page.locator('#credential').fill(`synthetic-${provider}-not-a-valid-token`);await connect();await page.locator('#error').waitFor({state:'visible',timeout:15000});assert.match(await page.locator('#error').innerText(),/HTTP 403/);assert.equal(await page.locator('#credential').inputValue(),'');assert.ok(intercepted>=1);assert.ok(!(await page.locator('body').innerText()).includes(`synthetic-${provider}-not-a-valid-token`));await check(`${provider}-denied-feedback`);await page.getByRole('button',{name:'Disconnect',exact:true}).click();await page.unrouteAll({behavior:'wait'});}
 phase='ion-google-recovered-401';let googleRoots=0;
 const fixture=await(await fetch(`${origin}/fixture/tileset.json`)).json();
 fixture.root.children.forEach((tile,index)=>tile.content.uri=`https://tile.googleapis.com/v1/3dtiles/${index?'b':'a'}.glb?session=synthetic-session`);
 await page.route('https://api.cesium.com/**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({externalType:'GOOGLE_3D_TILES',options:{url:'https://tile.googleapis.com/v1/3dtiles/root.json?key=synthetic-external-key'},attributions:[{html:'<a href="https://example.com/provider">Synthetic endpoint credit</a>',collapsible:false}]})}));
 await page.route('https://tile.googleapis.com/**',async route=>{const pathname=new URL(route.request().url()).pathname;if(pathname.endsWith('root.json')){googleRoots++;await route.fulfill(googleRoots===1?{status:401,body:'Synthetic expired session'}:{status:200,contentType:'application/json',body:JSON.stringify(fixture)});}else{const name=pathname.endsWith('b.glb')?'b':'a';await route.fulfill({status:200,contentType:'model/gltf-binary',body:Buffer.from(await(await fetch(`${origin}/fixture/${name}.glb`)).arrayBuffer())});}});
 await page.locator('#source').selectOption('ion');await page.locator('#credential').fill('synthetic-ion-recovery-token');await connect();await rendered();
 assert.ok(googleRoots>=3,'expired session is refreshed before retry');assert.equal(await page.locator('#error').isVisible(),false);assert.equal(await page.locator('#provider-credit').isVisible(),true);assert.match(await page.locator('#credits').innerText(),/Synthetic endpoint credit/);assert.match(await page.locator('#credits').innerText(),/Synthetic fixture A/);assert.match(await page.locator('#credits').innerText(),/Synthetic fixture B/);await check('auth-refresh-recovers-and-all-endpoint-tile-credits-display');
 await page.getByRole('button',{name:'Disconnect',exact:true}).click();await page.unrouteAll({behavior:'wait'});
 assert.equal(await page.evaluate(()=>localStorage.length+sessionStorage.length),0);
 assert.ok(!JSON.stringify(logs).includes('not-a-valid-token'),'application diagnostics do not expose synthetic tokens');
 assert.deepEqual(errors,[]);assert.deepEqual(logs.filter(l=>['startup','fixture','recover'].includes(l.phase)&&!(l.type==='warning'&&l.text==='TilesRenderer: tiles versions at 1.1 or higher have limited support. Some new extensions and features may not be supported.')),[]);await check('no-storage-or-success-path-errors');
}catch(error){errors.push({phase,error:error.stack||String(error)});await page.screenshot({path:`${output}/failure.png`}).catch(()=>{});}
finally{await writeFile(`${output}/result.json`,JSON.stringify({origin,fingerprint,browser:browser.version(),method:'Normal source form, camera buttons, mouse orbit, disconnect, missing fixture root/child and retry; synthetic provider403 fulfilled locally by Playwright, no actual API credentials or Miami tile requests.',checks,requests,logs,errors},null,2));await browser.close();console.log(JSON.stringify({checks:checks.length,errors,logs}));if(errors.length)process.exitCode=1;}
