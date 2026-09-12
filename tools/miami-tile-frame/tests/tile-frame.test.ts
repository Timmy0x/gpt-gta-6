import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {Frustum,Material,Matrix,Quaternion,UniversalCamera,Vector3,VertexBuffer} from '@babylonjs/core';
import {expected,glb,loadFixture,placeCanonical,vertices,fixtureError,mirror,matrixProduct,transform} from './frame-fixture';
const epsilon=2e-5,metrics:Record<string,unknown>={babylon:'9.25.0',method:'Actual original GLB loader plus CPU world/projection/bounds/indexed-winding tests; no GPU raster or provider/geodesy claims.'};
async function save(){await mkdir(new URL('../evidence/',import.meta.url),{recursive:true});await writeFile(new URL('../evidence/result.json',import.meta.url),JSON.stringify(metrics,null,2)+'\n');}

test('original asymmetric GLB imports hierarchy and metre markers with exactly one automatic conversion',async()=>{
 assert.equal(createHash('sha256').update(glb).digest('hex'),expected.glbSha256);
 for(const rh of [false,true]){const f=await loadFixture(rh);try{
  assert.equal(f.meshes.length,6);assert.equal(f.scene.useRightHandedSystem,rh);
  const c=f.root.computeWorldMatrix(true);for(const [p,target]of [[[1,0,0],[rh?1:-1,0,0]],[[0,1,0],[0,1,0]],[[0,0,1],[0,0,1]]] as number[][][]){assert.ok(Vector3.Distance(Vector3.TransformCoordinates(Vector3.FromArray(p),c),Vector3.FromArray(target))<1e-7);}
  for(const r of expected.records){const mesh=f.meshes.find(m=>m.name===r.name)!;for(const [i,p]of vertices(mesh).entries()){const v=r.gltfWorld[i];assert.ok(Vector3.Distance(p,new Vector3(rh?v[0]:-v[0],v[1],v[2]))<epsilon,`${rh}/${r.name}`);}}
  const o=f.meshes.find(m=>m.name==='marker-origin')!.getAbsolutePosition();for(const n of ['marker-east','marker-up','marker-north'])assert.ok(Math.abs(Vector3.Distance(o,f.meshes.find(m=>m.name===n)!.getAbsolutePosition())-1)<1e-7);
 }finally{f.dispose();}}
 metrics.loader={meshes:6,vertices:72,triangles:24,rootAutoLH:'diag(-1,1,1)',rootAutoRH:'identity',markerDistancesM:[1,1,1]};await save();
});

test('nested tile placement matches independent world-coordinate oracle and conservative bounds in both modes',async()=>{
 let maximumError=0,maximumBoundsError=0;for(const rh of [false,true]){const f=await loadFixture(rh);try{
  placeCanonical(f);maximumError=Math.max(maximumError,fixtureError(f));assert.ok(maximumError<epsilon,`${rh} ${maximumError}`);
  for(const r of expected.records){const mesh=f.meshes.find(m=>m.name===r.name)!,b=mesh.getBoundingInfo().boundingBox;
   const min=[0,1,2].map(c=>Math.min(...r.sourcePositions.filter((_,i)=>i%3===c))),max=[0,1,2].map(c=>Math.max(...r.sourcePositions.filter((_,i)=>i%3===c)));
   const world=matrixProduct(expected.combined,r.nodeWorld),corners=[];for(let i=0;i<8;i++){const p=transform(world,[i&1?max[0]:min[0],i&2?max[1]:min[1],i&4?max[2]:min[2]]);if(!rh)p[2]*=-1;corners.push(p);}
   for(let c=0;c<3;c++)maximumBoundsError=Math.max(maximumBoundsError,Math.abs(b.minimumWorld.asArray()[c]-Math.min(...corners.map(p=>p[c]))),Math.abs(b.maximumWorld.asArray()[c]-Math.max(...corners.map(p=>p[c]))));
   for(const p of vertices(mesh))for(let c=0;c<3;c++)assert.ok(p.asArray()[c]>=b.minimumWorld.asArray()[c]-epsilon&&p.asArray()[c]<=b.maximumWorld.asArray()[c]+epsilon);
  }
  const o=f.meshes.find(m=>m.name==='marker-origin')!.getAbsolutePosition();for(const n of ['marker-east','marker-up','marker-north'])assert.ok(Math.abs(Vector3.Distance(o,f.meshes.find(m=>m.name===n)!.getAbsolutePosition())-1)<epsilon);
 }finally{f.dispose();}}
 assert.ok(maximumBoundsError<epsilon);metrics.world={maximumErrorM:maximumError,maximumBoundsErrorM:maximumBoundsError,toleranceM:epsilon};await save();
});

