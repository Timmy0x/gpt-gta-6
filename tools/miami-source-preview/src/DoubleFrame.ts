/** Column-major, double-precision affine arithmetic. No Babylon Matrix is created before rebasing. */
export type Vec3 = [number,number,number];
export type DoubleMatrix = readonly number[];
export const identity = ():number[] => [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
export const translation = (v:readonly number[]):number[] => [1,0,0,0,0,1,0,0,0,0,1,0,v[0],v[1],v[2],1];
export function multiply(a:DoubleMatrix,b:DoubleMatrix):number[]{return Array.from({length:16},(_,i)=>{let sum=0;const r=i%4,c=Math.floor(i/4);for(let k=0;k<4;k++)sum+=a[k*4+r]*b[c*4+k];return sum;});}
export function point(m:DoubleMatrix,p:readonly number[]):Vec3{return [0,1,2].map(r=>m[r]*p[0]+m[4+r]*p[1]+m[8+r]*p[2]+m[12+r]) as Vec3;}
export function direction(m:DoubleMatrix,p:readonly number[]):Vec3{return [0,1,2].map(r=>m[r]*p[0]+m[4+r]*p[1]+m[8+r]*p[2]) as Vec3;}
export function affine(m:DoubleMatrix){if(m.length!==16||m.some(v=>!Number.isFinite(v))||Math.abs(m[3])+Math.abs(m[7])+Math.abs(m[11])+Math.abs(m[15]-1)>1e-10)throw new Error('Tile transform must be a finite affine 4x4 matrix.');}
export function upRotation(axis:string):number[]{if(axis==='Y')return [1,0,0,0,0,0,1,0,0,-1,0,0,0,0,0,1];if(axis==='X')return [0,0,1,0,0,1,0,0,-1,0,0,0,0,0,0,1];if(axis==='Z')return identity();throw new Error(`Unsupported glTF up axis: ${axis}`);}
export interface EllipsoidOrigin { latitudeDegrees:number; longitudeDegrees:number; ellipsoidHeightM:number; }
const A=6378137,F=1/298.257223563,E2=F*(2-F),RAD=Math.PI/180;
export function wgs84ECEF(latitudeRadians:number,longitudeRadians:number,height:number):Vec3{const sin=Math.sin(latitudeRadians),cos=Math.cos(latitudeRadians),n=A/Math.sqrt(1-E2*sin*sin);return [(n+height)*cos*Math.cos(longitudeRadians),(n+height)*cos*Math.sin(longitudeRadians),(n*(1-E2)+height)*sin];}
export class ECEFLocalFrame {
  readonly originECEF:Vec3;
  readonly origin:Readonly<EllipsoidOrigin>;
  private readonly axes:[Vec3,Vec3,Vec3];
  constructor(origin:EllipsoidOrigin){
    if(![origin.latitudeDegrees,origin.longitudeDegrees,origin.ellipsoidHeightM].every(Number.isFinite)||Math.abs(origin.latitudeDegrees)>90||Math.abs(origin.longitudeDegrees)>180)throw new Error('Specify finite WGS84 latitude/longitude and ellipsoidal height.');
    this.origin=Object.freeze({...origin});const lat=origin.latitudeDegrees*RAD,lon=origin.longitudeDegrees*RAD;
    this.originECEF=wgs84ECEF(lat,lon,origin.ellipsoidHeightM);
    this.axes=[[-Math.sin(lon),Math.cos(lon),0],[Math.cos(lat)*Math.cos(lon),Math.cos(lat)*Math.sin(lon),Math.sin(lat)],[-Math.sin(lat)*Math.cos(lon),-Math.sin(lat)*Math.sin(lon),Math.cos(lat)]];
  }
  direction(v:readonly number[]):Vec3{return this.axes.map(a=>a[0]*v[0]+a[1]*v[1]+a[2]*v[2]) as Vec3;}
  point(v:readonly number[]):Vec3{return this.direction(v.map((n,i)=>n-this.originECEF[i]));}
  matrix(m:DoubleMatrix):number[]{affine(m);const x=this.direction(m.slice(0,3)),y=this.direction(m.slice(4,7)),z=this.direction(m.slice(8,11)),t=this.point(m.slice(12,15));return [...x,0,...y,0,...z,0,...t,1];}
}
// Conservative interval enclosure, rather than corner-only sampling of a curved geographic region.
type Interval=[number,number];
const add=(a:Interval,b:Interval):Interval=>[a[0]+b[0],a[1]+b[1]];
const times=(a:Interval,b:Interval):Interval=>{const p=[a[0]*b[0],a[0]*b[1],a[1]*b[0],a[1]*b[1]];return [Math.min(...p),Math.max(...p)];};
function trig(lo:number,hi:number,cos=false):Interval{if(hi-lo>=2*Math.PI)return [-1,1];const fn=cos?Math.cos:Math.sin,values=[fn(lo),fn(hi)],start=cos?0:Math.PI/2;for(let k=Math.ceil((lo-start)/Math.PI);start+k*Math.PI<=hi;k++)values.push(fn(start+k*Math.PI));return [Math.min(...values),Math.max(...values)];}
export function geographicRegionCorners(region:readonly number[]):Vec3[]{
 if(region.length!==6||region.some(v=>!Number.isFinite(v)))throw new Error('Invalid geographic region.');
 let [west,south,east,north,low,high]=region;if(Math.abs(west)>Math.PI||Math.abs(east)>Math.PI)throw new Error('Geographic longitudes must be in [-pi, pi].');if(west>east)east+=2*Math.PI;
 if(south>north||south< -Math.PI/2||north>Math.PI/2||low>high||east-west>2*Math.PI+1e-10)throw new Error('Invalid geographic region extent.');
 const sin=trig(south,north),cos=trig(south,north,true),sin2:Interval=[sin[0]<=0&&sin[1]>=0?0:Math.min(sin[0]**2,sin[1]**2),Math.max(sin[0]**2,sin[1]**2)],n:Interval=[A/Math.sqrt(1-E2*sin2[0]),A/Math.sqrt(1-E2*sin2[1])];
 const radial=times(add(n,[low,high]),cos),x=times(radial,trig(west,east,true)),y=times(radial,trig(west,east)),z=times(add([n[0]*(1-E2),n[1]*(1-E2)],[low,high]),sin);
 return Array.from({length:8},(_,i)=>[x[i&1?1:0],y[i&2?1:0],z[i&4?1:0]] as Vec3);
}

/** Conservative maximum linear stretch; exact for orthogonal rotation/scale axes. */
export function maximumStretch(m:DoubleMatrix):number{
 const gram=Array.from({length:3},(_,row)=>Array.from({length:3},(_,col)=>[0,1,2].reduce((s,k)=>s+m[row*4+k]*m[col*4+k],0)));
 return Math.sqrt(Math.max(...gram.map(row=>row.reduce((s,v)=>s+Math.abs(v),0))));
}
