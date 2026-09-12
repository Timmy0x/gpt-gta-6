import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {CommonFrame,PROVISIONAL_POLICY,createGeoidSampler,type Point} from '../src/CommonFrame';
import {legacyHorizontalToGeographic,createDemSampler,createCommonSurfaceQuery} from '../src/SourceCoordinates';
import {projectMiami} from '../vendor/world/miami/projection';
import {insideMiamiPolygon} from '../vendor/world/miami/MiamiQueries';
const read=async(name:string)=>JSON.parse(await readFile(new URL('../'+name,import.meta.url),'utf8'));
const geoid=await read('data/geoid18.json'),frame=new CommonFrame(geoid,PROVISIONAL_POLICY),oracle=await read('data/proj-oracle.json'),coordinates=await read('output/coordinates.json');
test('actual source points match independent full PROJ arithmetic and retain NAVD88 on inverse',()=>{
 let maximum=0;
 for(const p of oracle.samples){const value=frame.navd88ToLocal(p.longitude,p.latitude,p.navd88M);maximum=Math.max(maximum,Math.hypot(...value.map((v,i)=>v-p.independentProjLocal[i])));assert.ok(Math.abs(frame.geoidAt(p.longitude,p.latitude)-p.independentGeoidM)<1e-9);const back=frame.localToProvisionalNavd88(value);assert.ok(Math.abs(back.longitude-p.longitude)<1e-10);assert.ok(Math.abs(back.latitude-p.latitude)<1e-10);assert.ok(Math.abs(back.navd88M-p.navd88M)<1e-7);}
 assert.ok(maximum<1e-6);assert.ok(oracle.samples.length>=23);
});
test('source uncertainty is mandatory, missing grid coverage fails, and zero-height ellipsoid has curvature',()=>{
 assert.throws(()=>new CommonFrame(geoid,undefined as never),/Explicit provisional/);
 assert.throws(()=>frame.navd88ToLocal(0,0,0),/outside/);
 assert.throws(()=>createGeoidSampler({...geoid,rasterPixelIsPoint:false}),/point grid/);
 const distant=frame.ellipsoidToLocal(-80.1925,25.7646,0);assert.ok(distant[1]<-.003);
 assert.match(frame.policy.unresolved,/2m-level/);assert.equal(frame.policy.sourceHorizontal,'EPSG:4326; realization and coordinate epoch unresolved');
});
test('old horizontal source frame can be inverted without treating its NAVD88 ordinate as ellipsoid height',()=>{
 for(let i=0;i<100;i++){const lon=-80.1925+i%10*.00035,lat=25.7646+Math.floor(i/10)*.00031,legacy=projectMiami(lon,lat,3),inverse=legacyHorizontalToGeographic(legacy[0],legacy[2]);assert.ok(Math.abs(lon-inverse.longitude)<1e-10);assert.ok(Math.abs(lat-inverse.latitude)<1e-10);}
});
test('common x/z surface query solves converted DEM and excludes water/out-of-AOI',async()=>{
 const grid=await read('data/terrain/grid.json'),b=await readFile(new URL('../data/terrain/heights.f32',import.meta.url)),m=await readFile(new URL('../data/terrain/source-mask.u8',import.meta.url));
 const sample=createDemSampler(grid,new Float32Array(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)),m),isDry=(lon:number,lat:number)=>{const p=projectMiami(lon,lat);return coordinates.dryCoverageLegacy.polygons.some((polygon:any)=>insideMiamiPolygon(p[0],p[2],polygon));},query=createCommonSurfaceQuery(frame,sample,isDry);
 for(const point of coordinates.locations){const source=sample(point.longitude,point.latitude)!;const local=frame.navd88ToLocal(point.longitude,point.latitude,source.navd88M),got=query(local[0],local[2]);assert.ok(got);assert.ok(Math.hypot(...got.point.map((v,i)=>v-local[i]))<1e-5);assert.ok(Math.abs(got.navd88M-source.navd88M)<1e-5);}
 assert.equal(query(10000,10000),null);
 const wet=legacyHorizontalToGeographic(476.5776054264012,71.36377798192005);assert.equal(isDry(wet.longitude,wet.latitude),false);const water=frame.navd88ToLocal(wet.longitude,wet.latitude,0);assert.equal(query(water[0],water[2]),null);
});
