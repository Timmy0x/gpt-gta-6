import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Plane } from '@babylonjs/core/Maths/math.plane';
import { direction, geographicRegionCorners, point, type DoubleMatrix, type ECEFLocalFrame, type Vec3 } from './DoubleFrame';
export class LocalTileBounds {
  obb:{points:Vector3[]}|null=null;
  sphere:{centerWorld:Vector3;radiusWorld:number}|null=null;
  private oriented:{center:Vector3;axes:Vector3[];halfLengths:number[]}|null=null;
  constructor(data:{box?:number[];sphere?:number[];region?:number[]},world:DoubleMatrix,frame?:ECEFLocalFrame){
    const project=(p:readonly number[])=>frame?frame.point(p):p as Vec3;
    let sourceCenter:Vector3|null=null,sourceAxes:Vector3[]|null=null;
    if(data.region){if(!frame)throw new Error('Geographic regions require an explicit ECEF origin.');this.obb={points:geographicRegionCorners(data.region).map(p=>Vector3.FromArray(frame.point(p)))};}
    if(data.box){const b=data.box;if(b.length!==12||b.some(v=>!Number.isFinite(v)))throw new Error('Invalid tile box.');this.obb={points:Array.from({length:8},(_,i)=>{const p=[0,1,2].map(c=>b[c]+(i&1?1:-1)*b[c+3]+(i&2?1:-1)*b[c+6]+(i&4?1:-1)*b[c+9]);return Vector3.FromArray(project(point(world,p)));})};sourceCenter=Vector3.FromArray(project(point(world,b.slice(0,3))));sourceAxes=[3,6,9].map(offset=>{const vector=direction(world,b.slice(offset,offset+3));return Vector3.FromArray(frame?frame.direction(vector):vector);});}
    if(data.sphere){const s=data.sphere;if(s.length!==4||s.some(v=>!Number.isFinite(v))||s[3]<0)throw new Error('Invalid tile sphere.');const columns=[direction(world,[1,0,0]),direction(world,[0,1,0]),direction(world,[0,0,1])];
      // sqrt(||A||1*||A||inf) bounds the largest singular value, including affine shear.
      const one=Math.max(...columns.map(v=>v.reduce((n,x)=>n+Math.abs(x),0))),inf=Math.max(...[0,1,2].map(r=>columns.reduce((n,c)=>n+Math.abs(c[r]),0)));
      this.sphere={centerWorld:Vector3.FromArray(project(point(world,s.slice(0,3)))),radiusWorld:s[3]*Math.sqrt(one*inf)};
    }
    if(!this.obb&&!this.sphere)throw new Error('Tile requires a box, sphere or geographic region.');
    if(this.obb){
      const points=this.obb.points,center=sourceCenter??points[0].add(points[7]).scale(.5),vectors=sourceAxes??[1,2,4].map(index=>points[index].subtract(points[0]).scale(.5));
      // Build a stable source-oriented orthonormal frame, then enclose every original
      // half-edge by its support along each axis. True OBBs retain their extents;
      // rounded or sheared boxes remain conservatively enclosed without reverting to a
      // giant world AABB. Source direction vectors avoid subtracting Earth-scale corners.
      const sorted=[...vectors].sort((a,b)=>b.lengthSquared()-a.lengthSquared());
      const first=sorted[0].lengthSquared()>0?sorted[0].normalizeToNew():Vector3.Right();
      const projected=sorted.map(v=>v.subtract(first.scale(Vector3.Dot(v,first)))).sort((a,b)=>b.lengthSquared()-a.lengthSquared());
      let second=projected[0];
      if(second.lengthSquared()<1e-24){const basis=[Vector3.Right(),Vector3.Up(),Vector3.Forward()].sort((a,b)=>Math.abs(Vector3.Dot(a,first))-Math.abs(Vector3.Dot(b,first)))[0];second=basis.subtract(first.scale(Vector3.Dot(basis,first)));}
      second.normalize();const third=Vector3.Cross(first,second).normalize();second=Vector3.Cross(third,first).normalize();
      const axes=[first,second,third],halfLengths=axes.map(axis=>vectors.reduce((sum,v)=>sum+Math.abs(Vector3.Dot(axis,v)),0)*(1+1e-14));
      this.oriented={center,axes,halfLengths};
    }
  }
  distanceToPoint(p:Vector3){let distance=0;
    if(this.oriented){const {center,axes,halfLengths}=this.oriented,dx=p.x-center.x,dy=p.y-center.y,dz=p.z-center.z;let qx=center.x,qy=center.y,qz=center.z;
      for(let i=0;i<3;i++){const axis=axes[i],projection=dx*axis.x+dy*axis.y+dz*axis.z,clamped=Math.max(-halfLengths[i],Math.min(halfLengths[i],projection));qx+=axis.x*clamped;qy+=axis.y*clamped;qz+=axis.z*clamped;}
      distance=Math.hypot(p.x-qx,p.y-qy,p.z-qz);
    }if(this.sphere)distance=Math.max(distance,Vector3.Distance(p,this.sphere.centerWorld)-this.sphere.radiusWorld);return Math.max(0,distance);}
  intersectsFrustum(planes:Plane[]){if(this.obb&&!planes.every(plane=>this.obb!.points.some(p=>plane.dotCoordinate(p)>=-1e-7)))return false;if(this.sphere&&!planes.every(plane=>plane.dotCoordinate(this.sphere!.centerWorld)>=-this.sphere!.radiusWorld*plane.normal.length()))return false;return true;}
}
