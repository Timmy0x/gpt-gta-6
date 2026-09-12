import { readFile, writeFile } from 'node:fs/promises';
import { stitch, contains, signedArea } from '../../gis/import.mjs';
const root=new URL('../../../data/world/miami/',import.meta.url);
const raw=JSON.parse(await readFile(new URL('raw/osm.json',root),'utf8'));
const nodes=new Map(raw.elements.filter(e=>e.type==='node').map(e=>[e.id,e]));
const ways=new Map(raw.elements.filter(e=>e.type==='way').map(e=>[e.id,e]));
const features=[],consumed=new Set(),rejected=[];
const building=t=>t?.building||t?.['building:part'];
function measure(raw){
  if(raw==null)return null;
  const m=String(raw).trim().match(/^([0-9]+(?:\.[0-9]+)?)\s*(m|metres?|meters?|ft|feet|')?$/i);
  return m?Number(m[1])*(/^(ft|feet|')$/i.test(m[2]??'')?.3048:1):null;
}
function coordinates(ids){return ids.map(id=>{const n=nodes.get(id);if(!n)throw new Error(`Missing node ${id}`);return[n.lon,n.lat];});}
function ring(ids){if(ids.length<4||ids[0]!==ids.at(-1))throw new Error('Unclosed source ring');return coordinates(ids);}
function normalize(geometry){
  if(geometry.type==='LineString')return geometry;
  const polygon=rings=>rings.map((r,i)=>(signedArea(r)>0)===(i===0)?r:r.slice().reverse());
  return {...geometry,coordinates:geometry.type==='Polygon'?polygon(geometry.coordinates):geometry.coordinates.map(polygon)};
}
function add(e,geometry){
  const tags=e.tags??{},id=`osm:${e.type}/${e.id}`;
  features.push({type:'Feature',id,properties:{sourceId:id,source:'osm-brickell-supplement',confidence:'mapped',kind:tags.highway?'road':'building',name:tags.name??null,heightM:measure(tags.height),heightConfidence:tags.height?'mapped':null,minHeightM:measure(tags.min_height),levels:tags['building:levels']&&/^\d+$/.test(tags['building:levels'])?Number(tags['building:levels']):null,widthM:measure(tags.width),lanes:tags.lanes&&/^\d+$/.test(tags.lanes)?Number(tags.lanes):null,tags},geometry:normalize(geometry)});
}
for(const relation of raw.elements.filter(e=>e.type==='relation'&&building(e.tags)&&e.tags.type==='multipolygon')){
  try{
    const members=relation.members.filter(m=>m.type==='way');
    const ids=m=>{const way=ways.get(m.ref);if(!way)throw new Error(`Missing member ${m.ref}`);return way.nodes;};
    const outer=stitch(members.filter(m=>m.role!=='inner').map(ids)).map(ring),inner=stitch(members.filter(m=>m.role==='inner').map(ids)).map(ring);
    if(!outer.length)throw new Error('Missing outer polygon');
    const polygons=outer.map(r=>[r]);
    for(const hole of inner){const match=outer.map((r,i)=>({i,area:Math.abs(signedArea(r))})).filter(({i})=>contains(outer[i],hole[0])).sort((a,b)=>a.area-b.area)[0];if(!match)throw new Error('Orphan inner ring');polygons[match.i].push(hole);}
    add(relation,{type:polygons.length===1?'Polygon':'MultiPolygon',coordinates:polygons.length===1?polygons[0]:polygons});members.forEach(m=>consumed.add(m.ref));
  }catch(error){rejected.push({id:`relation/${relation.id}`,error:String(error)});}
}
for(const way of ways.values()){
  try{
    if(way.tags?.highway)add(way,{type:'LineString',coordinates:coordinates(way.nodes)});
    else if(building(way.tags)&&!consumed.has(way.id))add(way,{type:'Polygon',coordinates:[ring(way.nodes)]});
  }catch(error){rejected.push({id:`way/${way.id}`,error:String(error)});}
}
features.sort((a,b)=>a.id.localeCompare(b.id));
await writeFile(new URL('osm-supplement.geojson',root),JSON.stringify({type:'FeatureCollection',name:'Brickell OSM explicit building and road tags; source WGS84 geometry',features})+'\n');
await writeFile(new URL('osm-normalization.json',root),JSON.stringify({features:features.length,roads:features.filter(f=>f.properties.kind==='road').length,buildings:features.filter(f=>f.properties.kind==='building').length,explicitHeight:features.filter(f=>f.properties.kind==='building'&&f.properties.heightM!==null).length,rejected,warning:'OSM community heights remain mapped confidence, not surveyed; construction, roof parts and contradictory floor counts require review.'},null,2)+'\n');
if(rejected.length)throw new Error(`Rejected ${rejected.length} incomplete geometries; inspect osm-normalization.json`);
console.log(features.length,'features; no rejected geometry');
