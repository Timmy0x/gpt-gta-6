import { readFile,writeFile } from 'node:fs/promises';
import polygonClipping from 'polygon-clipping';
const root=new URL('../../../data/world/miami/',import.meta.url),index=JSON.parse(await readFile(new URL('building-meshes.json',root),'utf8')),bytes=await readFile(new URL(index.binary,root));
const mesh=index.buildings.find((m:any)=>m.id==='county-i3s:316'),p=Array.from({length:mesh.positions.count},(_,i)=>bytes.readFloatLE(mesh.positions.byteOffset+i*4)),ii=Array.from({length:mesh.indices.count},(_,i)=>bytes.readUInt32LE(mesh.indices.byteOffset+i*4));
type Point=[number,number];const pointKey=(p:Point)=>p.join(',');
function signed(ring:Point[]){let sum=0;for(let i=0;i<ring.length-1;i++)sum+=ring[i][0]*ring[i+1][1]-ring[i+1][0]*ring[i][1];return sum/2;}
const sections=[];
for(const height of [2,10,20,25,30,60,100,130]){
  const nodes=new Map<string,{point:Point;neighbors:Set<string>}>(),edges=new Set<string>(),segments:{a:Point;b:Point;cuts:number[]}[]=[];
  for(let i=0;i<ii.length;i+=3){
    const t=ii.slice(i,i+3).map(n=>p.slice(n*3,n*3+3)),cut:Point[]=[];
    for(let j=0;j<3;j++){const a=t[j],b=t[(j+1)%3];if(a[1]<=height&&height<b[1]||b[1]<=height&&height<a[1]){const f=(height-a[1])/(b[1]-a[1]);cut.push([Math.round((a[0]+f*(b[0]-a[0]))*1000)/1000,Math.round((a[2]+f*(b[2]-a[2]))*1000)/1000]);}}
    if(cut.length===2&&pointKey(cut[0])!==pointKey(cut[1]))segments.push({a:cut[0],b:cut[1],cuts:[0,1]});
  }
  const cross=(a:Point,b:Point)=>a[0]*b[1]-a[1]*b[0],sub=(a:Point,b:Point):Point=>[a[0]-b[0],a[1]-b[1]];
  // Every crossing must become a graph node before walking bounded faces.
  // Source massing contains intersecting/nested extrusions and shared edges.
  for(let i=0;i<segments.length;i++)for(let j=i+1;j<segments.length;j++){
    const a=segments[i],b=segments[j],r=sub(a.b,a.a),s=sub(b.b,b.a),d=sub(b.a,a.a),den=cross(r,s);
    if(Math.abs(den)>1e-10){const t=cross(d,s)/den,u=cross(d,r)/den;if(t>=-1e-8&&t<=1+1e-8&&u>=-1e-8&&u<=1+1e-8){a.cuts.push(Math.max(0,Math.min(1,t)));b.cuts.push(Math.max(0,Math.min(1,u)));}}
    else if(Math.abs(cross(d,r))<1e-7){for(const [line,points]of [[a,[b.a,b.b]],[b,[a.a,a.b]]] as [{a:Point;b:Point;cuts:number[]},Point[]][]){const q=sub(line.b,line.a),sq=q[0]*q[0]+q[1]*q[1];for(const point of points){const p=sub(point,line.a),t=(p[0]*q[0]+p[1]*q[1])/sq;if(t>=0&&t<=1)line.cuts.push(t);}}}
  }
  for(const segment of segments){const cuts=[...new Set(segment.cuts)].sort((a,b)=>a-b);for(let i=1;i<cuts.length;i++){
    const points=cuts.slice(i-1,i+1).map(t=>[Math.round((segment.a[0]+t*(segment.b[0]-segment.a[0]))*1e5)/1e5,Math.round((segment.a[1]+t*(segment.b[1]-segment.a[1]))*1e5)/1e5] as Point),a=pointKey(points[0]),b=pointKey(points[1]);if(a===b)continue;const edge=[a,b].sort().join('|');if(edges.has(edge))continue;edges.add(edge);
    if(!nodes.has(a))nodes.set(a,{point:points[0],neighbors:new Set()});if(!nodes.has(b))nodes.set(b,{point:points[1],neighbors:new Set()});nodes.get(a)!.neighbors.add(b);nodes.get(b)!.neighbors.add(a);
  }}
  const order=new Map([...nodes].map(([key,node])=>[key,[...node.neighbors].sort((a,b)=>{const p=nodes.get(a)!.point,q=nodes.get(b)!.point;return Math.atan2(p[1]-node.point[1],p[0]-node.point[0])-Math.atan2(q[1]-node.point[1],q[0]-node.point[0]);})]));
  const used=new Set<string>(),rings:Point[][]=[],openPaths:Point[][]=[];
  for(const[start,node]of nodes)for(const next of node.neighbors){
    if(used.has(`${start}|${next}`))continue;
    let from=start,to=next;const ring:Point[]=[nodes.get(from)!.point];let closed=false;
    for(let guard=0;guard<edges.size*2+1;guard++){
      used.add(`${from}|${to}`);ring.push(nodes.get(to)!.point);const neighbors=order.get(to)!,back=neighbors.indexOf(from),chosen=neighbors[(back+neighbors.length-1)%neighbors.length];from=to;to=chosen;
      if(from===start&&to===next){closed=true;break;}if(used.has(`${from}|${to}`))break;
    }
    if(!closed)openPaths.push(ring);else if(signed(ring)>.001)rings.push(ring);
  }
  const polygons=(rings.length?polygonClipping.union(rings.map(r=>[r])):[]).map(poly=>poly.filter((ring,i)=>i===0||Math.abs(signed(ring as Point[]))>.01));
  const absolute=polygons.map(poly=>poly.map(r=>r.map(([x,z])=>[x+mesh.origin[0],z+mesh.origin[2]])));
  sections.push({heightAboveSourceBaseM:height,elevationNavd88M:height+mesh.groundM,sourceSegments:edges.size,intersectionJunctions:[...nodes.values()].filter(n=>n.neighbors.size>2).length,openPaths,componentRings:rings.length,polygons:absolute,areaM2:polygons.reduce((s,poly)=>s+poly.reduce((n,r,i)=>n+(i===0?1:-1)*Math.abs(signed(r as Point[])),0),0)});
}
await writeFile(new URL('701-source-sections.json',root),JSON.stringify({version:1,sourceId:mesh.id,sourceUniqueId:mesh.sourceUniqueId,sourceBinarySha256:index.sha256,coordinateSystem:'LocalENU [x,z] metres; elevation separately NAVD88metres',method:'Horizontal triangle/plane sections, millimetre weld, all segment intersections noded, bounded planar edge-face traversal and polygon union. Numerical sliver holes smaller than0.01m² removed only from inspection sections. Original source massing has overlapping nested volumes; sections describe occupied source envelopes only; original mesh unchanged.',fidelityLimit:'Source mesh has rectilinear corners and does not provide the rounded architecture visible in licensed701 west reference. Not an accepted finished facade.',sections},null,2)+'\n');
console.log(sections.map(s=>({height:s.heightAboveSourceBaseM,rings:s.componentRings,open:s.openPaths.length,area:s.areaM2})));
