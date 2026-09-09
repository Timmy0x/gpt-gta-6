import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const radians=d=>d*Math.PI/180;
const a=6378137,f=1/298.257223563,e2=f*(2-f);
function ecef(lon,lat,height=0){const p=radians(lat),l=radians(lon),n=a/Math.sqrt(1-e2*Math.sin(p)**2);return [(n+height)*Math.cos(p)*Math.cos(l),(n+height)*Math.cos(p)*Math.sin(l),(n*(1-e2)+height)*Math.sin(p)];}
export function project(lon,lat,origin){
 const p=ecef(lon,lat),o=ecef(origin.longitude,origin.latitude,origin.elevation),d=p.map((v,i)=>v-o[i]),l=radians(origin.longitude),b=radians(origin.latitude);
 return [-Math.sin(l)*d[0]+Math.cos(l)*d[1],-Math.sin(b)*Math.cos(l)*d[0]-Math.sin(b)*Math.sin(l)*d[1]+Math.cos(b)*d[2]].map(v=>Math.round(v*1000)/1000);
}
export function haversine(p,q){const a=radians(p[1]),b=radians(q[1]),dl=radians(q[0]-p[0]),dp=b-a;return 6371008.8*2*Math.asin(Math.min(1,Math.sqrt(Math.sin(dp/2)**2+Math.cos(a)*Math.cos(b)*Math.sin(dl/2)**2)));}
export function signedArea(ring){return ring.slice(1).reduce((sum,p,i)=>sum+ring[i][0]*p[1]-p[0]*ring[i][1],0)/2;}
export function contains(ring,p){let yes=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;}
export function stitch(ways){
 const remaining=ways.map(w=>w.slice()),rings=[];
 while(remaining.length){const ring=remaining.pop();while(ring.at(-1)!==ring[0]){const index=remaining.findIndex(w=>w[0]===ring.at(-1)||w.at(-1)===ring.at(-1));if(index<0)throw new Error('unclosed multipolygon chain');let next=remaining.splice(index,1)[0];if(next.at(-1)===ring.at(-1))next=next.reverse();ring.push(...next.slice(1));}rings.push(ring);}
 return rings;
}
export function convert(raw,source){
 const nodes=new Map(raw.elements.filter(e=>e.type==='node').map(n=>[n.id,n])),ways=new Map(raw.elements.filter(e=>e.type==='way').map(w=>[w.id,w]));
 const features=[],rejected=[],relationWays=new Set(),roadNodes=new Map(),edges=[];
 const coords=ids=>ids.map(id=>{const n=nodes.get(id);if(!n)throw new Error(`missing node ${id}`);return[n.lon,n.lat];});
 const ringCoords=ids=>{if(ids.length<4||ids[0]!==ids.at(-1))throw new Error('building ring is not closed');return coords(ids);};
 function add(id,type,coordinates,tags,nodeIds){features.push({type:'Feature',id,properties:{osm_id:id,source:'OpenStreetMap',classification:'real-world fallback; not GTA VI',tags,...(nodeIds?{node_ids:nodeIds}:{})},geometry:{type,coordinates}});}
 for(const relation of raw.elements.filter(e=>e.type==='relation'&&e.tags?.building&&e.tags.type==='multipolygon')){
  try{
   const members=relation.members.filter(m=>m.type==='way');const outer=stitch(members.filter(m=>m.role!=='inner').map(m=>ways.get(m.ref)?.nodes||[])).map(ringCoords),inner=stitch(members.filter(m=>m.role==='inner').map(m=>ways.get(m.ref)?.nodes||[])).map(ringCoords);
   if(!outer.length)throw new Error('missing outer ring');const polygons=outer.map(r=>[r]);
   for(const hole of inner){const index=outer.map((ring,index)=>({index,area:Math.abs(signedArea(ring))})).filter(r=>contains(outer[r.index],hole[0])).sort((a,b)=>a.area-b.area)[0]?.index;if(index===undefined)throw new Error('orphan inner ring');polygons[index].push(hole);}
   add(`relation/${relation.id}`,polygons.length===1?'Polygon':'MultiPolygon',polygons.length===1?polygons[0]:polygons,relation.tags);members.forEach(m=>relationWays.add(m.ref));
  }catch(error){rejected.push({id:`relation/${relation.id}`,error:String(error)});}
 }
 for(const way of ways.values()){
  if(way.tags?.building&&!relationWays.has(way.id))try{add(`way/${way.id}`,'Polygon',[ringCoords(way.nodes)],way.tags,way.nodes);}catch(error){rejected.push({id:`way/${way.id}`,error:String(error)});}
  if(way.tags?.highway)try{
   const line=coords(way.nodes);if(line.length<2)throw new Error('road has fewer than two points');add(`way/${way.id}`,'LineString',line,way.tags,way.nodes);
   for(const id of way.nodes){const n=nodes.get(id);roadNodes.set(id,{id,coordinates:project(n.lon,n.lat,source.origin)});}
   for(let i=1;i<way.nodes.length;i++){if(way.nodes[i-1]===way.nodes[i])continue;edges.push({from:way.nodes[i-1],to:way.nodes[i],way:way.id,highway:way.tags.highway,layer:way.tags.layer||'0',bridge:way.tags.bridge||null,tunnel:way.tags.tunnel||null,oneway:way.tags.oneway||null});}
  }catch(error){rejected.push({id:`way/${way.id}`,error:String(error)});}
 }
 const mapGeometry=geometry=>{
  const point=p=>project(p[0],p[1],source.origin),ring=(r,outer)=>{const projected=r.map(point);return (signedArea(projected)>0)===outer?projected:projected.reverse();};
  if(geometry.type==='LineString')return{...geometry,coordinates:geometry.coordinates.map(point)};
  const polygon=p=>p.map((r,i)=>ring(r,i===0));return{...geometry,coordinates:geometry.type==='Polygon'?polygon(geometry.coordinates):geometry.coordinates.map(polygon)};
 };
 const normalizeGeographic=geometry=>{
  if(geometry.type==='LineString')return geometry;
  const polygon=p=>p.map((r,i)=>(signedArea(r)>0)===(i===0)?r:r.slice().reverse());
  return {...geometry,coordinates:geometry.type==='Polygon'?polygon(geometry.coordinates):geometry.coordinates.map(polygon)};
 };
 const geographic={type:'FeatureCollection',name:'Miami Beach OSM reference (WGS84)',features:features.map(f=>({...f,geometry:normalizeGeographic(f.geometry)}))};
 const local={type:'FeatureCollection',name:'Miami Beach OSM reference (local metres)',coordinateSystem:{type:'WGS84 local East-North tangent plane',units:'metres',origin:source.origin,axes:['east','north'],babylonMapping:{x:'east',y:'elevation',z:'north'},rfc7946:false},features:features.map(feature=>({...feature,geometry:mapGeometry(feature.geometry)}))};
 return{geographic,local,graph:{nodes:[...roadNodes.values()],edges,joinRule:'shared OSM node IDs only; no coordinate-based welding'},rejected};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
 const out=resolve(import.meta.dirname,'../../data/gis/miami-beach');const raw=JSON.parse(await readFile(resolve(out,'raw-overpass.json'),'utf8')),source=JSON.parse(await readFile(resolve(out,'source.json'),'utf8'));const result=convert(raw,source);
 for(const [name,data] of [['miami-beach-wgs84.geojson',result.geographic],['miami-beach-local.geojson',result.local],['road-topology.json',result.graph],['import-rejections.json',result.rejected]])await writeFile(resolve(out,name),JSON.stringify(data,null,2)+'\n');
 console.log(JSON.stringify({features:result.local.features.length,buildings:result.local.features.filter(f=>f.geometry.type!=='LineString').length,roads:result.local.features.filter(f=>f.geometry.type==='LineString').length,roadNodes:result.graph.nodes.length,roadEdges:result.graph.edges.length,rejected:result.rejected},null,2));
}
