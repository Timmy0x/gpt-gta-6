import test from 'node:test';
import assert from 'node:assert/strict';
import { MIAMI_ORIGIN, projectMiami } from '../src/world/miami/projection';
import { assembleMiamiDataset, type MiamiDatasetInputs, type MiamiGeoFeature } from '../src/world/miami/MiamiDataset';

const feature = (id: number, properties: Record<string, unknown>, type: string, coordinates: any): MiamiGeoFeature => ({ id, properties, geometry: { type, coordinates } });
const ring = [[-80.193,25.765],[-80.1929,25.765],[-80.1929,25.7651],[-80.193,25.7651],[-80.193,25.765]];
function inputs(): MiamiDatasetInputs {
  return { id:'brickell-fixture',bboxWgs84:[-80.194,25.764,-80.192,25.766],
    streets:{features:[feature(10,{St_Label:'SE 8TH ST',One_Way:'TF',TF_Cost:100,FT_Cost:-1,Rd_Class:2},'LineString',[[-80.193,25.765],[-80.192,25.765]])]},
    buildings:{features:[feature(20,{UNIQUEID:'tower-1',HEIGHT:null,YEARUPDATE:2023},'Polygon',[ring])]},
    water:{features:[feature(30,{},'Polygon',[ring])]},boundary:{features:[feature(1,{},'Polygon',[ring])]},osm:{features:[]},envelopes:[],
    sources:['city-streets','county-buildings','city-water','county-i3s-buildings','osm-brickell-supplement'].map(id=>({id,url:`https://example.invalid/${id}`,retrieved:'2026-09-12',license:'fixture',attribution:'fixture'})) };
}
test('Miami projection is metre-scale ENU with independent survey elevation',()=>{
  assert.deepEqual(projectMiami(MIAMI_ORIGIN.longitude,MIAMI_ORIGIN.latitude),[0,0,0]);
  const east=projectMiami(-80.192,25.765,17.3),north=projectMiami(-80.193,25.766);
  // WGS84 radii of curvature at Brickell: one millidegree is about100.32m east/110.78m north.
  assert.ok(east[0]>100.2&&east[0]<100.4);assert.ok(Math.abs(east[2])<.001);assert.equal(east[1],17.3);
  assert.ok(north[2]>110.7&&north[2]<110.9);assert.ok(Math.abs(north[0])<1e-8);
  for(const coordinate of [[NaN,25],[-181,25],[1,91]])assert.throws(()=>projectMiami(coordinate[0],coordinate[1]));
});
test('source direction and full footprint holes survive normalization; null heights stay unavailable',()=>{
  const input=inputs();input.buildings.features[0].geometry.coordinates.push(ring.map(([lon,lat])=>[lon+.00002,lat+.00002]));
  const data=assembleMiamiDataset(input),road=data.roads[0],building=data.buildings[0];
  assert.ok(road.oneway);assert.ok(road.centerline[0][0]>road.centerline.at(-1)![0]);
  assert.equal(road.widthConfidence,'inferred');assert.equal(building.heightM,0);assert.equal(building.mappedMeshId,undefined);
  assert.equal(building.footprint.length,2);assert.ok(building.gaps.some(g=>g.includes('no tower height is fabricated')));
  assert.equal(data.municipalBoundary?.length,1);assert.ok(data.bounds.minX<0&&data.bounds.maxZ>0);
});
test('only exact source building identity joins height, with source date discrepancies retained',()=>{
  const input=inputs();input.envelopes=[{id:'mesh-1',sourceUniqueId:'tower-1',groundM:1.24,heightM:137.1,yearUpdated:2015},{id:'wrong',sourceUniqueId:'adjacent',groundM:0,heightM:300,yearUpdated:2023}];
  const building=assembleMiamiDataset(input).buildings[0];
  assert.equal(building.mappedMeshId,'mesh-1');assert.equal(building.heightM,137.1);assert.equal(building.groundM,1.24);
  assert.ok(building.gaps.some(g=>g.includes('postdates')));
  input.sources=input.sources.filter(s=>s.id!=='county-i3s-buildings');assert.throws(()=>assembleMiamiDataset(input),/Missing provenance/);
});
test('contradictory City FT/TF direction is rejected instead of reversing traffic silently',()=>{
  const input=inputs();input.streets.features[0].properties.TF_Cost=-1;assert.throws(()=>assembleMiamiDataset(input),/Conflicting street direction/);
});
