import {CommonFrame,PROVISIONAL_POLICY,type GeoidGrid} from './CommonFrame';
import {createDemSampler,createCommonSurfaceQuery,type DemGrid} from './SourceCoordinates';
import {projectMiami} from '../projection';
import {insideMiamiPolygon} from '../MiamiQueries';
import type {MiamiPolygon} from '../types';
export interface PublicQueryConfig {version:1;worldId:string;policyId:string;geoid:GeoidGrid;grid:DemGrid;dryCoverageLegacy:{polygons:MiamiPolygon[]};heightsUrl:string;maskUrl:string;}
export function createPublicCollisionQueries(config:PublicQueryConfig,heights:Float32Array,mask:Uint8Array){
 if(config.version!==1||config.policyId!==PROVISIONAL_POLICY.id)throw new Error('Unsupported public collision coordinate frame');
 const frame=new CommonFrame(config.geoid,PROVISIONAL_POLICY),sample=createDemSampler(config.grid,heights,mask);
 const isDry=(lon:number,lat:number)=>{const p=projectMiami(lon,lat);return config.dryCoverageLegacy.polygons.some(poly=>insideMiamiPolygon(p[0],p[2],poly));};
 const surfaceAt=createCommonSurfaceQuery(frame,sample,isDry);
 return {frame,worldId:config.worldId,policy:PROVISIONAL_POLICY,surfaceAt,
  floorHeightAt(x:number,z:number):number|null{return surfaceAt(x,z)?.point[1]??null;},
  /** A DEM floor query is not a walkability, road, entrance, bridge or safe-spawn test. */
  hasSourceGround(x:number,z:number){return surfaceAt(x,z)!==null;},
  navd88HeightAt(longitude:number,latitude:number){return isDry(longitude,latitude)?sample(longitude,latitude):null;},
 };
}
export async function loadPublicCollisionQueries(baseUrl:string,fetcher:typeof fetch=fetch){
 const base=new URL(baseUrl,globalThis.location?.href??'http://localhost/');
 const get=async(path:string)=>{const response=await fetcher(new URL(path,base));if(!response.ok)throw new Error(`Public collision query input failed (${response.status})`);return response;};
 const config=await (await get('runtime-query.json')).json() as PublicQueryConfig;
 const [h,m]=await Promise.all([(await get(config.heightsUrl)).arrayBuffer(),(await get(config.maskUrl)).arrayBuffer()]);
 return createPublicCollisionQueries(config,new Float32Array(h),new Uint8Array(m));
}
