import type {Scene} from '@babylonjs/core/scene';
import type {Observer} from '@babylonjs/core/Misc/observable';
import type {Tile,Tileset} from '3d-tiles-renderer/core';
import {LHTilesRenderer,type LHTile} from './LHTilesRenderer';
import {ResourceLedger,resourceLedgerPlugin,type ResourceSummary} from './resource-ledger';
import {StreamStatus,streamStatusPlugin,type StreamSnapshot} from './stream-status';
import {ScopedProviderTransport,type VisualFetch} from './ScopedProviderTransport';
import {connection,MIAMI_VISUAL_ORIGIN,safeFailure,VisualConnectionError,type VisualConnection,type VisualCredit,type VisualProvider,type VisualErrorCode} from './VisualConnectionTypes';
export {MIAMI_VISUAL_ORIGIN,VisualConnectionError};
export type {VisualConnection,VisualCredit,VisualProvider};
export type VisualPhase='disconnected'|'connecting'|'loading'|'visible'|'partial'|'failed'|'disposed';
export interface VisualSnapshot {
 readonly phase:VisualPhase;readonly provider:VisualProvider|null;readonly rootLoaded:boolean;
 readonly visibleTiles:number;readonly creditVersion:number;readonly requiresGoogleBranding:boolean;
 readonly error:Readonly<{code:VisualErrorCode;httpStatus:number|null;scope:'root'|'tile'|'frame'}>|null;
 readonly countLimit:960;readonly resources:Readonly<ResourceSummary>|null;readonly stream:Readonly<StreamSnapshot>|null;
 /** This module never establishes physical collision or safe-travel readiness. */
 readonly collisionReady:false;
}
export interface VisualOptions {fetch?:VisualFetch;onChange?:(state:VisualSnapshot)=>void;}
interface Session {
 renderer:LHTilesRenderer;transport:ScopedProviderTransport;abort:AbortController;resources:ResourceLedger;stream:StreamStatus;
 root:boolean;provider:VisualProvider;failure:VisualSnapshot['error'];resourceInfo:ResourceSummary|null;streamInfo:StreamSnapshot|null;
}
function freeze<T>(value:T):T{if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const item of Object.values(value))freeze(item);Object.freeze(value);}return value;}
/** Only fixed errors enter the pinned renderer's own failure log; no global console hook is installed. */
class PrivateTileRenderer extends LHTilesRenderer {
 preprocessTileset(json:Tileset&{asset:{gltfUpAxis?:string}},url:string,parent:Tile|null=null){try{return super.preprocessTileset(json,url,parent);}catch(error){throw safeFailure(error);}}
 preprocessNode(tile:LHTile,directory:string,parent:LHTile|null=null){try{return super.preprocessNode(tile,directory,parent);}catch(error){throw safeFailure(error);}}
 async parseTile(buffer:ArrayBuffer,tile:LHTile,extension:string,url:string,signal:AbortSignal){try{return await super.parseTile(buffer,tile,extension,url,signal);}catch(error){throw safeFailure(error);}}
}
/** Scene-owned visual streaming. It never creates an engine, scene, camera, pipeline or collision body. */
export class StreamedMiamiVisuals {
 #scene:Scene;#fetch:VisualFetch;#onChange:VisualOptions['onChange'];#sceneObserver:Observer<Scene>|null;
 #session:Session|null=null;#saved:VisualConnection|null=null;#closed=false;#credits:readonly VisualCredit[]=Object.freeze([]);#creditSignature='[]';#creditVersion=0;
 #snapshot:VisualSnapshot;#signature='';#dirty=true;
 constructor(scene:Scene,options:VisualOptions={}){
  if(scene.useRightHandedSystem)throw new VisualConnectionError('camera');
  this.#scene=scene;this.#fetch=options.fetch??globalThis.fetch.bind(globalThis);this.#onChange=options.onChange;
  this.#snapshot=freeze({phase:'disconnected',provider:null,rootLoaded:false,visibleTiles:0,creditVersion:0,requiresGoogleBranding:false,error:null,countLimit:960,resources:null,stream:null,collisionReady:false});
  this.#sceneObserver=scene.onDisposeObservable.add(()=>this.dispose());
 }
 snapshot():VisualSnapshot{return this.#snapshot;}
 credits():readonly VisualCredit[]{return this.#credits;}
 connect(input:VisualConnection):void{
  const config=connection(input);if(this.#closed)throw new VisualConnectionError('disposed');
  if(this.#scene.useRightHandedSystem||!this.#scene.activeCamera)throw new VisualConnectionError('camera');
  this.#stop();this.#saved={...config};const abort=new AbortController(),transport=new ScopedProviderTransport(config,this.#fetch,abort.signal);
  const renderer=new PrivateTileRenderer(transport.rootAlias,this.#scene,{origin:MIAMI_VISUAL_ORIGIN});
  const resources=new ResourceLedger(),stream=new StreamStatus(),session:Session={renderer,transport,abort,resources,stream,root:false,provider:config.provider,failure:null,resourceInfo:null,streamInfo:null};this.#session=session;
  renderer.registerPlugin(transport);renderer.registerPlugin(resourceLedgerPlugin(resources));renderer.registerPlugin(streamStatusPlugin(stream));
  renderer.fetchOptions={credentials:'omit',cache:'no-store',referrerPolicy:'strict-origin-when-cross-origin'};
  renderer.lruCache.maxSize=960;renderer.lruCache.minSize=640;
  // The backend's byte estimate is1, so these are tracker safeguards, not a measured memory budget.
  renderer.lruCache.maxBytesSize=128*1024*1024;renderer.lruCache.minBytesSize=96*1024*1024;
  renderer.downloadQueue.maxJobsPerOrigin=4;renderer.parseQueue.maxJobs=2;renderer.errorTarget=20;renderer.loadAncestors=true;renderer.loadSiblings=false;renderer.checkCollisions=false;
  renderer.addEventListener('load-root-tileset',()=>{if(this.#session===session){session.root=true;this.#dirty=true;}});
  renderer.addEventListener('load-error',event=>{if(this.#session!==session)return;const error=safeFailure(event.error);session.failure={code:error.code,httpStatus:error.status,scope:event.tile?'tile':'root'};this.#dirty=true;});
  this.#dirty=true;this.#publish();if(this.#session===session)this.update();
 }
 retry():boolean{if(this.#closed||!this.#saved)return false;this.connect({...this.#saved});return true;}
 update(nowMs=performance.now()):void{
  const session=this.#session;if(this.#closed||!session)return;
  try{session.renderer.update();}catch(error){const safe=error instanceof VisualConnectionError?error:new VisualConnectionError(this.#scene.useRightHandedSystem||!this.#scene.activeCamera?'camera':'content');session.failure={code:safe.code,httpStatus:safe.status,scope:'frame'};session.stream.renderError();this.#dirty=true;}
  if(this.#session!==session)return;
  const resources=session.resources.sample(nowMs,session.renderer.visibleTiles),stream=session.stream.sample(nowMs);
  if(resources){session.resourceInfo=resources;session.transport.pruneAddresses();this.#dirty=true;}if(stream){session.streamInfo=stream;this.#dirty=true;}
  this.#refreshCredits(session);
  const phase=this.#phase(session),branding=session.renderer.visibleTiles.size>0&&session.transport.googleBranding;
  if(this.#snapshot.phase!==phase||this.#snapshot.requiresGoogleBranding!==branding)this.#dirty=true;
  if(this.#dirty)this.#publish();
 }
 #phase(session:Session|null):VisualPhase{if(this.#closed)return'disposed';if(!session)return'disconnected';const visible=session.renderer.visibleTiles.size>0;return session.failure?(visible?'partial':'failed'):visible?'visible':session.root?'loading':'connecting';}
 #refreshCredits(session:Session){
  const credits:VisualCredit[]=[];if(session.renderer.visibleTiles.size){credits.push(...session.transport.endpointCredits);
   for(const tile of session.renderer.visibleTiles){const copyright=(tile as unknown as {engineData:{metadata?:{asset?:{copyright?:unknown}}}}).engineData.metadata?.asset?.copyright;if(typeof copyright==='string'&&copyright.trim())credits.push({type:'string',value:copyright});}
   for(const credit of session.renderer.getAttributions())if(typeof credit.value==='string'&&credit.value.trim())credits.push({type:credit.type,value:credit.value});
  }
  const unique=[...new Map(credits.map(c=>[`${c.type}:${c.value}`,c])).values()],signature=JSON.stringify(unique);
  if(signature!==this.#creditSignature){this.#creditSignature=signature;this.#credits=freeze(unique);this.#creditVersion++;this.#dirty=true;}
 }
 #publish(){
  const session=this.#session,value:VisualSnapshot=freeze({phase:this.#phase(session),provider:session?.provider??null,rootLoaded:session?.root??false,visibleTiles:session?.renderer.visibleTiles.size??0,creditVersion:this.#creditVersion,requiresGoogleBranding:Boolean(session?.renderer.visibleTiles.size&&session.transport.googleBranding),error:session?.failure??null,countLimit:960,resources:session?.resourceInfo??null,stream:session?.streamInfo??null,collisionReady:false});
  const signature=JSON.stringify(value);this.#snapshot=value;this.#dirty=false;if(signature===this.#signature)return;this.#signature=signature;
  try{this.#onChange?.(value);}catch{/* UI notification failures must not alter renderer ownership. */}
 }
 #stop(){const session=this.#session;this.#session=null;if(session){session.abort.abort();session.renderer.dispose();session.resources.dispose();session.stream.dispose();session.transport.dispose();}if(this.#saved)this.#saved.credential='';this.#saved=null;if(this.#credits.length){this.#credits=Object.freeze([]);this.#creditSignature='[]';this.#creditVersion++;}}
 disconnect(){if(this.#closed)return;this.#stop();this.#dirty=true;this.#publish();}
 dispose(){if(this.#closed)return;this.#closed=true;this.#stop();this.#scene.onDisposeObservable.remove(this.#sceneObserver);this.#sceneObserver=null;this.#dirty=true;this.#publish();this.#onChange=undefined;}
}
