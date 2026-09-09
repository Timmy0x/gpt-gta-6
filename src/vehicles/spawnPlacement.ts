import { HavokPlugin, PhysicsMotionType, PhysicsShapeBox, ProximityCastResult, Quaternion, Vector3, type Scene } from '@babylonjs/core';
import type { Obstacle, VehicleKind } from '../core/contracts';
import type { Vehicle } from './VehicleSystem';
import { VEHICLE_TUNING } from './handling';

interface Footprint { x:number; z:number; width:number; length:number; heading:number; }
/** Separating-axis test for two oriented vehicle footprints, including a practical body clearance. */
export function footprintsOverlap(a:Footprint,b:Footprint,clearance=.45):boolean {
  const axes=(r:number)=>[{x:Math.cos(r),z:-Math.sin(r)},{x:Math.sin(r),z:Math.cos(r)}];
  const aa=axes(a.heading),bb=axes(b.heading),delta={x:b.x-a.x,z:b.z-a.z};
  const dot=(u:{x:number;z:number},v:{x:number;z:number})=>u.x*v.x+u.z*v.z;
  for(const axis of [...aa,...bb]){
    const ra=Math.abs(dot(axis,aa[0]))*a.width/2+Math.abs(dot(axis,aa[1]))*a.length/2;
    const rb=Math.abs(dot(axis,bb[0]))*b.width/2+Math.abs(dot(axis,bb[1]))*b.length/2;
    if(Math.abs(dot(delta,axis))>ra+rb+clearance)return false;
  }
  return true;
}

export interface SpawnPlacementOptions {
  scene:Scene;
  kind:VehicleKind;
  origin:Vector3;
  heading:number;
  obstacles:readonly Obstacle[];
  vehicles:readonly Pick<Vehicle,'kind'|'root'|'heading'|'tuning'>[];
}

/** Read-only search: probe the full footprint and a Havok box; never spawn or move an existing body to test placement. */
export function findGroundVehicleSpawn(options:SpawnPlacementOptions):Vector3|null {
  const {scene,kind,origin,heading,obstacles,vehicles}=options;
  if(kind==='plane'||kind==='helicopter'||kind==='boat')throw new Error('Aircraft and boats use dedicated launch placement');
  const tuning=VEHICLE_TUNING[kind],physics=scene.getPhysicsEngine();
  if(!physics||!Number.isFinite(heading)||![origin.x,origin.y,origin.z].every(Number.isFinite))return null;
  const plugin=physics.getPhysicsPlugin() as HavokPlugin;
  const right=new Vector3(Math.cos(heading),0,-Math.sin(heading)),forward=new Vector3(Math.sin(heading),0,Math.cos(heading));
  const rotation=Quaternion.RotationAxis(Vector3.Up(),heading);
  const height=Math.max(2.1,tuning.height+1.4);
  // Query starts above the support surface, so the supporting ground itself is not an obstruction.
  const shape=new PhysicsShapeBox(Vector3.Zero(),Quaternion.Identity(),new Vector3(tuning.width+.5,height,tuning.length+.5),scene);
  const inputResult=new ProximityCastResult(),hitResult=new ProximityCastResult();
  try {
    const offsets=[0,4,-4,7,-7];
    for(const ahead of [6,9,12,15,18,-6,-9])for(const side of offsets){
      const candidate=origin.add(forward.scale(ahead)).add(right.scale(side));
      if(Vector3.DistanceSquared(candidate,origin)>22*22)continue;
      const rect:Footprint={x:candidate.x,z:candidate.z,width:tuning.width,length:tuning.length,heading};
      if(obstacles.some(o=>o.height>.35&&footprintsOverlap(rect,{x:o.x,z:o.z,width:o.w,length:o.d,heading:0},.35)))continue;
      if(vehicles.some(v=>Math.abs(v.root.position.y-origin.y)<4&&footprintsOverlap(rect,{x:v.root.position.x,z:v.root.position.z,width:v.kind==='plane'?10.5:v.kind==='helicopter'?11:v.tuning.width,length:v.kind==='helicopter'?11:v.tuning.length,heading:v.heading},.6)))continue;
      const supports:number[]=[];
      for(const x of [-.5,0,.5])for(const z of [-.5,0,.5]){
        const point=candidate.add(right.scale(x*(tuning.width+.3))).add(forward.scale(z*(tuning.length+.3)));
        const hit=physics.raycast(new Vector3(point.x,origin.y+3,point.z),new Vector3(point.x,origin.y-4,point.z),{shouldHitTriggers:false});
        if(!hit.hasHit||hit.hitNormalWorld.y<.94||hit.body?.getMotionType()!==PhysicsMotionType.STATIC)break;
        supports.push(hit.hitPointWorld.y);
      }
      if(supports.length!==9||Math.max(...supports)-Math.min(...supports)>.16)continue;
      const ground=Math.max(...supports);
      if(Math.abs(ground-(origin.y-1))>1.6)continue;
      inputResult.reset();hitResult.reset();
      plugin.shapeProximity({shape,position:new Vector3(candidate.x,ground+.12+height/2,candidate.z),rotation,maxDistance:0,shouldHitTriggers:false},inputResult,hitResult);
      if(hitResult.hasHit)continue;
      return new Vector3(candidate.x,ground+.95,candidate.z);
    }
    return null;
  }finally{shape.dispose();}
}
