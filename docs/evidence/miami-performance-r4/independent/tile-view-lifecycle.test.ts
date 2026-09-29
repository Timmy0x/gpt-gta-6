import test from 'node:test';
import assert from 'node:assert/strict';
import {Camera,Frustum,Matrix,NullEngine,Scene,TransformNode,UniversalCamera,Vector3} from '@babylonjs/core';

const source=process.env.REVIEW_SOURCE??'../miami-performance-r4-source';
const {LHTilesRenderer}=await import(`${source}/src/world/miami/visuals/LHTilesRenderer.ts`);
// Independently import the previously accepted application implementation rather than duplicate its formula.
const {LHTilesRenderer:BaselineRenderer}=await import('../miami-gameplay-r3-source/src/world/miami/visuals/LHTilesRenderer.ts');
globalThis.window??={location:{href:'https://review.invalid/'},addEventListener(){},removeEventListener(){}} as any;
globalThis.requestAnimationFrame??=callback=>setTimeout(()=>callback(performance.now()),0) as unknown as number;
globalThis.cancelAnimationFrame??=id=>clearTimeout(id);
const evidence:Record<string,unknown>[]=[];
const blank=()=>({inView:false,error:0,distanceFromCamera:0});

async function fixture(t:test.TestContext,count=128){
 const options={renderWidth:1280,renderHeight:720,textureSize:512,deterministicLockstep:false,lockstepMaxSteps:4};
 const engine=new NullEngine(options),scene=new Scene(engine),camera=new UniversalCamera('review-game-camera',new Vector3(0,-20,-6),scene);
 camera.minZ=.12;camera.maxZ=1500;camera.setTarget(new Vector3(0,-20,80));
 const renderer=new LHTilesRenderer('https://review.invalid/root.json',scene,{tileToLocal:Matrix.Scaling(1,1,-1)});
 const baseline=new BaselineRenderer('https://review.invalid/baseline.json',scene,{tileToLocal:Matrix.Scaling(1,1,-1)});
 const children=Array.from({length:count},(_,i)=>({geometricError:i%11,boundingVolume:i%2?{sphere:[i%16*24-180,-20+(i%6)*12,Math.floor(i/16)*32-140,18]}:{box:[i%16*24-180,-20+(i%6)*12,Math.floor(i/16)*32-140,12,0,0,0,25,0,0,0,12]},children:[]}));
 const root={asset:{version:'1.0',gltfUpAxis:'Y'},geometricError:1e8,root:{geometricError:1e8,refine:'REPLACE',boundingVolume:{sphere:[0,0,0,10000]},children}};
 renderer.registerPlugin({name:'SYNTHETIC_REVIEW_ROOT',async loadRootTileset(){renderer.preprocessTileset(root as any,'https://review.invalid/root.json');return root;}});
 renderer.update();for(let i=0;i<12&&!renderer.root;i++)await Promise.resolve();assert.ok(renderer.root);
 renderer.traverse(()=>false,null);children.forEach((tile:any,i)=>tile.engineData.errorScale=1+(i%4)*.125);
 t.after(()=>{renderer.dispose();baseline.dispose();scene.dispose();engine.dispose();});
 function oracle(tile:any){
  baseline.group.setPreTransformMatrix(renderer.group.computeWorldMatrix(true).clone());
  const expected=blank();baseline.calculateTileViewError(tile,expected);return expected;
 }
 let calls=0,compare=true,visible=0,hidden=0;
 const nativeCalculate=renderer.calculateTileViewError.bind(renderer);
 renderer.calculateTileViewError=(tile:any,target:any)=>{
  nativeCalculate(tile,target);calls++;if(target.inView)visible++;else hidden++;
  if(compare)assert.deepEqual(target,oracle(tile),'new native traversal decisions match the accepted application method');
 };
 return{options,engine,scene,camera,renderer,baseline,children,oracle,nativeCalculate,get calls(){return calls;},set compare(value:boolean){compare=value;},get visible(){return visible;},get hidden(){return hidden;}};
}

test('actual pinned core traversal agrees with the accepted renderer after affine rigid parents, projection, viewport and camera replacement',async t=>{
 const f=await fixture(t),tileParent=new TransformNode('review-tile-parent',f.scene),cameraParent=new TransformNode('review-camera-parent',f.scene);
 const replacement=new UniversalCamera('review-replacement',new Vector3(0,-22,0),f.scene);
 for(let state=0;state<24;state++){
  const camera=state%4===3?replacement:f.camera;f.scene.activeCamera=camera;
  camera.unfreezeProjectionMatrix();camera.mode=state%3===1?Camera.ORTHOGRAPHIC_CAMERA:Camera.PERSPECTIVE_CAMERA;
  camera.parent=state%5===2?cameraParent:null;cameraParent.position.set(10,-3,state);cameraParent.rotation.set(.04,.13,-.05);
  camera.position.set(state*4-30,-20+state%6,-12-state*2);camera.setTarget(new Vector3(state%2?110:-30,-20,state%2?-140:90));
  camera.fov=.61+(state%5)*.12;camera.fovMode=state%2?Camera.FOVMODE_HORIZONTAL_FIXED:Camera.FOVMODE_VERTICAL_FIXED;
  camera.minZ=.12+state*.01;camera.maxZ=900+state*50;
  camera.orthoLeft=-55-state;camera.orthoRight=37+state;camera.orthoTop=42;camera.orthoBottom=-16-state;
  camera.viewport.x=state%2*.1;camera.viewport.y=state%3*.08;camera.viewport.width=.5+(state%3)*.2;camera.viewport.height=.6+(state%3)*.15;
  f.options.renderWidth=960+state*21;f.options.renderHeight=600+state*11;f.engine.setHardwareScalingLevel(state%3+1);
  f.renderer.group.parent=state%4===1?tileParent:null;tileParent.position.set(state*3,-state/2,17);tileParent.rotation.set(.03,.22,.06);
  f.renderer.group.position.set(state%2*52,-state%3,20-state*3);f.renderer.group.rotation.set(.02,state*.013,-.01);
  f.renderer.group.setPreTransformMatrix(Matrix.RotationX(.03).multiply(Matrix.Scaling(1,1,-1)));
  if(state===11)camera.freezeProjectionMatrix(Matrix.OrthoOffCenterLH(-32,73,-24,57,.2,1300));
  if(state===12)camera.freezeProjectionMatrix(Matrix.PerspectiveFovLH(.71,1.6,.3,1800));
  const before=f.calls;f.renderer.update();assert.equal(f.calls-before,f.children.length+1,'root plus every native child query executed');
 }
 assert.ok(f.visible>0&&f.hidden>0);evidence.push({name:'actual-native-core-view-states',states:24,queries:f.calls,visible:f.visible,hidden:f.hidden});
});

