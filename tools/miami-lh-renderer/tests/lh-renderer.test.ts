import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { AbstractEngine, Frustum, Material, Matrix, NullEngine, Quaternion, Scene, Vector3, VertexBuffer } from '@babylonjs/core';
import { expected, fixtureError, matrixProduct, mirror, transform, vertices } from './frame-fixture';
import { harness, sourceTileset, tick, tileFrame } from './renderer-harness';
import { LHTilesRenderer, type LHTile, type TileView } from '../src/LHTilesRenderer';
const tolerance=2e-5, result:Record<string,unknown>={versions:{babylon:'9.25.0',renderer:'0.5.2'},method:'Actual TilesRenderer traversal, fixture-only transport, actual AUTO GLB importer. No reference placement helper.'};
async function save(){await mkdir(new URL('../evidence/',import.meta.url),{recursive:true});await writeFile(new URL('../evidence/result.json',import.meta.url),JSON.stringify(result,null,2)+'\n');}

test('real renderer loads original nested GLB into the existing LH scene without overwriting AUTO root or applying reference placement',async()=>{
 const h=await harness();try{
  assert.equal(h.scene.useRightHandedSystem,false);assert.equal(h.scene.activeCamera,h.camera);assert.equal(h.renderer.visibleTiles.size,1);assert.equal(h.meshes().length,6);
  assert.deepEqual(h.requests,['https://fixture.invalid/fixtures/tileset.json','https://fixture.invalid/fixtures/asymmetric.glb']);
  const tile=[...h.renderer.visibleTiles][0] as LHTile,root=tile.engineData.container!.rootNodes[0] as import('@babylonjs/core').TransformNode;
  assert.ok(Math.abs(Math.abs(root.rotationQuaternion!.y)-1)<1e-7);assert.ok(Math.abs(root.rotationQuaternion!.w)<1e-7);assert.deepEqual(root.scaling.asArray(),[1,1,-1]);
  const error=fixtureError({scene:h.scene,meshes:h.meshes()});assert.ok(error<tolerance,`world ${error}`);
  let boundsError=0;
  for(const record of expected.records){const mesh=h.meshes().find(m=>m.name===record.name)!,box=mesh.getBoundingInfo().boundingBox;
   const min=[0,1,2].map(c=>Math.min(...record.sourcePositions.filter((_,i)=>i%3===c))),max=[0,1,2].map(c=>Math.max(...record.sourcePositions.filter((_,i)=>i%3===c)));
   const world=matrixProduct(expected.combined,record.nodeWorld),corners=Array.from({length:8},(_,i)=>{const p=transform(world,[i&1?max[0]:min[0],i&2?max[1]:min[1],i&4?max[2]:min[2]]);p[2]*=-1;return p;});
   for(let c=0;c<3;c++)boundsError=Math.max(boundsError,Math.abs(box.minimumWorld.asArray()[c]-Math.min(...corners.map(p=>p[c]))),Math.abs(box.maximumWorld.asArray()[c]-Math.max(...corners.map(p=>p[c]))));
  }
  assert.ok(boundsError<tolerance,`bounds ${boundsError}`);result.load={requests:h.requests.length,meshes:6,maximumVertexErrorM:error,maximumBoundsErrorM:boundsError,events:h.events};await save();
 }finally{h.dispose();}
});

