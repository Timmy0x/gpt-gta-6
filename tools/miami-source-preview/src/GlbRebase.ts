import {affine,identity,multiply,point,translation,type Vec3} from './DoubleFrame';
interface GlbNode {translation?:number[];matrix?:number[];rotation?:number[];scale?:number[];children?:number[];mesh?:number;camera?:number;skin?:number;extensions?:unknown;}
export interface GlbDocument {asset:{version:string};scene?:number;scenes?:Array<{nodes?:number[]}>;nodes?:GlbNode[];buffers?:Array<{uri?:string}>;images?:Array<{uri?:string}>;extensions?:Record<string,unknown>;extensionsUsed?:string[];extensionsRequired?:string[];[key:string]:unknown;}
export function readGlb(bytes:Uint8Array):GlbDocument{const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);if(bytes.length<20||v.getUint32(0,true)!==0x46546c67||v.getUint32(4,true)!==2||v.getUint32(8,true)!==bytes.length||v.getUint32(16,true)!==0x4e4f534a)throw new Error('Expected GLB2 content.');const length=v.getUint32(12,true);if(length>bytes.length-20)throw new Error('Invalid GLB JSON length.');return JSON.parse(new TextDecoder().decode(bytes.subarray(20,20+length)));}
export function writeGlb(bytes:Uint8Array,json:GlbDocument):Uint8Array{const old=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),tail=bytes.subarray(20+old.getUint32(12,true)),encoded=new TextEncoder().encode(JSON.stringify(json)),length=Math.ceil(encoded.length/4)*4,result=new Uint8Array(20+length+tail.length),v=new DataView(result.buffer);v.setUint32(0,0x46546c67,true);v.setUint32(4,2,true);v.setUint32(8,result.length,true);v.setUint32(12,length,true);v.setUint32(16,0x4e4f534a,true);result.fill(32,20,20+length);result.set(encoded,20);result.set(tail,20+length);return result;}
/** In-memory origin extraction preserves all node linear transforms and hierarchy; the origin is restored in doubles outside the importer. */
export function prepareGlb(bytes:Uint8Array){
 const original=readGlb(bytes),json=structuredClone(original);let changed=false;
 const rtcValue=(json.extensions?.CESIUM_RTC as {center?:unknown}|undefined)?.center;
 let rtc:Vec3=[0,0,0];if(rtcValue!==undefined){if(!Array.isArray(rtcValue)||rtcValue.length!==3||!rtcValue.every(Number.isFinite))throw new Error('Invalid CESIUM_RTC center.');rtc=rtcValue as Vec3;delete json.extensions!.CESIUM_RTC;for(const key of ['extensionsUsed','extensionsRequired'] as const)if(json[key])json[key]=json[key]!.filter(value=>value!=='CESIUM_RTC');changed=true;}
 const rootIds=json.scenes?.[json.scene??0]?.nodes??[],nodes=json.nodes??[];
 const local=(node:GlbNode):number[]=>{
  if(node.matrix){affine(node.matrix);return [...node.matrix];}
  const[x,y,z,w]=node.rotation??[0,0,0,1],[a,b,c]=node.scale??[1,1,1],t=node.translation??[0,0,0];
  const m=[(1-2*y*y-2*z*z)*a,(2*x*y+2*z*w)*a,(2*x*z-2*y*w)*a,0,(2*x*y-2*z*w)*b,(1-2*x*x-2*z*z)*b,(2*y*z+2*x*w)*b,0,(2*x*z+2*y*w)*c,(2*y*z-2*x*w)*c,(1-2*x*x-2*y*y)*c,0,...t,1];affine(m);return m;
 };
 const active=new Set<number>(),parents=new Map<number,number>(),matrices=new Map<number,number[]>(),worlds=new Map<number,number[]>();
 function visit(id:number,parentWorld:number[],parent?:number){
  if(!Number.isInteger(id)||!nodes[id]||active.has(id))throw new Error('Active glTF hierarchy must be an acyclic tree.');
  active.add(id);if(parent!==undefined)parents.set(id,parent);const matrix=local(nodes[id]),world=multiply(parentWorld,matrix);matrices.set(id,matrix);worlds.set(id,world);for(const child of nodes[id].children??[])visit(child,world,id);
 }
 for(const root of rootIds)visit(root,identity());
 const candidates=[...active].filter(id=>nodes[id].mesh!==undefined);if(!candidates.length)candidates.push(...rootIds);
 const largest=candidates.map(id=>worlds.get(id)!.slice(12,15)).reduce((best,t)=>Math.hypot(...t)>Math.hypot(...best)?t:best,[0,0,0]);
 const anchor:Vec3=Math.max(...largest.map(Math.abs))>4096?[...largest] as Vec3:[0,0,0];
 if(anchor.some(v=>v!==0)||[...matrices.values()].some(m=>Math.max(...m.slice(12,15).map(Math.abs))>4096)){
  if((json.animations as unknown[]|undefined)?.length||(json.skins as unknown[]|undefined)?.length)throw new Error('Large-coordinate animated or skinned glTF requires a separate origin-rebase gate.');
  // Shift the coordinate origin of empty ancestors toward their first rendered descendant.
  // M'_i = T(-o_parent) * M_i * T(o_i). Interior offsets cancel along every path;
  // mesh nodes retain o_i=0, so vertex coordinates, linear transforms and the tree are preserved.
  const origins=new Map<number,Vec3>();
  function choose(id:number):Vec3{
   if(origins.has(id))return origins.get(id)!;const node=nodes[id];let origin:Vec3=[0,0,0];
   if(node.mesh===undefined&&node.camera===undefined&&node.skin===undefined&&!node.extensions&&node.children?.length){const child=node.children[0];origin=point(matrices.get(child)!,choose(child));}
   origins.set(id,origin);return origin;
  }
  for(const id of active)choose(id);
  for(const id of active){const parent=parents.get(id),parentOrigin=parent===undefined?anchor:origins.get(parent)!,own=origins.get(id)!;
   const adjusted=multiply(translation(parentOrigin.map(v=>-v)),multiply(matrices.get(id)!,translation(own)));
   if(Math.max(...adjusted.slice(12,15).map(Math.abs))>4096)throw new Error('A glTF hierarchy spans too far for the current local static origin-rebase gate.');
   const node=nodes[id];node.matrix=adjusted;delete node.translation;delete node.rotation;delete node.scale;
  }
  changed=true;
 }
 return {bytes:changed?writeGlb(bytes,json):bytes,metadata:original,rtc,anchor};
}
