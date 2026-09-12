import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {CesiumIonAuthPlugin} from '3d-tiles-renderer/core/plugins';
import {geoHarness,fixtureResponse} from './geographic-harness';
import {tick} from './renderer-harness';
const endpoint={type:'3DTILES',externalType:'GOOGLE_3D_TILES',options:{url:'https://fixture.invalid/geographic/nested-z/tileset.json?key=fixture-key'},attributions:[{html:'Synthetic endpoint credit',collapsible:false}]};
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
const report:Record<string,unknown>={scope:'Official pinned CesiumIonAuthPlugin and GoogleCloudAuthPlugin. Every global fetch is mocked with original synthetic bytes and dummy credentials; no provider requests.'};
async function save(){await mkdir(new URL('../evidence/',import.meta.url),{recursive:true});await writeFile(new URL('../evidence/auth-result.json',import.meta.url),JSON.stringify(report,null,2)+'\n');}
function auth(autoRefreshToken=true){return new CesiumIonAuthPlugin({apiToken:'fixture-ion-token',assetId:'123',autoRefreshToken,useRecommendedSettings:false});}

test('official ion endpoint -> Google root -> external JSON -> GLB carries session and preserves endpoint credits only while visible',async()=>{
 const original=globalThis.fetch,requests:Array<{url:URL;options:RequestInit}>=[];
 globalThis.fetch=async(input,init={})=>{const url=new URL(String(input));requests.push({url,options:init});if(url.host==='api.cesium.com')return json(endpoint);if(url.host==='unrelated.invalid')return new Response('ok');return fixtureResponse(url.href);};
 const h=await geoHarness('nested-z',{setup:r=>r.registerPlugin(auth())});try{
  assert.equal(h.renderer.getAttributions().length,0);assert.equal(await h.pump(),true,h.errors.map(e=>e.message).join('\n'));assert.equal(h.errors.length,0);assert.equal(requests.length,4);
  assert.equal(requests[0].url.searchParams.get('access_token'),'fixture-ion-token');
  for(const request of requests.slice(1)){assert.equal(request.url.searchParams.get('key'),'fixture-key');assert.equal(new Headers(request.options.headers).has('Authorization'),false);assert.ok(request.options.signal instanceof AbortSignal);}
  for(const request of requests.slice(2))assert.equal(request.url.searchParams.get('session'),'fixture-session');
  assert.ok(h.renderer.getAttributions().some(a=>a.type==='html'&&a.value==='Synthetic endpoint credit'));
  const google=h.renderer.getPluginByName('GOOGLE_CLOUD_AUTH_PLUGIN') as unknown as {fetchData:(url:string,init:RequestInit)=>Promise<unknown>};await google.fetchData('https://unrelated.invalid/file.glb',{});assert.equal(requests.at(-1)!.url.searchParams.has('key'),false);assert.equal(requests.at(-1)!.url.searchParams.has('session'),false);
  h.camera.setTarget(h.camera.position.scale(2).subtract(h.origin));h.renderer.update();await tick();assert.equal(h.renderer.visibleTiles.size,0);assert.deepEqual(h.renderer.getAttributions(),[]);
  report.flow={requests:4,officialPlugins:true,sameHostCredentials:true,nestedSession:true,crossHostCredentials:false,endpointCreditsVisibleOnly:true};await save();
 }finally{h.dispose();globalThis.fetch=original;}
});

test('failed official ion endpoint refresh is released and retries without duplicate terminal errors',async()=>{
 const original=globalThis.fetch;let attempts=0;globalThis.fetch=async(input)=>new URL(String(input)).host==='api.cesium.com'?(++attempts===1?json({error:'synthetic'},503):json(endpoint)):fixtureResponse(String(input));
 const h=await geoHarness('nested-z',{setup:r=>r.registerPlugin(auth())});try{
  await h.pump(()=>h.errors.length>0);for(let i=0;i<4;i++)await tick();assert.equal(h.errors.length,1);assert.match(h.errors[0].message,/503/);h.errors.length=0;h.renderer.resetFailedTiles();assert.equal(await h.pump(),true,h.errors.map(e=>e.message).join('\n'));assert.equal(attempts,2);report.endpointRetry={attempts,terminalErrors:1,loaded:true};await save();
 }finally{h.dispose();globalThis.fetch=original;}
});

