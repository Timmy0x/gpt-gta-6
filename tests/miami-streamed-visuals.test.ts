import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {MeshBuilder,NullEngine,Scene,UniversalCamera,Vector3,VertexBuffer} from '@babylonjs/core';
import {StreamedMiamiVisuals,MIAMI_VISUAL_ORIGIN,VisualConnectionError,type VisualSnapshot} from '../src/world/miami/visuals/StreamedMiamiVisuals';
import type {VisualFetch} from '../src/world/miami/visuals/ScopedProviderTransport';
// Pinned browser-only URL/queue primitives for the native fixture engine.
globalThis.window ??= {location:{href:'https://fixture.invalid/'},addEventListener(){},removeEventListener(){}} as unknown as Window & typeof globalThis;
globalThis.requestAnimationFrame ??= callback => setTimeout(() => callback(performance.now()),0) as unknown as number;
globalThis.cancelAnimationFrame ??= id => clearTimeout(id);
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const data=JSON.parse(await readFile(new URL('../tools/miami-lh-renderer/fixtures/geographic/expected.json',import.meta.url),'utf8'));
const fixture=data.cases.find((v:{name:string})=>v.name==='nested-z');
const rootJSON=JSON.parse(await readFile(new URL('../tools/miami-lh-renderer/fixtures/geographic/nested-z/tileset.json',import.meta.url),'utf8'));
const externalJSON=JSON.parse(await readFile(new URL('../tools/miami-lh-renderer/fixtures/geographic/nested-z/nested/tileset.json',import.meta.url),'utf8'));
const bytes=await readFile(new URL('../tools/miami-lh-renderer/fixtures/geographic/nested-z/nested/content.glb',import.meta.url));
const endpoint={type:'3DTILES',externalType:'GOOGLE_3D_TILES',options:{url:'https://tile.googleapis.com/v1/3dtiles/root.json?key=fixture-provider-key'},attributions:[{html:'<a href="https://example.com/credit">Synthetic endpoint credit</a>',collapsible:false}]};
const json=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status,headers:{'Content-Type':'application/json'}});
// Independent WGS84/ECEF-to-local oracle; no runtime adapter placement helper.
function local(p:number[]){const lat=MIAMI_VISUAL_ORIGIN.latitudeDegrees*Math.PI/180,lon=MIAMI_VISUAL_ORIGIN.longitudeDegrees*Math.PI/180,a=6378137,b=6356752.314245179,n=a*a/Math.sqrt(a*a*Math.cos(lat)**2+b*b*Math.sin(lat)**2),origin=[n*Math.cos(lat)*Math.cos(lon),n*Math.cos(lat)*Math.sin(lon),b*b/(a*a)*n*Math.sin(lat)],delta=p.map((v,i)=>v-origin[i]);return new Vector3(...[[-Math.sin(lon),Math.cos(lon),0],[Math.cos(lat)*Math.cos(lon),Math.cos(lat)*Math.sin(lon),Math.sin(lat)],[-Math.sin(lat)*Math.cos(lon),-Math.sin(lat)*Math.sin(lon),Math.cos(lat)]].map(axis=>axis.reduce((s,v,i)=>s+v*delta[i],0)) as [number,number,number]);}
interface Request {url:URL;init:RequestInit;}
function response(url:URL){if(url.host==='api.cesium.com')return json(endpoint);if(url.pathname.endsWith('/root.json'))return json(rootJSON);if(url.pathname.endsWith('/nested/tileset.json'))return json(externalJSON);if(url.pathname.endsWith('/content.glb'))return new Response(bytes);throw new Error('Unexpected synthetic request');}
async function harness(route?:(r:Request)=>Promise<Response>|Response){
 const engine=new NullEngine({renderWidth:1280,renderHeight:720,textureSize:512,deterministicLockstep:false,lockstepMaxSteps:4}),scene=new Scene(engine),target=local(fixture.records.find((r:{name:string})=>r.name==='marker-origin').ecefWorld[0]),camera=new UniversalCamera('existing-game-camera',target.add(new Vector3(10,4,12)),scene);camera.setTarget(target);camera.fov=.88;camera.minZ=.12;camera.maxZ=1500;const object=MeshBuilder.CreateBox('existing-game-object',{},scene);
 const requests:Request[]=[],changes:VisualSnapshot[]=[];const fetcher:VisualFetch=async function(this:typeof globalThis,input,init={}){assert.equal(this,globalThis);const request={url:new URL(String(input)),init};requests.push(request);return route?route(request):response(request.url);};
 const visuals=new StreamedMiamiVisuals(scene,{fetch:fetcher,onChange:s=>changes.push(s)});let clock=10000;
 async function pump(predicate:()=>boolean=()=>visuals.snapshot().phase==='visible',steps=250){for(let i=0;i<steps&&!predicate();i++){visuals.update(clock);clock+=17;await tick();}return predicate();}
 return{engine,scene,camera,target,object,visuals,requests,changes,pump,dispose(){visuals.dispose();scene.dispose();engine.dispose();}};
}
const report:Record<string,unknown>={scope:'Existing LH scene/camera, actual pinned renderer and GLB importer; injected fixture-only fetch, no global monkeypatch or provider request.'};
async function save(){if(process.env.MIAMI_VISUAL_EVIDENCE)await writeFile(process.env.MIAMI_VISUAL_EVIDENCE,JSON.stringify(report,null,2)+'\n');}

