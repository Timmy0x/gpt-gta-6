import test from 'node:test';
import assert from 'node:assert/strict';
import { Camera, Matrix, Vector3 } from '@babylonjs/core';
import { LHTilesRenderer, type LHTile } from '../src/world/miami/visuals/LHTilesRenderer';
import { StreamedMiamiVisuals, VISUAL_DETAIL_PROFILES, type VisualDetailProfile } from '../src/world/miami/visuals/StreamedMiamiVisuals';
import { originalTileView } from './fixtures/miami-tile-view';
import { detailFixture, detailGlb } from './fixtures/miami-detail-profile';

const roots = (f: ReturnType<typeof detailFixture>) => f.requests.filter(r => r.url.pathname.endsWith('/root.json'));
const content = (f: ReturnType<typeof detailFixture>, label: string) => f.requests.filter(r => r.url.pathname.endsWith('/' + label + '.glb'));

test('scene-owned detail profiles select actual native loaded frontiers in place and retain all source safeguards', async () => {
  for (const ion of [false, true]) {
    const f = detailFixture({ ion });
    try {
      assert.equal(Object.isFrozen(VISUAL_DETAIL_PROFILES), true);
      assert.equal(f.visuals.snapshot().detailProfile, 'balanced'); assert.equal(f.visuals.snapshot().errorTargetPixels, 20);
      f.connect(); assert.equal(await f.pump(() => f.visible().includes('level-0')), true);
      assert.deepEqual(f.visible(), ['level-0']); assert.equal(content(f, 'level-1').length, 0);
      const root = roots(f)[0], signal = root.init.signal!, group = f.scene.getTransformNodeByName('tiles-root');
      const retainedIds = f.visuals.snapshot().resources?.residentTileIds ?? [];
      assert.equal(f.visuals.setDetailProfile('high'), true);
      assert.equal(f.visuals.snapshot().errorTargetPixels, 12); assert.equal(f.visuals.snapshot().detailProfile, 'high');
      assert.equal(await f.pump(() => f.visible().includes('level-1')), true);
      assert.deepEqual(f.visible(), ['level-1']); assert.equal(content(f, 'level-2').length, 0);
      assert.equal(f.visuals.setDetailProfile('ultra'), true);
      assert.equal(await f.pump(() => f.visible().includes('level-2')), true);
      assert.deepEqual(f.visible(), ['level-2']); assert.equal(f.visuals.snapshot().errorTargetPixels, 8);
      assert.equal(roots(f).length, 1); assert.equal(signal.aborted, false); assert.equal(f.scene.getTransformNodeByName('tiles-root'), group);
      assert.equal(f.scene.activeCamera, f.camera); assert.equal(f.scene.cameras.length, 1); assert.equal(f.existingObject.isDisposed(), false);
      assert.equal(f.visuals.snapshot().collisionReady, false); assert.equal(f.visuals.snapshot().requiresGoogleBranding, true);
      assert.ok(f.visuals.credits().some(c => c.value === 'Original synthetic level-2 credit'));
      await f.step(65);
      const snapshot = f.visuals.snapshot();
      assert.equal(snapshot.countLimit, 960); assert.equal(snapshot.stream?.cache.countLimit, 960);
      assert.equal(snapshot.stream?.queues.downloadLimitPerOrigin, 4); assert.equal(snapshot.stream?.queues.parseLimit, 2);
      for (const id of retainedIds) assert.ok(snapshot.resources?.residentTileIds.includes(id));
      assert.equal(Object.isFrozen(snapshot), true);
      const total = f.requests.length, notifications = f.changes.length;
      assert.equal(f.visuals.setDetailProfile('ultra'), false); assert.equal(f.changes.length, notifications);
      f.visuals.setDetailProfile('balanced'); assert.equal(await f.pump(() => f.visible().includes('level-0')), true);
      f.visuals.setDetailProfile('high'); assert.equal(await f.pump(() => f.visible().includes('level-1')), true);
      assert.equal(f.requests.length, total, 'cached details and retained parent are reused');
      assert.ok(!JSON.stringify([f.visuals.snapshot(), f.visuals.credits()]).includes('fixture-detail-private'));
    } finally { f.dispose(); }
  }
});

