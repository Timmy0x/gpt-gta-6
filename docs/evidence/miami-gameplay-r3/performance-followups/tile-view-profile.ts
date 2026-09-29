import assert from 'node:assert/strict';
import { cpus } from 'node:os';
import { Frustum, Logger, Matrix, NullEngine, Scene, UniversalCamera, Vector3 } from '../miami-gameplay-r3-source/node_modules/@babylonjs/core/index.js';
import { LHTilesRenderer, type LHTile, type TileView } from '../miami-gameplay-r3-source/src/world/miami/visuals/LHTilesRenderer';
import { LocalTileBounds } from '../miami-gameplay-r3-source/src/world/miami/visuals/LocalTileBounds';
import { identity } from '../miami-gameplay-r3-source/src/world/miami/visuals/DoubleFrame';

// Read-only native investigation: synthetic local bounds, no tile fetch, importer or provider content.
globalThis.window ??= { location: { href: 'https://fixture.invalid/' }, addEventListener() {}, removeEventListener() {} } as unknown as Window & typeof globalThis;
globalThis.requestAnimationFrame ??= callback => setTimeout(() => callback(performance.now()), 0) as unknown as number;
globalThis.cancelAnimationFrame ??= id => clearTimeout(id);
Logger.LogLevels = Logger.NoneLogLevel;
const engine = new NullEngine({ renderWidth: 1512, renderHeight: 812, textureSize: 512, deterministicLockstep: false, lockstepMaxSteps: 4 });
const scene = new Scene(engine), camera = new UniversalCamera('existing-game-camera', new Vector3(20,-18,-7), scene);
camera.setTarget(new Vector3(0,-20,10)); camera.minZ=.12; camera.maxZ=1500; camera.fov=.88;
const renderer = new LHTilesRenderer('https://fixture.invalid/root.json', scene, { tileToLocal: Matrix.Scaling(1,1,-1) });
const tiles: LHTile[] = Array.from({ length: 1000 }, (_,i) => ({ geometricError: (i % 8) + 1, engineData: { errorScale: 1 + (i % 3) * .1, boundingVolume: new LocalTileBounds({ box: [(i%40)*35-600, -20 + (i%7)*15, Math.floor(i/40)*35-450, 12,0,0, 0,30,0, 0,0,12] }, identity()) } } as LHTile));
const results: TileView[] = tiles.map(() => ({ inView:false,error:0,distanceFromCamera:0 }));
function snapshot() {
  const width=engine.getRenderWidth(true)*camera.viewport.width,height=engine.getRenderHeight(true)*camera.viewport.height,projection=camera.getProjectionMatrix().m;
  const inverseGroup=renderer.group.computeWorldMatrix(true).clone().invert();
  const planes=Frustum.GetPlanes(camera.getViewMatrix(true).multiply(camera.getProjectionMatrix())).map(plane=>plane.transform(inverseGroup));
  const position=Vector3.TransformCoordinates(camera.globalPosition,inverseGroup);
  return {width,height,projection,planes,position};
}
function cachedBatch() {
  const s=snapshot();
  tiles.forEach((tile,i)=>{
    const target=results[i],bounds=tile.engineData.boundingVolume,distance=bounds.distanceToPoint(s.position),error=tile.geometricError*tile.engineData.errorScale;
    target.inView=bounds.intersectsFrustum(s.planes);target.distanceFromCamera=distance;
    target.error=s.projection[15]===1?error/Math.max(2/Math.abs(s.projection[0])/s.width,2/Math.abs(s.projection[5])/s.height):distance===0?Infinity:error*s.height*Math.abs(s.projection[5])/(2*distance);
  });
}
let checked=0;
for(const ortho of [false,true])for(const transformed of [false,true]) {
  camera.mode=ortho?1:0;camera.orthoLeft=-60;camera.orthoRight=60;camera.orthoTop=40;camera.orthoBottom=-40;
  renderer.group.position.set(transformed?123:0,transformed?-12:0,transformed?88:0);renderer.group.rotation.y=transformed?.32:0;
  const expected=tiles.map(tile=>{const result={inView:false,error:0,distanceFromCamera:0};renderer.calculateTileViewError(tile,result);return result;});
  cachedBatch();assert.deepEqual(results,expected);checked+=tiles.length;
}
camera.mode=0;renderer.group.position.setAll(0);renderer.group.rotation.setAll(0);
const nativeBatch=()=>tiles.forEach((tile,i)=>renderer.calculateTileViewError(tile,results[i]));
function measure(fn:()=>void) {const samples:number[]=[];for(let i=0;i<35;i++){const start=performance.now();fn();if(i>=5)samples.push(performance.now()-start);}samples.sort((a,b)=>a-b);return{batches:samples.length,medianMs:samples[15],p95Ms:samples[28],maxMs:samples.at(-1)};}
const native=measure(nativeBatch),frameSnapshot=measure(cachedBatch);
console.log(JSON.stringify({scope:'Synthetic native CPU-only 1000 local bounds evaluations; no provider data, live traversal or browser FPS claim',node:process.version,cpu:cpus()[0]?.model,measuredAt:new Date().toISOString(),tilesPerBatch:tiles.length,equivalenceChecks:checked,native,frameSnapshot},null,2));
renderer.dispose();scene.dispose();engine.dispose();
