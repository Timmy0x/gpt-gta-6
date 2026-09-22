import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {VertexData} from '@babylonjs/core';
import polygonClipping from 'polygon-clipping';
import {miamiRectangle} from '../vendor/world/miami/MiamiGeometry';
import {CommonFrame,PROVISIONAL_POLICY,type Point} from '../src/CommonFrame';
import {legacyHorizontalToGeographic,createDemSampler,createCommonSurfaceQuery} from '../src/SourceCoordinates';
import {projectMiami} from '../vendor/world/miami/projection';
import {buildMiamiRoads} from '../vendor/world/miami/MiamiRoads';
import {buildMiamiTerrain,createMiamiDryCoverage} from '../vendor/world/miami/MiamiTerrain';
import {createMiamiElevationSampler} from '../vendor/world/miami/MiamiElevation';
import {insideMiamiPolygon} from '../vendor/world/miami/MiamiQueries';
import {validateMiamiManifest,decodeMiamiChunk,type MiamiPackedMesh,type MiamiPackageManifest} from '../vendor/world/miami/MiamiPackages';
import type {MiamiDataset,MiamiMeshRecord} from '../vendor/world/miami/types';
const root=new URL('../',import.meta.url),data=new URL('data/',root),output=new URL('output/',root);
const json=async(name:string)=>JSON.parse(await readFile(new URL(name,data),'utf8'));
const sha=(b:Uint8Array|string)=>createHash('sha256').update(b).digest('hex');
const [preparation,grid,geoid,source,sourceManifest,dataset]=await Promise.all(['preparation.json','terrain/grid.json','geoid18.json','i3s-geographic.json','manifest.json','dataset-r5.json'].map(json));
const frame=new CommonFrame(geoid,PROVISIONAL_POLICY),heightsBytes=await readFile(new URL('terrain/heights.f32',data)),maskBytes=await readFile(new URL('terrain/source-mask.u8',data)),sourceBytes=await readFile(new URL('i3s-geographic.bin',data));
if(sha(heightsBytes)!==grid.sha256||sha(maskBytes)!==grid.sourceMaskSha256||sha(sourceBytes)!==source.sha256)throw new Error('Public input checksum mismatch');
const heights=new Float32Array(heightsBytes.buffer.slice(heightsBytes.byteOffset,heightsBytes.byteOffset+heightsBytes.byteLength));
const dem=createMiamiElevationSampler(grid,heights),sample=createDemSampler(grid,heights,maskBytes);
const bbox=(preparation.surfaceBboxWgs84??preparation.bboxWgs84) as number[],corners=[[bbox[0],bbox[1]],[bbox[2],bbox[1]],[bbox[2],bbox[3]],[bbox[0],bbox[3]]].map(([lon,lat])=>projectMiami(lon,lat));
const bounds={minX:Math.min(...corners.map(p=>p[0])),maxX:Math.max(...corners.map(p=>p[0])),minZ:Math.min(...corners.map(p=>p[2])),maxZ:Math.max(...corners.map(p=>p[2]))};
const subset:MiamiDataset={...dataset,bounds};
const heightOptions={heightAt:dem.heightAt,coverage:dem.coverage,maximumEdgeM:2,tileM:180},dry=createMiamiDryCoverage(subset,heightOptions);
const isDry=(lon:number,lat:number)=>{const p=projectMiami(lon,lat);return dry.polygons.some(poly=>insideMiamiPolygon(p[0],p[2],poly));};
const surface=createCommonSurfaceQuery(frame,sample,isDry);
const roads=subset.roads.filter(r=>!r.unavailableReason&&!r.bridge&&!r.tunnel&&r.layer===0);
type RecordSource=MiamiMeshRecord&{render?:boolean;navd88:number[];featureIds:string[];sourceGeometry?:unknown};
const records:RecordSource[]=[],commonRoads:unknown[]=[],numericSamples:unknown[]=[];
let maxFloat32ErrorM=0,removedDegenerateTriangles=0;
for(const record of [...buildMiamiRoads(roads,{bounds,...heightOptions,dryCoverage:dry}),...buildMiamiTerrain(subset,heightOptions).filter(r=>r.kind!=='waterbed')]){
 const positions:number[]=[],navd88:number[]=[];
 for(let i=0;i<record.positions.length;i+=3){const p=record.positions.slice(i,i+3),g=legacyHorizontalToGeographic(p[0],p[2]),out=frame.navd88ToLocal(g.longitude,g.latitude,p[1]);positions.push(...out);navd88.push(p[1]);}
 const normals:number[]=[];VertexData.ComputeNormals(positions,record.indices,normals);
 const featureIds=record.kind==='terrain'?['usgs-3dep-brickell-r1']:roads.filter(r=>r.centerline.some((p,i)=>{const q=r.centerline[Math.min(i+1,r.centerline.length-1)];return Math.min(p[0],q[0])-r.widthM<=bounds.maxX&&Math.max(p[0],q[0])+r.widthM>=bounds.minX&&Math.min(p[2],q[2])-r.widthM<=bounds.maxZ&&Math.max(p[2],q[2])+r.widthM>=bounds.minZ;})).map(r=>r.id);
 records.push({...record,positions,normals,navd88,featureIds,sourceGeometry:{method:'Pinned R5 dry geometry, exact inverse of legacy horizontal projection then common frame; NAVD88 vertex ordinates retained',maximumSurfaceEdgeM:2},gaps:[...record.gaps,PROVISIONAL_POLICY.unresolved]});
}
for(const building of source.buildings){
 const positions:number[]=[],sourceNormals:number[]=[],navd88:number[]=[],indices:number[]=[],uvs:number[]=[],memo=new Map<string,number>();
 for(let v=0;v<building.vertices;v++){
  const offset=building.byteOffset+v*building.strideBytes,lon=sourceBytes.readDoubleLE(offset),lat=sourceBytes.readDoubleLE(offset+8),H=sourceBytes.readDoubleLE(offset+16),p=frame.navd88ToLocal(lon,lat,H),normal=frame.direction([sourceBytes.readFloatLE(offset+24),sourceBytes.readFloatLE(offset+28),sourceBytes.readFloatLE(offset+32)]);
  const key=[...p,...normal].join(',');let n=memo.get(key);if(n===undefined){n=positions.length/3;memo.set(key,n);positions.push(...p);sourceNormals.push(...normal);navd88.push(H);uvs.push(0,0);}indices.push(n);
  if(v===0)numericSamples.push({id:building.id,longitude:lon,latitude:lat,navd88M:H,geoidM:frame.geoidAt(lon,lat),local:p});
 }
 const kept:number[]=[];
 for(let i=0;i<indices.length;i+=3){let [a,b,c]=indices.slice(i,i+3);const pa=positions.slice(a*3,a*3+3),pb=positions.slice(b*3,b*3+3),pc=positions.slice(c*3,c*3+3),u=pb.map((v,k)=>v-pa[k]),v=pc.map((v,k)=>v-pa[k]),cross=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
  if(Math.hypot(...cross)<1e-12){removedDegenerateTriangles++;continue;}
  // Babylon LH ComputeNormals uses the opposite mathematical triangle cross.
  const agreement=cross.reduce((sum,n,k)=>sum+n*(sourceNormals[a*3+k]+sourceNormals[b*3+k]+sourceNormals[c*3+k]),0);
  if(agreement>0)[b,c]=[c,b];kept.push(a,b,c);
 }
 const normals:number[]=[];VertexData.ComputeNormals(positions,kept,normals);
 records.push({id:building.id,kind:'building',material:'public-survey-volume',collision:true,render:false,friction:.8,restitution:0,positions,normals,indices:kept,uvs,navd88,featureIds:[building.sourceUniqueId],sourceIds:['county-i3s-buildings'],confidence:'mapped',sourceGeometry:{sourceObjectId:building.sourceObjectId,node:building.node,yearUpdated:building.yearUpdated,sourceArchiveSha256:source.sourceArchive.sha256,method:'Original I3S Float32 geographic offsets plus node MBS decoded directly to Float64 longitude/latitude/NAVD88; complete selected feature faces retained except zero-area triangles'},gaps:[PROVISIONAL_POLICY.unresolved,'County 2015 source massing; modern entrances, facade details and cross-source physical correspondence remain unverified.']});
}
for(const road of roads){const points=road.centerline.map(([x,H,z])=>{const g=legacyHorizontalToGeographic(x,z);return {longitude:g.longitude,latitude:g.latitude,navd88M:H,point:frame.navd88ToLocal(g.longitude,g.latitude,H)};});commonRoads.push({...road,centerline:points.map(p=>p.point),sourceCenterline:points});}
const groups=new Map<string,RecordSource[]>();
for(const record of records){let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;for(let i=0;i<record.positions.length;i+=3){minX=Math.min(minX,record.positions[i]);maxX=Math.max(maxX,record.positions[i]);minZ=Math.min(minZ,record.positions[i+2]);maxZ=Math.max(maxZ,record.positions[i+2]);}const cx=(minX+maxX)/2,cz=(minZ+maxZ)/2,key=`${Math.floor(cx/180)},${Math.floor(cz/180)}`;const group=groups.get(key)??[];group.push(record);groups.set(key,group);}
await mkdir(new URL('chunks/',output),{recursive:true});
const manifest:MiamiPackageManifest&{frame:unknown;coverage:unknown;exclusions:unknown;provenance:unknown}={version:1,worldId:'brickell-public-common-frame-r2',totalBytes:0,chunks:[],frame:{origin:frame.origin,originECEF:frame.originECEF,axes:'x East,y Up,z North',policy:PROVISIONAL_POLICY,geoid18:geoid},coverage:{sourceBboxWgs84:bbox,buildings:'Whole source features intersecting bbox; some extend outside surface AOI',surfaces:'Exact pinned old-horizontal AOI rectangle, DEM coverage minus City mapped water; not a playable global boundary'},exclusions:{roads:subset.roads.filter(r=>r.unavailableReason||r.bridge||r.tunnel||r.layer!==0).map(r=>({id:r.id,name:r.name,reason:r.unavailableReason??'No verified bridge/tunnel/elevated-road surface profile'})),water:subset.water.map(w=>({id:w.id,reason:'Water surface and unmeasured bed are not collision support'})),inventedWaterbeds:0,removedDegenerateTriangles},provenance:{sources:sourceManifest.sources,geographicSource:source.source,sourceArchive:source.sourceArchive,preparationSha256:sha(await readFile(new URL('preparation.json',data))),sourceHeightDatum:'NAVD88 metres; per-vertex H retained as Float32 sidecar, original geographic inputs Float64',maximumFloat32PositionErrorM:0}};
for(const [id,group] of [...groups].sort(([a],[b])=>a.localeCompare(b))){
 const chunkOrigin:Point=[(Number(id.split(',')[0])+.5)*180,-25,(Number(id.split(',')[1])+.5)*180],buffers:Buffer[]=[],meshes:MiamiPackedMesh[]=[],chunkBounds={minX:Infinity,maxX:-Infinity,minZ:Infinity,maxZ:-Infinity};let offset=0;
 const add=(values:number[],integer=false)=>{const b=Buffer.alloc(values.length*4);values.forEach((v,i)=>integer?b.writeUInt32LE(v,i*4):b.writeFloatLE(v,i*4));buffers.push(b);const slice={offset,count:values.length};offset+=b.length;return slice;};
 for(const record of group){
  const local=record.positions.map((v,i)=>v-chunkOrigin[i%3]),local32=local.map(Math.fround),box={minX:Infinity,maxX:-Infinity,minZ:Infinity,maxZ:-Infinity};
  for(let i=0;i<local.length;i+=3){maxFloat32ErrorM=Math.max(maxFloat32ErrorM,Math.hypot(...[0,1,2].map(k=>local[i+k]-local32[i+k])));const x=local32[i]+chunkOrigin[0],z=local32[i+2]+chunkOrigin[2];box.minX=Math.min(box.minX,x);box.maxX=Math.max(box.maxX,x);box.minZ=Math.min(box.minZ,z);box.maxZ=Math.max(box.maxZ,z);}
  const {positions,normals,indices,uvs,navd88,...meta}=record;
  const packed={...meta,render:false,origin:chunkOrigin,bounds:box,positions:add(local32),normals:add(normals),uvs:add(uvs),indices:add(indices,true),navd88:add(navd88),framePolicyId:PROVISIONAL_POLICY.id};meshes.push(packed);
  chunkBounds.minX=Math.min(chunkBounds.minX,box.minX);chunkBounds.maxX=Math.max(chunkBounds.maxX,box.maxX);chunkBounds.minZ=Math.min(chunkBounds.minZ,box.minZ);chunkBounds.maxZ=Math.max(chunkBounds.maxZ,box.maxZ);
 }
 const binary=Buffer.concat(buffers),hash=sha(binary),url=`chunks/${id}.${hash.slice(0,12)}.bin`,chunk={id,url,sha256:hash,bytes:binary.length,bounds:chunkBounds,chunkOrigin,meshes};
 decodeMiamiChunk(chunk,binary.buffer.slice(binary.byteOffset,binary.byteOffset+binary.byteLength));manifest.chunks.push(chunk);manifest.totalBytes+=binary.length;await writeFile(new URL(url,output),binary);
}
(manifest.provenance as {maximumFloat32PositionErrorM:number}).maximumFloat32PositionErrorM=maxFloat32ErrorM;
validateMiamiManifest(manifest);
const locations=[];for(const [name,lon,lat] of [['Brickell Avenue at SE 8th Street',-80.1907224560056,25.7661748271726],['SE 8th Street west continuation',-80.192,25.76635],['Brickell Avenue south continuation',-80.191,25.7652]] as const){const h=sample(lon,lat);if(!h||!isDry(lon,lat))continue;const point=frame.navd88ToLocal(lon,lat,h.navd88M),resolved=surface(point[0],point[2]);if(!resolved)throw new Error('Declared dry source location query failed');locations.push({name,longitude:lon,latitude:lat,navd88M:h.navd88M,point,source:'City source junction or labelled nearby geographic query; not an automatic safe spawn',sourceMask:h.usesOlderFallback?'older-fallback':'D23'});numericSamples.push({id:name,longitude:lon,latitude:lat,navd88M:h.navd88M,local:point});}
await writeFile(new URL('packages.json',output),JSON.stringify(manifest,null,2)+'\n');
await writeFile(new URL('coordinates.json',output),JSON.stringify({frame:manifest.frame,roads:commonRoads,locations,dryCoverageLegacy:dry,sourceSurfaceBounds:bounds,numericalSamples:numericSamples},null,2)+'\n');
const convertXZ=(p:number[],H=0)=>{const g=legacyHorizontalToGeographic(p[0],p[1]),point=frame.navd88ToLocal(g.longitude,g.latitude,H);return [point[0],point[2]] as [number,number];};
const convertPolygon=(polygon:number[][][],H=0)=>polygon.map(r=>r.map(p=>convertXZ(p,H)));
const commonDry=dry.polygons.map(p=>convertPolygon(p)),dryPoints=commonDry.flat(2),commonBounds={minX:Math.min(...dryPoints.map(p=>p[0])),maxX:Math.max(...dryPoints.map(p=>p[0])),minZ:Math.min(...dryPoints.map(p=>p[1])),maxZ:Math.max(...dryPoints.map(p=>p[1]))};
const clippedRoads:MiamiDataset['roads']=[];
for(const road of roads){let parts:Point[][]=[],part:Point[]=[];const flush=()=>{if(part.length>1)parts.push(part);part=[];};
 for(let i=1;i<road.centerline.length;i++){const a=road.centerline[i-1],b=road.centerline[i],dx=b[0]-a[0],dz=b[2]-a[2];let lo=0,hi=1,valid=true;
  for(const [p,q] of [[-dx,a[0]-bounds.minX],[dx,bounds.maxX-a[0]],[-dz,a[2]-bounds.minZ],[dz,bounds.maxZ-a[2]]]){if(Math.abs(p)<1e-12){if(q<0)valid=false;continue;}const t=q/p;if(p<0)lo=Math.max(lo,t);else hi=Math.min(hi,t);}
  if(!valid||lo>=hi){flush();continue;}const at=(t:number):Point=>{const x=a[0]+dx*t,z=a[2]+dz*t;return [x,dem.heightAt(x,z),z];};const start=at(lo),end=at(hi);
  if(part.length&&Math.hypot(part.at(-1)![0]-start[0],part.at(-1)![2]-start[2])>.001)flush();if(!part.length)part.push(start);part.push(end);if(hi<1)flush();
 }flush();
 parts.forEach((line,i)=>clippedRoads.push({...road,id:`${road.id}/common-${i}`,centerline:line.map(([x,H,z])=>{const g=legacyHorizontalToGeographic(x,z);return frame.navd88ToLocal(g.longitude,g.latitude,H);}),gaps:[...road.gaps,PROVISIONAL_POLICY.unresolved]}));
}
const selectedIds=new Set(source.buildings.map((b:any)=>b.id));
const commonBuildings=subset.buildings.filter(b=>b.mappedMeshId&&selectedIds.has(b.mappedMeshId)).map(b=>{const p=b.footprint[0][0],g=legacyHorizontalToGeographic(p[0],p[1]),ground=frame.navd88ToLocal(g.longitude,g.latitude,b.groundM)[1];return {...b,groundM:ground,footprint:convertPolygon(b.footprint,b.groundM),gaps:[...b.gaps,PROVISIONAL_POLICY.unresolved]};});
const commonWater=subset.water.map(w=>({...w,polygons:polygonClipping.intersection(w.polygons,miamiRectangle(bounds.minX,bounds.minZ,bounds.maxX,bounds.maxZ)).map(p=>convertPolygon(p,w.elevationM)),gaps:[...w.gaps,'Excluded from collision and gameplay support']})).filter(w=>w.polygons.length);
const commonDataset={...subset,id:manifest.worldId,origin:{latitude:frame.origin.latitudeDegrees,longitude:frame.origin.longitudeDegrees,elevationM:0},bounds:commonBounds,roads:clippedRoads,buildings:commonBuildings,land:[{id:'common-dry-ground',name:'Public Brickell ground',polygons:commonDry,elevationM:-25,confidence:'mapped',sourceIds:dry.sourceIds,gaps:[...dry.gaps,'Use runtime query for local Up; elevationM is not the DEM field',PROVISIONAL_POLICY.unresolved]}],water:commonWater,municipalBoundary:undefined,coordinateFrame:manifest.frame,waterExclusionFeatures:commonWater,locations};
await writeFile(new URL('dataset.json',output),JSON.stringify(commonDataset,null,2)+'\n');
await mkdir(new URL('terrain/',output),{recursive:true});await writeFile(new URL('terrain/heights.f32',output),heightsBytes);await writeFile(new URL('terrain/source-mask.u8',output),maskBytes);await writeFile(new URL('terrain/grid.json',output),JSON.stringify(grid)+'\n');
await writeFile(new URL('runtime-query.json',output),JSON.stringify({version:1,worldId:manifest.worldId,policyId:PROVISIONAL_POLICY.id,geoid,grid,dryCoverageLegacy:dry,heightsUrl:'terrain/heights.f32',maskUrl:'terrain/source-mask.u8'},null,2)+'\n');
console.log(JSON.stringify({chunks:manifest.chunks.length,meshes:records.length,buildings:source.buildings.length,triangles:records.reduce((s,r)=>s+r.indices.length/3,0),bytes:manifest.totalBytes,maxFloat32ErrorM,removedDegenerateTriangles,locations:locations.length}));
