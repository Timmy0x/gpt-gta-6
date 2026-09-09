import type { Character } from "../Character";
import type { CharacterDamageKind } from "../combat/injuries";
export interface Casualty { id:string;x:number;y:number;z:number;yaw:number;health?:number;recoverySeconds?:number|null;kind?:CharacterDamageKind; }
export interface PoliceCasualty extends Casualty { role:"patrol"|"swat"; }
export interface PopulationCasualties { version:1|2;civilians:Casualty[];guards:Casualty[];police:PoliceCasualty[];nextOfficerId:number; }
export const CASUALTY_LIMITS={civilians:60,guards:4,police:24} as const;
export function validateCasualties(value:unknown):value is PopulationCasualties {
  if(!value||typeof value!=="object")return false;
  const s=value as PopulationCasualties;
  if(![1,2].includes(s.version)||!Number.isSafeInteger(s.nextOfficerId)||s.nextOfficerId<1||s.nextOfficerId>1e9)return false;
  for(const key of ["civilians","guards","police"] as const){
    const entries=s[key];if(!Array.isArray(entries)||entries.length>CASUALTY_LIMITS[key])return false;
    const ids=new Set<string>();
    for(const entry of entries){
      if(!entry||typeof entry.id!=="string"||!(/^[A-Za-z0-9_.:-]{1,96}$/).test(entry.id)||ids.has(entry.id))return false;
      if(![entry.x,entry.y,entry.z,entry.yaw].every(Number.isFinite)||Math.abs(entry.x)>20000||Math.abs(entry.z)>20000||Math.abs(entry.y)>2000||Math.abs(entry.yaw)>1e6)return false;
      if(s.version===2){
        if(typeof entry.health!=="number"||!Number.isFinite(entry.health)||entry.health<0||entry.health>200)return false;
        if(entry.recoverySeconds!==null&&(typeof entry.recoverySeconds!=="number"||!Number.isFinite(entry.recoverySeconds)||entry.recoverySeconds<0||entry.recoverySeconds>30))return false;
        if(typeof entry.kind!=="string"||!["impact","melee","projectile","explosion","fire"].includes(entry.kind))return false;
        if(entry.health===0&&entry.recoverySeconds!==null)return false;
      }else if(entry.health!==undefined||entry.recoverySeconds!==undefined||entry.kind!==undefined)return false;
      if(key==="guards"&&!/^reserve-guard-[1-4]$/.test(entry.id))return false;
      if(key==="police"&&(!/^officer-\d+$/.test(entry.id)||Number(entry.id.slice(8))>=s.nextOfficerId||!["patrol","swat"].includes((entry as PoliceCasualty).role)))return false;
      ids.add(entry.id);
    }
  }
  return true;
}
export function isDown(model:Character,health:number):boolean { return health<=0 || !!model.injury; }
export function snapshotCasualty(id:string,model:Character,health=0):Casualty {
  return {id,x:model.root.position.x,y:model.root.position.y,z:model.root.position.z,yaw:model.root.rotation.y,
    health,recoverySeconds:health<=0?null:model.injury?.remaining??null,kind:model.injury?.kind??"impact"};
}
/** Restore a lying casualty; version-one entries without health remain fatal. */
export function restoreCorpse(model:Character,entry:Casualty):void {
  model.dead=(entry.health??0)<=0;
  model.injury=model.dead?null:{kind:entry.kind??"impact",remaining:entry.recoverySeconds??null};
  model.skeleton.returnToRest();model.root.rotationQuaternion=null;
  model.root.rotation.set(0,entry.yaw,Math.PI/2);
  model.root.position.set(entry.x,Math.max(.18,entry.y),entry.z);
  model.root.metadata={...model.root.metadata,ragdollActive:true,ragdollRecovering:false,injuryStatus:model.dead?"dead":model.injury?.remaining===null?"incapacitated":"knocked-down"};
}