test('actual tile bounds and LH culling match independently transformed corners over camera views, FOVs and aspect ratios',async()=>{
 const h=await harness();try{
  const tile=[...h.renderer.visibleTiles][0] as LHTile,box=sourceTileset.root.children[0].boundingVolume.box as number[];
  const localCorners=Array.from({length:8},(_,i)=>[box[0]+(i&1?1:-1)*box[3],box[1]+(i&2?1:-1)*box[7],box[2]+(i&4?1:-1)*box[11]]);
  const tileWorld=matrixProduct(expected.frame,matrixProduct(expected.tileParent,expected.tileChild));
  const corners=localCorners.map(p=>{const q=transform(tileWorld,p);return new Vector3(q[0],q[1],-q[2]);});
  const actual=tile.engineData.boundingVolume.obb!.points.map(p=>Vector3.TransformCoordinates(p,h.renderer.group.getWorldMatrix()));
  const maxBounds=Math.max(...corners.map(p=>Math.min(...actual.map(q=>Vector3.Distance(p,q)))));assert.ok(maxBounds<tolerance,`tile bounds ${maxBounds}`);
  let configurations=0,visible=0,culled=0,vertexChecks=0,triangleChecks=0,maxNdc=0;
  const all=h.meshes();
  for(const offset of [[10,4,12],[-13,4,-6],[1,17,-4],[5,1,-10],[-4,1,8],[20,8,-20]])for(const fov of [.88,.44,.11])for(const aspect of [16/9,1,9/16])for(const away of [false,true]){
   h.camera.position.copyFrom(h.origin.add(Vector3.FromArray(offset)));h.camera.setTarget(away?h.camera.position.scale(2).subtract(h.origin):h.origin);h.camera.fov=fov;h.camera.freezeProjectionMatrix(Matrix.PerspectiveFovLH(fov,aspect,.12,1500));
   const cameraMatrix=h.camera.getViewMatrix(true).multiply(h.camera.getProjectionMatrix()),planes=Frustum.GetPlanes(cameraMatrix),view:TileView={inView:false,error:0,distanceFromCamera:0};
   h.renderer.calculateTileViewError(tile,view);
   const inView=planes.every(plane=>corners.some(p=>plane.dotCoordinate(p)>=0));assert.equal(view.inView,inView,`view ${configurations}`);assert.ok(Number.isFinite(view.distanceFromCamera));if(inView)visible++;else culled++;configurations++;
   for(const record of expected.records){const mesh=all.find(m=>m.name===record.name)!,projected=vertices(mesh).map(p=>Vector3.TransformCoordinates(p,cameraMatrix)),oracle=record.lhWorld.map(p=>Vector3.TransformCoordinates(Vector3.FromArray(p),cameraMatrix));
    for(let i=0;i<projected.length;i++){maxNdc=Math.max(maxNdc,Vector3.Distance(projected[i],oracle[i]));vertexChecks++;}
    const indices=mesh.getIndices()!;const sign=(points:Vector3[],i:number)=>{const[p,q,r]=[0,1,2].map(j=>points[indices[i+j]]);return Math.sign((q.x-p.x)*(r.y-p.y)-(q.y-p.y)*(r.x-p.x));};
    for(let i=0;i<indices.length;i+=3){assert.equal(sign(projected,i),sign(oracle,i));triangleChecks++;}
   }
  }
  assert.ok(visible>0&&culled>0);assert.ok(maxNdc<2e-4,`NDC ${maxNdc}`);
  result.culling={configurations,visible,culled,vertexChecks,triangleChecks,maximumNdcError:maxNdc,maximumTileBoundsErrorM:maxBounds};await save();
 }finally{h.dispose();}
});

test('renderer really hides and restores the same tile, retains metre scale and moves bounds with the local group',async()=>{
 const h=await harness();try{
  const tile=[...h.renderer.visibleTiles][0] as LHTile,container=tile.engineData.container,all=h.meshes();
  h.camera.setTarget(h.camera.position.scale(2).subtract(h.origin));h.renderer.update();await tick();assert.equal(h.renderer.visibleTiles.size,0);assert.equal(tile.engineData.scene!.isEnabled(),false);
  h.camera.setTarget(h.origin);h.renderer.update();await tick();assert.equal(h.renderer.visibleTiles.size,1);assert.equal(tile.engineData.container,container);assert.ok(fixtureError({scene:h.scene,meshes:all})<tolerance);
  const shift=new Vector3(3,2,-4);h.renderer.group.position.copyFrom(shift);h.camera.position.addInPlace(shift);h.camera.setTarget(h.origin.add(shift));h.renderer.update();
  for(const record of expected.records){const mesh=all.find(m=>m.name===record.name)!;for(const[i,p]of vertices(mesh).entries())assert.ok(Vector3.Distance(p,Vector3.FromArray(record.lhWorld[i]).add(shift))<tolerance);}
  const view:TileView={inView:false,error:0,distanceFromCamera:0};h.renderer.calculateTileViewError(tile,view);assert.equal(view.inView,true);
  const origin=all.find(m=>m.name==='marker-origin')!.getAbsolutePosition();for(const name of ['marker-east','marker-up','marker-north'])assert.ok(Math.abs(Vector3.Distance(origin,all.find(m=>m.name===name)!.getAbsolutePosition())-1)<tolerance);
  h.renderer.dispose();assert.equal(h.scene.meshes.length,0);assert.equal(h.scene.transformNodes.length,0);h.renderer.dispose();result.lifecycle={hideRestore:true,groupTranslationM:shift.asArray(),disposalMeshes:0,disposalTransforms:0};await save();
 }finally{h.dispose();}
});

