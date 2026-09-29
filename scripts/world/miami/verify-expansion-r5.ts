import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {CommonFrame,PROVISIONAL_POLICY} from '../../../tools/miami-common-frame/src/CommonFrame';
import {createDemSampler} from '../../../tools/miami-common-frame/src/SourceCoordinates';

const root=new URL('../../../data/world/miami/expansions/downtown-edge-r5/',import.meta.url),baseline=new URL('../../../data/world/miami/',import.meta.url);
const json=async(path:string)=>JSON.parse(await readFile(new URL(path,root),'utf8')),hash=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
const source=await json('prepared/i3s-geographic.json'),raw=await readFile(new URL('prepared/'+source.binary,root));assert.equal(hash(raw),source.sha256);
const geoid=JSON.parse(await readFile(new URL('../../../tools/miami-common-frame/data/geoid18.json',import.meta.url),'utf8'));
const frame=new CommonFrame(geoid,PROVISIONAL_POLICY),records=[];let sampled=0,maxRoundtripDegrees=0,maxSourceNormalError=0;
for(const building of source.buildings){
 const node=await json(`i3s/nodes_${building.node}.bin`),geometry=await readFile(new URL(`i3s/nodes_${building.node}_geometries_0.bin`,root)),vc=geometry.readUInt32LE(0),fc=geometry.readUInt32LE(4),fo=8+vc*36;
 const feature=Array.from({length:fc},(_,i)=>i).find(i=>Number(geometry.readBigUInt64LE(fo+i*8))===building.sourceObjectId)!;assert.notEqual(feature,undefined);
 const first=geometry.readUInt32LE(fo+fc*8+feature*8),last=geometry.readUInt32LE(fo+fc*8+feature*8+4);assert.equal(building.vertices,(last-first+1)*3);
 for(const v of [0,Math.floor(building.vertices/2),building.vertices-1]){
  const original=first*3+v,offset=building.byteOffset+v*36,lon=raw.readDoubleLE(offset),lat=raw.readDoubleLE(offset+8),H=raw.readDoubleLE(offset+16);
  assert.equal(lon,geometry.readFloatLE(8+original*12)+node.mbs[0]);assert.equal(lat,geometry.readFloatLE(8+original*12+4)+node.mbs[1]);assert.equal(H,geometry.readFloatLE(8+original*12+8)+node.mbs[2]);
  for(let axis=0;axis<3;axis++)maxSourceNormalError=Math.max(maxSourceNormalError,Math.abs(raw.readFloatLE(offset+24+axis*4)-geometry.readFloatLE(8+vc*12+original*12+axis*4)));
  const local=frame.navd88ToLocal(lon,lat,H),roundtrip=frame.localToGeodetic(local);maxRoundtripDegrees=Math.max(maxRoundtripDegrees,Math.abs(lon-roundtrip.longitude),Math.abs(lat-roundtrip.latitude));assert.ok(maxRoundtripDegrees<1e-9);sampled++;
  if(v===0)records.push({id:building.id,year:building.yearUpdated,source:[lon,lat,H],local});
 }
}
assert.equal(maxSourceNormalError,0);
const grid=await json('prepared/terrain/grid.json'),stripGrid=await json('prepared/terrain/northwest-strip-grid.json');
const bytes=await readFile(new URL('prepared/terrain/heights.f32',root)),stripBytes=await readFile(new URL('prepared/terrain/northwest-strip-heights.f32',root)),mask=await readFile(new URL('prepared/terrain/northwest-strip-source-mask.u8',root));
assert.equal(hash(bytes),grid.sha256);assert.equal(hash(stripBytes),stripGrid.sha256);assert.equal(hash(mask),stripGrid.sourceMaskSha256);assert.ok(stripBytes.subarray(0,bytes.length).equals(bytes));
const oldGrid=JSON.parse(await readFile(new URL('terrain/grid.json',baseline),'utf8')),oldBytes=await readFile(new URL('terrain/heights.f32',baseline));
for(let row=0;row<oldGrid.height;row++)assert.ok(stripBytes.subarray(bytes.length+row*600*4,bytes.length+(row+1)*600*4).equals(oldBytes.subarray(row*oldGrid.width*4,row*oldGrid.width*4+600*4)));
const heights=new Float32Array(stripBytes.buffer.slice(stripBytes.byteOffset,stripBytes.byteOffset+stripBytes.byteLength)),sample=createDemSampler(stripGrid,heights,mask),seam=[];
for(const column of [0,149,299,449,598]){
 const lon=grid.pixelCenterLongitude+(column+.3)*grid.longitudeStep,lat=25.7704,result=sample(lon,lat)!;assert.ok(result);
 const h=[heights[539*600+column],heights[539*600+column+1],heights[540*600+column],heights[540*600+column+1]];
 const expected=(h[0]*.7+h[1]*.3)*.5+(h[2]*.7+h[3]*.3)*.5;assert.ok(Math.abs(result.navd88M-expected)<1e-7);
 const local=frame.navd88ToLocal(lon,lat,result.navd88M);assert.ok(local[1]<0,'NAVD88 ground becomes negative local Up under unchanged provisional common frame');seam.push({longitude:lon,latitude:lat,navd88M:result.navd88M,localUpM:local[1]});
}
assert.equal(sample(-80.2,25.775),null);assert.equal(sample(-80.194,25.776),null);
const footprints=await json('raw/county-buildings.geojson'),byUnique=new Map(footprints.features.filter((f:any)=>f.properties.UNIQUEID).map((f:any)=>[f.properties.UNIQUEID,f.properties]));
const exact=source.buildings.filter((b:any)=>byUnique.has(b.sourceUniqueId)),unmatched=source.buildings.filter((b:any)=>!byUnique.has(b.sourceUniqueId));
const result={scope:'Original County geometry bytes, unchanged provisional common frame and accepted terrain byte preservation; not current survey/provider correspondence or gameplay validation',framePolicy:PROVISIONAL_POLICY,verifiedBuildingFeatures:source.buildings.length,sampledOriginalVertices:sampled,maxSourceNormalError,maxRoundtripDegrees,sourceEpochs:[...new Set(source.buildings.map((b:any)=>b.yearUpdated))],terrainPixels:grid.validPixels,acceptedStripRowsVerified:oldGrid.height,seamSamples:seam,unsupportedOutsideReturnsNull:true,exactUniqueIdFootprintJoins:exact.length,unjoinedMeshIds:unmatched.map((b:any)=>b.id),sampleCoordinates:records};
await writeFile(new URL('prepared/verification.json',root),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({...result,sampleCoordinates:undefined}));
