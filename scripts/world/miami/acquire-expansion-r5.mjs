/** One bounded north-adjacent public GIS preparation; never writes the accepted dataset. */
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const repository=new URL('../../../',import.meta.url),root=new URL('data/world/miami/expansions/downtown-edge-r5/',repository);
const bbox=[-80.199,25.7704,-80.193,25.7758];
const maximum={networkRequests:350,downloadBytes:40*1024*1024,nodes:160,featuresPerSource:1500};
const requests=[],started=new Date().toISOString();let networkCount=0,downloadBytes=0;
const hash=b=>createHash('sha256').update(b).digest('hex');
await mkdir(root,{recursive:true});
// This cohort is immutable after completion. Re-running must not reset retrieval dates/counts
// or silently mix upstream versions; a new extent/cohort needs a separate output folder.
let completed;
try{completed=JSON.parse(await readFile(new URL('manifest.json',root),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
if(completed?.completed){
 for(const request of completed.requests)if(hash(await readFile(new URL(request.path,root)))!==request.sha256)throw new Error(`Retained public response hash mismatch: ${request.path}`);
 const retainedI3S=JSON.parse(await readFile(new URL('i3s/manifest.json',root),'utf8'));
 if(retainedI3S.archive&&hash(await readFile(new URL('i3s/'+retainedI3S.archive.path,root)))!==retainedI3S.archive.sha256)throw new Error('Retained I3S archive hash mismatch');
 console.log(JSON.stringify({retainedCohortVerified:true,completed:completed.completed,networkRequests:0,policy:'Use a separately named output cohort for changed upstream data or extent'}));
 process.exit(0);
}
async function get(url,path,json=true){
 const file=new URL(path,root);await mkdir(new URL('./',file),{recursive:true});
 let bytes,usedCache=false;
 try{bytes=await readFile(file);usedCache=true;}catch{
  if(++networkCount>maximum.networkRequests)throw new Error('Public acquisition request budget exceeded');
  const response=await fetch(url,{signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw new Error(`Public source HTTP${response.status}: ${url}`);
  const advertised=Number(response.headers.get('content-length'));
  if(Number.isFinite(advertised)&&advertised+downloadBytes>maximum.downloadBytes)throw new Error('Public acquisition byte budget exceeded');
  bytes=Buffer.from(await response.arrayBuffer());downloadBytes+=bytes.length;
  if(downloadBytes>maximum.downloadBytes)throw new Error('Public acquisition byte budget exceeded');
  if(bytes[0]===31&&bytes[1]===139)bytes=gunzipSync(bytes);
  if(bytes.length>maximum.downloadBytes)throw new Error('Decompressed public payload exceeded budget');
  if(json){const parsed=JSON.parse(bytes.toString());if(parsed.error)throw new Error(JSON.stringify(parsed.error));}
  await writeFile(file,bytes);
 }
 requests.push({url,path,sha256:hash(bytes),bytes:bytes.length,retrieved:usedCache?'retained acquisition at '+started:new Date().toISOString()});
 const value=json?JSON.parse(bytes.toString()):bytes;if(value.error)throw new Error(JSON.stringify(value.error));return value;
}
const previous=JSON.parse(await readFile(new URL('data/world/miami/manifest.json',repository),'utf8'));
const sources=[];
for(const id of ['city-streets','city-water','city-shoreline','county-buildings']){
 const source=previous.sources.find(s=>s.id===id);if(!source)throw new Error('Unknown pinned public source');
 const item=await get(source.itemUrl,`metadata/${id}-item.json`),layer=await get(source.url+'?f=pjson',`metadata/${id}-layer.json`);
 if(item.access!=='public')throw new Error('Source is not public');
 const params={f:'json',where:'1=1',returnIdsOnly:'true',geometry:bbox.join(','),geometryType:'esriGeometryEnvelope',inSR:'4326',spatialRel:'esriSpatialRelIntersects'};
 const query=source.url+'/query?',ids=await get(query+new URLSearchParams(params),`metadata/${id}-ids.json`);
 if(ids.exceededTransferLimit||!Array.isArray(ids.objectIds)||ids.objectIds.length>maximum.featuresPerSource)throw new Error(`Unexpected ${id} feature budget/count`);
 const objectIds=[...ids.objectIds].sort((a,b)=>a-b),features=[];
 for(let offset=0;offset<objectIds.length;offset+=200){
  const result=await get(query+new URLSearchParams({f:'geojson',objectIds:objectIds.slice(offset,offset+200).join(','),outFields:'*',outSR:'4326',returnGeometry:'true'}),`raw/${id}-${offset/200}.geojson`);
  if(result.exceededTransferLimit)throw new Error(`${id} feature response truncated`);features.push(...result.features);
 }
 const field=ids.objectIdFieldName??source.objectIdField,returned=new Set(features.map(f=>f.properties[field]));
 if(returned.size!==objectIds.length||objectIds.some(id=>!returned.has(id))||features.length!==objectIds.length)throw new Error(`${id} object-ID mismatch`);
 await writeFile(new URL(`raw/${id}.geojson`,root),JSON.stringify({type:'FeatureCollection',features})+'\n');
 sources.push({id,title:item.title,url:source.url,item:source.item,itemUrl:source.itemUrl,sourceModified:new Date(item.modified).toISOString(),retrieved:new Date().toISOString(),license:source.license,licenseInfo:item.licenseInfo,attribution:item.accessInformation,spatialReference:layer.extent?.spatialReference,objectIdField:field,featureCount:features.length,path:`raw/${id}.geojson`,sha256:hash(await readFile(new URL(`raw/${id}.geojson`,root)))});
 console.log(JSON.stringify({stage:id,features:features.length,networkCount,downloadBytes}));
}
const terrainBase='https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer';
const terrainService=await get(terrainBase+'?f=pjson','terrain/service.json');
const geometry=JSON.stringify({xmin:bbox[0],ymin:bbox[1],xmax:bbox[2],ymax:bbox[3],spatialReference:{wkid:4326}});
const catalog=await get(terrainBase+'/query?'+new URLSearchParams({f:'json',where:'Category=1',geometry,geometryType:'esriGeometryEnvelope',spatialRel:'esriSpatialRelIntersects',outSR:'4326',outFields:'OBJECTID,Name,Source,VerticalDatum,AcquisitionDate,URL,Metadata,Resolution_X,Resolution_Y,ProductName,Best,StartDate,EndDate',returnGeometry:'true'}),'terrain/catalog.json');
if(catalog.exceededTransferLimit||catalog.features.length>50)throw new Error('Terrain catalog unbounded');
const rasters=catalog.features.filter(f=>f.attributes.Name==='FL_MiamiDade_D23');
if(!rasters.length||rasters.length>4||rasters.some(f=>!f.attributes.VerticalDatum.includes('NAVD 88')))throw new Error('D23 NAVD88 source not confirmed');
const mosaicRule={mosaicMethod:'esriMosaicLockRaster',lockRasterIds:rasters.map(f=>f.attributes.OBJECTID),mosaicOperation:'MT_FIRST'};
const image=await get(terrainBase+'/exportImage?'+new URLSearchParams({f:'json',bbox:bbox.join(','),bboxSR:'4326',imageSR:'4326',size:'600,540',format:'tiff',pixelType:'F32',noData:'-999999',interpolation:'RSP_BilinearInterpolation',renderingRule:JSON.stringify({rasterFunction:'None'}),mosaicRule:JSON.stringify(mosaicRule),compression:'LZ77'}),'terrain/export.json');
await get(image.href,'terrain/dem.tif',false);
const terrain={id:'usgs-3dep-downtown-edge-r5',source:terrainBase,bboxRequested:bbox,extent:image.extent,width:image.width,height:image.height,pixelType:'Float32',units:'meters',verticalDatum:'NAVD88 (EPSG:5703)',method:'Original one-meter-source D23 bare-earth samples, bilinear resampling to retained0.00001° WGS84 grid phase. No unmarked fallback, bridge deck, water support or invented fill.',selectedRasters:rasters.map(f=>f.attributes),mosaicRule,attribution:'USGS National Map3D Elevation Program(3DEP)',license:'USGS-produced public domain data',licenseUrl:'https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits',serviceSnapshot:terrainService.copyrightText};
await writeFile(new URL('terrain/manifest.json',root),JSON.stringify(terrain,null,2)+'\n');
console.log(JSON.stringify({stage:'terrain',rasters:rasters.length,width:image.width,height:image.height,networkCount,downloadBytes}));

const i3sBase='https://tiles.arcgis.com/tiles/8Pc9XBTAsYuxx9Ny/arcgis/rest/services/Buildings_Models_3D/SceneServer/layers/0';
const i3sItem=await get('https://www.arcgis.com/sharing/rest/content/items/ce420278a45a4bf4a349c37c197263b3?f=pjson','metadata/county-3d-item.json');
const layer=await get(i3sBase+'?f=pjson','metadata/county-3d-layer.json');
const retainedLayer=JSON.parse(await readFile(new URL('data/world/miami/research/county-3d-layer.json',repository),'utf8'));
if(layer.store.version!=='1.6'||layer.store.vertexCRS!=='http://www.opengis.net/def/crs/EPSG/0/4326'||layer.spatialReference.vcsWkid!==5703||layer.heightModelInfo.heightUnit!=='meter')throw new Error('Changed County I3S coordinates/schema');
const sameVersion=layer.version===retainedLayer.version;
const old=JSON.parse(await readFile(new URL('data/world/miami/i3s/manifest.json',repository),'utf8')),oldRequests=new Map(old.requests.map(r=>[r.path,r]));
const oldArchive=new URL('data/world/miami/i3s/'+old.archive.path,repository),cache=new URL('tools/miami-expansion-r5/.retained-i3s-cache/',repository);
if(sameVersion){
 if(hash(await readFile(oldArchive))!==old.archive.sha256)throw new Error('Retained source archive hash mismatch');
 await mkdir(cache,{recursive:true});execFileSync('tar',['-xzf',fileURLToPath(oldArchive),'-C',fileURLToPath(cache)]);
}
const i3sRequests=[];
async function i3s(path){
 const file=path.replaceAll('/','_')+'.bin';let bytes,retained;
 if(sameVersion&&oldRequests.has(file)){
  retained=oldRequests.get(file);bytes=await readFile(new URL(file,cache));if(hash(bytes)!==retained.sha256)throw new Error('Retained I3S request hash mismatch');
  await mkdir(new URL('i3s/',root),{recursive:true});await writeFile(new URL('i3s/'+file,root),bytes);
 }else bytes=await get(i3sBase+'/'+path,'i3s/'+file,false);
 i3sRequests.push({url:i3sBase+'/'+path,path:file,sha256:hash(bytes),bytes:bytes.length,retrieved:retained?old.retrieved:new Date().toISOString(),reusedVerifiedArchive:!!retained});return bytes;
}
function intersects(mbs){
 const lon=Math.max(bbox[0],Math.min(bbox[2],mbs[0])),lat=Math.max(bbox[1],Math.min(bbox[3],mbs[1]));
 return Math.hypot((lon-mbs[0])*100000,(lat-mbs[1])*110000)<=mbs[3]*1.03+5;
}
const pending=['root'],leaves=[];let visited=0;
while(pending.length){
 if(++visited>maximum.nodes)throw new Error('Bounded I3S node traversal exceeded');
 const node=JSON.parse((await i3s('nodes/'+pending.shift())).toString());
 if(node.children?.length)pending.push(...node.children.filter(c=>intersects(c.mbs)).map(c=>c.id));
 else if(node.geometryData?.length)leaves.push(node);
 if(visited%20===0)console.log(JSON.stringify({stage:'i3s-tree',visited,pending:pending.length,leaves:leaves.length,networkCount,downloadBytes}));
}
for(const [index,node]of leaves.entries()){
 for(const ref of [...(node.featureData??[]),...(node.geometryData??[]),...(node.attributeData??[])])await i3s(`nodes/${node.id}/${ref.href.replace('./','')}`);
 if(index%5===0)console.log(JSON.stringify({stage:'i3s-leaves',finished:index+1,total:leaves.length,networkCount,downloadBytes}));
}
const i3sManifest={source:i3sBase,item:i3sItem.id,retrieved:new Date().toISOString(),sourceModified:new Date(i3sItem.modified).toISOString(),sourceVersion:layer.version,bboxWgs84:bbox,selection:'Conservative source MBS intersection, full finest-leaf source vertices retained; no source imagery/textures requested',visited,leaves:leaves.map(n=>n.id),sameVersionAsRetained:sameVersion,license:'Miami-Dade County custom public-data as-is terms',licenseInfo:i3sItem.licenseInfo,attribution:i3sItem.accessInformation,requests:i3sRequests};
await writeFile(new URL('i3s/manifest.json',root),JSON.stringify(i3sManifest,null,2)+'\n');
await writeFile(new URL('manifest.json',root),JSON.stringify({version:1,id:'downtown-edge-r5',started,completed:new Date().toISOString(),bboxWgs84:bbox,acceptedAdjacentBboxWgs84:previous.bboxWgs84,gridStepDegrees:.00001,policy:'Independent public source preparation only; full geographic features without invented heights or simplified geometry. Not yet runtime coverage or proof of current1:1 Miami.',maximum,networkCount,downloadBytes,sources,terrainPath:'terrain/manifest.json',i3sPath:'i3s/manifest.json',requests},null,2)+'\n');
console.log(JSON.stringify({complete:true,features:sources.map(s=>({id:s.id,count:s.featureCount})),i3sNodes:visited,i3sLeaves:leaves.length,networkCount,downloadBytes}));
