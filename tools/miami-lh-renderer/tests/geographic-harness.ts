import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {NullEngine,Scene,UniversalCamera,Vector3,type Mesh} from '@babylonjs/core';
import {LHTilesRenderer,type LHTile} from '../src/LHTilesRenderer';
import {tick} from './renderer-harness';
export const expected=JSON.parse(await readFile(new URL('../fixtures/geographic/expected.json',import.meta.url),'utf8'));
export async function geoHarness(name:string,options:{fetch?:(url:string,init:RequestInit)=>Promise<Response>;rootURL?:string;setup?:(renderer:LHTilesRenderer)=>void}={}){
 const fixture=expected.cases.find((v:{name:string})=>v.name===name),engine=new NullEngine({renderWidth:1600,renderHeight:900,textureSize:512,deterministicLockstep:false,lockstepMaxSteps:4}),scene=new Scene(engine);
 const origin=Vector3.FromArray(fixture.records.find((r:{name:string})=>r.name==='marker-origin').lhWorld[0]);
 const camera=new UniversalCamera('local-camera',origin.add(new Vector3(10,4,12)),scene);camera.minZ=.12;camera.maxZ=1500;camera.fov=.88;camera.setTarget(origin);
 const renderer=new LHTilesRenderer(options.rootURL??`https://fixture.invalid/geographic/${name}/tileset.json`,scene,{origin:expected.origin}),errors:Error[]=[],events:string[]=[],requests:string[]=[];
 renderer.addEventListener('load-error',event=>errors.push(event.error));for(const type of ['load-root-tileset','load-tileset','load-model'])renderer.addEventListener(type,()=>events.push(type));
 if(options.setup)options.setup(renderer);else renderer.registerPlugin({name:'GEOGRAPHIC_FIXTURE',async fetchData(url:string,init:RequestInit){requests.push(url);if(options.fetch)return options.fetch(url,init);return fixtureResponse(url);}});
 async function pump(predicate:()=>boolean=()=>renderer.visibleTiles.size>0){for(let i=0;i<300&&!predicate()&&!errors.length;i++){renderer.update();await tick();}return predicate();}
 const meshes=()=>[...renderer.visibleTiles].flatMap(tile=>(tile as LHTile).engineData.container?.meshes.filter(mesh=>mesh.getTotalVertices()>0)??[]) as Mesh[];
 return{fixture,engine,scene,camera,origin,renderer,errors,events,requests,pump,meshes,dispose(){renderer.dispose();scene.dispose();engine.dispose();}};
}
export async function fixtureResponse(url:string){const path=new URL(url).pathname;assert.ok(path.startsWith('/geographic/'));const file=new URL('../fixtures'+path,import.meta.url),bytes=await readFile(file);return new Response(bytes,{headers:{'Content-Type':path.endsWith('.json')?'application/json':'model/gltf-binary'}});}
