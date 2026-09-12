export type Point = [number,number,number];
export interface Origin {latitudeDegrees:number;longitudeDegrees:number;ellipsoidHeightM:number;}
export const ORIGIN:Readonly<Origin>=Object.freeze({latitudeDegrees:25.7662,longitudeDegrees:-80.1907,ellipsoidHeightM:0});
export const PROVISIONAL_POLICY=Object.freeze({id:'provisional-numeric-geoid18-v1',sourceHorizontal:'EPSG:4326; realization and coordinate epoch unresolved',sourceVertical:'NAVD88 metres (EPSG:5703)',geoidEvaluation:'Numeric source longitude/latitude used provisionally for GEOID18 evaluation; source is not relabelled NAD83(2011)',renderHeight:'H+N is NAD83(2011) ellipsoid height, used provisionally as WGS84-formula ellipsoid h',unresolved:'NAD83(2011) to renderer WGS84 realization/epoch transformation is not resolved; metre-scale, potentially 2m-level error remains. This is not a statistical bound or a surveyed correspondence claim.',status:'provisional' as const});
export interface GeoidGrid {width:number;height:number;longitudeOrigin:number;latitudeOrigin:number;longitudeStep:number;latitudeStep:number;values:number[];sourceSha256:string;rasterPixelIsPoint:boolean;}
const A=6378137,F=1/298.257223563,E2=F*(2-F),RAD=Math.PI/180;
export function ecef(longitude:number,latitude:number,h:number):Point{
 if(![longitude,latitude,h].every(Number.isFinite)||Math.abs(longitude)>180||Math.abs(latitude)>90)throw new TypeError('Invalid geodetic coordinate');
 const phi=latitude*RAD,lambda=longitude*RAD,s=Math.sin(phi),c=Math.cos(phi),n=A/Math.sqrt(1-E2*s*s);
 return [(n+h)*c*Math.cos(lambda),(n+h)*c*Math.sin(lambda),(n*(1-E2)+h)*s];
}
export function createGeoidSampler(grid:GeoidGrid){
 if(!Number.isInteger(grid.width)||!Number.isInteger(grid.height)||grid.width<2||grid.height<2||grid.values.length!==grid.width*grid.height||grid.longitudeStep<=0||grid.latitudeStep>=0||!grid.rasterPixelIsPoint||grid.values.some(v=>!Number.isFinite(v)))throw new TypeError('Invalid original GEOID18 point grid');
 return (longitude:number,latitude:number)=>{
  const x=(longitude-grid.longitudeOrigin)/grid.longitudeStep,y=(latitude-grid.latitudeOrigin)/grid.latitudeStep;
  if(![x,y].every(Number.isFinite)||x<0||y<0||x>grid.width-1||y>grid.height-1)throw new RangeError('GEOID18 sample outside retained coverage');
  const c=Math.min(Math.floor(x),grid.width-2),r=Math.min(Math.floor(y),grid.height-2),u=x-c,v=y-r;
  const a=grid.values[r*grid.width+c]*(1-u)+grid.values[r*grid.width+c+1]*u,b=grid.values[(r+1)*grid.width+c]*(1-u)+grid.values[(r+1)*grid.width+c+1]*u;
  return a*(1-v)+b*v;
 };
}
export class CommonFrame {
 readonly origin:Readonly<Origin>;readonly originECEF:Point;readonly geoidAt:(lon:number,lat:number)=>number;
 private axes:Point[];
 constructor(grid:GeoidGrid,readonly policy:typeof PROVISIONAL_POLICY,origin:Origin={...ORIGIN}){
  if(policy?.id!==PROVISIONAL_POLICY.id||policy.status!=='provisional')throw new Error('Explicit provisional source-frame policy is required');
  this.origin=Object.freeze({...origin});this.originECEF=ecef(origin.longitudeDegrees,origin.latitudeDegrees,origin.ellipsoidHeightM);this.geoidAt=createGeoidSampler(grid);
  const p=origin.latitudeDegrees*RAD,l=origin.longitudeDegrees*RAD;
  this.axes=[[-Math.sin(l),Math.cos(l),0],[Math.cos(p)*Math.cos(l),Math.cos(p)*Math.sin(l),Math.sin(p)],[-Math.sin(p)*Math.cos(l),-Math.sin(p)*Math.sin(l),Math.cos(p)]];
 }
 direction(v:Point):Point{return this.axes.map(a=>a.reduce((s,n,i)=>s+n*v[i],0)) as Point;}
 ellipsoidToLocal(lon:number,lat:number,h:number):Point{return this.direction(ecef(lon,lat,h).map((v,i)=>v-this.originECEF[i]) as Point);}
 navd88ToLocal(lon:number,lat:number,H:number):Point{return this.ellipsoidToLocal(lon,lat,H+this.geoidAt(lon,lat));}
 localToGeodetic(local:Point){
  if(!local.every(Number.isFinite))throw new TypeError('Invalid local point');
  const [x,y,z]=this.originECEF.map((v,i)=>v+this.axes.reduce((s,a,j)=>s+a[i]*local[j],0));
  const p=Math.hypot(x,y);if(p<1e-6)throw new RangeError('Polar/central inverse is outside this Miami frame');
  let phi=Math.atan2(z,p*(1-E2)),h=0;
  for(let i=0;i<12;i++){const s=Math.sin(phi),n=A/Math.sqrt(1-E2*s*s);h=p/Math.cos(phi)-n;const next=Math.atan2(z,p*(1-E2*n/(n+h)));if(Math.abs(next-phi)<1e-15){phi=next;break;}phi=next;}
  const latitude=phi/RAD,longitude=Math.atan2(y,x)/RAD,n=A/Math.sqrt(1-E2*Math.sin(phi)**2);h=p/Math.cos(phi)-n;
  return {longitude,latitude,ellipsoidHeightM:h};
 }
 localToProvisionalNavd88(local:Point){const g=this.localToGeodetic(local);return {...g,navd88M:g.ellipsoidHeightM-this.geoidAt(g.longitude,g.latitude),policyId:this.policy.id};}
}
