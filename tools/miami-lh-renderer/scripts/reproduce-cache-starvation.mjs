import assert from 'node:assert/strict';
import { TilesRendererBase } from '3d-tiles-renderer/core';

// Original synthetic hierarchy only. No network, provider metadata, graphics or decoder.
globalThis.requestAnimationFrame = callback => setTimeout(() => callback(performance.now()), 0);
globalThis.cancelAnimationFrame = handle => clearTimeout(handle);
globalThis.window = { location:{ href:'https://synthetic.invalid/fixture/' } };
const pause = () => new Promise(resolve => setTimeout(resolve, 0));
const tile = (uri, error, inView, children=[]) => ({ boundingVolume:{ sphere:[0,0,0,1] }, geometricError:error, inView, ...(uri?{content:{uri}}:{}), children });
function fixture() {
  const nested = new Map();
  const children = Array.from({length:90}, (_,group) => {
    nested.set(`/fixture/group-${group}.json`, {asset:{version:'1.0'},geometricError:512,
      root:tile(null,10000,true, Array.from({length:3},(_,leaf)=>tile(`leaf-${group}-${leaf}.glb`,0,leaf===0)))});
    return tile(`group-${group}.json`,512,true);
  });
  return { nested, root:{asset:{version:'1.0'},geometricError:10000,root:tile('coarse.glb',10000,true,children)} };
}
class Probe extends TilesRendererBase {
  constructor(cap,ancestors) {
    super('https://synthetic.invalid/fixture/root.json');
    this.data=fixture(); this.errors=[]; this.requests=0; this.modelEvents=0;
    this.lruCache.maxSize=cap;this.lruCache.minSize=160;
    this.lruCache.maxBytesSize=128*1024*1024;this.lruCache.minBytesSize=96*1024*1024;
    this.loadAncestors=ancestors;this.loadSiblings=false;this.errorTarget=20;
    this.maxTilesProcessed=10000;this.downloadQueue.maxJobsPerOrigin=4;this.parseQueue.maxJobs=2;
  }
  async loadRootTileset() {this.preprocessTileset(this.data.root,this.rootURL);return this.data.root;}
  async fetchData(url) {this.requests++;return url.endsWith('.json')?structuredClone(this.data.nested.get(new URL(url).pathname)):new ArrayBuffer(1);}
  async parseTile(buffer,tile) {tile.engineData.scene={synthetic:true};}
  calculateBytesUsed() {return 1;}
  calculateTileViewError(tile,target) {target.inView=tile.inView;target.error=tile.geometricError;target.distanceFromCamera=1;}
  dispatchEvent(event) {if(event.type==='load-error')this.errors.push(String(event.error));if(event.type==='load-model')this.modelEvents++;}
  snapshot(){
    const entries=[...this.lruCache.itemSet.keys()];
    return {cap:this.lruCache.maxSize,loadAncestors:this.loadAncestors,loadSiblings:this.loadSiblings,
      residentEntries:entries.length,protectedEntries:this.lruCache.usedSet.size,
      residentExternalJson:entries.filter(t=>t.internal.hasUnrenderableContent).length,
      residentModels:entries.filter(t=>t.internal.hasRenderableContent&&t.internal.loadingState===4).length,
      successfulContent:this.stats.loaded,visible:this.visibleTiles.size,
      visibleCoarse:[...this.visibleTiles].some(t=>t.content.uri.endsWith('coarse.glb')),
      requested:this.requests,cumulativeModelEvents:this.modelEvents,
      queue:{queued:this.stats.queued,downloading:this.stats.downloading,parsing:this.stats.parsing},
      usedTraversal:this.stats.used,full:this.lruCache.isFull(),errors:this.errors};
  }
}
async function run(cap,ancestors){
  const renderer=new Probe(cap,ancestors);
  for(let i=0;i<500;i++){renderer.update();await pause();}
  const first=renderer.snapshot();
  for(let i=0;i<200;i++){renderer.update();await pause();}
  const last=renderer.snapshot();
  const stable=JSON.stringify(first)===JSON.stringify(last);
  // Synthetic view change: each branch sees its second (previously off-screen) leaf.
  // This probes fallback/readiness only, not a physical camera or a rasterized image.
  renderer.traverse(t=>{if(t.content?.uri.startsWith('leaf-'))t.inView=t.content.uri.endsWith('-1.glb');});
  const motion={minimumVisible:Infinity,framesUntilAll90Visible:null,peakEntries:0};
  for(let i=0;i<300;i++){
    renderer.update();await pause();
    motion.minimumVisible=Math.min(motion.minimumVisible,renderer.visibleTiles.size);
    motion.peakEntries=Math.max(motion.peakEntries,renderer.lruCache.itemSet.size);
    if(motion.framesUntilAll90Visible===null&&renderer.visibleTiles.size===90)motion.framesUntilAll90Visible=i+1;
  }
  renderer.dispose();await pause();
  return {...last,stableAcross200AdditionalFrames:stable,syntheticViewChange:motion};
}
const results=[];
for(const [cap,ancestors] of [[240,true],[512,true],[240,false]])results.push(await run(cap,ancestors));
assert.equal(results[0].residentEntries,240);
assert.equal(results[0].residentExternalJson,90);
assert.equal(results[0].residentModels,150);
assert.equal(results[0].visible,1);
assert.equal(results[0].visibleCoarse,true);
assert.equal(results[0].stableAcross200AdditionalFrames,true);
assert.equal(results[1].visibleCoarse,false);
assert.equal(results[2].visibleCoarse,false);
assert.ok(results.every(result=>result.errors.length===0));
console.log(JSON.stringify({scope:'Original synthetic core traversal/cache proof; no provider data.',results},null,2));