test('scene-owned ion→Google connection retains the actual game camera, geometry, all credits and fixed origin',async()=>{
 const globalFetch=globalThis.fetch,h=await harness();try{
  await tick();assert.equal(h.requests.length,0);assert.equal(h.visuals.snapshot().phase,'disconnected');h.visuals.connect({provider:'ion',credential:'fixture-user-token',assetId:'123'});assert.equal(await h.pump(),true,JSON.stringify(h.visuals.snapshot()));
  assert.equal(globalThis.fetch,globalFetch);assert.equal(h.scene.activeCamera,h.camera);assert.equal(h.scene.cameras.length,1);assert.equal(h.scene.useRightHandedSystem,false);assert.equal(h.camera.fov,.88);assert.equal(h.camera.maxZ,1500);assert.equal(h.object.isDisposed(),false);assert.equal(h.requests.length,4);
  assert.equal(h.requests[0].url.searchParams.get('access_token'),'fixture-user-token');for(const r of h.requests.slice(1))assert.equal(r.url.searchParams.get('key'),'fixture-provider-key');for(const r of h.requests.slice(2))assert.equal(r.url.searchParams.get('session'),'fixture-session');
  assert.ok(h.requests.every(r=>r.init.credentials==='omit'&&r.init.cache==='no-store'&&r.init.signal));
  let maximum=0,checks=0;for(const record of fixture.records){const mesh=h.scene.getMeshByName(record.name)!;const positions=mesh.getVerticesData(VertexBuffer.PositionKind)!;for(let i=0;i<positions.length;i+=3){const p=Vector3.TransformCoordinates(Vector3.FromArray(positions,i),mesh.computeWorldMatrix(true));maximum=Math.max(maximum,Vector3.Distance(p,local(record.ecefWorld[i/3])));checks++;}}
  assert.ok(maximum<.001);assert.ok(h.visuals.credits().some(c=>c.type==='html'&&c.value===endpoint.attributions[0].html));assert.ok(h.visuals.credits().some(c=>c.value==='Original synthetic fixture credit'));assert.equal(h.visuals.snapshot().requiresGoogleBranding,true);assert.equal(h.visuals.snapshot().collisionReady,false);assert.equal(h.visuals.snapshot().countLimit,960);assert.equal(Object.isFrozen(h.visuals.credits()),true);
  h.visuals.disconnect();assert.deepEqual(h.visuals.credits(),[]);assert.equal(h.visuals.retry(),false);assert.equal(h.scene.meshes.length,1);assert.equal(h.object.isDisposed(),false);assert.equal(h.scene.cameras.length,1);report.existingScene={requests:4,vertices:checks,maximumVertexErrorM:maximum,camerasCreated:0,existingObjectPreserved:true,allCredits:true};await save();
 }finally{h.dispose();}
});

