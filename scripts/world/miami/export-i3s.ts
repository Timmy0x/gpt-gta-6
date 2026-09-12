import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { projectMiami, MIAMI_ORIGIN } from '../../../src/world/miami/projection';

const root=new URL('../../../data/world/miami/',import.meta.url),cache=new URL('i3s/',root);
const envelopes=JSON.parse(await readFile(new URL('building-envelopes.json',root),'utf8'));
const lambda=MIAMI_ORIGIN.longitude*Math.PI/180,phi=MIAMI_ORIGIN.latitude*Math.PI/180;
const index:any[]=[];const chunks:Buffer[]=[];let byteOffset=0;
const read=(node:string,suffix:string)=>readFile(new URL(`nodes_${node}${suffix}.bin`,cache));
const cacheNodes=new Map<string,{node:any;bytes:Buffer}>();
function encode(values:number[],type:'float32'|'uint32'){
  const bytes=Buffer.alloc(values.length*4);for(let i=0;i<values.length;i++)type==='float32'?bytes.writeFloatLE(values[i],i*4):bytes.writeUInt32LE(values[i],i*4);
  const record={byteOffset,byteLength:bytes.length,componentType:type,count:values.length};byteOffset+=bytes.length;chunks.push(bytes);return record;
}
function localNormal(x:number,y:number,z:number){
  const n=[-Math.sin(lambda)*x+Math.cos(lambda)*y,Math.cos(phi)*Math.cos(lambda)*x+Math.cos(phi)*Math.sin(lambda)*y+Math.sin(phi)*z,-Math.sin(phi)*Math.cos(lambda)*x-Math.sin(phi)*Math.sin(lambda)*y+Math.cos(phi)*z];
  const length=Math.hypot(...n);return length>1e-8?n.map(v=>v/length):[0,1,0];
}
for(const feature of envelopes.features){
  let source=cacheNodes.get(feature.node);
  if(!source){source={node:JSON.parse((await read(feature.node,'')).toString()),bytes:await read(feature.node,'_geometries_0')};cacheNodes.set(feature.node,source);}
  const {node,bytes}=source,vertexCount=bytes.readUInt32LE(0),featureCount=bytes.readUInt32LE(4),featureOffset=8+vertexCount*36,faceOffset=featureOffset+featureCount*8;
  let f=-1;for(let i=0;i<featureCount;i++)if(Number(bytes.readBigUInt64LE(featureOffset+i*8))===feature.sourceObjectId){f=i;break;}
  if(f<0)throw new Error(`Missing source feature ${feature.id}`);
  const first=bytes.readUInt32LE(faceOffset+f*8),last=bytes.readUInt32LE(faceOffset+f*8+4);
  const b=feature.bboxWgs84,origin=projectMiami((b[0]+b[2])/2,(b[1]+b[3])/2,feature.groundM);
  const positions:number[]=[],normals:number[]=[],indices:number[]=[],vertices=new Map<string,number>();
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(let vertex=first*3;vertex<=(last*3+2);vertex++){
    const position=projectMiami(bytes.readFloatLE(8+vertex*12)+node.mbs[0],bytes.readFloatLE(12+vertex*12)+node.mbs[1],bytes.readFloatLE(16+vertex*12)+node.mbs[2]);
    const nOffset=8+vertexCount*12+vertex*12,n=localNormal(bytes.readFloatLE(nOffset),bytes.readFloatLE(nOffset+4),bytes.readFloatLE(nOffset+8));
    const p=position.map((v,i)=>{min[i]=Math.min(min[i],v);max[i]=Math.max(max[i],v);return Math.fround(v-origin[i]);});
    const normal=n.map(Math.fround),key=p.join(',')+'|'+normal.join(',');let index=vertices.get(key);
    if(index===undefined){index=positions.length/3;vertices.set(key,index);positions.push(...p);normals.push(...normal);}indices.push(index);
  }
  // Geographic XYZ -> Babylon east/up/north changes handedness. Orient each
  // triangle so its geometric normal agrees with the transformed source normal.
  let reversed=0;
  for(let i=0;i<indices.length;i+=3){
    const a=indices[i]*3,b=indices[i+1]*3,c=indices[i+2]*3;
    const u=[positions[b]-positions[a],positions[b+1]-positions[a+1],positions[b+2]-positions[a+2]],v=[positions[c]-positions[a],positions[c+1]-positions[a+1],positions[c+2]-positions[a+2]];
    const cross=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
    const mean=[normals[a]+normals[b]+normals[c],normals[a+1]+normals[b+1]+normals[c+1],normals[a+2]+normals[b+2]+normals[c+2]];
    if(cross.reduce((n,x,j)=>n+x*mean[j],0)<0){[indices[i+1],indices[i+2]]=[indices[i+2],indices[i+1]];reversed++;}
  }
  index.push({...feature,origin,localBounds:{min:min.map((v,i)=>v-origin[i]),max:max.map((v,i)=>v-origin[i])},worldBounds:{min,max},vertices:positions.length/3,triangles:indices.length/3,reversedSourceTriangles:reversed,positions:encode(positions,'float32'),normals:encode(normals,'float32'),indices:encode(indices,'uint32')});
}
const binary=Buffer.concat(chunks);
await writeFile(new URL('building-meshes.bin',root),binary);
await writeFile(new URL('building-meshes.json',root),JSON.stringify({version:1,id:'brickell-county-i3s-r1',origin:MIAMI_ORIGIN,coordinateSystem:'projectMiami WGS84 horizontal ENU, x east y NAVD88 metres z north',binary:'building-meshes.bin',byteOrder:'little-endian',sha256:createHash('sha256').update(binary).digest('hex'),byteLength:binary.length,winding:'Cross(B-A,C-A) agrees with outward source normals in exported coordinates; Babylon LH default front-face interpretation must be set explicitly when binding',uvs:null,geometryPolicy:'Exact source finest-leaf triangles; positions projected then stored Float32 relative to per-building origin; exact position+normal dedup preserves hard edges; no simplification, imagery, textures or inferred roof/height',buildings:index},null,2)+'\n');
console.log(JSON.stringify({buildings:index.length,vertices:index.reduce((n,f)=>n+f.vertices,0),triangles:index.reduce((n,f)=>n+f.triangles,0),bytes:binary.length,sha256:createHash('sha256').update(binary).digest('hex')}));
