import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = new URL('../../../data/world/miami/', import.meta.url);
const bounds = '25.7596,-80.199,25.7704,-80.187';
const query = `[out:json][timeout:45];(way["highway"](${bounds});way["building"](${bounds});way["building:part"](${bounds});relation["building"]["type"="multipolygon"](${bounds});relation["building:part"]["type"="multipolygon"](${bounds}););out body;>;out skel qt;`;
await mkdir(root,{recursive:true});
await writeFile(new URL('raw/query.overpassql', root), query+'\n');
const attempts=[];
for(const endpoint of ['https://overpass-api.de/api/interpreter','https://overpass.kumi.systems/api/interpreter']) {
  try {
    const response = await fetch(`${endpoint}?${new URLSearchParams({data:query})}`,{signal:AbortSignal.timeout(55000)});
    const text=await response.text(); attempts.push({endpoint,status:response.status});
    if(!response.ok) continue;
    const data=JSON.parse(text); if(data.remark||!Array.isArray(data.elements)) throw new Error(data.remark||'Invalid Overpass data');
    await writeFile(new URL('raw/osm.json',root),text);
    const manifest={id:'osm-brickell-supplement',bboxWgs84:[-80.199,25.7596,-80.187,25.7704],retrieved:new Date().toISOString(),timestamp:data.osm3s.timestamp_osm_base,endpoint,license:'ODbL-1.0',attribution:'© OpenStreetMap contributors',licenseUrl:'https://www.openstreetmap.org/copyright',elementCount:data.elements.length,sha256:createHash('sha256').update(text).digest('hex'),attempts};
    await writeFile(new URL('osm-manifest.json',root),JSON.stringify(manifest,null,2)+'\n'); console.log(manifest); process.exit(0);
  }catch(error){attempts.push({endpoint,error:String(error)});}
}
throw new Error(JSON.stringify(attempts));
