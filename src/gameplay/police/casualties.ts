import { Quaternion, Vector3 } from '@babylonjs/core';
import { bodyInjuryEffects, cloneBodyInjuries, hasBodyInjuries, validateBodyInjuries, type BodyInjuryState } from '../Injuries';
import type { Character } from "../Character";
import type { CharacterDamageKind } from "../combat/injuries";
export interface SavedBonePose { name:string; position:number[]; rotation:number[]; }
export interface Casualty { id:string;x:number;y:number;z:number;yaw:number;health?:number;recoverySeconds?:number|null;kind?:CharacterDamageKind;bodyInjuries?:BodyInjuryState;fallen?:boolean;pose?:SavedBonePose[];rootRotation?:number[];vehicleId?:string; }
export interface PoliceCasualty extends Casualty { role:"patrol"|"swat"; seat?:0|1; }
export interface PopulationCasualties { version:1|2|3;civilians:Casualty[];guards:Casualty[];police:PoliceCasualty[];nextOfficerId:number; }
export const CASUALTY_LIMITS={civilians:60,guards:4,police:24} as const;
export function validateCasualties(value:unknown):value is PopulationCasualties {
  if(!value||typeof value!=="object")return false;
  const s=value as PopulationCasualties;
  if(![1,2,3].includes(s.version)||!Number.isSafeInteger(s.nextOfficerId)||s.nextOfficerId<1||s.nextOfficerId>1e9)return false;
  for(const key of ["civilians","guards","police"] as const){
    const entries=s[key];if(!Array.isArray(entries)||entries.length>CASUALTY_LIMITS[key])return false;
    const ids=new Set<string>();
    for(const entry of entries){
      if(!entry||typeof entry.id!=="string"||!(/^[A-Za-z0-9_.:-]{1,96}$/).test(entry.id)||ids.has(entry.id))return false;
      if(![entry.x,entry.y,entry.z,entry.yaw].every(Number.isFinite)||Math.abs(entry.x)>20000||Math.abs(entry.z)>20000||Math.abs(entry.y)>2000||Math.abs(entry.yaw)>1e6)return false;
      if(s.version>=2){
        if(typeof entry.health!=="number"||!Number.isFinite(entry.health)||entry.health<0||entry.health>200)return false;
        if(entry.recoverySeconds!==null&&(typeof entry.recoverySeconds!=="number"||!Number.isFinite(entry.recoverySeconds)||entry.recoverySeconds<0||entry.recoverySeconds>30))return false;
        if(typeof entry.kind!=="string"||!["impact","melee","projectile","explosion","fire"].includes(entry.kind))return false;
        if(entry.health===0&&entry.recoverySeconds!==null)return false;
      }else if(entry.health!==undefined||entry.recoverySeconds!==undefined||entry.kind!==undefined)return false;
      if(s.version===3){
        if(entry.vehicleId!==undefined&&(typeof entry.vehicleId!=='string'||!(/^[A-Za-z0-9_.:-]{1,96}$/).test(entry.vehicleId)))return false;
        if(typeof entry.fallen!=='boolean'||entry.bodyInjuries!==undefined&&!validateBodyInjuries(entry.bodyInjuries))return false;
        if(entry.rootRotation&&(!Array.isArray(entry.rootRotation)||entry.rootRotation.length!==4||!entry.rootRotation.every(Number.isFinite)||Math.abs(Math.hypot(...entry.rootRotation)-1)>.01))return false;
        if(entry.pose){
          if(!Array.isArray(entry.pose)||entry.pose.length>80||entry.pose.some(b=>!b||typeof b!=='object')||new Set(entry.pose.map(b=>b.name)).size!==entry.pose.length)return false;
          for(const bone of entry.pose)if(typeof bone.name!=='string'||!(/^[A-Za-z]{1,32}$/).test(bone.name)||!Array.isArray(bone.position)||bone.position.length!==3||!bone.position.every(n=>Number.isFinite(n)&&Math.abs(n)<100)||!Array.isArray(bone.rotation)||bone.rotation.length!==4||!bone.rotation.every(Number.isFinite)||Math.abs(Math.hypot(...bone.rotation)-1)>.01)return false;
        }
      }else if(entry.bodyInjuries!==undefined||entry.fallen!==undefined||entry.pose!==undefined||entry.rootRotation!==undefined||entry.vehicleId!==undefined)return false;
      if(key==="guards"&&!/^reserve-guard-[1-4]$/.test(entry.id))return false;
      if(key==="police"&&(!/^officer-\d+$/.test(entry.id)||Number(entry.id.slice(8))>=s.nextOfficerId||!["patrol","swat"].includes((entry as PoliceCasualty).role)))return false;
      if(key==='police'&&(entry as PoliceCasualty).seat!==undefined&&(s.version!==3||!entry.vehicleId||![0,1].includes((entry as PoliceCasualty).seat!)))return false;
      ids.add(entry.id);
    }
  }
  return true;
}
export function isDown(model:Character,health:number):boolean {
  const effects=bodyInjuryEffects(model.bodyInjuries);
  return health<=0 || !!model.injury || effects.mode==='down' || effects.mode==='crawling';
}
export function hasCasualtyState(model:Character,health:number):boolean { return isDown(model,health)||hasBodyInjuries(model.bodyInjuries); }
export function snapshotCasualty(id:string,model:Character,health=0):Casualty {
  const fallen=health<=0||!!model.root.metadata?.ragdollActive||!bodyInjuryEffects(model.bodyInjuries).canStand;
  const rotation=Quaternion.Identity(),position=Vector3.Zero();
  model.root.computeWorldMatrix(true).decompose(undefined,rotation,position);
  return {id,x:position.x,y:position.y,z:position.z,yaw:rotation.toEulerAngles().y,
    health,recoverySeconds:health<=0?null:model.injury?.remaining??null,kind:model.injury?.kind??'impact',fallen,
    ...(model.bodyInjuries?{bodyInjuries:cloneBodyInjuries(model.bodyInjuries)}:{}),
    ...(fallen?{rootRotation:rotation.asArray(),pose:model.skeleton.bones.map(bone=>({name:bone.name.split('/').at(-1)!,position:bone.getPosition().asArray(),rotation:bone.getRotationQuaternion().asArray()}))}:{})};
}
/** Version-three partial injuries restore as active survivors; legacy casualties keep their meaning. */
export function restoreCorpse(model:Character,entry:Casualty):void {
  model.dead=(entry.health??0)<=0;
  model.bodyInjuries=entry.bodyInjuries?cloneBodyInjuries(entry.bodyInjuries):null;
  const legacy=!entry.bodyInjuries;
  model.injury=model.dead||!legacy?null:{kind:entry.kind??'impact',remaining:entry.recoverySeconds??null};
  model.skeleton.returnToRest();model.root.parent=null;model.root.rotationQuaternion=null;model.root.scaling.setAll(1);
  model.root.position.set(entry.x,entry.y,entry.z);
  model.root.rotation.set(0,entry.yaw,0);
  if(entry.pose){
    if(entry.rootRotation)model.root.rotation.copyFrom(Quaternion.FromArray(entry.rootRotation).toEulerAngles());
    for(const pose of entry.pose){const bone=model.skeleton.bones.find(b=>b.name.endsWith('/'+pose.name));if(bone){bone.setPosition(Vector3.FromArray(pose.position));bone.setRotationQuaternion(Quaternion.FromArray(pose.rotation));}}
  }else if(legacy){
    model.dead=false;model.root.metadata={...model.root.metadata,ragdollActive:false};model.animate(1/60,0);model.dead=(entry.health??0)<=0;
    model.root.rotation.z=Math.PI/2;model.root.position.y=Math.max(.18,entry.y);
  }
  const physical=model.dead||legacy;
  model.root.metadata={...model.root.metadata,ragdollActive:physical,ragdollRecovering:false,ragdollHandoffActive:false,injuryStatus:model.dead?'dead':legacy?model.injury?.remaining===null?'incapacitated':'knocked-down':bodyInjuryEffects(model.bodyInjuries).mode};
  if(!physical&&!entry.pose){model.animate(1/60,0);model.applyInjuryPose(bodyInjuryEffects(model.bodyInjuries),1/60,0);}
}