test('before/after listeners, skipped and rootless updates, and native traversal exceptions never retain a previous snapshot',async t=>{
 const f=await fixture(t,32);let skip=false,before=0,after=0;
 f.renderer.registerPlugin({name:'REVIEW_SKIP',doTilesNeedUpdate(){return !skip;}});
 f.renderer.addEventListener('update-before',()=>{
  before++;f.camera.position.x+=15;f.camera.mode=Camera.ORTHOGRAPHIC_CAMERA;f.camera.orthoLeft=-22;f.camera.orthoRight=66;f.camera.orthoTop=30;f.camera.orthoBottom=-11;
  f.renderer.group.position.z-=30;f.camera.viewport.height=.7;f.options.renderHeight=902;
 });
 f.renderer.addEventListener('update-after',()=>{
  after++;f.camera.position.z-=23;f.camera.mode=Camera.PERSPECTIVE_CAMERA;f.camera.fov=.79;f.renderer.group.position.x+=7;
  f.renderer.calculateTileViewError(f.children[3] as any,blank());
 });
 let calls=f.calls;f.renderer.update();assert.equal(f.calls-calls,34);assert.equal(before,1);assert.equal(after,1);
 skip=true;calls=f.calls;f.renderer.update();assert.equal(f.calls-calls,1);assert.equal(before,2);assert.equal(after,2);
 const state=f.renderer as any,saved=state.rootTileset;state.rootTileset=null;calls=f.calls;f.renderer.update();assert.equal(f.calls,calls);assert.equal(before,2);assert.equal(after,2);
 f.camera.position.y+=40;f.renderer.group.position.x+=80;f.renderer.calculateTileViewError(f.children[7] as any,blank());state.rootTileset=saved;
 skip=false;const method=f.renderer.calculateTileViewError;let failed=false;
 f.renderer.calculateTileViewError=(tile:any,target:any)=>{if(!failed){failed=true;throw new Error('independent synthetic traversal failure');}method(tile,target);};
 assert.throws(()=>f.renderer.update(),/independent synthetic traversal failure/);f.renderer.calculateTileViewError=method;
 f.camera.position.x-=90;f.renderer.calculateTileViewError(f.children[9] as any,blank());f.renderer.update();
 evidence.push({name:'actual-native-callback-skip-rootless-and-exception',before,after});
});

test('stable native traversal captures once and legitimate dispatched listeners invalidate before querying moved camera state',async t=>{
 const f=await fixture(t,64),original=Frustum.GetPlanes;let captures=0;
 Frustum.GetPlanes=(...args)=>{captures++;return original(...args);};
 t.after(()=>{Frustum.GetPlanes=original;});f.compare=false;
 const previous=captures;f.renderer.update();assert.equal(captures-previous,1);
 // An actual query after an update is outside its lifetime, even if manual backend preparation is called.
 f.renderer.prepareForTraversal();f.camera.position.x+=50;f.renderer.group.position.z-=22;
 const direct=blank(),start=captures;f.nativeCalculate(f.children[8] as any,direct);assert.equal(captures-start,1);assert.deepEqual(direct,f.oracle(f.children[8]));
 let event=false;f.renderer.addEventListener('review-during-traversal',()=>{
  event=true;f.camera.position.z-=80;f.camera.fov=.72;f.renderer.group.position.x-=33;
  const actual=blank();f.nativeCalculate(f.children[4] as any,actual);assert.deepEqual(actual,f.oracle(f.children[4]));
 });
 const prepare=f.renderer.prepareForTraversal.bind(f.renderer);f.renderer.prepareForTraversal=()=>{prepare();f.renderer.dispatchEvent({type:'review-during-traversal'});};
 f.compare=true;f.renderer.update();assert.ok(event);
 evidence.push({name:'stable-capture-and-event-invalidation',stableNativeQueries:65,stableCaptures:1});
});

test.after(()=>console.log(JSON.stringify({scope:'Independent synthetic 3d-tiles-renderer0.5.2 actual-core traversal and accepted R3 oracle, no provider content',evidence})));