test('loaded meshes match NDC, depth, indexed winding, normals and frusta across 54 camera configurations',async()=>{
 const lh=await loadFixture(false),rh=await loadFixture(true);try{placeCanonical(lh);placeCanonical(rh);
  const origin=Vector3.FromArray(expected.records.find(r=>r.name==='marker-origin')!.rhWorld[0]);
  const a=new UniversalCamera('LH-camera',Vector3.Zero(),lh.scene),b=new UniversalCamera('RH-camera',Vector3.Zero(),rh.scene);let configurations=0,pointChecks=0,triangleChecks=0,boundsChecks=0,maxNdc=0,maxNormals=0,visibleBounds=0,culledBounds=0;
  for(const offset of [[10,4,-12],[-13,4,6],[1,17,4],[5,1,10],[-4,1,-8],[20,8,20]])for(const fov of [.88,.44,.11])for(const aspect of [16/9,1,9/16]){
   b.position.copyFrom(origin.add(Vector3.FromArray(offset)));a.position.copyFrom(mirror(b.position));b.setTarget(origin);a.setTarget(mirror(origin));for(const c of [a,b]){c.minZ=.12;c.maxZ=1500;c.fov=fov;}
   a.freezeProjectionMatrix(Matrix.PerspectiveFovLH(fov,aspect,.12,1500));b.freezeProjectionMatrix(Matrix.PerspectiveFovRH(fov,aspect,.12,1500));
   const ma=a.getViewMatrix(true).multiply(a.getProjectionMatrix()),mb=b.getViewMatrix(true).multiply(b.getProjectionMatrix()),fa=Frustum.GetPlanes(ma),fb=Frustum.GetPlanes(mb);configurations++;
   for(const r of expected.records){const x=lh.meshes.find(m=>m.name===r.name)!,y=rh.meshes.find(m=>m.name===r.name)!,nx=vertices(x).map(p=>Vector3.TransformCoordinates(p,ma)),ny=vertices(y).map(p=>Vector3.TransformCoordinates(p,mb));
    for(let i=0;i<nx.length;i++){maxNdc=Math.max(maxNdc,Vector3.Distance(nx[i],ny[i]));pointChecks++;}
    const indices=x.getIndices()!;assert.deepEqual(Array.from(indices),Array.from(y.getIndices()!));
    const signed=(points:Vector3[],i:number)=>{const[p,q,r]=[0,1,2].map(j=>points[indices[i+j]]);return(q.x-p.x)*(r.y-p.y)-(q.y-p.y)*(r.x-p.x);};
    for(let i=0;i<indices.length;i+=3){const sx=signed(nx,i),sy=signed(ny,i);if(Math.abs(sx)>1e-9&&Math.abs(sy)>1e-9)assert.equal(Math.sign(sx),Math.sign(sy));triangleChecks++;}
    const visibleX=x.getBoundingInfo().isInFrustum(fa),visibleY=y.getBoundingInfo().isInFrustum(fb);assert.equal(visibleX,visibleY,`bounds ${r.name}`);boundsChecks++;if(visibleX)visibleBounds++;else culledBounds++;
    const effective=(m:typeof x)=>{let o=m.material?.sideOrientation??m.sideOrientation;if(m.getWorldMatrix().determinant()<0)o=o===Material.ClockWiseSideOrientation?Material.CounterClockWiseSideOrientation:Material.ClockWiseSideOrientation;return o;};assert.equal(effective(x),effective(y));
    const data=x.getVerticesData(VertexBuffer.NormalKind)!,normalX=x.getWorldMatrix().clone().invert().transpose(),normalY=y.getWorldMatrix().clone().invert().transpose();
    for(let i=0;i<data.length;i+=3){const n=Vector3.FromArray(data,i),u=Vector3.TransformNormal(n,normalX).normalize(),v=Vector3.TransformNormal(n,normalY).normalize();maxNormals=Math.max(maxNormals,Vector3.Distance(u,mirror(v)));}
   }
  }
  assert.equal(configurations,54);assert.ok(maxNdc<2e-4,`NDC ${maxNdc}`);assert.ok(maxNormals<2e-5);assert.ok(visibleBounds>0&&culledBounds>0,'both visible and culled bounds');
  metrics.camera={configurations,pointChecks,triangleChecks,boundsChecks,visibleBounds,culledBounds,maximumNdcDistance:maxNdc,maximumNormalDistance:maxNormals,limit:'CPU projection/culling only; GPU depth/front-face/postprocess still need renderer tests.'};await save();
 }finally{lh.dispose();rh.dispose();}
});

