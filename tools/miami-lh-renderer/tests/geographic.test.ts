import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {Frustum,Matrix,NullEngine,Scene,UniversalCamera,Vector3,type Mesh} from '@babylonjs/core';
import {LHTilesRenderer,type LHTile,type TileView} from '../src/LHTilesRenderer';
import {ECEFLocalFrame,geographicRegionCorners,identity,translation,wgs84ECEF} from '../src/DoubleFrame';
import {LocalTileBounds} from '../src/LocalTileBounds';
import {tick} from './renderer-harness';
import {vertices} from './frame-fixture';
import {expected,geoHarness} from './geographic-harness';
const results:Record<string,unknown>={scope:'Original synthetic content only; actual pinned renderer traversal and AUTO GLB import; oracle generated independently without runtime matrix helpers.'};
async function save(){await mkdir(new URL('../evidence/',import.meta.url),{recursive:true});await writeFile(new URL('../evidence/geographic-result.json',import.meta.url),JSON.stringify(results,null,2)+'\n');}
for(const name of expected.cases.map((c:{name:string})=>c.name))test(`ECEF ${name}: actual nested traversal preserves all source vertices and metre markers before Float32 placement`,async()=>{
 const h=await geoHarness(name);try{
  assert.equal(await h.pump(),true,h.errors.map(e=>e.message).join('\n'));assert.equal(h.meshes().length,6);assert.equal(h.errors.length,0);assert.ok(h.meshes().every(m=>(m.material as unknown as {unlit:boolean}).unlit===true));
  const tile=[...h.renderer.visibleTiles][0] as LHTile;assert.equal(tile.engineData.upAxis,h.fixture.axis);assert.equal(h.scene.useRightHandedSystem,false);
  let maximum=0,checks=0,maximumNdc=0,cameraChecks=0;
  for(const record of h.fixture.records){const mesh=h.meshes().find(m=>m.name===record.name)!;for(const[i,p]of vertices(mesh).entries()){maximum=Math.max(maximum,Vector3.Distance(p,Vector3.FromArray(record.lhWorld[i])));checks++;}}
  assert.ok(maximum<.001,`${name} maximum world error ${maximum} m`);
  for(const offset of [[10,4,12],[-13,4,-6],[1,17,-4]])for(const fov of [.88,.44,.11])for(const away of [false,true]){
   h.camera.position.copyFrom(h.origin.add(Vector3.FromArray(offset)));h.camera.setTarget(away?h.camera.position.scale(2).subtract(h.origin):h.origin);h.camera.fov=fov;h.camera.freezeProjectionMatrix(Matrix.PerspectiveFovLH(fov,16/9,.12,1500));
   const matrix=h.camera.getViewMatrix(true).multiply(h.camera.getProjectionMatrix()),planes=Frustum.GetPlanes(matrix),view:TileView={inView:false,error:0,distanceFromCamera:0};h.renderer.calculateTileViewError(tile,view);
   const source=h.fixture.records.flatMap((r:{lhWorld:number[][]})=>r.lhWorld).map((v:number[])=>Vector3.FromArray(v));if(planes.every(p=>source.some((v:Vector3)=>p.dotCoordinate(v)>=0)))assert.equal(view.inView,true,'conservative bounds must not cull visible geometry');
   for(const record of h.fixture.records){const mesh=h.meshes().find(m=>m.name===record.name)!;for(const[i,p]of vertices(mesh).entries()){const actual=Vector3.TransformCoordinates(p,matrix),oracle=Vector3.TransformCoordinates(Vector3.FromArray(record.lhWorld[i]),matrix);maximumNdc=Math.max(maximumNdc,Vector3.Distance(actual,oracle));cameraChecks++;}}
  }
  assert.ok(maximumNdc<.001,`NDC ${maximumNdc}`);
  const origin=h.meshes().find(m=>m.name==='marker-origin')!.getAbsolutePosition();for(const name of ['marker-east','marker-up','marker-north'])assert.ok(Math.abs(Vector3.Distance(origin,h.meshes().find(m=>m.name===name)!.getAbsolutePosition())-1)<.001);
  const normals=h.meshes().map(m=>m.computeWorldMatrix(true).determinant());assert.ok(normals.every(v=>v<0));
  if(name.startsWith('nested')){assert.equal(h.requests.length,3);assert.equal(h.events.filter(e=>e==='load-tileset').length,2);assert.ok(h.requests.some(u=>u.endsWith('nested/tileset.json?session=fixture-session')));}
  h.renderer.dispose();assert.equal(h.scene.meshes.length,0);assert.equal(h.scene.transformNodes.length,0);
  results[name]={requests:h.requests.length,vertices:checks,maximumVertexErrorM:maximum,ndcChecks:cameraChecks,maximumNdcError:maximumNdc,axis:tile.engineData.upAxis,disposedMeshes:0};await save();
 }finally{h.dispose();}
});

