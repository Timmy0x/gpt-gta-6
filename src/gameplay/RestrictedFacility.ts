import { Color3, MeshBuilder, PBRMaterial, PhysicsAggregate, PhysicsMotionType, PhysicsShapeType, Quaternion, Ray, Vector3, type Scene, type ShadowGenerator } from "@babylonjs/core";
import type { Obstacle, RoadNode, WorldContract } from "../core/contracts";
import { clamp, distance, lineBlocked, type Point2 } from "../core/math";
import { RESTRICTED_COMPOUND } from "../world/layout";
import { Officer } from "./police/Officer";
import { accessible, clearSight, compliant, footRoute } from "./police/rules";
import type { Character } from "./Character";
import type { Player } from "./Player";
import type { WantedSystem } from "./Wanted";
import type { VehicleSystem } from "../vehicles/VehicleSystem";
import { restoreCorpse, type Casualty } from "./police/casualties";

/** An original local training annex. These numbers are authored, not VI intelligence. */
export const FACILITY_RULES={warningSeconds:6,visitorSeconds:90,alarmSearchSeconds:30,guardCount:4,guardSight:65,guardFireRange:45,arrestSeconds:3} as const;
export type FacilityPhase="quiet"|"warning"|"authorized"|"alarm";
const B=RESTRICTED_COMPOUND;
const ROUTES:Point2[][]=[
  [{x:-464,z:140}],
  [{x:-476,z:148},{x:-476,z:188},{x:-498,z:188},{x:-498,z:148}],
  [{x:-502,z:132},{x:-540,z:132},{x:-540,z:155},{x:-502,z:155}],
  [{x:-491,z:121},{x:-491,z:88},{x:-474,z:88},{x:-474,z:126}],
];
export function insideFacility(p:Point2){return p.x>B.minX&&p.x<B.maxX&&p.z>B.minZ&&p.z<B.maxZ;}
function annexDistance(p:Point2){return Math.hypot(Math.max(B.minX-p.x,0,p.x-B.maxX),Math.max(B.minZ-p.z,0,p.z-B.maxZ));}
function facilityRoads(obstacles:Obstacle[]):RoadNode[]{
  const points=[...ROUTES.flat(),{x:-452,z:144},{x:-463,z:144},...[-540,-500,-480,-463].flatMap(x=>[86,126,144,158,190].map(z=>({x,z})))].filter(p=>accessible(p,obstacles));
  const inflated=obstacles.filter(o=>o.height>.5).map(o=>({...o,w:o.w+1.1,d:o.d+1.1}));
  return points.map((p,i)=>({...p,id:-1000-i,next:points.flatMap((n,j)=>i!==j&&distance(p,n)<65&&!lineBlocked(p,n,inflated)?[-1000-j]:[])}));
}