test('moving the existing camera hides and restores visual coverage and credits without reconnecting',async()=>{
 const h=await harness();try{h.visuals.connect({provider:'google',credential:'fixture-direct-key'});assert.equal(await h.pump(),true);const count=h.requests.length;
  h.camera.setTarget(h.camera.position.scale(2).subtract(h.target));assert.equal(await h.pump(()=>h.visuals.snapshot().visibleTiles===0),true);assert.deepEqual(h.visuals.credits(),[]);assert.equal(h.visuals.snapshot().requiresGoogleBranding,false);
  h.camera.setTarget(h.target);assert.equal(await h.pump(),true);assert.equal(h.requests.length,count);assert.equal(h.scene.activeCamera,h.camera);report.camera={sameCamera:true,hideRestore:true,additionalRequests:0};await save();
 }finally{h.dispose();}
});

test('disconnect aborts a pending endpoint and reconnect cannot receive late assets or stale credits',async()=>{
 let release!:(r:Response)=>void;const wait=new Promise<Response>(done=>{release=done;});let endpoints=0;const h=await harness(r=>r.url.host==='api.cesium.com'&&++endpoints===1?wait:response(r.url));try{
  h.visuals.connect({provider:'ion',credential:'fixture-old-token',assetId:'123'});await h.pump(()=>h.requests.length===1);const signal=h.requests[0].init.signal!;h.visuals.disconnect();assert.equal(signal.aborted,true);h.visuals.connect({provider:'google',credential:'fixture-new-token'});assert.equal(await h.pump(),true);release(json({...endpoint,attributions:[{html:'STALE CREDIT'}]}));for(let i=0;i<10;i++)await tick();
  assert.equal(h.visuals.snapshot().provider,'google');assert.ok(!JSON.stringify(h.visuals.credits()).includes('STALE'));assert.equal(h.scene.meshes.filter(m=>m.getTotalVertices()>0&&m!==h.object).length,6);assert.equal(h.requests.filter(r=>r.url.searchParams.get('key')==='fixture-provider-key').length,0);report.reconnect={abortedOldEndpoint:true,staleCredits:false,duplicateMeshes:0};await save();
 }finally{release(json(endpoint));h.dispose();}
});

test('initial401 recovers once while403/503 remain terminal and explicit retry rebuilds a fresh connection',async()=>{
 for(const status of [401,403,503]){let roots=0;const h=await harness(r=>r.url.pathname.endsWith('/root.json')&&++roots===1?json({echo:'fixture-user-secret'},status):response(r.url));try{
  h.visuals.connect({provider:'google',credential:'fixture-user-secret'});
  if(status===401){assert.equal(await h.pump(),true);assert.equal(roots,2);}else{assert.equal(await h.pump(()=>h.visuals.snapshot().phase==='failed'),true);assert.equal(roots,1);assert.equal(h.visuals.snapshot().error?.httpStatus,status);assert.ok(!JSON.stringify(h.visuals.snapshot()).includes('fixture-user-secret'));assert.equal(h.visuals.retry(),true);assert.equal(await h.pump(),true);assert.equal(roots,2);}
 }finally{h.dispose();}}
 report.rootRetry={initial401Attempts:2,initial403Attempts:1,initial503Attempts:1,explicitReconnect:true};await save();
});

