import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector2, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { GeospatialCamera } from '@babylonjs/core/Cameras/geospatialCamera';
import { GeospatialClippingBehavior } from '@babylonjs/core/Behaviors/Cameras/geospatialClippingBehavior';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { TilesRenderer } from '3d-tiles-renderer/babylonjs';
import { CesiumIonAuthPlugin, GoogleCloudAuthPlugin } from '3d-tiles-renderer/core/plugins';
import { ecef, rootUrl, safeError, validateConfiguration, type Configuration } from './access';
import { renderCredits, type Credit } from './credits';
import { redactDiagnosticArgs } from './diagnostics';
import { RequestDiagnostics, endpointCredits, isIonEndpoint } from './request-diagnostics';
import { StructuralProfile, structuralProfilePlugin } from './structural-profile';
import './style.css';
const get = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas=get<HTMLCanvasElement>('canvas'), source=get<HTMLSelectElement>('source'), credential=get<HTMLInputElement>('credential');
const state=get('state'), metrics=get('metrics'), errorBox=get('error'), retry=get<HTMLButtonElement>('retry'), credits=get('credits');
const engine=new Engine(canvas,true,{useLargeWorldRendering:true}); engine.setHardwareScalingLevel(1/Math.min(devicePixelRatio,1.5));
const scene=new Scene(engine);scene.useRightHandedSystem=true;scene.clearColor=new Color4(.13,.20,.24,1);
const camera=new GeospatialCamera('geographic',scene,{planetRadius:6378137});camera.attachControl(true);camera.addBehavior(new GeospatialClippingBehavior());
camera.limits.radiusMin=35;camera.limits.radiusMax=200000;camera.limits.pitchDisabledRadiusScale=new Vector2(.5,1.5);
new HemisphericLight('fixture-light',new Vector3(...ecef(25.7662,-80.1907)).normalize(),scene).intensity=1.2;
function focus(radius=1500){camera.center=new Vector3(...ecef(25.7662,-80.1907,0));camera.radius=radius;camera.pitch=1.1;camera.yaw=-.25;}
focus();
interface Session {config:Configuration;tiles:TilesRenderer;loaded:number;root:boolean;generation:number;failure:boolean;diagnostics:RequestDiagnostics;endpointCredits:Credit[];profile:StructuralProfile;profileFrames:number;}
let current:Session|null=null, generation=0, saved:Configuration|null=null, creditSignature='';
const originalError=console.error.bind(console), originalWarn=console.warn.bind(console);
console.error=(...args:unknown[])=>originalError(...redactDiagnosticArgs(args,current?.config.credential??''));
console.warn=(...args:unknown[])=>originalWarn(...redactDiagnosticArgs(args,current?.config.credential??''));
function showError(message:string){errorBox.textContent=message;errorBox.hidden=false;state.textContent='Connection incomplete';retry.hidden=!saved;}
function disconnect(clear=true){generation++;const old=current;current=null;old?.tiles.dispose();if(clear&&saved){saved.credential='';saved=null;}credential.value='';metrics.dataset.visible='0';metrics.dataset.root='false';metrics.textContent='0 visible · 0 loaded';state.textContent='Disconnected';errorBox.hidden=true;retry.hidden=true;credits.replaceChildren();get('provider-credit').hidden=true;get('fixture-badge').hidden=true;creditSignature='';get('structural-profile').textContent='No connection · no structural observations';}
// Preserve HTTP root/node failures before auth plugins parse responses; never retain URLs with credentials.
const originalFetch=window.fetch.bind(window);
window.fetch=async(input,init)=>{
 const observed=current;
 const url=input instanceof Request?input.url:String(input);
 try {
  const response=await originalFetch(input,init);
  if(observed===current&&observed){
   observed.diagnostics.response(url,response.status,observed.root);
   if(response.ok&&observed.config.provider==='ion'&&isIonEndpoint(url)){
    // Read a clone; the official auth plugin still receives the untouched response.
    try{const all=endpointCredits(await response.clone().json());if(observed===current)observed.endpointCredits=all;}catch{/* The official parser reports invalid endpoint JSON. */}
   }
  }
  return response;
 }catch(error){
  if(observed===current&&observed)observed.diagnostics.rejected(url,error,observed.config.credential);
  throw error;
 }
};
function fixtureCredits(tiles:TilesRenderer){return {name:'SYNTHETIC_FIXTURE_CREDITS',getAttributions(target:Credit[]){const values=new Set<string>();for(const tile of tiles.visibleTiles){const value=(tile as unknown as {engineData:{metadata?:{asset?:{copyright?:string}}}}).engineData.metadata?.asset?.copyright;if(value)values.add(value);}for(const value of [...values].sort())target.push({type:'string',value});}};}
function connect(config:Configuration){disconnect();saved={...config};const tiles=new TilesRenderer(rootUrl(config),scene);const session:Session={config:saved,tiles,loaded:0,root:false,generation:++generation,failure:false,diagnostics:new RequestDiagnostics(),endpointCredits:[],profile:new StructuralProfile(),profileFrames:0};current=session;
 tiles.registerPlugin(structuralProfilePlugin(session.profile));
 tiles.fetchOptions={credentials:'omit',referrerPolicy:'strict-origin-when-cross-origin',cache:'no-store'};
 if(config.provider==='google')tiles.registerPlugin(new GoogleCloudAuthPlugin({apiToken:config.credential,autoRefreshToken:true,useRecommendedSettings:true}));
 else if(config.provider==='ion')tiles.registerPlugin(new CesiumIonAuthPlugin({apiToken:config.credential,assetId:config.assetId,autoRefreshToken:true,assetTypeHandler(type){throw new Error(`Cesium asset type ${type} is not supported by this 3D Tiles preview.`);}}));
 else tiles.registerPlugin(fixtureCredits(tiles));
 // Babylon0.5.2 reports1 byte per tile; count/concurrency limits are the meaningful bounds.
 tiles.lruCache.maxSize=240;tiles.lruCache.minSize=160;tiles.lruCache.maxBytesSize=128*1024*1024;tiles.lruCache.minBytesSize=96*1024*1024;
 tiles.downloadQueue.maxJobsPerOrigin=4;tiles.parseQueue.maxJobs=2;tiles.errorTarget=20;tiles.checkCollisions=false;tiles.loadSiblings=false;
 tiles.addEventListener('load-root-tileset',()=>{if(current!==session)return;session.root=true;metrics.dataset.root='true';if(!session.failure)state.textContent='Root loaded · waiting for tiles';});
 tiles.addEventListener('load-tileset',event=>{if(current===session)session.profile.observeTileset(event.tileset);});
 tiles.addEventListener('load-model',event=>{if(current===session){session.loaded++;session.profile.observeLoaded(event.tile,(event.tile as unknown as {engineData:{metadata:unknown}}).engineData.metadata);}});
 tiles.addEventListener('load-error',event=>{if(current!==session)return;session.failure=true;showError(session.diagnostics.messageFor(event.url)??`${event.tile?'Tile':'Root/auth'} load failed: ${safeError(event.error,session.config.credential)}`);});
 get('fixture-badge').hidden=config.provider!=='fixture';get('source-note').textContent=config.provider==='fixture'?'Synthetic renderer fixture. No Miami data loaded.':'Live API preview. Waiting for your provider’s tile responses.';
 state.textContent='Connecting…';credential.value='';focus(config.provider==='fixture'?420:1500);
}
get<HTMLFormElement>('connect-form').addEventListener('submit',event=>{event.preventDefault();try{connect(validateConfiguration(source.value,credential.value,get<HTMLInputElement>('asset-id').value,get<HTMLSelectElement>('fixture-case').value));}catch(error){showError(safeError(error));}});
get('stop').addEventListener('click',()=>disconnect());retry.addEventListener('click',()=>{if(saved)connect({...saved});});
source.addEventListener('change',()=>{disconnect();get<HTMLAnchorElement>('access-help').href=source.value==='google'?'https://developers.google.com/maps/documentation/tile/get-api-key':'https://cesium.com/learn/cesiumjs-learn/cesiumjs-photorealistic-3d-tiles/';get('auth').hidden=source.value==='fixture';get('ion-options').hidden=source.value!=='ion';get('credential-label').textContent=source.value==='google'?'Google Map Tiles API key':'Cesium ion access token';get('source-note').textContent=source.value==='fixture'?'Synthetic renderer fixture. No Miami data loaded.':'Enter your own credential locally, then connect.';});
get('brickell').addEventListener('click',()=>focus((current?.config.provider??source.value)==='fixture'?420:700));get('overview').addEventListener('click',()=>focus(1500));
scene.onBeforeRenderObservable.add(()=>{const session=current;if(!session)return;try{session.tiles.update();if(++session.profileFrames%30===0)get('structural-profile').textContent=JSON.stringify(session.profile.snapshot(),null,2);const visible=session.tiles.visibleTiles.size;metrics.dataset.visible=String(visible);metrics.textContent=`${visible} visible · ${session.loaded} loaded`;if(visible&&!session.failure){state.textContent=session.config.provider==='fixture'?'Fixture tile coverage available':'API tile coverage available';get('source-note').textContent=session.config.provider==='fixture'?'Synthetic renderer fixture. No Miami data loaded.':'Live streamed data from your selected provider.';}const all=[...session.tiles.getAttributions(),...(visible?session.endpointCredits:[])];const signature=JSON.stringify(all);if(signature!==creditSignature){renderCredits(credits,all);creditSignature=signature;}get('provider-credit').hidden=!(visible&&(session.config.provider==='google'||Boolean(session.tiles.getPluginByName('GOOGLE_CLOUD_AUTH_PLUGIN'))));}catch(error){session.failure=true;showError(safeError(error,session.config.credential));}});
engine.runRenderLoop(()=>scene.render());window.addEventListener('resize',()=>engine.resize());window.addEventListener('pagehide',()=>{disconnect();engine.dispose();});
// No remote requests or fixture geometry until the user explicitly connects.
state.textContent='Waiting for access token';