export class RestrictedFacility {
  guards:Officer[]=[];
  phase:FacilityPhase="quiet";
  warningRemaining=0;
  accessRemaining=0;
  alarmRemaining=0;
  arrestProgress=0;
  observesSuspect=false;
  onMessage=(_text:string)=>{};
  onArrest=()=>{};
  onCharacterHit:((model:Character,impulse:Vector3,fatal:boolean)=>void)|null=null;
  private active=false;
  private resistance=0;
  private messageTimer=0;
  private lastPlayer:Vector3;
  private lastKnown:Point2={...B.entrance};
  private patrolIndices=[0,0,0,0];
  private gateAngle=0;
  private readonly gate;
  private readonly gatePhysics:PhysicsAggregate;
  private readonly beacon;
  private readonly material:PBRMaterial;
  private readonly alarmMaterial:PBRMaterial;
  private nav:RoadNode[]=[];
  private obstacleCount=-1;
  private seconds=0;
  constructor(private scene:Scene,private shadows:ShadowGenerator,private world:WorldContract,private vehicles:VehicleSystem,private player:Player,private wanted:WantedSystem){
    this.lastPlayer=player.position.clone();
    this.material=new PBRMaterial("reserve/gate-material",scene);this.material.albedoColor=new Color3(.85,.73,.28);this.material.roughness=.75;
    this.gate=MeshBuilder.CreateBox("reserve/access-boom",{width:.18,height:.17,depth:12.6},scene);this.gate.position.set(-456,1.15,144);this.gate.rotationQuaternion=Quaternion.Identity();this.gate.material=this.material;this.gate.metadata={cameraBlocker:true,facility:B.id};shadows.addShadowCaster(this.gate);
    this.gatePhysics=new PhysicsAggregate(this.gate,PhysicsShapeType.BOX,{mass:0,friction:.5},scene);this.gatePhysics.body.setMotionType(PhysicsMotionType.ANIMATED);
    this.alarmMaterial=new PBRMaterial("reserve/alarm-material",scene);this.alarmMaterial.albedoColor=new Color3(.2,.38,.25);
    this.beacon=MeshBuilder.CreateSphere("reserve/gate-alarm",{diameter:.28,segments:8},scene);this.beacon.position.set(-456,3.45,137.3);this.beacon.material=this.alarmMaterial;
    this.createGuards();
  }
  private createGuards(){
    this.guards=ROUTES.map((route,i)=>{const guard=new Officer(`reserve-guard-${i+1}`,"military",B.id,this.scene,this.shadows);guard.model.root.position.set(route[0].x,.15,route[0].z);guard.model.root.rotation.y=Math.PI/2;guard.state="search";guard.model.root.setEnabled(false);return guard;});
  }
  get canRequestAccess(){return distance(this.player.position,B.entrance)<B.warningRadius&&!insideFacility(this.player.position);}
  requestAccess(){
    if(!this.canRequestAccess)return false;
    if(this.wanted.stars||this.wanted.phase==="reporting"||this.player.aim||this.resistance>0){this.onMessage("RESERVE: Visitor access denied while wanted or armed. Leave the gate area.");return false;}
    this.accessRemaining=FACILITY_RULES.visitorSeconds;this.warningRemaining=0;this.phase="authorized";
    this.onMessage("RESERVE: 90-second visitor pass granted. Keep weapons lowered; use the marked gate.");return true;
  }
  resist(seconds=12){
    if(annexDistance(this.player.position)>60)return;
    this.resistance=Math.max(this.resistance,seconds);this.accessRemaining=0;
    if(insideFacility(this.player.position)||this.guards.some(g=>g.health>0&&distance(g.position,this.player.position)<45&&clearSight(g.position,this.player.position,this.world.obstacles)))this.alarm("Armed incident reported at the annex.");
  }
  private alarm(message:string){
    if(this.phase!=="alarm"){
      this.phase="alarm";this.accessRemaining=0;this.warningRemaining=0;
      this.lastKnown={x:this.player.position.x,z:this.player.position.z};
      this.wanted.crime(300,this.lastKnown,true);this.onMessage(`RESERVE ALARM: ${message} Lower your weapon and stop, or leave the restricted area.`);
    }
    this.alarmRemaining=FACILITY_RULES.alarmSearchSeconds;
  }
  hurtGuard(guard:Officer,amount:number){
    if(!this.guards.includes(guard)||guard.health<=0||!Number.isFinite(amount)||amount<=0)return;
    guard.health=Math.max(0,guard.health-amount);this.resistance=12;this.alarm("A guard has been attacked.");
    if(guard.health<=0)guard.model.dead=true;
    const impulse=guard.position.subtract(this.player.position).normalize().scale(Math.min(12,amount*.16));impulse.y=1.5;
    this.onCharacterHit?.(guard.model,impulse,guard.health<=0);
    if(guard.health<=0){guard.state="injured";guard.controller?.dispose();guard.controller=null;if(!this.onCharacterHit){guard.model.root.rotation.z=Math.PI/2;guard.model.root.position.y=.35;}}
  }
  update(dt:number,enabled=true){
    this.seconds+=dt;this.messageTimer-=dt;this.accessRemaining=Math.max(0,this.accessRemaining-dt);this.resistance=Math.max(0,this.resistance-dt);this.observesSuspect=false;
    const p=this.player.position,inside=insideFacility(p),speed=distance(p,this.lastPlayer)/Math.max(.001,dt);this.lastPlayer.copyFrom(p);
    const near=annexDistance(p)<220;
    if(!inside&&this.phase==="warning"){this.phase="quiet";this.warningRemaining=0;if(near)this.onMessage("RESERVE: You are clear of the boundary. No alarm raised.");}
    if(!enabled){this.phase="quiet";this.warningRemaining=0;this.alarmRemaining=0;this.arrestProgress=0;}
    if(enabled&&near){
      if(this.phase!=="alarm"){
        const unauthorized=inside&&(this.accessRemaining<=0||this.player.aim);
        if(unauthorized){
          if(this.phase!=="warning"){this.phase="warning";this.warningRemaining=FACILITY_RULES.warningSeconds;this.accessRemaining=0;this.onMessage("RESERVE: Restricted grounds. Lower weapons and leave through the east gate within 6 seconds.");}
          this.warningRemaining-=dt;if(this.warningRemaining<=0)this.alarm("Restricted-area warning ignored.");
        }else if(this.accessRemaining>0)this.phase="authorized";
        else {if(this.phase==="warning"){this.warningRemaining=0;this.onMessage("RESERVE: You are clear of the boundary. No alarm raised.");}this.phase="quiet";}
      }
      if(this.canRequestAccess&&this.phase==="quiet"&&this.messageTimer<=0){this.onMessage("COASTAL RESERVE · authored training annex. Request visitor access at the east gate before entering.");this.messageTimer=18;}
    }
    const open=!enabled||inside||this.accessRemaining>0;
    this.gateAngle+=clamp((open?Math.PI/2:0)-this.gateAngle,-dt*1.1,dt*1.1);
    this.gatePhysics.body.setTargetTransform(new Vector3(-456,1.15+Math.sin(this.gateAngle)*6.3,137.7+Math.cos(this.gateAngle)*6.3),Quaternion.RotationAxis(new Vector3(1,0,0),-this.gateAngle));
    const flash=this.phase==="alarm"&&Math.sin(this.seconds*12)>0;
    this.alarmMaterial.emissiveColor.set(flash?1:0,flash?.05:.05,0);
    if(near!==this.active){
      this.active=near;
      for(const guard of this.guards){guard.model.root.setEnabled(near);if(!near){guard.weapon.setEnabled(false);guard.flash.setEnabled(false);guard.controller?.dispose();guard.controller=null;}}
    }
    if(!near){this.alarmRemaining=Math.max(0,this.alarmRemaining-dt);if(this.alarmRemaining===0&&this.phase==="alarm")this.phase="quiet";return;}
    if(this.world.obstacles.length!==this.obstacleCount){this.obstacleCount=this.world.obstacles.length;this.nav=facilityRoads(this.world.obstacles);}
    const routes=[...this.world.roads,...this.nav];let arrest=false;
    for(const [i,guard] of this.guards.entries()){
      guard.fireTimer-=dt;guard.flashTime=Math.max(0,guard.flashTime-dt);guard.flash.setEnabled(guard.flashTime>0);
      if(guard.health<=0)continue;
      if(guard.model.root.metadata?.ragdollActive){guard.controller?.dispose();guard.controller=null;continue;}
      const ensure=(this.world as WorldContract&{ensureCollision?:(p:Vector3)=>void}).ensureCollision;ensure?.call(this.world,guard.position);
      if(!guard.controller)guard.dismount(guard.model.root.position.add(new Vector3(0,.95,0)));
      const g=guard.position,gap=distance(g,p),visible=gap<FACILITY_RULES.guardSight&&clearSight(g.add(new Vector3(0,.6,0)),p.add(new Vector3(0,.45,0)),this.world.obstacles);
      const responding=enabled&&this.phase==="alarm";
      const identified=visible&&(inside||this.wanted.recognizes(p,this.player.vehicle?.id??null,this.player.name,gap)||distance(p,this.lastKnown)<12);
      if(responding&&identified){this.observesSuspect=true;this.lastKnown={x:p.x,z:p.z};this.alarmRemaining=FACILITY_RULES.alarmSearchSeconds;}
      const threat=this.resistance>0||this.player.aim;
      const aim=responding&&identified;
      if(aim&&threat&&gap<FACILITY_RULES.guardFireRange&&guard.fireTimer<=0&&this.player.deadTimer<=0){this.fire(guard);guard.fireTimer=.85;guard.flashTime=.07;guard.state="firing";}else guard.state=aim?"challenge":"search";
      if(responding&&identified&&gap<2.8&&compliant(this.player.vehicle?.speed??speed,this.resistance>0,this.player.aim,this.player.deadTimer>0))arrest=true;
      let goal:Point2=ROUTES[i][this.patrolIndices[i]];
      if(responding){goal={x:clamp(this.lastKnown.x,B.minX+2,B.maxX-5),z:clamp(this.lastKnown.z,B.minZ+3,B.maxZ-3)};}
      else if(distance(g,goal)<1.8){this.patrolIndices[i]=(this.patrolIndices[i]+1)%ROUTES[i].length;goal=ROUTES[i][this.patrolIndices[i]];}
      guard.routeTimer-=dt;
      if(guard.routeTimer<=0){guard.path=footRoute(g,goal,routes,this.world.obstacles);guard.routeTimer=.9+i*.04;}
      while(guard.path.length&&distance(g,guard.path[0])<.8)guard.path.shift();
      const target=guard.path[0],direction=target?new Vector3(target.x-g.x,0,target.z-g.z).normalize():Vector3.Zero();
      let movement=target?(responding?4:1.35):0;
      if((responding&&visible&&gap<(threat?10:2.2))||(!responding&&ROUTES[i].length===1&&distance(g,goal)<1))movement=0;
      if(aim&&movement===0)direction.copyFrom(p.subtract(g));
      direction.y=0;direction.normalize();guard.move(dt,direction,movement,aim);
    }
    if(this.phase==="alarm"){
      this.alarmRemaining-=dt;
      if(this.alarmRemaining<=0&&!inside){this.phase="quiet";this.onMessage("RESERVE: Local search ended. Guards returning to posts.");}
    }
    this.arrestProgress=arrest?Math.min(1,this.arrestProgress+dt/FACILITY_RULES.arrestSeconds):0;
    if(this.arrestProgress>=1){this.arrestProgress=0;this.onArrest();}
  }
  private fire(guard:Officer){
    const origin=guard.position.add(new Vector3(0,.5,0)),target=this.player.position.add(new Vector3(0,.35,0)),delta=target.subtract(origin),length=delta.length();
    const hit=this.scene.pickWithRay(new Ray(origin,delta.normalize(),length),m=>m.isEnabled()&&m.metadata?.officer!==guard&&!!(m.metadata?.cameraBlocker||m.metadata?.prop||m.metadata?.officer||m.metadata?.vehicleId||m.parent?.metadata?.vehicleId));
    if(hit?.hit&&hit.pickedMesh&&hit.distance<length-.8){const id=hit.pickedMesh.metadata?.vehicleId??hit.pickedMesh.parent?.metadata?.vehicleId;const v=this.vehicles.list.find(v=>v.id===id);if(v)this.vehicles.damage(v,3,hit.pickedPoint??target);return;}
    this.player.hurt(7);
  }
  reset(revive=true){if(revive){this.guards.forEach(g=>g.dispose());this.createGuards();this.active=false;this.patrolIndices=[0,0,0,0];}this.phase="quiet";this.warningRemaining=0;this.accessRemaining=0;this.alarmRemaining=0;this.arrestProgress=0;this.resistance=0;this.lastPlayer.copyFrom(this.player.position);}
  restoreCasualties(entries:Casualty[]){for(const entry of entries){const guard=this.guards.find(g=>g.id===entry.id);if(!guard)continue;guard.health=0;guard.state="injured";guard.controller?.dispose();guard.controller=null;restoreCorpse(guard.model,entry);guard.weapon.setEnabled(false);}}
  get stats(){return {id:B.id,classification:B.classification,phase:this.phase,inside:insideFacility(this.player.position),accessSeconds:Math.ceil(this.accessRemaining),warningSeconds:Math.ceil(this.warningRemaining),guards:this.guards.filter(g=>g.health>0).length,activeGuards:this.active?this.guards.filter(g=>g.health>0).length:0,gateOpen:this.gateAngle>1.4,arrestProgress:this.arrestProgress};}
  dispose(){this.guards.forEach(g=>g.dispose());this.guards=[];this.gatePhysics.dispose();this.gate.dispose();this.beacon.dispose();this.material.dispose();this.alarmMaterial.dispose();}
}
