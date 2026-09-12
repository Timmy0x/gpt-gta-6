import {projectMiami,MIAMI_ORIGIN} from '../projection';
import {CommonFrame,type Point} from './CommonFrame';
export function legacyHorizontalToGeographic(x:number,z:number){
 let lon:number=MIAMI_ORIGIN.longitude,lat:number=MIAMI_ORIGIN.latitude;
 for(let i=0;i<6;i++){
  const p=projectMiami(lon,lat),dx=x-p[0],dz=z-p[2];if(Math.hypot(dx,dz)<1e-8)break;
  const step=1e-5,a=projectMiami(lon+step,lat),b=projectMiami(lon,lat+step),ex=(a[0]-p[0])/step,ez=(a[2]-p[2])/step,nx=(b[0]-p[0])/step,nz=(b[2]-p[2])/step,det=ex*nz-ez*nx;
  lon+=(dx*nz-dz*nx)/det;lat+=(dz*ex-dx*ez)/det;
 }
 const p=projectMiami(lon,lat);if(Math.hypot(x-p[0],z-p[2])>1e-5)throw new Error('Legacy horizontal inverse did not converge');
 return {longitude:lon,latitude:lat};
}
export interface DemGrid {width:number;height:number;pixelCenterLongitude:number;pixelCenterLatitude:number;longitudeStep:number;latitudeStep:number;noData:number;}
export function createDemSampler(grid:DemGrid,heights:Float32Array,mask:Uint8Array){
 if(heights.length!==grid.width*grid.height||mask.length!==heights.length)throw new Error('DEM layout mismatch');
 return (lon:number,lat:number)=>{
  const x=(lon-grid.pixelCenterLongitude)/grid.longitudeStep,y=(lat-grid.pixelCenterLatitude)/grid.latitudeStep;
  if(![x,y].every(Number.isFinite)||x<0||y<0||x>grid.width-1||y>grid.height-1)return null;
  const c=Math.min(Math.floor(x),grid.width-2),r=Math.min(Math.floor(y),grid.height-2),u=x-c,v=y-r,indices=[r*grid.width+c,r*grid.width+c+1,(r+1)*grid.width+c,(r+1)*grid.width+c+1],h=indices.map(i=>heights[i]);
  if(h.some(n=>!Number.isFinite(n)||n===grid.noData))return null;
  return {navd88M:(h[0]*(1-u)+h[1]*u)*(1-v)+(h[2]*(1-u)+h[3]*u)*v,usesOlderFallback:indices.some(i=>mask[i]===1)};
 };
}
/** Solve x/z on the actual converted DEM surface, without assuming survey height equals local Up. */
export function createCommonSurfaceQuery(frame:CommonFrame,sample:ReturnType<typeof createDemSampler>,isDry:(lon:number,lat:number)=>boolean){
 return (x:number,z:number)=>{
  if(![x,z].every(Number.isFinite))return null;
  const seed=frame.localToGeodetic([x,-25,z]);let lon=seed.longitude,lat=seed.latitude;
  let local:Point=[0,0,0];
  for(let i=0;i<8;i++){
   const h=sample(lon,lat);if(!h)return null;local=frame.navd88ToLocal(lon,lat,h.navd88M);
   const dx=x-local[0],dz=z-local[2];if(Math.hypot(dx,dz)<1e-6){if(!isDry(lon,lat))return null;return {point:local,longitude:lon,latitude:lat,navd88M:h.navd88M,usesOlderFallback:h.usesOlderFallback,policyId:frame.policy.id};}
   const s=1e-6,eh=sample(lon+s,lat),nh=sample(lon,lat+s);if(!eh||!nh)return null;
   const e=frame.navd88ToLocal(lon+s,lat,eh.navd88M),n=frame.navd88ToLocal(lon,lat+s,nh.navd88M),ex=(e[0]-local[0])/s,ez=(e[2]-local[2])/s,nx=(n[0]-local[0])/s,nz=(n[2]-local[2])/s,det=ex*nz-nx*ez;
   if(!Number.isFinite(det)||Math.abs(det)<1)return null;lon+=(dx*nz-dz*nx)/det;lat+=(dz*ex-dx*ez)/det;
  }
  throw new Error('Common-frame surface query did not converge');
 };
}
