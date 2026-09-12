import {readFile,writeFile,mkdir} from 'node:fs/promises';
// Original independently authored source geometry plus plain-double oracle. No runtime adapter math imported.
const source=await readFile(new URL('../fixtures/asymmetric.glb',import.meta.url));
const original=JSON.parse(source.subarray(20,20+source.readUInt32LE(12)).toString());
const records=JSON.parse(await readFile(new URL('../fixtures/expected.json',import.meta.url))).records;
const I=()=>[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
const mul=(a,b)=>Array.from({length:16},(_,i)=>{const r=i%4,c=Math.floor(i/4);return [0,1,2,3].reduce((s,k)=>s+a[k*4+r]*b[c*4+k],0);});
const point=(m,p)=>[0,1,2].map(r=>m[r]*p[0]+m[4+r]*p[1]+m[8+r]*p[2]+m[12+r]);
const t=v=>{const a=I();a.splice(12,3,...v);return a;};
const rz=a=>{a*=Math.PI/180;return[Math.cos(a),Math.sin(a),0,0,-Math.sin(a),Math.cos(a),0,0,0,0,1,0,0,0,0,1];};
const trs=n=>{if(n.matrix)return n.matrix;const[x,y,z,w]=n.rotation??[0,0,0,1],[a,b,c]=n.scale??[1,1,1];return[(1-2*y*y-2*z*z)*a,(2*x*y+2*z*w)*a,(2*x*z-2*y*w)*a,0,(2*x*y-2*z*w)*b,(1-2*x*x-2*z*z)*b,(2*y*z+2*x*w)*b,0,(2*x*z+2*y*w)*c,(2*y*z-2*x*w)*c,(1-2*x*x-2*y*y)*c,0,...n.translation??[0,0,0],1];};
const origin={latitudeDegrees:25.765,longitudeDegrees:-80.193,ellipsoidHeightM:37.125},lat=origin.latitudeDegrees*Math.PI/180,lon=origin.longitudeDegrees*Math.PI/180;
const a=6378137,b=6356752.314245179,prime=a*a/Math.sqrt(a*a*Math.cos(lat)**2+b*b*Math.sin(lat)**2);
const ecef=[(prime+origin.ellipsoidHeightM)*Math.cos(lat)*Math.cos(lon),(prime+origin.ellipsoidHeightM)*Math.cos(lat)*Math.sin(lon),(b*b/(a*a)*prime+origin.ellipsoidHeightM)*Math.sin(lat)];
const east=[-Math.sin(lon),Math.cos(lon),0],north=[-Math.sin(lat)*Math.cos(lon),-Math.sin(lat)*Math.sin(lon),Math.cos(lat)],up=[Math.cos(lat)*Math.cos(lon),Math.cos(lat)*Math.sin(lon),Math.sin(lat)];
const ecefFrame=[...east,0,...north,0,...up,0,...ecef,1];
const local=p=>[east,up,north].map(v=>v.reduce((s,x,i)=>s+x*(p[i]-ecef[i]),0));
const axis={Y:[1,0,0,0,0,0,1,0,0,-1,0,0,0,0,0,1],Z:I(),X:[0,0,1,0,0,1,0,0,-1,0,0,0,0,0,0,1]};
const box=points=>{const lo=[0,1,2].map(i=>Math.min(...points.map(p=>p[i]))),hi=[0,1,2].map(i=>Math.max(...points.map(p=>p[i])));return[...lo.map((v,i)=>(v+hi[i])/2),(hi[0]-lo[0])/2+.001,0,0,0,(hi[1]-lo[1])/2+.001,0,0,0,(hi[2]-lo[2])/2+.001];};
function pack(json){const text=Buffer.from(JSON.stringify(json)),length=Math.ceil(text.length/4)*4,tail=source.subarray(20+source.readUInt32LE(12)),out=Buffer.alloc(20+length+tail.length,32);source.copy(out,0,0,12);out.writeUInt32LE(out.length,8);out.writeUInt32LE(length,12);out.writeUInt32LE(0x4e4f534a,16);text.copy(out,20);tail.copy(out,20+length);return out;}
function b3dm(glb,rtc){const json=Buffer.from(JSON.stringify({BATCH_LENGTH:0,RTC_CENTER:rtc})),length=Math.ceil((28+json.length)/8)*8-28,out=Buffer.alloc(28+length+glb.length,32);out.write('b3dm');out.writeUInt32LE(1,4);out.writeUInt32LE(out.length,8);out.writeUInt32LE(length,12);out.writeUInt32LE(0,16);out.writeUInt32LE(0,20);out.writeUInt32LE(0,24);json.copy(out,28);glb.copy(out,28+length);return out;}
const fixtureCases=[];
for(const name of ['nested-z','nested-x','default-y-large-root','default-y-large-matrix','default-y-large-nested','default-y-large-cancellation','rtc-glb','rtc-b3dm']){
 const json=structuredClone(original);json.extensionsUsed=['KHR_materials_unlit'];json.extensionsRequired=['KHR_materials_unlit'];for(const material of json.materials)material.extensions={KHR_materials_unlit:{}};json.asset.copyright='Original synthetic fixture credit';let world=I(),gltfAxis='Y',rtc=[0,0,0],nested=name.startsWith('nested-');
 if(nested){gltfAxis=name.endsWith('z')?'Z':'X';world=mul(ecefFrame,mul(t([17.123456,-9.456789,4.789123]),mul(rz(27),mul(t([-3.125,2.375,1.25]),mul(rz(-16),t([.5123,-.2543,.1256]))))));}
 else if(name.startsWith('default-y-large')){
  // ECEF vector expressed in glTF Y-up coordinates before required Y->Z correction.
  const huge=[ecef[0]+.123456,ecef[2]+.345678,-ecef[1]-.234567];
  for(const id of json.scenes[0].nodes){const n=json.nodes[id];n.translation=(n.translation??[0,0,0]).map((v,i)=>v+huge[i]);if(name.endsWith('matrix')){n.matrix=trs(n);delete n.translation;delete n.rotation;delete n.scale;}}
  if(name.endsWith('cancellation')){world=ecefFrame;const children=json.scenes[0].nodes;json.nodes.push({name:'cancelling-large-parent',translation:huge.map(v=>-v),children});json.scenes[0].nodes=[json.nodes.length-1];}
  if(name.endsWith('nested')){const children=json.scenes[0].nodes;json.nodes.push({name:'small-parent-above-ECEF-children',translation:[.0625,-.125,.25],rotation:[0,0,0,1],children});json.scenes[0].nodes=[json.nodes.length-1];}
 } else {rtc=point(ecefFrame,[.123456,-.234567,.345678]);if(name==='rtc-glb'){json.extensions={CESIUM_RTC:{center:rtc}};json.extensionsUsed.push('CESIUM_RTC');json.extensionsRequired.push('CESIUM_RTC');}}
 const parents=new Map();json.nodes.forEach((n,i)=>n.children?.forEach(c=>parents.set(c,i)));const nodeWorld=i=>parents.has(i)?mul(nodeWorld(parents.get(i)),trs(json.nodes[i])):trs(json.nodes[i]);
 const content=mul(world,mul(t(rtc),axis[gltfAxis]));
 const outRecords=records.map(record=>{const id=json.nodes.findIndex(n=>n.name===record.name),node=nodeWorld(id);return{...record,nodeWorld:node,ecefWorld:record.sourcePositions.reduce((a,_,i)=>{if(i%3===0)a.push(point(content,point(node,record.sourcePositions.slice(i,i+3))));return a;},[])};});
 for(const record of outRecords)record.lhWorld=record.ecefWorld.map(local);
 const tilePoints=outRecords.flatMap(r=>r.sourcePositions.reduce((a,_,i)=>{if(i%3===0)a.push(point(mul(t(rtc),axis[gltfAxis]),point(r.nodeWorld,r.sourcePositions.slice(i,i+3))));return a;},[]));
 const boundingVolume={box:box(tilePoints)},leaf={boundingVolume,geometricError:0,content:{uri:name==='rtc-b3dm'?'content.b3dm':'content.glb'}};
 let root,external;
 if(nested){const parent=mul(ecefFrame,mul(t([17.123456,-9.456789,4.789123]),rz(27))),child=mul(t([-3.125,2.375,1.25]),rz(-16)),end=t([.5123,-.2543,.1256]);external={asset:{version:'1.0',gltfUpAxis:gltfAxis},geometricError:0,root:{...leaf,transform:end}};root={asset:{version:'1.0'},geometricError:100,root:{transform:parent,boundingVolume:{sphere:[0,0,0,50]},geometricError:50,refine:'REPLACE',children:[{transform:child,boundingVolume:{sphere:[0,0,0,40]},geometricError:0,content:{uri:'nested/tileset.json?session=fixture-session'}}]}};}
 else root={asset:{version:'1.0'},geometricError:0,root:name.endsWith('cancellation')?{...leaf,transform:world}:leaf};
 const dir=new URL(`../fixtures/geographic/${name}/`,import.meta.url);await mkdir(new URL('nested/',dir),{recursive:true});await writeFile(new URL('tileset.json',dir),JSON.stringify(root,null,2)+'\n');if(external)await writeFile(new URL('nested/tileset.json',dir),JSON.stringify(external,null,2)+'\n');await writeFile(new URL((nested?'nested/':'')+(name==='rtc-b3dm'?'content.b3dm':'content.glb'),dir),name==='rtc-b3dm'?b3dm(pack(json),rtc):pack(json));
 fixtureCases.push({name,origin,axis:gltfAxis,sourceTransform:world,rtc,box:boundingVolume.box,records:outRecords});
}
await writeFile(new URL('../fixtures/geographic/expected.json',import.meta.url),JSON.stringify({provenance:'Original synthetic geometry and WGS84 mathematical fixtures. No provider content. Ellipsoidal origin is an explicit test input, not NAVD88.',origin,ecef,cases:fixtureCases},null,2)+'\n');console.log(JSON.stringify({geographicCases:fixtureCases.length,origin,meshesPerCase:records.length}));