test('negative controls reject duplicated conversion, overwritten root rotation, reversed tiles and missing up-axis',async()=>{
 const failures:Record<string,number>={};for(const mode of ['double-importer-conversion','reverse-tiles','omit-up'] as const){const f=await loadFixture(false);try{placeCanonical(f,mode);failures[mode]=fixtureError(f);assert.ok(failures[mode]>.25,mode);}finally{f.dispose();}}
 const f=await loadFixture(false);try{placeCanonical(f);f.root.rotationQuaternion=Quaternion.Identity();for(const mesh of f.meshes)mesh.computeWorldMatrix(true);failures['overwritten-auto-root-quaternion']=fixtureError(f);assert.ok(failures['overwritten-auto-root-quaternion']>1);}finally{f.dispose();}
 metrics.negativeControls={rejectedErrorsM:failures};await save();
});


test('serialized tile hierarchy encloses complete child bounds and rejects an undersized box',async()=>{
 const tileset=JSON.parse(await readFile(new URL('../fixtures/tileset.json',import.meta.url),'utf8'));
 assert.equal(tileset.asset.version,'1.1');assert.equal(tileset.asset.gltfUpAxis,'Y');assert.equal(tileset.root.refine,'REPLACE');
 const parent=tileset.root,child=parent.children[0];assert.equal(child.content.uri,'asymmetric.glb');assert.deepEqual(parent.transform,expected.tileParent);assert.deepEqual(child.transform,expected.tileChild);
 const inside=(box:number[],p:number[])=>[0,1,2].every(i=>Math.abs(p[i]-box[i])<=box[[3,7,11][i]]+1e-9);
 const childBox=child.boundingVolume.box as number[],parentBox=parent.boundingVolume.box as number[];
 const source=expected.records.flatMap(r=>r.gltfWorld).map(p=>transform(expected.up,p));assert.ok(source.every(p=>inside(childBox,p)));
 const corners=Array.from({length:8},(_,i)=>[childBox[0]+(i&1?1:-1)*childBox[3],childBox[1]+(i&2?1:-1)*childBox[7],childBox[2]+(i&4?1:-1)*childBox[11]]);
 assert.ok(corners.every(p=>inside(parentBox,transform(child.transform,p))),'parent bounds must contain the whole transformed child box, not just its mesh');
 const wrong=childBox.slice();wrong[3]*=.5;assert.ok(source.some(p=>!inside(wrong,p)),'undersized box is detected');
 metrics.tileBounds={sourceVertices:source.length,childCorners:corners.length,parentContainsWholeChild:true,undersizedNegativeControlRejected:true};await save();
});
