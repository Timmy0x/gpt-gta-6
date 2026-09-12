import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {Matrix,NullEngine,Scene,UniversalCamera,Vector3} from '@babylonjs/core';
import {LocalTileBounds} from '../src/LocalTileBounds';
import {identity} from '../src/DoubleFrame';
import {LHTilesRenderer,type LHTile,type TileView} from '../src/LHTilesRenderer';
import {glb} from './frame-fixture';
import {tick} from './renderer-harness';
// Tilted, broad, thin mapped sheet. Its axis-aligned enclosure contains the camera,
// but the actual oriented slab lies more than a kilometre away.
const angle=Math.PI/6,box=[0,0,0,10000,0,0,0,2*Math.cos(angle),2*Math.sin(angle),0,-10000*Math.sin(angle),10000*Math.cos(angle)],position=new Vector3(-330,680,1295);
const report:Record<string,unknown>={scope:'Original tilted-box hierarchy, fixture GLB only; no provider data or GPU.'};
async function save(){await mkdir(new URL('../evidence/',import.meta.url),{recursive:true});await writeFile(new URL('../evidence/refinement-result.json',import.meta.url),JSON.stringify(report,null,2)+'\n');}
function aabbDistance(bounds:LocalTileBounds,p:Vector3){const points=bounds.obb!.points,min=new Vector3(...[0,1,2].map(c=>Math.min(...points.map(v=>v.asArray()[c]))) as [number,number,number]),max=new Vector3(...[0,1,2].map(c=>Math.max(...points.map(v=>v.asArray()[c]))) as [number,number,number]);return Vector3.Distance(p,Vector3.Clamp(p,min,max));}

test('oriented slab distance stays finite when a kilometre-distant camera lies inside its loose world AABB',async()=>{
 const bounds=new LocalTileBounds({box},identity()),exact=Math.abs(position.y*Math.cos(angle)+position.z*Math.sin(angle))-2,actual=bounds.distanceToPoint(position),old=aabbDistance(bounds,position);assert.equal(old,0);assert.ok(Math.abs(actual-exact)<1e-8,`distance ${actual}, expected ${exact}`);report.slab={cameraToActualSlabM:exact,orientedDistanceM:actual,previousAabbDistanceM:old};await save();
});

async function cohort(legacy:boolean){
 const engine=new NullEngine({renderWidth:1600,renderHeight:900,textureSize:512,deterministicLockstep:false,lockstepMaxSteps:4}),scene=new Scene(engine),camera=new UniversalCamera('controlled-camera',new Vector3(position.x,position.y,-position.z),scene);camera.setTarget(Vector3.Zero());camera.fov=65*Math.PI/180;camera.minZ=.1;camera.maxZ=100000;
 class LegacyDistance extends LHTilesRenderer{preprocessNode(tile:LHTile,directory:string,parent:LHTile|null=null){super.preprocessNode(tile,directory,parent);const bounds=tile.engineData.boundingVolume as LocalTileBounds;bounds.distanceToPoint=p=>aabbDistance(bounds,p);}}
 const renderer=new(legacy?LegacyDistance:LHTilesRenderer)('https://fixture.invalid/refinement/tileset.json',scene,{tileToLocal:Matrix.Scaling(1,1,-1)});renderer.lruCache.maxSize=24;renderer.lruCache.minSize=16;renderer.loadAncestors=true;renderer.loadSiblings=false;renderer.errorTarget=20;
 const data={asset:{version:'1.0'},geometricError:10,root:{boundingVolume:{box},geometricError:10,refine:'REPLACE',content:{uri:'coarse.glb'},children:Array.from({length:64},(_,i)=>({boundingVolume:{box},geometricError:0,content:{uri:`detail-${i}.glb`}}))}};
 const requests:string[]=[],errors:string[]=[];let loaded=0;renderer.addEventListener('load-error',event=>errors.push(event.error.message));renderer.addEventListener('load-model',()=>loaded++);renderer.registerPlugin({name:'ORIGINAL_REFINEMENT_FIXTURE',async fetchData(url:string){requests.push(url);return url.endsWith('.json')?new Response(JSON.stringify(data)):new Response(new Uint8Array(glb));}});
 try{for(let i=0;i<160;i++){renderer.update();await tick();}assert.deepEqual(errors,[]);const view:TileView={inView:false,error:0,distanceFromCamera:0};renderer.calculateTileViewError(renderer.root!,view);return{requests:requests.length,loaded,visible:renderer.visibleTiles.size,inView:view.inView,errorPixels:view.error===Infinity?'Infinity':view.error,distanceM:view.distanceFromCamera};}finally{renderer.dispose();scene.dispose();engine.dispose();}
}