test('scene disposal releases owned tiles and callbacks; immutable summaries are sampled rather than emitted every frame',async()=>{
 const h=await harness();try{h.visuals.connect({provider:'google',credential:'fixture-direct-key'});assert.equal(await h.pump(),true);h.visuals.update(100000);const before=h.changes.length;for(let i=0;i<60;i++)h.visuals.update(100001+i);assert.equal(h.changes.length,before);assert.equal(Object.isFrozen(h.visuals.snapshot()),true);assert.equal(Object.isFrozen(h.visuals.snapshot().resources),true);
  h.scene.dispose();assert.equal(h.visuals.snapshot().phase,'disposed');assert.equal(h.visuals.retry(),false);assert.throws(()=>h.visuals.connect({provider:'google',credential:'fixture-token'}),VisualConnectionError);h.visuals.update();assert.equal(h.scene.meshes.length,0);report.lifecycle={sceneDispose:true,unchangedFrameNotifications:0,immutableSnapshots:true};await save();
 }finally{h.dispose();}
});

test('normal ion bearer and version stay on the issued origin; cross-origin content receives no private auth fields',async()=>{
 const external=structuredClone(externalJSON);external.root.content.uri='https://public-fixture.invalid/content.glb?key=fixture-provider-key&session=fixture-session';
 const h=await harness(r=>{
  if(r.url.host==='api.cesium.com')return json({type:'3DTILES',url:'https://asset-fixture.invalid/root.json?v=31',accessToken:'fixture-issued-bearer',attributions:endpoint.attributions});
  if(r.url.pathname.endsWith('/root.json'))return json(rootJSON);if(r.url.pathname.endsWith('/nested/tileset.json'))return json(external);return new Response(bytes);
 });try{h.visuals.connect({provider:'ion',credential:'fixture-user-token',assetId:'123'});assert.equal(await h.pump(),true,JSON.stringify(h.visuals.snapshot()));
  for(const r of h.requests.filter(r=>r.url.host==='asset-fixture.invalid')){assert.equal(new Headers(r.init.headers).get('Authorization'),'Bearer fixture-issued-bearer');assert.equal(r.url.searchParams.get('v'),'31');}
  const foreign=h.requests.find(r=>r.url.host==='public-fixture.invalid')!;assert.ok(foreign);assert.equal(new Headers(foreign.init.headers).has('Authorization'),false);assert.equal(foreign.url.searchParams.has('key'),false);assert.equal(foreign.url.searchParams.has('session'),false);assert.equal(h.visuals.snapshot().requiresGoogleBranding,false);report.originScope={normalIonBearerAndVersion:true,crossOriginAuth:false};await save();
 }finally{h.dispose();}
});

test('persistent401 is bounded and tile parse failures expose no credential-bearing content labels or raw error text',async()=>{
 let roots=0;const denied=await harness(r=>{if(r.url.pathname.endsWith('/root.json')){roots++;return json({},401);}return response(r.url);});try{denied.visuals.connect({provider:'google',credential:'fixture-user-secret'});assert.equal(await denied.pump(()=>denied.visuals.snapshot().phase==='failed'),true);assert.equal(roots,2);}finally{denied.dispose();}
 const messages:unknown[][]=[],original=console.error;console.error=(...args:unknown[])=>messages.push(args);
 const h=await harness(r=>r.url.pathname.endsWith('/content.glb')?new Response(new Uint8Array([1,2,3,4])):response(r.url));try{
  h.visuals.connect({provider:'google',credential:'fixture-user-secret'});assert.equal(await h.pump(()=>h.visuals.snapshot().phase==='failed'),true);assert.equal(h.visuals.snapshot().error?.scope,'tile');assert.equal(h.visuals.snapshot().error?.code,'content');
  const output=JSON.stringify(messages.map(args=>args.map(v=>v instanceof Error?v.message:v)))+JSON.stringify(h.visuals.snapshot());for(const secret of ['fixture-user-secret','fixture-session','tile.googleapis.com'])assert.ok(!output.includes(secret));assert.ok(output.includes('streamed.invalid'));report.safeErrors={persistent401Attempts:2,credentialOrSourceURLInFrameworkErrors:false,fixedContentCode:true};await save();
 }finally{h.dispose();console.error=original;}
});