test('all scene-owned thresholds preserve exact framebuffer SSE across native camera/projection/viewport changes', async () => {
  const f = detailFixture(), original = LHTilesRenderer.prototype.calculateTileViewError;
  let compared = 0, rootError = 0;
  LHTilesRenderer.prototype.calculateTileViewError = function(tile, target) {
    original.call(this, tile, target);
    if (this.group.getScene() !== f.scene) return;
    assert.deepEqual(target, originalTileView(this, f.scene, tile as LHTile)); compared++;
    if (!tile.parent) rootError = target.error;
  };
  try {
    f.connect(); assert.equal(await f.pump(() => f.visible().includes('level-0')), true);
    assert.ok(rootError > 12 && rootError < 20, 'original root SSE lies between balanced and high thresholds');
    f.visuals.setDetailProfile('ultra'); assert.equal(await f.pump(() => f.visible().includes('level-2')), true);
    for (let state = 0; state < 8; state++) for (const profile of Object.keys(VISUAL_DETAIL_PROFILES) as VisualDetailProfile[]) {
      f.camera.unfreezeProjectionMatrix(); f.camera.mode = state % 2 ? Camera.ORTHOGRAPHIC_CAMERA : Camera.PERSPECTIVE_CAMERA;
      f.camera.orthoLeft = -60; f.camera.orthoRight = 60; f.camera.orthoTop = 40; f.camera.orthoBottom = -40;
      f.camera.fov = .73 + state * .025; f.camera.position.copyFrom(f.center.add(new Vector3(2 * state, 4, -120 - state)));
      f.camera.setTarget(f.center); f.camera.viewport.width = state % 3 ? 1 : .6; f.camera.viewport.height = state % 4 ? 1 : .5;
      f.engine.framebufferWidth = state % 3 ? 1280 : 990; f.engine.framebufferHeight = state % 3 ? 720 : 610;
      f.engine.setHardwareScalingLevel(1 + state % 3);
      if (state === 6) f.camera.freezeProjectionMatrix(Matrix.PerspectiveFovLH(.73, 1.78, .17, 2300));
      if (state === 7) f.camera.freezeProjectionMatrix(Matrix.OrthoOffCenterLH(-23, 77, -33, 19, .4, 1777));
      f.visuals.setDetailProfile(profile); await f.step(2);
      assert.equal(f.visuals.snapshot().errorTargetPixels, VISUAL_DETAIL_PROFILES[profile]);
    }
    assert.ok(compared > 80); assert.equal(roots(f).length, 1);
  } finally { LHTilesRenderer.prototype.calculateTileViewError = original; f.dispose(); }
});

test('delayed fine children retain visible ancestor and a late inflight child cannot replace a newly selected coarse frontier', async () => {
  let release!: (response: Response) => void;
  const delayed = new Promise<Response>(resolve => { release = resolve; });
  let pendingResponse!: () => Response;
  const f = detailFixture({ route(request, ordinary) {
    if (request.url.pathname.endsWith('/level-1.glb')) { pendingResponse = ordinary; return delayed; }
    return ordinary();
  } });
  try {
    f.connect(); assert.equal(await f.pump(() => f.visible().includes('level-0')), true);
    f.visuals.setDetailProfile('high'); assert.equal(await f.pump(() => content(f, 'level-1').length === 1), true);
    await f.step(25); assert.deepEqual(f.visible(), ['level-0']); assert.equal(f.visuals.snapshot().error, null);
    const rootSignal = roots(f)[0].init.signal!, childSignal = content(f, 'level-1')[0].init.signal!;
    f.visuals.setDetailProfile('balanced'); await f.step(8);
    // Pinned core preserves already-started downloads, while only unused QUEUED work is canceled.
    assert.equal(rootSignal.aborted, false); assert.equal(childSignal.aborted, false);
    release(pendingResponse()); await f.step(30);
    assert.deepEqual(f.visible(), ['level-0']); assert.equal(f.scene.getMeshByName('level-1')?.isEnabled(), false);
    assert.equal(f.visuals.snapshot().error, null); assert.equal(roots(f).length, 1);
  } finally { release?.(new Response(new Uint8Array())); f.dispose(); }
});

