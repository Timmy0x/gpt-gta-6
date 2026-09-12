export type VisualProvider='ion'|'google';
export interface VisualConnection {provider:VisualProvider;credential:string;assetId?:string;}
export interface VisualCredit {readonly type:string;readonly value:string;readonly collapsible?:boolean;}
export type VisualErrorCode='configuration'|'http'|'network'|'content'|'camera'|'disposed';
export class VisualConnectionError extends Error {
 readonly code:VisualErrorCode;readonly status:number|null;
 constructor(code:VisualErrorCode,status:number|null=null){super(code==='http'?`Visual source request failed (${status}).`:`Visual source ${code} error.`);this.name='VisualConnectionError';this.code=code;this.status=status;}
}
export function connection(value:VisualConnection):VisualConnection {
 if(!value||!['ion','google'].includes(value.provider)||typeof value.credential!=='string'||!value.credential.trim()||/\s/.test(value.credential.trim())||value.credential.length>4096)throw new VisualConnectionError('configuration');
 if(value.provider==='ion'&&(typeof value.assetId!=='string'||!/^\d+$/.test(value.assetId)||!Number.isSafeInteger(Number(value.assetId))||Number(value.assetId)<=0))throw new VisualConnectionError('configuration');
 return {provider:value.provider,credential:value.credential.trim(),...(value.provider==='ion'?{assetId:value.assetId}: {})};
}
export const MIAMI_VISUAL_ORIGIN=Object.freeze({latitudeDegrees:25.7662,longitudeDegrees:-80.1907,ellipsoidHeightM:0});
export const abortError=()=>new DOMException('Visual connection cancelled','AbortError');
export function safeFailure(error:unknown):VisualConnectionError{return error instanceof VisualConnectionError?error:new VisualConnectionError('content');}
