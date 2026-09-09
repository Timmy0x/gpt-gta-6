import type { Character } from "../Character";
export interface Casualty { id:string;x:number;y:number;z:number;yaw:number; }
export interface PoliceCasualty extends Casualty { role:"patrol"|"swat"; }
export interface PopulationCasualties { version:1;civilians:Casualty[];guards:Casualty[];police:PoliceCasualty[];nextOfficerId:number; }
export const CASUALTY_LIMITS={civilians:60,guards:4,police:24} as const;
export function validateCasualties(value:unknown):value is PopulationCasualties {
  if(!value||typeof value!=="object")return false;
  const s=value as PopulationCasualties;
  if(s.version!==1||!Number.isSafeInteger(s.nextOfficerId)||s.nextOfficerId<1||s.nextOfficerId>1e9)return false;
  for(const key of ["civilians","guards","police"] as const){
    const entries=s[key];if(!Array.isArray(entries)||entries.length>CASUALTY_LIMITS[key])return false;
    const ids=new Set<string>();
    for(const entry of entries){
      if(!entry||typeof entry.id!=="string"||!(/^[A-Za-z0-9_.:-]{1,96}$/).test(entry.id)||ids.has(entry.id))return false;
      if(![entry.x,entry.y,entry.z,entry.yaw].every(Number.isFinite)||Math.abs(entry.x)>20000||Math.abs(entry.z)>20000||Math.abs(entry.y)>2000||Math.abs(entry.yaw)>1e6)return false;
      if(key==="guards"&&!/^reserve-guard-[1-4]$/.test(entry.id))return false;
      if(key==="police"&&(!/^officer-\d+$/.test(entry.id)||Number(entry.id.slice(8))>=s.nextOfficerId||!["patrol","swat"].includes((entry as PoliceCasualty).role)))return false;
      ids.add(entry.id);
    }
  }
  return true;
}
export function snapshotCasualty(id:string,model:Character):Casualty {
  return {id,x:model.root.position.x,y:model.root.position.y,z:model.root.position.z,yaw:model.root.rotation.y};
}
/** Saved casualties remain corpses without retaining simulation bodies or serializing a ragdoll graph. */
export function restoreCorpse(model:Character,entry:Casualty):void {
  model.dead=true;model.skeleton.returnToRest();model.root.rotationQuaternion=null;
  model.root.rotation.set(0,entry.yaw,Math.PI/2);
  model.root.position.set(entry.x,Math.max(.18,entry.y),entry.z);
  model.root.metadata={...model.root.metadata,ragdollActive:true,ragdollRecovering:false};
}
