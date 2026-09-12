/** Scoped compatibility wrappers for the pinned auth plugins. Values stay in memory; callers own visible branding. */
export interface Attribution {type:string;value:unknown;}
type Options=RequestInit|undefined;
interface RefreshAuth {autoRefreshToken?:boolean;authURL?:string;sessionToken?:string|null;isMapTilesSession?:boolean;refreshToken?:(options?:RequestInit)=>Promise<unknown>;_tokenRefreshPromise?:Promise<unknown>|null;}
interface Plugin {name?:string;fetchData?:(url:string,options:RequestInit)=>unknown;loadRootTileset?:()=>Promise<unknown>;auth?:RefreshAuth;}
const abortError=()=>new DOMException('Renderer request cancelled','AbortError');
export function scopePlugin(pluginObject:object,lifetime:AbortSignal){
 const plugin=pluginObject as Plugin,originalFetch=plugin.fetchData,originalRoot=plugin.loadRootTileset,auth=plugin.auth,originalRefresh=auth?.refreshToken;
 const state:{credits:Attribution[];restore:()=>void}={credits:[],restore:()=>{}};
 function options(value:Options):RequestInit {if(lifetime.aborted)throw abortError();return {...value,signal:value?.signal?AbortSignal.any([value.signal,lifetime]):lifetime};}
 if(originalFetch)plugin.fetchData=function(url,init){
  const scoped=options(init);
  // Pinned GoogleCloudAuth.fetch parses its first root without checking response.ok.
  // Its official refresh path performs the same session extraction and checks HTTP status.
  if(plugin.name==='GOOGLE_CLOUD_AUTH_PLUGIN'&&auth&&!auth.isMapTilesSession&&auth.sessionToken===null&&auth.authURL){
   const request=new URL(url),root=new URL(auth.authURL);
   if(request.origin===root.origin&&request.pathname===root.pathname)return auth.refreshToken!(scoped).catch((error:unknown)=>{
    // The pinned refresh method validates HTTP but does not itself auto-refresh.
    // Restore one initial 401 refresh, without retrying forbidden/server failures.
    if(auth.autoRefreshToken&&error instanceof Error&&error.message==='GoogleCloudAuth: Failed to load data with error code 401'){
     return auth.refreshToken!(options(init));
    }
    throw error;
   });
  }
  return originalFetch.call(plugin,url,scoped);
 };
 if(originalRoot)plugin.loadRootTileset=function(){if(lifetime.aborted)return Promise.reject(abortError());return originalRoot.call(plugin);};
 if(auth&&originalRefresh)auth.refreshToken=function(init){
  const pending=originalRefresh.call(auth,options(init));
  return pending.then(json=>{
   if(lifetime.aborted)throw abortError();
   const attributions=(json as {attributions?:unknown}|null)?.attributions;
   if(Array.isArray(attributions))state.credits=attributions.flatMap(value=>typeof value?.html==='string'?[{type:'html',value:value.html}]:[]);
   return json;
  }).finally(()=>{if(auth._tokenRefreshPromise===pending)auth._tokenRefreshPromise=null;});
 };
 state.restore=()=>{if(originalFetch)plugin.fetchData=originalFetch;if(originalRoot)plugin.loadRootTileset=originalRoot;if(auth&&originalRefresh)auth.refreshToken=originalRefresh;state.credits=[];};
 return state;
}