test('failed HTTP/network/unsupported fine children keep coarse coverage, truthful callback states and fixed errors without retries', async () => {
 for(const mode of ['http','network','unsupported'] as const){
  const f = detailFixture({ route(request, ordinary) {
    if(!request.url.pathname.endsWith('/level-1.glb'))return ordinary();
    if(mode==='network')throw new Error('fixture-detail-private-key');
    if(mode==='unsupported')return new Response(detailGlb('level-1',true));
    return new Response(JSON.stringify({ secret: 'fixture-detail-private-key' }), { status: 503 });
  } });
  const original = LHTilesRenderer.prototype.calculateTileViewError;
  let actualRenderer:LHTilesRenderer|undefined,failed:LHTile|undefined,callbackChecks=0;
  LHTilesRenderer.prototype.calculateTileViewError=function(tile,target){
    original.call(this,tile,target);
    if(this.group.getScene()!==f.scene||actualRenderer)return;
    actualRenderer=this;
    this.addEventListener('load-error',event=>{if(event.tile)failed=event.tile as LHTile;});
    for(const name of ['update-before','update-after','tile-visibility-change'])this.addEventListener(name,()=>{
      if(failed){assert.ok(failed.internal.loadingState===-1||failed.internal.loadingState===0,`${name} sees genuine failed/unloaded state, never a traversal marker`);callbackChecks++;}
    });
  };
  const errors: unknown[][] = [], previous = console.error; console.error = (...args) => { errors.push(args); };
  try {
    f.connect(); assert.equal(await f.pump(() => f.visible().includes('level-0')), true);
    f.visuals.setDetailProfile('high'); assert.equal(await f.pump(() => f.visuals.snapshot().error !== null), true);
    await f.step(25);
    assert.equal(f.visuals.snapshot().error?.httpStatus,mode==='http'?503:null); assert.equal(f.visuals.snapshot().error?.scope, 'tile');
    assert.equal(f.visuals.snapshot().error?.code,mode==='http'?'http':mode==='network'?'network':'content');
    assert.deepEqual(f.visible(), ['level-0'], 'terminal child failure must preserve its loaded coarse ancestor');
    assert.equal(content(f, 'level-1').length, 1); assert.equal(roots(f).length, 1);
    f.visuals.setDetailProfile('balanced'); assert.equal(await f.pump(() => f.visible().includes('level-0')), true);
    assert.equal(f.visuals.snapshot().phase, 'partial'); assert.equal(f.visuals.snapshot().error?.httpStatus,mode==='http'?503:null);
    assert.equal(f.visuals.snapshot().collisionReady, false); assert.equal(f.visuals.snapshot().requiresGoogleBranding, true);
    assert.ok(f.visuals.credits().some(c => c.value === 'Original synthetic level-0 credit'));
    assert.equal(roots(f).length, 1); assert.equal(content(f, 'level-1').length, 1);
    for(const profile of ['high','ultra','balanced','high'] as const){
      f.visuals.setDetailProfile(profile);await f.step(8);
      // A healthy finer grandchild may replace the fallback even when its intermediate content failed.
      if(profile==='ultra')assert.ok(f.visible().includes('level-0')||f.visible().includes('level-2'));
      else assert.deepEqual(f.visible(),['level-0']);
    }
    f.camera.setTarget(f.camera.position.scale(2).subtract(f.center));await f.step(8);assert.deepEqual(f.visible(),[]);
    f.camera.setTarget(f.center);await f.step(8);assert.deepEqual(f.visible(),['level-0']);
    assert.equal(content(f,'level-1').length,1);assert.ok(callbackChecks>20);assert.equal(failed!.internal.loadingState,-1);
    actualRenderer!.prepareForTraversal();assert.equal(failed!.internal.loadingState,-1,'manual preparation cannot install a traversal marker');
    const output = JSON.stringify([f.visuals.snapshot(), errors.map(items => items.map(item => item instanceof Error ? item.message : item))]);
    assert.ok(!output.includes('fixture-detail-private-key'));
  } finally { LHTilesRenderer.prototype.calculateTileViewError=original;console.error = previous; f.dispose(); }
 }
});

