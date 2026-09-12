import { readFile,writeFile } from 'node:fs/promises';
import polygonClipping from 'polygon-clipping';
import { projectMiami } from '../../../src/world/miami/projection';
const root=new URL('../../../data/world/miami/',import.meta.url);
const read=async (path:string)=>JSON.parse(await readFile(new URL(path,root),'utf8'));
const source=await read('building-meshes.json'),bytes=await readFile(new URL(source.binary,root));
type Ring=[number,number][];type Polygon=Ring[];type Multi=Polygon[];
const meshFootprints:any[]=[],failures:any[]=[];
function area(polygons:Multi){return polygons.reduce((sum,p)=>sum+p.reduce((s,r,i)=>{let a=0;for(let j=0;j<r.length-1;j++)a+=r[j][0]*r[j+1][1]-r[j+1][0]*r[j][1];return s+(i===0?1:-1)*Math.abs(a/2);},0),0);}
function bounds(polygons:Multi){const p=polygons.flat(2);return[Math.min(...p.map(v=>v[0])),Math.min(...p.map(v=>v[1])),Math.max(...p.map(v=>v[0])),Math.max(...p.map(v=>v[1]))];}
function overlap(a:number[],b:number[]){return a[0]<=b[2]&&a[2]>=b[0]&&a[1]<=b[3]&&a[3]>=b[1];}
function project(g:any):Multi{
  const polygons=g.type==='Polygon'?[g.coordinates]:g.coordinates;
  return polygons.map((p:number[][][])=>p.map(r=>r.map(([lon,lat])=>{const q=projectMiami(lon,lat);return[q[0],q[2]];})));
}
for(const mesh of source.buildings){
  try{
    const indices=Array.from({length:mesh.indices.count},(_,i)=>bytes.readUInt32LE(mesh.indices.byteOffset+i*4));
    const positions=Array.from({length:mesh.positions.count},(_,i)=>bytes.readFloatLE(mesh.positions.byteOffset+i*4));
    const unique=new Set<string>(),triangles:Multi=[];
    for(let i=0;i<indices.length;i+=3){
      const corners=indices.slice(i,i+3).map(index=>positions.slice(index*3,index*3+3));
      const u=corners[1].map((v,j)=>v-corners[0][j]),v=corners[2].map((v,j)=>v-corners[0][j]);
      const normal=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
      if(Math.abs(normal[1])/Math.hypot(...normal)<.01)continue;
      const ring=indices.slice(i,i+3).map(index=>[Math.round((positions[index*3]+mesh.origin[0])*1000)/1000,Math.round((positions[index*3+2]+mesh.origin[2])*1000)/1000] as [number,number]);
      const signed=(ring[1][0]-ring[0][0])*(ring[2][1]-ring[0][1])-(ring[1][1]-ring[0][1])*(ring[2][0]-ring[0][0]);
      if(Math.abs(signed)<1e-6)continue;
      const key=ring.map(p=>p.join(',')).sort().join('|');if(unique.has(key))continue;unique.add(key);ring.push(ring[0]);triangles.push([ring]);
    }
    const polygons=polygonClipping.union(triangles) as Multi;
    meshFootprints.push({id:mesh.id,sourceUniqueId:mesh.sourceUniqueId,year:mesh.yearUpdated,bounds:bounds(polygons),areaM2:area(polygons),polygons});
  }catch(error){failures.push({id:mesh.id,error:String(error)});}
}
await writeFile(new URL('building-mesh-footprints.json',root),JSON.stringify({version:1,status:'Follow-up spatial reconciliation candidate',coordinateSystem:'projectMiami local east/north metres, [x,z] pairs; notRFC7946',sourceBinarySha256:source.sha256,method:'Union of roof/floor triangle projections after millimetre coordinate snapping solely for robust topology; nearly vertical faces with abs(normalY)<.01 contribute no footprint; original rendered source mesh is unchanged.',failures,buildings:meshFootprints},null,2)+'\n');
const current=(await read('raw/county-buildings.geojson')).features,osm=(await read('osm-supplement.geojson')).features.filter((f:any)=>f.properties.kind==='building');
function matching(polygons:Multi){
  const a=area(polygons),b=bounds(polygons);
  return meshFootprints.filter(f=>overlap(b,f.bounds)).flatMap(f=>{
    const intersection=polygonClipping.intersection(polygons,f.polygons) as Multi,covered=area(intersection);
    return covered>.1?[{id:f.id,sourceUniqueId:f.sourceUniqueId,coveredM2:covered,fractionOfInput:covered/a,fractionOfMesh:covered/f.areaM2,intersectionOverUnion:covered/(a+f.areaM2-covered)}]:[];
  }).sort((a,b)=>b.coveredM2-a.coveredM2);
}
const rows=current.map((f:any)=>{
  const polygons=project(f.geometry),candidates=matching(polygons),best=candidates[0];
  return{id:`county-buildings:${f.properties.GlobalID}`,objectId:f.properties.OBJECTID,uniqueId:f.properties.UNIQUEID,year:f.properties.YEARUPDATE,areaM2:area(polygons),candidates,status:f.properties.UNIQUEID?'has-source-id':best?.fractionOfInput>.95?'newer-part-projection-covered-by-old-mesh':'needs-new-geometry-review',gaps:['Horizontal overlap is evidence of occupied area, not proof of unchanged height, facade or physical building identity.']};
});
const osmRows=osm.filter((f:any)=>f.properties.name||f.properties.tags['addr:housenumber']).map((f:any)=>({id:f.id,name:f.properties.name,address:[f.properties.tags['addr:housenumber'],f.properties.tags['addr:street']].filter(Boolean).join(' '),heightM:f.properties.heightM,levels:f.properties.levels,candidates:matching(project(f.geometry))}));
const report={version:1,status:'Follow-up review only; no automatic identity or geometry replacement',sourceBinarySha256:source.sha256,sourceMeshFootprintFailures:failures,summary:{currentFeatures:rows.length,newerParts:rows.filter((r:any)=>!r.uniqueId).length,newerPartsAtLeast95PercentCovered:rows.filter((r:any)=>!r.uniqueId&&r.candidates[0]?.fractionOfInput>.95).length,newerPartsRequiringReview:rows.filter((r:any)=>!r.uniqueId&&!(r.candidates[0]?.fractionOfInput>.95)).length},rows,osmNamedBuildings:osmRows};
await writeFile(new URL('building-spatial-reconciliation.json',root),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({meshes:meshFootprints.length,failures,summary:report.summary,office801:osmRows.find((r:any)=>r.address==='801 Brickell Avenue')},null,2));
