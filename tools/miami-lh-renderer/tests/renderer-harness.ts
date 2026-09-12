import { readFile } from 'node:fs/promises';
import { Matrix, NullEngine, Scene, UniversalCamera, Vector3, type Mesh } from '@babylonjs/core';
import { LHTilesRenderer, type LHTile, type LHRendererOptions } from '../src/LHTilesRenderer';
import { expected, glb, mirror } from './frame-fixture';

// The core renderer uses window.location only to resolve root URLs in its browser API.
globalThis.window ??= {location:{href:'https://fixture.invalid/'},addEventListener(){},removeEventListener(){}} as unknown as Window & typeof globalThis;
globalThis.requestAnimationFrame ??= callback => setTimeout(() => callback(performance.now()),0) as unknown as number;
globalThis.cancelAnimationFrame ??= id => clearTimeout(id);
export const sourceTileset = JSON.parse(await readFile(new URL('../fixtures/tileset.json',import.meta.url),'utf8'));
export const tileFrame = () => Matrix.FromArray(expected.frame).multiply(Matrix.Scaling(1,1,-1));
export const tick = () => new Promise(resolve => setTimeout(resolve,0));
export interface HarnessOptions {
  tileset?: typeof sourceTileset;
  target?: Vector3;
  Renderer?: new(url:string,scene:Scene,options:LHRendererOptions) => LHTilesRenderer;
  waitForVisible?: boolean;
  content?: Uint8Array;
  framebuffer?: [number,number];
  rootFetch?: (init:RequestInit)=>Promise<Response>;
}
export async function harness(options: HarnessOptions = {}) {
  const engine = new NullEngine({renderWidth:options.framebuffer?.[0]??1600,renderHeight:options.framebuffer?.[1]??900,textureSize:512,deterministicLockstep:false,lockstepMaxSteps:4});
  const scene = new Scene(engine);
  const origin = options.target ?? mirror(Vector3.FromArray(expected.records.find(r=>r.name==='marker-origin')!.rhWorld[0]));
  const camera = new UniversalCamera('existing-LH-camera',origin.add(new Vector3(10,4,12)),scene);
  camera.minZ=.12; camera.maxZ=1500; camera.fov=.88; camera.setTarget(origin);
  const renderer = new (options.Renderer ?? LHTilesRenderer)('https://fixture.invalid/fixtures/tileset.json',scene,{tileToLocal:tileFrame()});
  const requests:string[]=[],errors:Error[]=[],events:string[]=[];
  const data = structuredClone(options.tileset ?? sourceTileset);
  const content = options.content ?? glb;
  renderer.registerPlugin({name:'ORIGINAL_FIXTURE_TRANSPORT',async fetchData(url:string,init:RequestInit){
    requests.push(url); if(init.signal?.aborted)throw new DOMException('Fixture cancelled','AbortError');
    if(url==='https://fixture.invalid/fixtures/tileset.json'&&options.rootFetch)return options.rootFetch(init);
    if(url==='https://fixture.invalid/fixtures/tileset.json')return new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
    if(url==='https://fixture.invalid/fixtures/asymmetric.glb')return new Response(new Uint8Array(content),{headers:{'Content-Type':'model/gltf-binary'}});
    throw new Error('Unexpected fixture request '+url);
  }});
  renderer.addEventListener('load-error',event=>errors.push(event.error));
  for(const name of ['load-root-tileset','load-model','tile-visibility-change','dispose-model'])renderer.addEventListener(name,()=>events.push(name));
  function meshes(){return [...renderer.visibleTiles].flatMap(tile=>(tile as LHTile).engineData.container?.meshes.filter(mesh=>mesh.getTotalVertices()>0) ?? []) as Mesh[];}
  const dispose=()=>{renderer.dispose();scene.dispose();engine.dispose();};
  async function pump(predicate:()=>boolean=()=>renderer.visibleTiles.size>0){for(let i=0;i<200&&!predicate()&&!errors.length;i++){renderer.update();await tick();}return predicate();}
  if(options.waitForVisible!==false){await pump();if(errors.length){dispose();throw errors[0];}if(!renderer.visibleTiles.size){dispose();throw new Error('Fixture tile did not become visible.');}}
  return {engine,scene,camera,origin,renderer,requests,errors,events,meshes,pump,dispose};
}