test('finer requested frontiers respect the production 960-item cap and keep a coarse ancestor when capacity cannot cover children', async () => {
  const f = detailFixture({ fanout: 1000 });
  try {
    f.connect(); assert.equal(await f.pump(() => f.visible().includes('level-0')), true);
    f.visuals.setDetailProfile('high');
    assert.equal(await f.pump(() => f.visuals.snapshot().stream?.cache.countLimitReached === 1, 2500), true);
    assert.equal(await f.pump(()=>f.visuals.snapshot().stream?.renderer.queuedDownloads===0&&f.visuals.snapshot().stream?.renderer.pendingOrParsing===0&&f.visuals.snapshot().stream?.renderer.downloading===0,2500),true);
    await f.step(65);
    assert.equal(f.visuals.snapshot().stream?.cache.admitted, 960); assert.equal(f.visuals.snapshot().countLimit, 960);
    assert.equal(f.visuals.snapshot().resources?.residentTiles,960);
    assert.deepEqual(f.visible(), ['level-0']); assert.equal(f.visuals.snapshot().error, null);
    assert.equal(f.visuals.snapshot().stream?.queues.downloadLimitPerOrigin, 4); assert.equal(f.visuals.snapshot().stream?.queues.parseLimit, 2);
    f.visuals.setDetailProfile('ultra'); await f.step(70);
    assert.ok((f.visuals.snapshot().stream?.cache.admitted ?? Infinity) <= 960);
    assert.deepEqual(f.visible(), ['level-0']); assert.equal(roots(f).length, 1);
    f.visuals.setDetailProfile('balanced'); await f.step(70);
    assert.deepEqual(f.visible(), ['level-0']); assert.ok((f.visuals.snapshot().stream?.cache.admitted ?? Infinity) <= 960);
    assert.equal(f.visuals.snapshot().collisionReady, false); assert.equal(f.existingObject.isDisposed(), false);
  } finally { f.dispose(); }
});

test('detail selection survives scene-owned disconnect/retry and disposal rejects further changes without persisting credentials', async () => {
  const f = detailFixture({ profile: 'high' });
  try {
    assert.equal(f.visuals.snapshot().detailProfile, 'high'); assert.equal(f.requests.length, 0);
    assert.throws(() => new StreamedMiamiVisuals(f.scene, { detailProfile: 'invalid' as VisualDetailProfile }), RangeError);
    assert.throws(() => f.visuals.setDetailProfile('invalid' as VisualDetailProfile), RangeError);
    f.visuals.setDetailProfile('ultra'); assert.equal(f.requests.length, 0);
    f.connect(); assert.equal(await f.pump(() => f.visible().includes('level-2')), true);
    const signal = roots(f)[0].init.signal!; f.visuals.disconnect(); assert.equal(signal.aborted, true);
    assert.equal(f.visuals.snapshot().detailProfile, 'ultra'); assert.equal(f.visuals.retry(), false);
    f.connect(); assert.equal(await f.pump(() => f.visible().includes('level-2')), true);
    assert.equal(f.visuals.retry(), true); assert.equal(await f.pump(() => f.visible().includes('level-2')), true);
    assert.equal(f.visuals.snapshot().errorTargetPixels, 8); assert.equal(roots(f).length, 3);
    f.scene.dispose(); assert.equal(f.visuals.snapshot().phase, 'disposed');
    assert.equal(f.visuals.setDetailProfile('balanced'), false); assert.equal(f.visuals.snapshot().detailProfile, 'ultra');
  } finally { f.dispose(); }
});