test('actual traversal avoids AABB-driven infinite refinement and a full cache retaining only the coarse ancestor',async()=>{
 const old=await cohort(true),fixed=await cohort(false);assert.equal(old.errorPixels,'Infinity');assert.equal(old.visible,1);assert.ok(old.loaded>=20);assert.equal(fixed.inView,true);assert.equal(fixed.visible,1);assert.equal(fixed.loaded,1);assert.equal(fixed.requests,2);assert.ok(typeof fixed.errorPixels==='number'&&fixed.errorPixels<20);report.refinement={legacyAabb:old,oriented:fixed,cacheMaxCount:24,overlappingConservativeChildBounds:true};await save();
});

test('oriented box distances match the pinned upstream OBB across rotated, thin, degenerate and translated frames',async()=>{
 const upstreamPath='../node_modules/3d-tiles-renderer/src/babylonjs/renderer/math/TileBoundingVolume.js';
 const {TileBoundingVolume}=await import(upstreamPath);let maximum=0,checks=0;
 for(let k=0;k<80;k++){
  const rotation=Matrix.RotationYawPitchRoll(k*.173,k*.071,k*.037),axes=[Vector3.Right(),Vector3.Up(),Vector3.Forward()].map(v=>Vector3.TransformNormal(v,rotation).normalize()),half=[10000/(1+k%7),k%5===0?0:.002+k%11,2000/(1+k%3)],center=new Vector3(120.123+k,-43.456+k*.7,-61.789),b=[...center.asArray(),...axes.flatMap((axis,i)=>axis.scale(half[i]).asArray())],upstream=new TileBoundingVolume();upstream.setObbData(b,Matrix.Identity());const actual=new LocalTileBounds({box:b},identity());
  for(let n=0;n<30;n++){const p=center.add(new Vector3(Math.sin(n*.67)*12000,Math.cos(n*.73)*4500,Math.sin(n*.97)*4000)),old=upstream.distanceToPoint(p),fixed=actual.distanceToPoint(p);maximum=Math.max(maximum,Math.abs(old-fixed));assert.ok(Math.abs(old-fixed)<.004,`OBB parity ${k}/${n}: ${old} vs ${fixed}`);checks++;}
 }
 report.upstreamParity={checks,maximumDistanceDifferenceM:maximum,toleranceM:.004,referenceUsesPinnedFloat32Matrix:true};await save();
});

test('sheared and near-degenerate source boxes remain inside the oriented enclosure without false distance at any source corner',async()=>{
 let checks=0,maximum=0;for(const factor of [0,1e-12,1e-8,.02,1,30])for(const shear of [0,.0000001,.3,8]){
  const b=[123.456,-56.789,42.567,5000,0,0,shear*factor,factor,0,1200*shear,.2*factor,1200],bounds=new LocalTileBounds({box:b},identity());
  for(const corner of bounds.obb!.points){const distance=bounds.distanceToPoint(corner);maximum=Math.max(maximum,distance);assert.ok(distance<1e-7,`source corner outside: ${distance}`);checks++;}
 }
 const near=new LocalTileBounds({box:[0,0,0,1e7,0,0,1e-9,1,0,0,0,1]},identity());assert.ok(near.distanceToPoint(new Vector3(1e7,0,0))<1e-7);
 report.conservativeEnclosure={sourceCornerChecks:checks,maximumCornerDistanceM:maximum,shearAndDegenerate:true,largeNearOrthogonalBoundary:true};await save();
});
