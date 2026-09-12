import {writeFileSync} from 'node:fs';
import {Vector3} from '../miami-lh-renderer-r2-2-source/node_modules/@babylonjs/core/Maths/math.vector.js';
import {LocalTileBounds} from '../miami-lh-renderer-r2-2-source/src/LocalTileBounds.ts';
import {identity,ECEFLocalFrame} from '../miami-lh-renderer-r2-2-source/src/DoubleFrame.ts';

// Original independent numerical inputs. No renderer, graphics, source payload or network.
const add=(a:number[],b:number[])=>a.map((v,i)=>v+b[i]);
const mul=(a:number[],s:number)=>a.map(v=>v*s);
const cases:{id:string;center:number[];edges:number[][];points:{point:number[];inside:boolean}[]}[]=[];
for(let i=0;i<48;i++){
 const a=i*.381,b=i*.119,ca=Math.cos(a),sa=Math.sin(a),cb=Math.cos(b),sb=Math.sin(b);
 const orthogonal=[[ca*cb,sa*cb,-sb],[-sa,ca,0],[ca*sb,sa*sb,cb]];
 const half=[10**(i%7-2),i%6===0?0:10**(i%5-8),i%4===0?0:4+i];
 const shear=i%3===0?.75:i%3===1?1e-9:0;
 const edges=[mul(orthogonal[0],half[0]),mul(add(orthogonal[1],mul(orthogonal[0],shear)),half[1]),mul(add(orthogonal[2],mul(orthogonal[1],-.2*shear)),half[2])];
 const center=[120+i*.13,-42+i*.29,1000-i*.17];
 const points=[];
 for(let j=0;j<20;j++){
  const weights=j<8?[j&1?1:-1,j&2?1:-1,j&4?1:-1]:[Math.sin(j*.37),Math.cos(j*.53),Math.sin(j*.83)];
  points.push({point:edges.reduce((p,e,k)=>add(p,mul(e,weights[k])),center),inside:true});
 }
 for(let j=0;j<10;j++)points.push({point:add(center,[Math.sin(j*.91)*2000,Math.cos(j*.39)*1000,Math.sin(j*.67)*1500]),inside:false});
 cases.push({id:`case-${i}`,center,edges,points});
}
cases.push({id:'near-orthogonal-long-axis',center:[0,0,0],edges:[[1e7,0,0],[1e-9,1,0],[0,0,1]],points:[{point:[1e7,0,0],inside:true},{point:[1e7+1,2,3],inside:false}]});
cases.push({id:'zero-volume',center:[1,2,3],edges:[[0,0,0],[0,0,0],[0,0,0]],points:[{point:[1,2,3],inside:true},{point:[4,6,3],inside:false}]});
cases.push({id:'tiny-axes',center:[0,0,0],edges:[[1e-180,0,0],[0,1e-160,0],[0,0,1e-140]],points:[{point:[1e-180,1e-160,1e-140],inside:true},{point:[1,2,3],inside:false}]});
for(let i=1;i<=30;i++){
 const base=[Math.sin(i*.172)*1e7,Math.cos(i*.331)*1e7,Math.sin(i*.732)*1e7];
 const edges=[base,mul(base,.3),mul(base,1e-9)];
 cases.push({id:`collinear-large-${i}`,center:[0,0,0],edges,points:[{point:edges.reduce(add,[0,0,0]),inside:true},{point:mul(base,.5),inside:true},{point:[3,-2,1],inside:false}]});
}
const frame=new ECEFLocalFrame({latitudeDegrees:25.7662,longitudeDegrees:-80.1907,ellipsoidHeightM:0});
const lat=25.7662*Math.PI/180,lon=-80.1907*Math.PI/180;
const rotate=(v:number[])=>[-Math.sin(lon)*v[0]+Math.cos(lon)*v[1],Math.cos(lat)*Math.cos(lon)*v[0]+Math.cos(lat)*Math.sin(lon)*v[1]+Math.sin(lat)*v[2],-Math.sin(lat)*Math.cos(lon)*v[0]-Math.sin(lat)*Math.sin(lon)*v[1]+Math.cos(lat)*v[2]];
const earthSources=new Map<string,number[]>();
for(let i=0;i<21;i++){
 const sourceCenter=add(frame.originECEF,[i*33.5,-i*17.33,i*.13]);
 const sourceEdges=[[1e6,0,0],[i%2?1e-9:0,i%3===0?0:.001,0],[0,i%4*.33,300]];
 const center=rotate(sourceCenter.map((v,k)=>v-frame.originECEF[k])),edges=sourceEdges.map(rotate),id=`earth-${i}`;
 const points=[];
 for(let j=0;j<8;j++)points.push({point:edges.reduce((p,e,k)=>add(p,mul(e,j&(1<<k)?1:-1)),center),inside:true});
 for(let j=0;j<5;j++)points.push({point:add(center,[j*120000-200000,1000+j*230,-500+j*173]),inside:false});
 cases.push({id,center,edges,points});earthSources.set(id,[...sourceCenter,...sourceEdges.flat()]);
}
const rows=cases.map(c=>{
 const source=earthSources.get(c.id);
 const bounds=new LocalTileBounds({box:source??[...c.center,...c.edges.flat()]},identity(),source?frame:undefined);
 return {...c,points:c.points.map(p=>({...p,distance:bounds.distanceToPoint(Vector3.FromArray(p.point))}))};
});
writeFileSync(new URL('./numerical-samples.json',import.meta.url),JSON.stringify(rows,null,2)+'\n');
const inside=rows.flatMap(c=>c.points.filter(p=>p.inside));
console.log(JSON.stringify({cases:rows.length,points:rows.reduce((n,c)=>n+c.points.length,0),maxInsideDistance:Math.max(...inside.map(p=>p.distance)),nonFinite:rows.flatMap(c=>c.points).filter(p=>!Number.isFinite(p.distance)).length}));