test('native source callbacks cannot reenter a traversal or resume an old session after disconnect/replacement',async()=>{
 for(const mode of ['reentrant','exception','disconnect','replace'] as const){
  const f=detailFixture({route(request,ordinary){return request.url.pathname.endsWith('/level-1.glb')?new Response('{}',{status:503}):ordinary();}});
  const original=LHTilesRenderer.prototype.calculateTileViewError;
  type Runtime=LHTilesRenderer&{frameCount:number;requestTileContents:(tile:LHTile)=>void;};
  let renderer:Runtime|undefined,failed:LHTile|undefined,forced=false;
  LHTilesRenderer.prototype.calculateTileViewError=function(tile,target){
   original.call(this,tile,target);if(this.group.getScene()!==f.scene)return;
   if(forced){forced=false;throw new Error('original synthetic traversal exception');}
   if(!renderer){renderer=this as Runtime;this.addEventListener('load-error',event=>{if(event.tile)failed=event.tile as LHTile;});}
  };
  const previous=console.error;console.error=()=>{};
  try{
   f.connect();assert.equal(await f.pump(()=>f.visible().includes('level-0')),true);
   f.visuals.setDetailProfile('high');assert.equal(await f.pump(()=>f.visuals.snapshot().error!==null),true);await f.step(5);
   const source=renderer!,firstFrame=source.frameCount,rootSignal=roots(f)[0].init.signal!;
   let before=0,after=0,once=true,closed=false,requestsAfterClose=0;
   const requestTile=source.requestTileContents.bind(source);
   source.requestTileContents=(tile)=>{if(closed){requestsAfterClose++;return;}return requestTile(tile);};
   source.addEventListener('update-before',()=>{
    before++;if(!once)return;once=false;
    if(mode==='reentrant')f.visuals.update(60000);
    if(mode==='exception')forced=true;
    if(mode==='disconnect'){f.visuals.disconnect();closed=true;}
    if(mode==='replace'){f.connect();closed=true;}
   });
   source.addEventListener('update-after',()=>{after++;});
   f.visuals.update(60017);await new Promise(resolve=>setTimeout(resolve,0));
   assert.equal(before,1);assert.equal(requestsAfterClose,0,'closed old renderer cannot issue new contents');
   assert.equal(f.scene.activeCamera,f.camera);assert.equal(f.existingObject.isDisposed(),false);
   if(mode==='reentrant'){
    assert.equal(after,1);assert.equal(source.frameCount-firstFrame,1);assert.equal(failed!.internal.loadingState,-1);
    assert.deepEqual(f.visible(),['level-0']);assert.equal(f.visuals.snapshot().phase,'partial');assert.equal(roots(f).length,1);
   }else if(mode==='exception'){
    assert.equal(after,0);assert.equal(failed!.internal.loadingState,-1);assert.equal(f.visuals.snapshot().error?.scope,'frame');
    assert.deepEqual(f.visible(),['level-0']);await f.step(3);assert.deepEqual(f.visible(),['level-0']);
   }else{
    assert.equal(rootSignal.aborted,true);assert.equal(source.group.isDisposed(),true);assert.equal(after,0);
    if(mode==='disconnect'){assert.equal(f.visuals.snapshot().phase,'disconnected');assert.deepEqual(f.visible(),[]);}
    else{assert.equal(await f.pump(()=>f.visible().includes('level-0')),true);assert.equal(roots(f).length,2);assert.equal(f.visuals.snapshot().detailProfile,'high');}
   }
  }finally{LHTilesRenderer.prototype.calculateTileViewError=original;console.error=previous;f.dispose();}
 }
});
