import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { signedArea, contains, haversine, project } from './import.mjs';
const out=resolve(import.meta.dirname,'../../data/gis/miami-beach');
const [source,local,geographic,graph]=await Promise.all(['source.json','miami-beach-local.geojson','miami-beach-wgs84.geojson','road-topology.json'].map(async f=>JSON.parse(await readFile(resolve(out,f),'utf8'))));
const raw=await readFile(resolve(out,'raw-overpass.json'));const errors=[],warnings=[];
if(createHash('sha256').update(raw).digest('hex')!==source.rawSha256)errors.push('Raw response hash mismatch');
function cross(a,b,c){return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);}
function selfCross(r){for(let i=1;i<r.length;i++)for(let j=i+2;j<r.length;j++){if(i===1&&j===r.length-1)continue;const a=r[i-1],b=r[i],c=r[j-1],d=r[j];if(cross(a,b,c)*cross(a,b,d)<-1e-10&&cross(c,d,a)*cross(c,d,b)<-1e-10)return true;}return false;}
const featureIds=new Set();let buildings=0,roads=0,rings=0,roadMeters=0,geodesicMeters=0,maxSegmentRelativeDifference=0;const buildingAreas=[];
for(let index=0;index<local.features.length;index++){
 const f=local.features[index],original=geographic.features[index];if(featureIds.has(f.id))errors.push(`Duplicate feature ${f.id}`);featureIds.add(f.id);
 if(f.geometry.type==='LineString'){
  roads++;const c=f.geometry.coordinates,g=original.geometry.coordinates;
  for(let i=1;i<c.length;i++){const length=Math.hypot(c[i][0]-c[i-1][0],c[i][1]-c[i-1][1]),ground=haversine(g[i-1],g[i]);roadMeters+=length;geodesicMeters+=ground;if(ground>1)maxSegmentRelativeDifference=Math.max(maxSegmentRelativeDifference,Math.abs(length-ground)/ground);}
 }else{
  buildings++;const polygons=f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.coordinates;
  for(const polygon of polygons){let area=0;for(let index=0;index<polygon.length;index++){const r=polygon[index];rings++;if(r.length<4||r[0][0]!==r.at(-1)[0]||r[0][1]!==r.at(-1)[1])errors.push(`${f.id}: open ring`);if(r.flat().some(v=>!Number.isFinite(v)))errors.push(`${f.id}: non-finite coordinates`);if(selfCross(r))errors.push(`${f.id}: self-crossing ring`);const signed=signedArea(r);if(index===0&&signed<=0||index>0&&signed>=0)errors.push(`${f.id}: incorrect winding`);if(index>0&&!contains(polygon[0],r[0]))errors.push(`${f.id}: orphan hole`);area+=signed;}if(area<=0)errors.push(`${f.id}: non-positive footprint`);buildingAreas.push(area);}
 }
}
const nodeIds=new Set(graph.nodes.map(n=>n.id)),adjacency=new Map(graph.nodes.map(n=>[n.id,[]]));
for(const e of graph.edges){if(!nodeIds.has(e.from)||!nodeIds.has(e.to))errors.push('Road edge references a missing node');if(e.from===e.to)errors.push('Zero-node road edge');adjacency.get(e.from)?.push(e.to);adjacency.get(e.to)?.push(e.from);}
const visited=new Set(),components=[];for(const node of graph.nodes)if(!visited.has(node.id)){const queue=[node.id];let size=0;while(queue.length){const id=queue.pop();if(visited.has(id))continue;visited.add(id);size++;queue.push(...adjacency.get(id));}components.push(size);}components.sort((a,b)=>b-a);
if(components.length>1)warnings.push(`${components.length} road/path components remain; shared-node topology is preserved, including boundary cuts and separately mapped footpaths.`);
if(maxSegmentRelativeDifference>.006)errors.push('Projected metre lengths differ unexpectedly from the spherical geodesic check');
const originPoint=project(source.origin.longitude,source.origin.latitude,source.origin);if(Math.hypot(...originPoint)>.001)errors.push('Local origin failed');
const report={validatedAt:new Date().toISOString(),rawSha256:source.rawSha256,features:local.features.length,buildings,roads,rings,roadNodes:graph.nodes.length,roadEdges:graph.edges.length,roadMeters,geodesicMeters,maxSegmentRelativeDifference,buildingAreaSquareMeters:{min:Math.min(...buildingAreas),max:Math.max(...buildingAreas),sum:buildingAreas.reduce((a,b)=>a+b,0)},topology:{components:components.length,largestComponentNodes:components[0],sizes:components},errors,warnings};
await writeFile(resolve(out,'validation.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));process.exitCode=errors.length?1:0;