test('failed initial Google root retains its HTTP status and can retry with the official session parser',async()=>{
 const original=globalThis.fetch;let roots=0;globalThis.fetch=async(input)=>{const url=new URL(String(input));if(url.host==='api.cesium.com')return json(endpoint);if(url.pathname.endsWith('nested-z/tileset.json')&&++roots===1)return json({error:'synthetic root failure'},503);return fixtureResponse(url.href);};
 const h=await geoHarness('nested-z',{setup:r=>r.registerPlugin(auth())});try{
  await h.pump(()=>h.errors.length>0);for(let i=0;i<4;i++)await tick();assert.equal(h.errors.length,1);assert.match(h.errors[0].message,/503/);h.errors.length=0;h.renderer.resetFailedTiles();assert.equal(await h.pump(),true,h.errors.map(e=>e.message).join('\n'));assert.equal(roots,2);assert.equal((h.renderer as unknown as {plugins:Array<{name:string}>}).plugins.filter(p=>p.name==='GOOGLE_CLOUD_AUTH_PLUGIN').length,1);report.googleRootRetry={attempts:roots,terminalErrors:1,loaded:true};await save();
 }finally{h.dispose();globalThis.fetch=original;}
});

test('dispose while official ion endpoint is pending aborts the request and suppresses late plugin registration and events',async()=>{
 const original=globalThis.fetch;let resolve!:(r:Response)=>void,signal:AbortSignal|undefined,requests=0;const barrier=new Promise<Response>(done=>{resolve=done;});globalThis.fetch=async(_input,init)=>{requests++;signal=init?.signal??undefined;return barrier;};
 const h=await geoHarness('nested-z',{setup:r=>r.registerPlugin(auth())});try{
  assert.equal(await h.pump(()=>Boolean(signal)),true);h.renderer.dispose();assert.equal(signal!.aborted,true);const before=h.events.length;resolve(json(endpoint));for(let i=0;i<8;i++)await tick();assert.equal(requests,1);assert.equal(h.events.length,before);assert.equal(h.errors.length,0);assert.equal(h.renderer.root,null);assert.equal(h.renderer.getPluginByName('GOOGLE_CLOUD_AUTH_PLUGIN'),null);assert.equal(h.scene.meshes.length,0);report.endpointCancellation={requestAborted:true,requests:1,lateEvents:0,lateMeshes:0};await save();
 }finally{resolve(json(endpoint));h.dispose();globalThis.fetch=original;}
});

test('a transient authenticated nested JSON failure refreshes the official Google session and succeeds without a terminal load error',async()=>{
 const original=globalThis.fetch;let failures=0,roots=0;globalThis.fetch=async(input)=>{const url=new URL(String(input));if(url.host==='api.cesium.com')return json(endpoint);if(url.pathname.endsWith('nested-z/tileset.json'))roots++;if(url.pathname.endsWith('/nested/tileset.json')&&failures++===0)return json({error:'expired synthetic session'},401);return fixtureResponse(url.href);};
 const h=await geoHarness('nested-z',{setup:r=>r.registerPlugin(auth())});try{assert.equal(await h.pump(),true,h.errors.map(e=>e.message).join('\n'));assert.equal(h.errors.length,0);assert.equal(roots,2);assert.equal(failures,2);report.sessionRefresh={rootRequests:roots,nestedAttempts:failures,terminalErrors:0};await save();}finally{h.dispose();globalThis.fetch=original;}
});

test('initial Google root 401 refreshes once and loads through the official parser',async()=>{
 const original=globalThis.fetch;let roots=0,endpoints=0;globalThis.fetch=async(input)=>{const url=new URL(String(input));if(url.host==='api.cesium.com'){endpoints++;return json(endpoint);}if(url.pathname.endsWith('nested-z/tileset.json')&&++roots===1)return json({error:'initial synthetic session expired'},401);return fixtureResponse(url.href);};
 const h=await geoHarness('nested-z',{setup:r=>r.registerPlugin(auth())});try{
  assert.equal(await h.pump(),true,h.errors.map(e=>e.message).join('\n'));assert.equal(h.errors.length,0);assert.equal(roots,2);assert.equal(endpoints,1);assert.equal(h.events.filter(e=>e==='load-root-tileset').length,1);report.initial401Refresh={rootAttempts:roots,endpointAttempts:endpoints,terminalErrors:0,loaded:true};await save();
 }finally{h.dispose();globalThis.fetch=original;}
});