test('independent oracle rejects overwritten AUTO root and swapped tile transforms from actual renderer loads',async()=>{
 const h=await harness();try{const tile=[...h.renderer.visibleTiles][0] as LHTile,root=tile.engineData.container!.rootNodes[0] as import('@babylonjs/core').TransformNode;root.rotationQuaternion=Quaternion.Identity();assert.ok(fixtureError({scene:h.scene,meshes:h.meshes()})>1);result.negativeRootOverwriteM=fixtureError({scene:h.scene,meshes:h.meshes()});}finally{h.dispose();}
 const data=structuredClone(sourceTileset);[data.root.transform,data.root.children[0].transform]=[data.root.children[0].transform,data.root.transform];
 // Keep deliberately wrong placement visible so the oracle, rather than traversal rejection, detects it.
 data.root.boundingVolume={sphere:[0,0,0,100]};data.root.children[0].boundingVolume={sphere:[0,0,0,10]};
 const wrongWorld=matrixProduct(expected.frame,matrixProduct(expected.tileChild,matrixProduct(expected.tileParent,expected.up)));const target=mirror(Vector3.FromArray(transform(wrongWorld,[0,0,0])));
 const swapped=await harness({tileset:data,target});try{const error=fixtureError({scene:swapped.scene,meshes:swapped.meshes()});assert.ok(error>.25);result.negativeSwappedTileTransformsM=error;}finally{swapped.dispose();}
 await save();
});

test('invalid handedness, metre scale and unsupported geographic bounds fail explicitly',async()=>{
 const engine=new NullEngine(),scene=new Scene(engine);try{assert.throws(()=>new LHTilesRenderer('fixture',scene,{tileToLocal:Matrix.Identity()}),/determinant -1/);assert.throws(()=>new LHTilesRenderer('fixture',scene,{tileToLocal:Matrix.Scaling(2,1,-1)}),/preserve metres/);scene.useRightHandedSystem=true;assert.throws(()=>new LHTilesRenderer('fixture',scene,{tileToLocal:tileFrame()}),/left-handed/);}finally{scene.dispose();engine.dispose();}
 const data=structuredClone(sourceTileset);data.root.boundingVolume={region:[0,0,.1,.1,0,10]};const h=await harness({tileset:data,waitForVisible:false});try{await h.pump(()=>h.errors.length>0);assert.match(h.errors[0]?.message??'',/geographic regions/);assert.equal(h.scene.meshes.length,0);}finally{h.dispose();}result.capabilities={LHScene:true,rigidMetres:true,regionRejected:true};await save();
});


test('imported normals and material culling retain their handedness over nonuniform GLTF nodes',async()=>{
 const h=await harness();try{
  let maximumError=0,checks=0;
  for(const record of expected.records){const mesh=h.meshes().find(m=>m.name===record.name)!;
   assert.equal(mesh.material!.backFaceCulling,true);assert.equal(mesh.material!.sideOrientation ?? mesh.sideOrientation,Material.ClockWiseSideOrientation);
   const world=mesh.computeWorldMatrix(true),actualNormal=world.clone().invert().transpose();
   const oracleWorld=Matrix.FromArray(matrixProduct(expected.combined,record.nodeWorld)).multiply(Matrix.Scaling(1,1,-1)),oracleNormal=oracleWorld.clone().invert().transpose();
   const data=mesh.getVerticesData(VertexBuffer.NormalKind)!;assert.deepEqual(Array.from(data),record.sourceNormals);
   for(let i=0;i<data.length;i+=3){const source=Vector3.FromArray(data,i),a=Vector3.TransformNormal(source,actualNormal).normalize(),b=Vector3.TransformNormal(source,oracleNormal).normalize();maximumError=Math.max(maximumError,Vector3.Distance(a,b));checks++;}
   assert.ok(world.determinant()<0,'one handedness reversal in final geometry');
  }
  assert.ok(maximumError<2e-5);result.normals={checks,maximumError,backFaceCulling:true,negativeWorldDeterminant:true};await save();
 }finally{h.dispose();}
});