test('double rebase retains centimetres at Earth magnitude and rejects the premature Float32 negative control',async()=>{
 const frame=new ECEFLocalFrame({latitudeDegrees:0,longitudeDegrees:0,ellipsoidHeightM:0}),raw=translation([6378137.1234,0,0]),correct=Vector3.TransformCoordinates(Vector3.Zero(),Matrix.FromArray(frame.matrix(raw)));
 assert.ok(Math.abs(correct.y-.1234)<1e-8);const wrong=Matrix.FromArray(raw).multiply(Matrix.Translation(-6378137,0,0));assert.ok(Math.abs(Vector3.TransformCoordinates(Vector3.Zero(),wrong).x-.1234)>.1);
 results.negativeFloatBeforeRebase={expectedM:.1234,correctM:correct.y,incorrectM:Vector3.TransformCoordinates(Vector3.Zero(),wrong).x};await save();
});

test('curved geographic region bounds conservatively contain fractional WGS84 samples, dateline and poles; tile transform is ignored',async()=>{
 const regions=[[-1.4,.449,-1.399,.450,-20,230],[3.13,-.03,-3.13,.02,-100,400],[-Math.PI,-Math.PI/2,Math.PI,Math.PI/2,-500,9000],[-2,1.5,1,Math.PI/2,0,500],[-2,-Math.PI/2,1,-1.5,-50,800]],frame=new ECEFLocalFrame(expected.origin);let checks=0;
 for(const r of regions){const corners=geographicRegionCorners(r),lo=[0,1,2].map(i=>Math.min(...corners.map(c=>c[i]))),hi=[0,1,2].map(i=>Math.max(...corners.map(c=>c[i]))),east=r[2]<r[0]?r[2]+2*Math.PI:r[2];
  const b=new LocalTileBounds({region:r},translation([1e8,-1e8,1e8]),frame),same=new LocalTileBounds({region:r},identity(),frame);assert.deepEqual(b.obb!.points.map(v=>v.asArray()),same.obb!.points.map(v=>v.asArray()));
  for(let i=0;i<=20;i++)for(let j=0;j<=20;j++)for(const k of [0,.37,1]){const p=wgs84ECEF(r[1]+(r[3]-r[1])*i/20,r[0]+(east-r[0])*j/20,r[4]+(r[5]-r[4])*k);for(let c=0;c<3;c++)assert.ok(p[c]>=lo[c]-1e-7&&p[c]<=hi[c]+1e-7,`region ${r}, axis ${c}`);checks++;}
 }
 results.regions={regions:regions.length,samples:checks,tileTransformIgnored:true};await save();
});


test('malformed ellipsoid origin and longitude ranges fail before any bounds iteration',()=>{
 assert.throws(()=>new ECEFLocalFrame({latitudeDegrees:25,longitudeDegrees:-80} as never),/finite/);
 for(const longitude of [1e30,-1e30,Math.PI+.001])assert.throws(()=>geographicRegionCorners([longitude,-.1,longitude,.1,0,1]),/longitudes/);
});