test('persistent initial Google root 401 makes exactly two attempts and one terminal error',async()=>{
 const original=globalThis.fetch;let roots=0;globalThis.fetch=async(input)=>{const url=new URL(String(input));if(url.host==='api.cesium.com')return json(endpoint);if(url.pathname.endsWith('nested-z/tileset.json')){roots++;return json({error:'persistent synthetic authorization failure'},401);}throw new Error('No child request is permitted before the root succeeds.');};
 const h=await geoHarness('nested-z',{setup:r=>r.registerPlugin(auth())});try{
  await h.pump(()=>h.errors.length>0);for(let i=0;i<8;i++){h.renderer.update();await tick();}assert.equal(h.errors.length,1);assert.match(h.errors[0].message,/401/);assert.equal(roots,2);assert.equal(h.renderer.root,null);assert.equal(h.scene.meshes.length,0);report.persistentInitial401={rootAttempts:roots,terminalErrors:1,childRequests:0};await save();
 }finally{h.dispose();globalThis.fetch=original;}
});

test('initial Google root 403 is terminal without an automatic retry',async()=>{
 const original=globalThis.fetch;let roots=0;globalThis.fetch=async(input)=>{const url=new URL(String(input));if(url.host==='api.cesium.com')return json(endpoint);roots++;return json({error:'synthetic forbidden'},403);};
 const h=await geoHarness('nested-z',{setup:r=>r.registerPlugin(auth())});try{
  await h.pump(()=>h.errors.length>0);for(let i=0;i<4;i++)await tick();assert.equal(roots,1);assert.equal(h.errors.length,1);assert.match(h.errors[0].message,/403/);report.initial403={rootAttempts:roots,terminalErrors:1};await save();
 }finally{h.dispose();globalThis.fetch=original;}
});

test('autoRefreshToken false keeps an initial Google root 401 terminal after one attempt',async()=>{
 const original=globalThis.fetch;let roots=0;globalThis.fetch=async(input)=>{const url=new URL(String(input));if(url.host==='api.cesium.com')return json(endpoint);roots++;return json({error:'synthetic unauthorized'},401);};
 const h=await geoHarness('nested-z',{setup:r=>r.registerPlugin(auth(false))});try{
  await h.pump(()=>h.errors.length>0);for(let i=0;i<4;i++)await tick();assert.equal(roots,1);assert.equal(h.errors.length,1);assert.match(h.errors[0].message,/401/);report.disabledInitial401={rootAttempts:roots,terminalErrors:1};await save();
 }finally{h.dispose();globalThis.fetch=original;}
});

test('disposal before an initial Google 401 settles prevents the refresh request and late errors',async()=>{
 const original=globalThis.fetch;let roots=0,resolve!:(response:Response)=>void,signal:AbortSignal|undefined;const barrier=new Promise<Response>(done=>{resolve=done;});globalThis.fetch=async(input,init)=>{const url=new URL(String(input));if(url.host==='api.cesium.com')return json(endpoint);roots++;signal=init?.signal??undefined;return barrier;};
 const h=await geoHarness('nested-z',{setup:r=>r.registerPlugin(auth())});try{
  assert.equal(await h.pump(()=>Boolean(signal)),true);h.renderer.dispose();assert.equal(signal!.aborted,true);resolve(json({error:'synthetic stale initial response'},401));for(let i=0;i<8;i++)await tick();assert.equal(roots,1);assert.equal(h.errors.length,0);assert.equal(h.renderer.root,null);assert.equal(h.scene.meshes.length,0);report.initial401Cancellation={rootAttempts:roots,signalAborted:true,lateErrors:0};await save();
 }finally{resolve(json({},401));h.dispose();globalThis.fetch=original;}
});