test('nested Google401 renews with a key-only root, propagates the new session, and bounds persistent failures',async()=>{
 for(const mode of ['recover','persistent401','refresh503'] as const){
  let roots=0,nested=0;const h=await harness(r=>{
   if(r.url.pathname.endsWith('/root.json')){
    roots++;assert.equal(r.url.searchParams.has('session'),false,'Google root renewal must omit the expired session');assert.equal(r.url.searchParams.get('key'),'fixture-direct-key');
    if(roots===2&&mode==='refresh503')return json({},503);
    const body=JSON.parse(JSON.stringify(rootJSON).replaceAll('fixture-session',roots>1?'fixture-new-session':'fixture-session'));return json(body);
   }
   if(r.url.pathname.endsWith('/nested/tileset.json')){
    nested++;if(nested===1||mode==='persistent401')return json({},401);assert.equal(r.url.searchParams.get('session'),'fixture-new-session');return json(externalJSON);
   }
   assert.equal(r.url.searchParams.get('session'),'fixture-new-session');return response(r.url);
  });try{
   h.visuals.connect({provider:'google',credential:'fixture-direct-key'});
   assert.equal(await h.pump(()=>h.visuals.snapshot().phase===(mode==='recover'?'visible':'failed')),true,JSON.stringify(h.visuals.snapshot()));
   assert.equal(roots,2);assert.equal(nested,mode==='refresh503'?1:2);
   if(mode!=='recover')assert.equal(h.visuals.snapshot().error?.httpStatus,mode==='refresh503'?503:401);
   const requests=h.requests.length;for(let i=0;i<20;i++){h.visuals.update(20000+i);await tick();}assert.equal(h.requests.length,requests,'no unbounded refresh after terminal error');
  }finally{h.dispose();}
 }
 report.nestedGoogleRenewal={keyOnlyRoot:true,freshSessionPropagated:true,persistent401NestedAttempts:2,refresh503RootAttempts:2,noAutomaticRetryAfterTerminal:true};await save();
});

test('ion external Google endpoint uses the pinned presence contract instead of a guessed externalType enum',async()=>{
 for(const externalType of ['3DTILES','GOOGLE_3D_TILES','OTHER_ENDPOINT_LABEL',null]){
  const h=await harness(r=>r.url.host==='api.cesium.com'?json({...endpoint,externalType}):response(r.url));
  try{h.visuals.connect({provider:'ion',credential:'fixture-user-token',assetId:'123'});assert.equal(await h.pump(),true,JSON.stringify(h.visuals.snapshot()));assert.equal(h.visuals.snapshot().requiresGoogleBranding,true);assert.ok(h.visuals.credits().some(c=>c.value===endpoint.attributions[0].html));}
  finally{h.dispose();}
 }
 for(const url of ['https://unrelated.invalid/root.json?key=fixture-provider-key','https://tile.googleapis.com/v1/createSession?key=fixture-provider-key','https://tile.googleapis.com/v1/3dtiles/root.json']){
  const h=await harness(r=>r.url.host==='api.cesium.com'?json({...endpoint,options:{url}}):response(r.url));
  try{h.visuals.connect({provider:'ion',credential:'fixture-user-token',assetId:'123'});assert.equal(await h.pump(()=>h.visuals.snapshot().phase==='failed'),true);assert.equal(h.visuals.snapshot().error?.code,'content');assert.equal(h.requests.length,1);}
  finally{h.dispose();}
 }
 report.externalEndpoint={enumAgnosticAsPinned:true,validatedGoogleURLAndKey:true,unsupportedEndpointsRejectedBeforeRequest:true};await save();
});
