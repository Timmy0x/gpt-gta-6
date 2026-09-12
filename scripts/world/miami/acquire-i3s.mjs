import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
const root = new URL('../../../data/world/miami/i3s/', import.meta.url);
const base = 'https://tiles.arcgis.com/tiles/8Pc9XBTAsYuxx9Ny/arcgis/rest/services/Buildings_Models_3D/SceneServer/layers/0';
const bbox = [-80.199,25.7596,-80.187,25.7704];
await mkdir(root,{recursive:true});
const requests=[];
async function get(path) {
  const file=path.replaceAll('/','_')+'.bin', url=`${base}/${path}`;
  let bytes;
  try { bytes=await readFile(new URL(file,root)); }
  catch {
    const response=await fetch(url,{signal:AbortSignal.timeout(30000)});
    if(!response.ok)throw new Error(`${response.status} ${url}`);
    bytes=Buffer.from(await response.arrayBuffer());
    if(bytes[0]===31&&bytes[1]===139)bytes=gunzipSync(bytes);
    await writeFile(new URL(file,root),bytes);
  }
  requests.push({url,path:file,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length});
  return bytes;
}
// Conservative sphere/AOI test in local metres. This only selects source nodes;
// their original geographic vertices remain unchanged in the retained payloads.
function intersects(mbs) {
  const lon=Math.max(bbox[0],Math.min(bbox[2],mbs[0])),lat=Math.max(bbox[1],Math.min(bbox[3],mbs[1]));
  return Math.hypot((lon-mbs[0])*100000,(lat-mbs[1])*110000)<=mbs[3]*1.03+5;
}
let pending=['root'],visited=0;const leaves=[];
while(pending.length) {
  if(visited>400)throw new Error('Bounded I3S traversal exceeded 400 nodes');
  const batch=pending.splice(0,6);
  const nodes=await Promise.all(batch.map(async id=>JSON.parse((await get(`nodes/${id}`)).toString())));
  for(const node of nodes) {
    visited++;
    if(node.children?.length) pending.push(...node.children.filter(c=>intersects(c.mbs)).map(c=>c.id));
    else if(node.geometryData?.length)leaves.push(node);
  }
  console.log('nodes',visited,'pending',pending.length,'leaves',leaves.length);
}
for(const node of leaves) {
  for(const ref of [...(node.featureData??[]),...(node.geometryData??[]),...(node.attributeData??[])]) {
    await get(`nodes/${node.id}/${ref.href.replace('./','')}`);
  }
}
await writeFile(new URL('manifest.json',root),JSON.stringify({source:base,item:'ce420278a45a4bf4a349c37c197263b3',retrieved:new Date().toISOString(),bboxWgs84:bbox,selection:'Conservative source MBS/AOI intersection; full finest-leaf geometry retained; no imagery/textures downloaded',visited,leaves:leaves.map(n=>n.id),requests},null,2)+'\n');
console.log('Complete',visited,leaves.length,requests.reduce((n,r)=>n+r.bytes,0));