test('disposing during actual GLB import releases late assets instead of installing them',async()=>{
 let ready=false,release!:()=>void;const barrier=new Promise<void>(resolve=>{release=resolve;});
 class DelayedImporter extends LHTilesRenderer {protected async importGlb(buffer:Uint8Array,metadata:(json:unknown)=>void){const container=await super.importGlb(buffer,metadata);ready=true;await barrier;return container;}}
 const h=await harness({Renderer:DelayedImporter,waitForVisible:false});try{
  assert.equal(await h.pump(()=>ready),true);assert.equal(h.renderer.visibleTiles.size,0);h.renderer.dispose();release();for(let i=0;i<8;i++)await tick();
  assert.equal(h.scene.meshes.length,0);assert.equal(h.scene.transformNodes.length,0);assert.equal(h.events.includes('load-model'),false);assert.equal(h.errors.length,0);
  result.cancelledImport={actualImporterResolved:true,lateMeshes:0,lateTransforms:0,loadModelAfterDisposal:false};await save();
 }finally{release();h.dispose();}
});

test('doubled root compensation and incorrect up-axis fail the untouched fixture oracle',async()=>{
 class DoubleCompensation extends LHTilesRenderer {async parseTile(buffer:ArrayBuffer,tile:LHTile,extension:string,url:string,signal:AbortSignal){await super.parseTile(buffer,tile,extension,url,signal);const wrapper=tile.engineData.scene;if(wrapper)wrapper.setPreTransformMatrix(Matrix.Scaling(-1,1,1).multiply(wrapper.getPivotMatrix()));}}
 const duplicate=await harness({Renderer:DoubleCompensation});try{const error=fixtureError({scene:duplicate.scene,meshes:duplicate.meshes()});assert.ok(error>.25);result.negativeDoubleCompensationM=error;}finally{duplicate.dispose();}
 const data=structuredClone(sourceTileset);data.asset.gltfUpAxis='Z';const wrongUp=await harness({tileset:data});try{const error=fixtureError({scene:wrongUp.scene,meshes:wrongUp.meshes()});assert.ok(error>.25);result.negativeOmittedUpAxisM=error;}finally{wrongUp.dispose();}await save();
});


test('SSE uses framebuffer pixels across quality scale, resolution, viewport and projection modes',async()=>{
 const measurements:Array<Record<string,unknown>>=[];
 for(const dimensions of [[1600,900],[800,450],[1200,900]] as [number,number][]){const h=await harness({framebuffer:dimensions});try{
  const tile=[...h.renderer.visibleTiles][0] as LHTile;tile.geometricError=2;let reference=0;
  // NullEngine alone hardcodes its getter to1; use the actual AbstractEngine getter/setter for quality state.
  h.engine.getHardwareScalingLevel=AbstractEngine.prototype.getHardwareScalingLevel.bind(h.engine);
  for(const scale of [1,2,.75]){
   h.engine.setHardwareScalingLevel(scale);assert.equal(h.engine.getHardwareScalingLevel(),scale);const view:TileView={inView:false,error:0,distanceFromCamera:0};h.renderer.calculateTileViewError(tile,view);
   const expectedError=tile.geometricError*dimensions[1]*Math.abs(h.camera.getProjectionMatrix().m[5])/(2*view.distanceFromCamera);
   assert.ok(Math.abs(view.error-expectedError)<1e-9);if(scale===1)reference=view.error;else assert.ok(Math.abs(view.error-reference)<1e-9,'logical scaling must not multiply fixed framebuffer SSE');
   measurements.push({framebuffer:dimensions,hardwareScaling:scale,errorPixels:view.error});
  }
  h.camera.viewport.height=.5;const view:TileView={inView:false,error:0,distanceFromCamera:0};h.renderer.calculateTileViewError(tile,view);assert.ok(Math.abs(view.error-reference*.5)<1e-9);
  h.camera.freezeProjectionMatrix(Matrix.OrthoLH(20,10,.12,1500));h.renderer.calculateTileViewError(tile,view);const pixelsPerMetre=Math.min(dimensions[0]/20,dimensions[1]*.5/10);assert.ok(Math.abs(view.error-2*pixelsPerMetre)<1e-5);
 }finally{h.dispose();}}
 result.sse={measurements,viewportAndOrthographic:true};await save();
});

