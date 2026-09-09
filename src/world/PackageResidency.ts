import { LoadAssetContainerAsync, Material, Mesh, PBRMaterial, Vector3, type AssetContainer, type Scene, type ShadowGenerator } from '@babylonjs/core';
import '@babylonjs/core/Loading/Plugins/babylonFileLoader';
import { distanceToBounds } from './ChunkResidency';
import { PACKAGE_LIMITS, type ChunkPackage, type WorldManifest } from './packages';

type Fetcher = typeof fetch;
type PackageState = { asset:ChunkPackage; container?:AssetContainer; promise?:Promise<void>; attempts:number; retryAt:number; error:string; pinned:number; materials:string[]; };
type MaterialState = { refs:number; promise:Promise<Material>; material?:Material; };
export class PackageResidency {
  private readonly states = new Map<string,PackageState>();
  private readonly materialStates = new Map<string,MaterialState>();
  private position = Vector3.Zero();
  private anchors:Vector3[]=[];
  private disposed=false;
  private active=0;
  private readonly slots:(()=>void)[]=[];
  private loaded=0;private evicted=0;private meshLoads=0;private meshDisposals=0;
  private requests=0;private bytes=0;private retries=0;private lastError='';
  private readonly controllers=new Set<AbortController>();
  constructor(private readonly scene:Scene,private readonly shadows:ShadowGenerator,readonly manifest:WorldManifest,private readonly baseUrl:string,private readonly fetcher:Fetcher=fetch) {
    for(const asset of manifest.chunks)this.states.set(asset.id,{asset,attempts:0,retryAt:0,error:'',pinned:0,materials:[]});
  }
  setActiveAnchors(anchors:Vector3[]) {this.anchors=anchors.filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.z)).map(p=>p.clone());}
  private wanted(state:PackageState):boolean {
    if(state.pinned||state.asset.detail==='global')return true;
    const extra=state.container?PACKAGE_LIMITS.unloadHysteresis:0;
    const radius=state.asset.detail==='detail'?PACKAGE_LIMITS.detailLoad:PACKAGE_LIMITS.structureLoad;
    return distanceToBounds(this.position,state.asset.bounds)<=radius+extra || this.anchors.some(a=>distanceToBounds(a,state.asset.bounds)<=PACKAGE_LIMITS.anchorLoad+extra);
  }
  private async enterSlot(){if(this.active>=PACKAGE_LIMITS.concurrentLoads)await new Promise<void>(resolve=>this.slots.push(resolve));else this.active++;}
  private leaveSlot(){const next=this.slots.shift();if(next)next();else this.active--;}
  async readJson(url:string,sha256?:string):Promise<any>{
    const controller=new AbortController();this.controllers.add(controller);
    const timer=setTimeout(()=>controller.abort(),PACKAGE_LIMITS.requestTimeoutMs);
    try{
      this.requests++;
      // Native Window.fetch requires its global receiver; an injected fetch must not bind to this loader.
      const response=await this.fetcher.call(globalThis,new URL(url,this.baseUrl),{signal:controller.signal,cache:"no-cache"});
      if(!response.ok)throw new Error(`${url}: HTTP ${response.status}`);
      const raw=new Uint8Array(await response.arrayBuffer());this.bytes+=raw.byteLength;
      const compressed=raw[0]===0x1f&&raw[1]===0x8b;
      if(sha256&&compressed){const digest=await crypto.subtle.digest('SHA-256',raw);const hash=Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');if(hash!==sha256)throw new Error(`${url}: integrity mismatch`);}
      const data=compressed?await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('gzip'))).text():new TextDecoder().decode(raw);
      return JSON.parse(data);
    }finally{clearTimeout(timer);this.controllers.delete(controller);}
  }
  private acquireMaterial(id:string):Promise<Material>{
    let state=this.materialStates.get(id);
    if(state){state.refs++;return state.promise;}
    const asset=this.manifest.materials.find(m=>m.id===id);
    if(!asset)return Promise.reject(new Error(`Missing material ${id}`));
    const entry:MaterialState={refs:1,promise:Promise.resolve(null as unknown as Material)};
    entry.promise=this.readJson(asset.url).then(data=>{
      if(this.disposed)throw new Error('World disposed');
      const material=Material.Parse(data,this.scene,this.baseUrl);
      if(!material)throw new Error(`Could not parse material ${id}`);
      // Export-time defaults must not override the live scene's exposure, tone
      // mapping or postprocess path when a distant package becomes resident.
      if(material instanceof PBRMaterial)material.imageProcessingConfiguration=this.scene.imageProcessingConfiguration;
      entry.material=material;return material;
    }).catch(error=>{this.materialStates.delete(id);throw error;});
    this.materialStates.set(id,entry);return entry.promise;
  }
  private releaseMaterial(id:string){const state=this.materialStates.get(id);if(!state)return;if(--state.refs<=0){state.material?.dispose(false,true);this.materialStates.delete(id);}}
  private load(state:PackageState):Promise<void>{
    if(state.container)return Promise.resolve();
    if(state.promise)return state.promise;
    state.promise=(async()=>{
      await this.enterSlot();
      const acquired:string[]=[];
      let container:AssetContainer|undefined;
      try{
        if(this.disposed)throw new Error('World disposed');
        if(state.attempts)this.retries++;
        const results=await Promise.allSettled(state.asset.materials.map(async id=>{await this.acquireMaterial(id);acquired.push(id);}));
        const failure=results.find(r=>r.status==='rejected');if(failure?.status==='rejected')throw failure.reason;
        const data=await this.readJson(state.asset.url,state.asset.sha256);
        if(this.disposed)throw new Error('World disposed');
        container=await LoadAssetContainerAsync('data:'+JSON.stringify(data),this.scene,{pluginExtension:'.babylon',rootUrl:this.baseUrl});
        // Parsed Babylon objects own the only retained CPU vertex arrays. Serialized text is released here.
        if(this.disposed||!this.wanted(state)){container.dispose();for(const id of acquired)this.releaseMaterial(id);return;}
        for(const mesh of container.meshes)if(mesh instanceof Mesh){
          for(const kind of mesh.getVerticesDataKinds()){
            const data=mesh.getVerticesData(kind);if(data&&Array.isArray(data))mesh.setVerticesData(kind,new Float32Array(data),false,mesh.getVertexBuffer(kind)!.getStrideSize());
          }
          const indices=mesh.getIndices();if(indices&&Array.isArray(indices))mesh.setIndices(mesh.getTotalVertices()>65535?new Uint32Array(indices):new Uint16Array(indices));
        }
        container.addAllToScene();
        for(const mesh of container.meshes){mesh.isPickable=false;mesh.receiveShadows=true;if(mesh.metadata?.worldCasts)this.shadows.addShadowCaster(mesh,false);if(mesh.name!=='Atlantic Ocean'&&!mesh.name.startsWith('shore-break'))mesh.freezeWorldMatrix();}
        state.container=container;state.materials=acquired;state.attempts=0;state.retryAt=0;state.error='';this.loaded++;this.meshLoads+=state.asset.meshes;
      }catch(error){
        container?.dispose();for(const id of acquired)this.releaseMaterial(id);
        state.attempts++;state.error=error instanceof Error?error.message:String(error);this.lastError=state.error;
        state.retryAt=Date.now()+Math.min(PACKAGE_LIMITS.maxRetryMs,PACKAGE_LIMITS.retryBaseMs*2**Math.min(6,state.attempts-1));
        throw error;
      }finally{this.leaveSlot();state.promise=undefined;}
    })();
    return state.promise;
  }
  private release(state:PackageState){
    if(!state.container)return;
    for(const mesh of state.container.meshes)if(mesh.metadata?.worldCasts)this.shadows.removeShadowCaster(mesh,false);
    state.container.dispose();state.container=undefined;
    for(const id of state.materials)this.releaseMaterial(id);state.materials=[];
    this.evicted++;this.meshDisposals+=state.asset.meshes;
  }
  async preparePosition(position:Vector3):Promise<void>{
    this.position.copyFrom(position);
    const required=[...this.states.values()].filter(s=>s.asset.detail==='global'||distanceToBounds(position,s.asset.bounds)<=PACKAGE_LIMITS.immediateRadius);
    required.forEach(s=>s.pinned++);
    try{
      await Promise.all(required.map(async state=>{
        for(let attempt=0;attempt<3;attempt++){
          try{await this.load(state);return;}catch(error){if(this.disposed||attempt===2)throw error;await new Promise(r=>setTimeout(r,Math.max(0,state.retryAt-Date.now())));}
        }
      }));
    }finally{required.forEach(s=>s.pinned--);}
  }
  update(position:Vector3){
    if(this.disposed)return;this.position.copyFrom(position);
    let unloads=0;
    for(const state of this.states.values())if(state.container&&!this.wanted(state)&&unloads++<PACKAGE_LIMITS.unloadsPerUpdate)this.release(state);
    const pending=[...this.states.values()].filter(s=>!s.container&&!s.promise&&this.wanted(s)&&s.retryAt<=Date.now()).sort((a,b)=>distanceToBounds(position,a.asset.bounds)-distanceToBounds(position,b.asset.bounds));
    for(const state of pending.slice(0,Math.max(0,PACKAGE_LIMITS.concurrentLoads-this.active-this.slots.length)))void this.load(state).catch(()=>{});
  }
  getMaterial(id:string){return this.materialStates.get(id)?.material;}
  getMesh(id:string){for(const state of this.states.values()){const mesh=state.container?.meshes.find(m=>m.id===id);if(mesh)return mesh;}return undefined;}
  getStats(){
    const states=[...this.states.values()],resident=states.filter(s=>s.container),pending=states.filter(s=>!s.container&&(s.promise||this.wanted(s)));
    return {totalChunks:new Set(states.filter(s=>s.asset.detail!=='global').map(s=>s.asset.id.replace(/_(structure|detail)$/,''))).size,residentChunks:new Set(resident.filter(s=>s.asset.detail!=='global').map(s=>s.asset.id.replace(/_(structure|detail)$/,''))).size,totalMeshes:this.manifest.totals.meshes,residentMeshes:resident.reduce((n,s)=>n+s.asset.meshes,0),cpuGeometryBytes:resident.reduce((n,s)=>n+s.asset.cpuBytes,0),meshLoads:this.meshLoads,meshDisposals:this.meshDisposals,pendingMeshes:pending.reduce((n,s)=>n+s.asset.meshes,0),lastMeshOperations:0,loadedPackages:resident.length,totalPackages:states.length,pendingPackages:pending.length,failedPackages:states.filter(s=>s.error).length,retries:this.retries,requests:this.requests,fetchedBytes:this.bytes,residentMaterials:this.materialStates.size,totalCpuGeometryBytes:this.manifest.totals.cpuGeometryBytes,lastError:this.lastError,packagesLoaded:this.loaded,packagesEvicted:this.evicted};
  }
  dispose(){this.disposed=true;for(const controller of this.controllers)controller.abort();for(const state of this.states.values())this.release(state);}
}
