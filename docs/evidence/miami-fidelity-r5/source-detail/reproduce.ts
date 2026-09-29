import assert from 'node:assert/strict';
import { Logger } from '@babylonjs/core';
import { detailFixture } from '../../../../tests/fixtures/miami-detail-profile';
Logger.LogLevels=Logger.NoneLogLevel;
const report:Record<string,unknown>={scope:'Actual pinned native traversal/importer/scoped transport using original synthetic fixture-only responses. No real provider requests/content/tokens, browser rendering or FPS acceptance.',dependencies:{babylon:'9.25.0',tilesRenderer:'0.5.2'}};
for(const ion of [false,true]){
 const f=detailFixture({ion}),frontiers:unknown[]=[];
 try{
  f.connect();
  for(const [profile,label] of [['balanced','level-0'],['high','level-1'],['ultra','level-2']] as const){
   f.visuals.setDetailProfile(profile);assert.equal(await f.pump(()=>f.visible().includes(label)),true);await f.step(65);
   const state=f.visuals.snapshot();frontiers.push({profile,errorTargetPixels:state.errorTargetPixels,visibleOriginalFixtureMeshes:f.visible(),rootRequests:f.requests.filter(r=>r.url.pathname.endsWith('/root.json')).length,contentRequests:f.requests.filter(r=>r.url.pathname.endsWith('.glb')).length,countLimit:state.countLimit,residentTiles:state.resources?.residentTiles,collisionReady:state.collisionReady,googleBranding:state.requiresGoogleBranding});
  }
  report[ion?'ionToGoogleFrontiers':'directGoogleFrontiers']=frontiers;
 }finally{f.dispose();}
}
const failed=detailFixture({route(request,ordinary){return request.url.pathname.endsWith('/level-1.glb')?new Response('{}',{status:503}):ordinary();}});
const errors:unknown[][]=[],previous=console.error;console.error=(...args)=>errors.push(args);
try{
 failed.connect();assert.equal(await failed.pump(()=>failed.visible().includes('level-0')),true);failed.visuals.setDetailProfile('high');assert.equal(await failed.pump(()=>failed.visuals.snapshot().error!==null),true);await failed.step(40);
 const state=failed.visuals.snapshot();assert.deepEqual(failed.visible(),['level-0']);
 report.failedChild={profile:state.detailProfile,errorTargetPixels:state.errorTargetPixels,phase:state.phase,error:state.error,visibleOriginalFixtureMeshes:failed.visible(),failedChildRequests:failed.requests.filter(r=>r.url.pathname.endsWith('/level-1.glb')).length,rootRequests:failed.requests.filter(r=>r.url.pathname.endsWith('/root.json')).length,collisionReady:state.collisionReady};
}finally{failed.dispose();console.error=previous;}
const capped=detailFixture({fanout:1000});
try{
 capped.connect();assert.equal(await capped.pump(()=>capped.visible().includes('level-0')),true);capped.visuals.setDetailProfile('high');assert.equal(await capped.pump(()=>capped.visuals.snapshot().stream?.cache.countLimitReached===1,2500),true);
 assert.equal(await capped.pump(()=>capped.visuals.snapshot().stream?.renderer.queuedDownloads===0&&capped.visuals.snapshot().stream?.renderer.pendingOrParsing===0&&capped.visuals.snapshot().stream?.renderer.downloading===0,2500),true);await capped.step(65);
 const state=capped.visuals.snapshot();assert.equal(state.stream?.cache.admitted,960);assert.deepEqual(capped.visible(),['level-0']);
 report.productionCap={requestedSyntheticChildren:1000,profile:state.detailProfile,errorTargetPixels:state.errorTargetPixels,cache:state.stream?.cache,queues:state.stream?.queues,renderer:state.stream?.renderer,residentSyntheticModels:state.resources?.residentTiles,visibleOriginalFixtureMeshes:capped.visible(),error:state.error,collisionReady:state.collisionReady,memoryScope:'Count cap only; synthetic fixture resources do not estimate real provider RAM/VRAM.'};
}finally{capped.dispose();}
console.log(JSON.stringify(report,null,2));
