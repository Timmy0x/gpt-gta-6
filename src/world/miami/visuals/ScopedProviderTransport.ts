import type {Tile,Tileset} from '3d-tiles-renderer/core';
import type {LHTilesRenderer} from './LHTilesRenderer';
import {abortError,VisualConnectionError,type VisualConnection,type VisualCredit} from './VisualConnectionTypes';
export type VisualFetch=(input:RequestInfo|URL,init?:RequestInit)=>Promise<Response>;
interface Address {url:string;}
type OwnedTile=Tile;
/** Connection-local auth and address routing. Real URLs never become renderer content labels. */
export class ScopedProviderTransport {
 readonly name='SCOPED_VISUAL_PROVIDER';
 readonly rootAlias='https://streamed.invalid/root.json';
 #config:VisualConnection;#fetch:VisualFetch;#signal:AbortSignal;#closed=false;
 #renderer:LHTilesRenderer|null=null;#rootURL='';#authOrigin='';#version:string|null=null;#bearer='';#googleKey='';#google=false;#session:string|null=null;
 #endpointCredits:readonly VisualCredit[]=[];#refresh:Promise<void>|null=null;
 #rootOwner={};#owners=new WeakMap<object,Address>();#addresses=new Map<string,WeakRef<Address>>();#bases=new WeakMap<object,string>();#next=0;
 constructor(config:VisualConnection,fetcher:VisualFetch,signal:AbortSignal){this.#config={...config};this.#fetch=(input,init)=>fetcher.call(globalThis,input,init);this.#signal=signal;}
 init(renderer:LHTilesRenderer){this.#renderer=renderer;}
 get googleBranding(){return this.#google;}
 get endpointCredits(){return this.#endpointCredits;}
 #options(value:RequestInit={}):RequestInit {
  if(this.#closed||this.#signal.aborted||value.signal?.aborted)throw abortError();
  return {...value,credentials:'omit',cache:'no-store',referrerPolicy:'strict-origin-when-cross-origin',signal:value.signal?AbortSignal.any([this.#signal,value.signal]):this.#signal};
 }
 async #request(url:URL,init:RequestInit={}):Promise<Response>{
  const options=this.#options(init);let response:Response;
  try{response=await this.#fetch(url,options);}catch(error){if(this.#closed||options.signal?.aborted)throw abortError();throw new VisualConnectionError('network');}
  if(this.#closed||options.signal?.aborted)throw abortError();return response;
 }
 #check(response:Response){if(!response.ok)throw new VisualConnectionError('http',response.status);}
 async #json(response:Response):Promise<Record<string,unknown>>{
  this.#check(response);try{const json:unknown=await response.json();if(this.#closed||this.#signal.aborted)throw abortError();if(!json||typeof json!=='object'||Array.isArray(json))throw new VisualConnectionError('content');return json as Record<string,unknown>;}catch(error){if(this.#closed||this.#signal.aborted)throw abortError();throw error instanceof VisualConnectionError?error:new VisualConnectionError('content');}
 }
 #https(value:unknown):URL{try{if(typeof value!=='string')throw 0;const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password)throw 0;return url;}catch{throw new VisualConnectionError('content');}}
 #setRoot(url:URL){this.#rootURL=url.href;this.#authOrigin=url.origin;this.#version=url.searchParams.get('v');const record={url:url.href};this.#owners.set(this.#rootOwner,record);this.#addresses.set(this.rootAlias,new WeakRef(record));}
 async #endpoint(init:RequestInit={}):Promise<void>{
  const url=new URL(`https://api.cesium.com/v1/assets/${this.#config.assetId}/endpoint`);url.searchParams.set('access_token',this.#config.credential);
  const json=await this.#json(await this.#request(url,init));
  this.#endpointCredits=Object.freeze((Array.isArray(json.attributions)?json.attributions:[]).flatMap((item:unknown)=>{if(!item||typeof item!=='object')return[];const {html,collapsible}=item as {html?:unknown;collapsible?:unknown};return typeof html==='string'&&html.trim()?[Object.freeze({type:'html',value:html,...(typeof collapsible==='boolean'?{collapsible}:{})})]:[];}));
  if('externalType' in json){
   // Pinned CesiumIonAuthPlugin treats externalType as a presence marker.
   // Identify the supported Google endpoint from its actual URL, not an invented enum.
   const options=json.options as {url?:unknown}|undefined,root=this.#https(options?.url),key=root.searchParams.get('key');if(!key||root.origin!=='https://tile.googleapis.com'||root.pathname!=='/v1/3dtiles/root.json')throw new VisualConnectionError('content');
   this.#google=true;this.#googleKey=key;this.#bearer='';this.#session=null;root.searchParams.delete('key');this.#setRoot(root);
  }else{
   if(json.type!=='3DTILES'||typeof json.accessToken!=='string'||!json.accessToken)throw new VisualConnectionError('content');
   this.#google=false;this.#googleKey='';this.#session=null;this.#bearer=`Bearer ${json.accessToken}`;this.#setRoot(this.#https(json.url));
  }
 }
 async loadRootTileset():Promise<Tileset>{
  if(this.#config.provider==='ion')await this.#endpoint();else{this.#google=true;this.#googleKey=this.#config.credential;this.#setRoot(new URL('https://tile.googleapis.com/v1/3dtiles/root.json'));}
  this.#options();if(!this.#renderer)throw abortError();return this.#renderer.loadRootTileset();
 }
 #authenticated(url:URL,init:RequestInit,omitSession=false){
  const request=new URL(url),headers=new Headers(init.headers);headers.delete('Authorization');
  if(request.origin===this.#authOrigin){
   if(this.#google){request.searchParams.set('key',this.#googleKey);if(omitSession)request.searchParams.delete('session');else if(this.#session)request.searchParams.set('session',this.#session);}
   else if(this.#bearer){headers.set('Authorization',this.#bearer);if(this.#version)request.searchParams.set('v',this.#version);}
  }else for(const key of ['key','session','access_token','token'])request.searchParams.delete(key);
  return {url:request,options:{...init,headers}};
 }
 async #contentRequest(url:URL,init:RequestInit,omitSession=false){const auth=this.#authenticated(url,init,omitSession);return this.#request(auth.url,auth.options);}
 #captureSession(json:Record<string,unknown>){
  const stack:unknown[]=[json.root];while(stack.length){const value=stack.pop();if(!value||typeof value!=='object')continue;const tile=value as {content?:{uri?:unknown};children?:unknown[]};if(typeof tile.content?.uri==='string'){const query=tile.content.uri.split('?')[1],session=new URLSearchParams(query).get('session');if(session){this.#session=session;return;}}if(Array.isArray(tile.children))for(let i=tile.children.length-1;i>=0;i--)stack.push(tile.children[i]);}
 }
 // Root session renewal is key-only, matching GoogleCloudAuth.refreshToken.
 // Reusing an expired session here prevents the source from issuing its replacement.
 async #renew(init:RequestInit){
  if(!this.#refresh){const pending=(async()=>{if(this.#google){const json=await this.#json(await this.#contentRequest(new URL(this.#rootURL),init,true));this.#captureSession(json);}else await this.#endpoint(init);})();this.#refresh=pending;try{await pending;}finally{if(this.#refresh===pending)this.#refresh=null;}}
  else await this.#refresh;
 }
 async fetchData(alias:string,init:RequestInit={}):Promise<Record<string,unknown>|ArrayBuffer>{
  this.#options(init);const address=this.#addresses.get(alias)?.deref();if(!address)throw new VisualConnectionError('content');
  const url=this.#https(address.url),root=alias===this.rootAlias;let response=await this.#contentRequest(url,init,root&&this.#google);
  if(response.status===401&&url.origin===this.#authOrigin){
   // Initial Google root: retry once. Nested content: refresh auth/session once, then retry.
   if(!(root&&this.#google))await this.#renew(init);
   response=await this.#contentRequest(url,this.#options(init),root&&this.#google);
  }
  this.#check(response);
  if(new URL(alias).pathname.endsWith('.json')){
   const json=await this.#json(response);if(this.#google&&root)this.#captureSession(json);
   if(json.root&&typeof json.root==='object')this.#bases.set(json.root,address.url);return json;
  }
  try{const bytes=await response.arrayBuffer();this.#options(init);return bytes;}catch(error){if(this.#closed||this.#signal.aborted||init.signal?.aborted)throw abortError();throw new VisualConnectionError('network');}
 }
 preprocessNode(tile:OwnedTile,_directory:string,parent:OwnedTile|null){
  this.#options();const base=this.#bases.get(tile)??(parent?this.#bases.get(parent):undefined)??this.#rootURL;this.#bases.set(tile,base);
  if(tile.content?.uri){let url:URL;try{url=new URL(tile.content.uri,base);}catch{throw new VisualConnectionError('content');}url=this.#https(url.href);
   const extension=url.pathname.toLowerCase().endsWith('.json')?'json':url.pathname.toLowerCase().endsWith('.b3dm')?'b3dm':'glb';
   const alias=`https://streamed.invalid/content/${++this.#next}.${extension}`,record={url:url.href};this.#owners.set(tile,record);this.#addresses.set(alias,new WeakRef(record));tile.content.uri=alias;
  }
 }
 /** Weak address entries hold no tile/URL alive after the renderer releases its tile. */
 pruneAddresses(){for(const [alias,reference] of this.#addresses)if(!reference.deref())this.#addresses.delete(alias);}
 dispose(){if(this.#closed)return;this.#closed=true;this.#renderer=null;this.#config.credential='';this.#rootURL=this.#authOrigin=this.#bearer=this.#googleKey='';this.#session=null;this.#version=null;this.#endpointCredits=[];this.#refresh=null;this.#owners=new WeakMap();this.#bases=new WeakMap();this.#addresses.clear();}
}
