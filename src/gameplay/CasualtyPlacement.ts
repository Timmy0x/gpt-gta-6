import { HavokPlugin, Matrix, PhysicsShapeCapsule, ProximityCastResult, Quaternion, Vector3, type PhysicsBody, type Scene } from '@babylonjs/core';
import type { Casualty } from './police/casualties';

const parents: Record<string, string | null> = {
  pelvis:null,spine:'pelvis',chest:'spine',neck:'chest',head:'neck',
  leftArm:'chest',leftForearm:'leftArm',leftHand:'leftForearm',rightArm:'chest',rightForearm:'rightArm',rightHand:'rightForearm',
  leftThigh:'pelvis',leftCalf:'leftThigh',leftFoot:'leftCalf',rightThigh:'pelvis',rightCalf:'rightThigh',rightFoot:'rightCalf',
};
const segments: readonly [string,string,number][] = [
  ['pelvis','chest',.24],['chest','neck',.22],['head','head',.22],
  ['leftArm','leftForearm',.13],['leftForearm','leftHand',.12],['rightArm','rightForearm',.13],['rightForearm','rightHand',.12],
  ['leftThigh','leftCalf',.15],['leftCalf','leftFoot',.13],['rightThigh','rightCalf',.15],['rightCalf','rightFoot',.13],
  ['leftFoot','leftFoot',.25],['rightFoot','rightFoot',.25],
];

/** Read-only native occupancy queries follow the saved anatomical pose.
 * These authored limb capsules are clearance proxies, not a new ragdoll or
 * a claim of exact clothing collision. The real restored ragdoll still owns it. */
export class CasualtyPlacement {
  private readonly plugin: HavokPlugin;
  private readonly input=new ProximityCastResult();
  private readonly hit=new ProximityCastResult();
  constructor(private scene:Scene){this.plugin=scene.getPhysicsEngine()!.getPhysicsPlugin() as HavokPlugin;}
  clear(entry:Casualty,ground:Vector3,support?:PhysicsBody):boolean{
    const rootPosition=new Vector3(entry.x,entry.y,entry.z);
    const rotation=entry.rootRotation?Quaternion.FromArray(entry.rootRotation):Quaternion.RotationYawPitchRoll(entry.yaw,0,Math.PI/2);
    const root=Matrix.Compose(Vector3.One(),rotation,rootPosition);
    const saved=new Map(entry.pose?.map(bone=>[bone.name,bone]));
    const world=new Map<string,Matrix>();
    const frame=(name:string):Matrix|null=>{
      const existing=world.get(name);if(existing)return existing;
      const pose=saved.get(name);if(!pose || !(name in parents))return null;
      const parent=parents[name]===null?root:frame(parents[name]!);if(!parent)return null;
      const value=Matrix.Compose(Vector3.One(),Quaternion.FromArray(pose.rotation),Vector3.FromArray(pose.position)).multiply(parent);
      world.set(name,value);return value;
    };
    const capsules: {a:Vector3;b:Vector3;radius:number}[]=[];
    for(const [from,to,radius] of segments){
      const a=frame(from),b=frame(to);if(!a||!b)continue;
      const origin=Vector3.TransformCoordinates(Vector3.Zero(),a),end=Vector3.TransformCoordinates(Vector3.Zero(),b);
      if(from.endsWith('Foot')){
        const sole=Vector3.TransformCoordinates(new Vector3(0,-.035,.075),a);
        capsules.push({a:sole,b:sole,radius});
      }else capsules.push({a:origin,b:end,radius});
    }
    if(capsules.length<3){
      // Versions 1–2 did not store bones. Match their lying fallback posture,
      // including its sideways axis, instead of requiring space to stand.
      const axis=new Vector3(-Math.cos(entry.yaw),0,Math.sin(entry.yaw));
      const center=new Vector3(entry.x,Math.max(entry.y,ground.y+.32),entry.z).add(axis.scale(.8));
      capsules.push({a:center.subtract(axis.scale(.58)),b:center.add(axis.scale(.58)),radius:.32});
    }
    for(const {a,b,radius} of capsules){
      const midpoint=a.add(b).scale(.5);
      const shape=new PhysicsShapeCapsule(a.subtract(midpoint),b.subtract(midpoint),radius,this.scene);
      try{
        this.input.reset();this.hit.reset();
        this.plugin.shapeProximity({shape,position:midpoint,rotation:Quaternion.Identity(),maxDistance:0,shouldHitTriggers:false,ignoreBody:support},this.input,this.hit);
        if(this.hit.hasHit&&this.hit.hitDistance < -.015)return false;
      }finally{shape.dispose();}
    }
    return true;
  }
}