test('delayed root completion is cancelled without state, events or requests surviving disposal',async()=>{
 let resolve!: (response:Response)=>void,signal:AbortSignal|undefined;const deferred=new Promise<Response>(done=>{resolve=done;});
 const h=await harness({waitForVisible:false,rootFetch:init=>{signal=init.signal??undefined;return deferred;}});try{
  assert.equal(await h.pump(()=>Boolean(signal)),true);h.renderer.dispose();assert.equal(signal!.aborted,true);const eventsBefore=h.events.length;
  resolve(new Response(JSON.stringify(sourceTileset)));for(let i=0;i<8;i++)await tick();
  assert.equal(h.renderer.rootTileset,null);assert.equal(h.renderer.root,null);assert.equal(h.events.length,eventsBefore);assert.equal(h.errors.length,0);assert.equal(h.scene.meshes.length,0);assert.equal(h.scene.transformNodes.length,0);
 }finally{resolve(new Response('{}'));h.dispose();}
 const immediate=await harness({waitForVisible:false});try{immediate.renderer.update();immediate.renderer.dispose();for(let i=0;i<4;i++)await tick();assert.equal(immediate.requests.length,0);assert.equal(immediate.errors.length,0);}finally{immediate.dispose();}
 result.rootCancellation={signalAborted:true,lateRoot:null,lateEvents:0,immediateDisposalRequests:0};await save();
});

test('terminal root failure can be reset and successfully load through the same guarded renderer',async()=>{
 let attempts=0;const h=await harness({waitForVisible:false,rootFetch:async()=>++attempts===1?new Response('synthetic failure',{status:503}):new Response(JSON.stringify(sourceTileset))});try{
  await h.pump(()=>h.errors.length===1);assert.match(h.errors[0]?.message??'',/503/);assert.equal(h.renderer.rootTileset,null);h.errors.length=0;h.renderer.resetFailedTiles();assert.equal(await h.pump(),true);assert.equal(attempts,2);assert.ok(fixtureError({scene:h.scene,meshes:h.meshes()})<tolerance);assert.equal(h.events.filter(event=>event==='load-root-tileset').length,1);
  result.rootRetry={attempts,terminalErrors:1,successfulRootEvents:1};await save();
 }finally{h.dispose();}
});


test('guarded root loading preserves the pinned renderer plugin root hook',async()=>{
 const h=await harness({waitForVisible:false});let hookCalls=0;try{
  h.renderer.registerPlugin({name:'ROOT_HOOK_REGRESSION',loadRootTileset(){hookCalls++;return h.renderer.loadRootTileset();}});
  assert.equal(await h.pump(),true);assert.equal(hookCalls,1);assert.ok(fixtureError({scene:h.scene,meshes:h.meshes()})<tolerance);result.rootPlugin={hookCalls,loadedThroughHook:true};await save();
 }finally{h.dispose();}
});

test('a root-event listener can dispose without subsequent root events leaking through',async()=>{
 for(const stopOn of ['needs-update','load-tileset']){
  const h=await harness({waitForVisible:false});let stopped=false;try{
   const postDispose:string[]=[];for(const name of ['needs-update','load-tileset','load-root-tileset'])h.renderer.addEventListener(name,()=>{if(stopped)postDispose.push(name);});
   h.renderer.addEventListener(stopOn,()=>{stopped=true;h.renderer.dispose();});await h.pump(()=>stopped);for(let i=0;i<4;i++)await tick();
   assert.equal(stopped,true);assert.deepEqual(postDispose,[]);assert.equal(h.renderer.root,null);assert.equal(h.scene.meshes.length,0);assert.equal(h.errors.length,0);
  }finally{h.dispose();}
 }
 result.rootReentrantDisposal={eventStops:['needs-update','load-tileset'],laterEvents:0};await save();
});
