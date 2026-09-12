import assert from 'node:assert/strict';
import { readFile,writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const root=new URL('../../../data/world/miami/',import.meta.url);
const read=async path=>JSON.parse(await readFile(new URL(path,root),'utf8'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const manifest=await read('manifest.json'),summary={sources:[],geometry:{},terrain:{},reconciliation:{}};
function geometry(g){
  let vertices=0,polygons=0;
  const point=p=>{assert.ok(Number.isFinite(p[0])&&Number.isFinite(p[1])&&Math.abs(p[0])<=180&&Math.abs(p[1])<=90);vertices++;};
  const ring=r=>{assert.ok(r.length>=4);assert.deepEqual(r[0],r.at(-1));r.forEach(point);};
  const polygon=p=>{assert.ok(p.length>=1);polygons++;p.forEach(ring);};
  if(g.type==='Polygon')polygon(g.coordinates);else if(g.type==='MultiPolygon')g.coordinates.forEach(polygon);else if(g.type==='LineString'){assert.ok(g.coordinates.length>=2);g.coordinates.forEach(point);}else throw new Error(`Unexpected geometry ${g.type}`);
  return{vertices,polygons};
}
for(const source of manifest.sources){
  const bytes=await readFile(new URL(source.path,root));assert.equal(hash(bytes),source.sha256);
  const fc=JSON.parse(bytes.toString());assert.equal(fc.features.length,source.featureCount);const ids=new Set();let polygons=0,vertices=0;
  for(const f of fc.features){const id=f.properties[source.objectIdField];assert.ok(!ids.has(id));ids.add(id);const s=geometry(f.geometry);polygons+=s.polygons;vertices+=s.vertices;}
  if(source.id.startsWith('city-'))assert.ok(source.licenseInfo.includes('creativecommons.org/licenses/by/4.0'));
  summary.sources.push({id:source.id,features:fc.features.length,polygons,vertices,sha256:source.sha256});
}
const osm=await read('osm-supplement.geojson'),osmMeta=await read('osm-manifest.json');
assert.equal(hash(await readFile(new URL('raw/osm.json',root))),osmMeta.sha256);
assert.deepEqual((await read('osm-normalization.json')).rejected,[]);for(const f of osm.features)geometry(f.geometry);
summary.sources.push({id:'osm-brickell-supplement',features:osm.features.length,sourceSha256:osmMeta.sha256});
const meshes=await read('building-meshes.json'),bytes=await readFile(new URL(meshes.binary,root));assert.equal(bytes.length,meshes.byteLength);assert.equal(hash(bytes),meshes.sha256);
let triangles=0,vertices=0,degenerate=0,maxNormalError=0;const ids=new Set();
for(const mesh of meshes.buildings){
  assert.ok(!ids.has(mesh.id));ids.add(mesh.id);assert.equal(mesh.positions.count,mesh.vertices*3);assert.equal(mesh.normals.count,mesh.vertices*3);assert.equal(mesh.indices.count,mesh.triangles*3);
  const arrays={};for(const key of ['positions','normals','indices']){const r=mesh[key];assert.equal(r.byteLength,r.count*4);assert.ok(r.byteOffset>=0&&r.byteOffset+r.byteLength<=bytes.length);arrays[key]=Array.from({length:r.count},(_,i)=>key==='indices'?bytes.readUInt32LE(r.byteOffset+i*4):bytes.readFloatLE(r.byteOffset+i*4));}
  const{positions:p,normals:n,indices:ii}=arrays;assert.ok(p.every(Number.isFinite));assert.ok(n.every(Number.isFinite));assert.ok(ii.every(i=>i>=0&&i<mesh.vertices));
  let minY=Infinity,maxY=-Infinity;
  for(let i=0;i<mesh.vertices;i++){maxNormalError=Math.max(maxNormalError,Math.abs(Math.hypot(n[i*3],n[i*3+1],n[i*3+2])-1));minY=Math.min(minY,p[i*3+1]);maxY=Math.max(maxY,p[i*3+1]);}
  assert.ok(Math.abs(maxY-minY-mesh.heightM)<.0001);assert.ok(Math.abs(mesh.origin[1]-mesh.groundM)<1e-8);
  for(let i=0;i<ii.length;i+=3){const a=ii[i]*3,b=ii[i+1]*3,c=ii[i+2]*3,u=[p[b]-p[a],p[b+1]-p[a+1],p[b+2]-p[a+2]],v=[p[c]-p[a],p[c+1]-p[a+1],p[c+2]-p[a+2]],cross=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];if(Math.hypot(...cross)<1e-7)degenerate++;const dot=cross.reduce((sum,x,j)=>sum+x*(n[a+j]+n[b+j]+n[c+j]),0);assert.ok(dot>=-1e-7,'Triangle winding must agree with exported outward normals');}
  triangles+=mesh.triangles;vertices+=mesh.vertices;
}
assert.equal(degenerate,0);assert.ok(maxNormalError<1e-5);
const archive=await read('i3s/manifest.json');assert.equal(hash(await readFile(new URL(`i3s/${archive.archive.path}`,root))),archive.archive.sha256);
const archiveResult=execFileSync('python3',['-c',`import pathlib,json,tarfile,hashlib
p=pathlib.Path(${JSON.stringify(new URL('i3s/',root).pathname)})
m=json.loads((p/'manifest.json').read_text())
with tarfile.open(p/m['archive']['path'],'r:gz') as t:
 for r in m['requests']:
  b=t.extractfile(r['path']).read();assert len(b)==r['bytes'];assert hashlib.sha256(b).hexdigest()==r['sha256']
print(len(m['requests']))`],{encoding:'utf8'}).trim();
summary.geometry={buildings:meshes.buildings.length,vertices,triangles,degenerateTriangles:degenerate,maxNormalError,binarySha256:meshes.sha256,verifiedArchivedSourcePayloads:Number(archiveResult),archiveSha256:archive.archive.sha256};
const grid=await read('terrain/grid.json'),heightBytes=await readFile(new URL('terrain/heights.f32',root)),mask=await readFile(new URL('terrain/source-mask.u8',root));
assert.equal(hash(heightBytes),grid.sha256);assert.equal(hash(mask),grid.sourceMaskSha256);assert.equal(heightBytes.length,grid.width*grid.height*4);assert.equal(mask.length,grid.width*grid.height);
let fallback=0,min=Infinity,max=-Infinity;for(let i=0;i<mask.length;i++){const h=heightBytes.readFloatLE(i*4);assert.ok(Number.isFinite(h)&&h!==grid.noData);min=Math.min(min,h);max=Math.max(max,h);assert.ok(mask[i]===0||mask[i]===1);fallback+=mask[i];}
assert.equal(fallback,grid.fallbackPixels);assert.equal(min,grid.minM);assert.equal(max,grid.maxM);
summary.terrain={pixels:mask.length,fallbackPixels:fallback,minM:min,maxM:max,sha256:grid.sha256};
const reconciliation=await read('building-reconciliation.json');assert.equal(reconciliation.rows.length,590);assert.equal(reconciliation.counts.polygonParts,613);assert.equal(reconciliation.counts.exactI3sMatches,200);assert.equal(reconciliation.counts.unresolvedNewerFootprints,390);assert.ok(reconciliation.minimumExactBboxSimilarity>.98);summary.reconciliation=reconciliation.counts;
await writeFile(new URL('verification.json',root),JSON.stringify({status:'PASS',scope:'Offline source acquisition, byte integrity, all retained source features, triangulated geometry, datum/mask and identity ledger only; not runtime or photorealistic acceptance',...summary},null,2)+'\n');
console.log(JSON.stringify(summary,null,2));
