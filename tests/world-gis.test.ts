import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { project, stitch, signedArea } from '../scripts/gis/import.mjs';
const origin={longitude:-80.1309,latitude:25.7823,elevation:0};

test('WGS84 tangent-plane projection preserves origin, east/north orientation and local metre scale',()=>{
 assert.deepEqual(project(origin.longitude,origin.latitude,origin),[0,0]);
 const east=project(origin.longitude+.001,origin.latitude,origin),north=project(origin.longitude,origin.latitude+.001,origin);
 assert.ok(east[0]>99&&east[0]<102);assert.ok(Math.abs(east[1])<.01);
 assert.ok(north[1]>109&&north[1]<112);assert.ok(Math.abs(north[0])<.01);
});

test('multipolygon chains join shared node IDs in either direction and reject open rings',()=>{
 const rings=stitch([[1,2],[3,2],[3,1]]);assert.equal(rings.length,1);assert.equal(rings[0][0],rings[0].at(-1));assert.equal(new Set(rings[0]).size,3);
 assert.throws(()=>stitch([[1,2],[3,4]]),/unclosed/);
});

test('acquired GIS extract retains provenance, closed footprints and explicit disconnected source topology',async()=>{
 const root=new URL('../data/gis/miami-beach/',import.meta.url);
 const source=JSON.parse(await readFile(new URL('source.json',root),'utf8')),raw=await readFile(new URL('raw-overpass.json',root));
 assert.equal(createHash('sha256').update(raw).digest('hex'),source.rawSha256);assert.equal(source.attribution,'© OpenStreetMap contributors');assert.match(source.license,/ODbL/);
 const local=JSON.parse(await readFile(new URL('miami-beach-local.geojson',root),'utf8')),report=JSON.parse(await readFile(new URL('validation.json',root),'utf8'));
 assert.equal(local.coordinateSystem.units,'metres');assert.equal(local.coordinateSystem.rfc7946,false);assert.equal(local.features.length,2333);
 for(const f of local.features.filter((f:{geometry:{type:string}})=>f.geometry.type!=='LineString'))for(const polygon of f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.coordinates)for(let i=0;i<polygon.length;i++){const ring=polygon[i];assert.deepEqual(ring[0],ring.at(-1));assert.ok(i===0?signedArea(ring)>0:signedArea(ring)<0);}
 assert.deepEqual(report.errors,[]);assert.equal(report.topology.components,2);assert.deepEqual(report.topology.sizes,[4636,9]);assert.ok(report.maxSegmentRelativeDifference<.006);
});
