import { readFile, writeFile } from 'node:fs/promises';
const root=new URL('../../../data/world/miami/',import.meta.url),cache=new URL('i3s/',root);
const manifest=JSON.parse(await readFile(new URL('manifest.json',cache),'utf8'));
const layer=JSON.parse(await readFile(new URL('research/county-3d-layer.json',root),'utf8'));
if(layer.store.version!=='1.6'||layer.store.vertexCRS!=='http://www.opengis.net/def/crs/EPSG/0/4326'||layer.heightModelInfo.heightUnit!=='meter'||layer.spatialReference.vcsWkid!==5703)throw new Error('Unexpected source geometry/height schema');
const schema=layer.store.defaultGeometrySchema;
if(JSON.stringify(schema.ordering)!==JSON.stringify(['position','normal','uv0','color']))throw new Error('Unexpected vertex layout');
const features=[],ids=new Set();let vertexTotal=0,triangleTotal=0,excluded=0;
function strings(bytes){const count=bytes.readUInt32LE(0),byteCount=bytes.readUInt32LE(4),start=8+count*4;let offset=start;const values=[];for(let i=0;i<count;i++){const n=bytes.readUInt32LE(8+i*4);values.push(bytes.subarray(offset,offset+n).toString('utf8').replace(/\0$/,''));offset+=n;}if(offset-start!==byteCount||offset!==bytes.length)throw new Error('Bad I3S string table');return values;}
async function get(node,suffix=''){return readFile(new URL(`nodes_${node}${suffix}.bin`,cache));}
for(const id of manifest.leaves){
  const node=JSON.parse((await get(id)).toString()),bytes=await get(id,'_geometries_0');
  const vertexCount=bytes.readUInt32LE(0),featureCount=bytes.readUInt32LE(4);
  // The service declares Float32 XYZ+normal+UV and UInt8 RGBA, then UInt64
  // feature IDs and two UInt32 inclusive face ranges (I3S 1.6 common schema).
  const featureOffset=8+vertexCount*36,faceOffset=featureOffset+featureCount*8;
  if(bytes.length!==faceOffset+featureCount*8)throw new Error(`Unexpected byte count ${id}`);
  const unique=strings(await get(id,'_attributes_f_0_0')),source=strings(await get(id,'_attributes_f_2_0')),kind=strings(await get(id,'_attributes_f_3_0'));
  const oids=await get(id,'_attributes_f_1_0'),years=await get(id,'_attributes_f_4_0');
  const featureData=JSON.parse((await get(id,'_features_0')).toString()).featureData;
  if(unique.length!==featureCount||oids.readUInt32LE(0)!==featureCount||featureData.length!==featureCount)throw new Error(`Mismatched features ${id}`);
  for(let f=0;f<featureCount;f++){
    const oid=oids.readUInt32LE(4+f*4),binaryId=Number(bytes.readBigUInt64LE(featureOffset+f*8));
    const first=bytes.readUInt32LE(faceOffset+f*8),last=bytes.readUInt32LE(faceOffset+f*8+4);
    const declared=featureData[f].geometries[0].params.faceRange;
    if(oid!==binaryId||featureData[f].id!==oid||first!==declared[0]||last!==declared[1]||last*3+2>=vertexCount||first>last)throw new Error(`Bad feature range ${id}/${oid}`);
    const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
    for(let v=first*3;v<=(last*3+2);v++)for(let axis=0;axis<3;axis++){
      const value=bytes.readFloatLE(8+v*12+axis*4)+node.mbs[axis];
      if(!Number.isFinite(value))throw new Error('Nonfinite source coordinate');min[axis]=Math.min(min[axis],value);max[axis]=Math.max(max[axis],value);
    }
    if(min[0]>manifest.bboxWgs84[2]||max[0]<manifest.bboxWgs84[0]||min[1]>manifest.bboxWgs84[3]||max[1]<manifest.bboxWgs84[1]){excluded++;continue;}
    const key=`county-i3s:${oid}`;if(ids.has(key))throw new Error(`Duplicate finest-level feature ${key}`);ids.add(key);
    vertexTotal+=(last-first+1)*3;triangleTotal+=last-first+1;
    features.push({id:key,sourceUniqueId:unique[f],sourceObjectId:oid,node:id,source:source[f],buildingType:kind[f],yearUpdated:years.readInt16LE(4+f*2),bboxWgs84:[min[0],min[1],max[0],max[1]],groundM:min[2],roofM:max[2],heightM:max[2]-min[2],verticalDatum:'NAVD88 (EPSG:5703)',confidence:'mapped',method:'Min/max of all source finest-leaf mesh vertices, ground-relative extent=roof minus minimum; source mesh floor is not an independently surveyed street elevation.',triangles:last-first+1});
  }
}
features.sort((a,b)=>a.sourceObjectId-b.sourceObjectId);
const output={version:1,source:manifest.source,sourceItem:manifest.item,verticalDatum:'NAVD88 (EPSG:5703)',units:'meters',bboxWgs84:manifest.bboxWgs84,featureCount:features.length,vertexTotal,triangleTotal,excludedOutsideAOI:excluded,features};
await writeFile(new URL('building-envelopes.json',root),JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify({features:features.length,triangles:triangleTotal,excluded,landmarks:features.filter(f=>['D1_MDC_Building_3','D1_MDC_Building_89','D1_MDC_Building_426'].includes(f.sourceUniqueId))},null,2));
