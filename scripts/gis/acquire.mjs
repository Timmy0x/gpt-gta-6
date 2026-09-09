import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
const out=resolve(import.meta.dirname,'../../data/gis/miami-beach');await mkdir(out,{recursive:true});
const bbox={south:25.770,west:-80.140,north:25.784,east:-80.127};
const bounds=`${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
const query=`[out:json][timeout:45];(way["highway"](${bounds});way["building"](${bounds});relation["building"]["type"="multipolygon"](${bounds}););out body;>;out skel qt;`;
await writeFile(resolve(out,'query.overpassql'),query+'\n');
const attempts=[];
for(const endpoint of ['https://overpass-api.de/api/interpreter','https://overpass.kumi.systems/api/interpreter']){
 try{
  const started=new Date().toISOString();
  const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','User-Agent':'Leonida-local-GIS-reference/1.0 (single small research extract)'},body:new URLSearchParams({data:query}),signal:AbortSignal.timeout(55000)});
  const text=await response.text();attempts.push({endpoint,started,status:response.status,bytes:Buffer.byteLength(text),error:response.ok?null:text.slice(0,1200)});
  if(!response.ok)continue;
  const data=JSON.parse(text);if(data.remark||!Array.isArray(data.elements))throw new Error(data.remark||'Invalid OSM response');
  await writeFile(resolve(out,'raw-overpass.json'),text);
  const metadata={dataset:'Miami Beach / Ocean Drive road and building reference',classification:'real-world fallback; not GTA VI geography',bbox,origin:{longitude:-80.1309,latitude:25.7823,elevation:0},retrievedAt:new Date().toISOString(),endpoint,source:'https://www.openstreetmap.org',license:'Open Data Commons Open Database License 1.0 (ODbL)',licenseUrl:'https://opendatacommons.org/licenses/odbl/1-0/',attribution:'© OpenStreetMap contributors',attributionUrl:'https://www.openstreetmap.org/copyright',rawSha256:createHash('sha256').update(text).digest('hex'),osmTimestamp:data.osm3s?.timestamp_osm_base,elementCount:data.elements.length,attempts};
  await writeFile(resolve(out,'source.json'),JSON.stringify(metadata,null,2)+'\n');console.log(JSON.stringify(metadata,null,2));process.exit(0);
 }catch(error){attempts.push({endpoint,error:String(error)});}
}
await writeFile(resolve(out,'acquisition-errors.json'),JSON.stringify({bbox,attempts},null,2));throw new Error('All GIS sources failed; see acquisition-errors.json');
