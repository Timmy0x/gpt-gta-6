import { Color3, PBRMaterial, Vector3 } from '@babylonjs/core';
import type { BuildContext, Obstacle, RoadNode, WorldContract, WorldLocation } from '../core/contracts';
import { Ocean } from './Ocean';
import { StreetObjects } from './StreetObjectSystem';
import { COAST, coastFloorHeight } from './Coast';
import { CENTRAL_LOCATIONS, createLaneGraph } from './layout';
import { connectInnerCityRoads, INNER_CITY_LOCATIONS } from './authoring/expansion/innerCityLayout';
import { ChunkResidency } from './ChunkResidency';
import { PackageResidency } from './PackageResidency';
import type { NetworkStreamingStats, WorldManifest } from './packages';

export interface WorldOptions { baseUrl?:string; fetch?:typeof fetch; }
/** Pre-exported Babylon packages: no procedural district generation in the runtime bundle. */
export class World implements WorldContract {
  readonly spawn = new Vector3(3.3,1.2,-28);
  readonly waterLevel = COAST.waterLevel;
  readonly ocean: Ocean;
  readonly streetObjects: StreetObjects;
  readonly roads:RoadNode[]=connectInnerCityRoads(createLaneGraph());
  readonly locations:WorldLocation[]=[...CENTRAL_LOCATIONS,...INNER_CITY_LOCATIONS].map(l=>({...l}));
  readonly obstacles:Obstacle[]=[];
  readonly lightPositions:Vector3[]=[];
  readonly ready:Promise<void>;
  private readonly collision:ChunkResidency;
  private packages?:PackageResidency;
  private manifest?:WorldManifest;
  private anchors:Vector3[]=[];
  private initialized=false;
  private disposed=false;
  private error='';
  private readonly abort=new AbortController();
  constructor(private readonly ctx:BuildContext,options:WorldOptions={}) {
    this.ocean = new Ocean(ctx.scene, { waterLevel: this.waterLevel, shorelineX: COAST.shorelineX, floorHeightAt: coastFloorHeight });
    this.collision=new ChunkResidency(ctx.scene,ctx.shadows,this.spawn);
    this.streetObjects=new StreetObjects(ctx.scene,this.obstacles,this.lightPositions,ctx.shadows);
    const baseUrl=options.baseUrl||new URL('world/',document.baseURI).href;
    this.ready=this.initialize(baseUrl,options.fetch||fetch);
  }
  private async initialize(baseUrl:string,fetcher:typeof fetch):Promise<void>{
    try{
      let manifest:WorldManifest|undefined;
      for(let attempt=0;attempt<3;attempt++){
        try{
          const response=await fetcher(new URL('manifest.json',baseUrl),{signal:AbortSignal.any([this.abort.signal,AbortSignal.timeout(12000)]),cache:"no-cache"});
          if(!response.ok)throw new Error(`World manifest HTTP ${response.status}`);
          manifest=await response.json() as WorldManifest;break;
        }catch(error){if(attempt===2||this.disposed)throw error;await new Promise(r=>setTimeout(r,400*2**attempt));}
      }
      if(!manifest||manifest.version!==1||manifest.format!=='babylon-json+gzip')throw new Error('Unsupported world manifest');
      if(this.disposed)throw new Error('World disposed');
      this.manifest=manifest;
      for(const collider of manifest.colliders){
        if(collider.obstacle)this.obstacles.push(collider.obstacle);
        this.collision.registerCollider(collider);
      }
      this.lightPositions.push(...manifest.lights.map(p=>Vector3.FromArray(p)));
      this.streetObjects.register(manifest.streetObjects ?? []);
      this.streetObjects.ensureCollision(this.spawn);
      this.collision.setActiveAnchors(this.anchors);
      this.packages=new PackageResidency(this.ctx.scene,this.ctx.shadows,manifest,baseUrl,fetcher);
      this.packages.onMeshesLoaded=meshes=>this.streetObjects.mount(meshes);
      this.packages.onMeshesUnloading=meshes=>this.streetObjects.unmount(meshes);
      this.packages.setActiveAnchors(this.anchors);
      await this.packages.preparePosition(this.spawn);
      this.initialized=true;
    }catch(error){this.error=error instanceof Error?error.message:String(error);throw error;}
  }
  /** Prepare scenery before committing fast travel. Collision becomes available synchronously first. */
  async preparePosition(position:Vector3):Promise<void>{
    await this.ready;
    if(!Number.isFinite(position.x)||!Number.isFinite(position.z))throw new Error('Invalid destination');
    this.ensureCollision(position);
    await this.packages!.preparePosition(position);
    // Render updates continue at the old position while packages load and may
    // evict distant bodies. Restore destination collision before the caller's
    // synchronous support/clearance query and teleport.
    this.ensureCollision(position);
  }
  setActiveAnchors(anchors:Vector3[]):void {
    this.anchors=anchors.filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.z)).map(p=>p.clone());
    this.collision.setActiveAnchors(this.anchors);this.packages?.setActiveAnchors(this.anchors);
    this.streetObjects.setActiveAnchors(this.anchors);
  }
  ensureCollision(position:Vector3):void {this.collision.ensureCollision(position);this.streetObjects.ensureCollision(position);}
  update(dt:number,position:Vector3,time:number,weather:string):void {
    if(!this.initialized||this.disposed)return;
    this.collision.update(position,0);this.packages!.update(position);
    this.streetObjects.updateResidency(position);
    const manifest=this.manifest!,rain=['rain','storm'].includes(weather.toLowerCase());
    const asphalt=this.packages!.getMaterial(manifest.asphaltMaterial) as PBRMaterial|undefined;
    if(asphalt)asphalt.roughness=rain?.29:.94;
    const hour=((time%24)+24)%24,night=Math.max(0,Math.min(1,(Math.abs(hour-12)-5)/2.5));
    this.ocean.update(dt, position, weather, Math.max(0, Math.sin((hour - 6) / 12 * Math.PI)));
    for(const item of manifest.litMaterials){const material=this.packages!.getMaterial(item.id) as PBRMaterial|undefined;if(material)material.emissiveColor=Color3.FromArray(item.color).scale((.06+night*.94)*item.intensity);}
  }
  getStreamingStats():NetworkStreamingStats {
    const base=this.collision.getStats(),network=this.packages?.getStats(),streetObjects=this.streetObjects.getStats();
    const extraBytes=streetObjects.indexBackupBytes+streetObjects.extractedGeometryBytes;
    return {...base,loadedPackages:0,totalPackages:0,pendingPackages:0,failedPackages:0,retries:0,requests:0,fetchedBytes:0,residentMaterials:0,lastError:this.error,packagesLoaded:0,packagesEvicted:0,...network,ready:this.initialized,
      totalColliders:base.totalColliders+streetObjects.objects,residentColliders:base.residentColliders+streetObjects.residentBodies,
      colliderLoads:base.colliderLoads+streetObjects.colliderLoads,colliderDisposals:base.colliderDisposals+streetObjects.colliderDisposals,
      totalMeshes:(network?.totalMeshes??base.totalMeshes)+streetObjects.extractedMeshes,residentMeshes:(network?.residentMeshes??base.residentMeshes)+streetObjects.extractedMeshes,
      cpuGeometryBytes:(network?.cpuGeometryBytes??base.cpuGeometryBytes)+extraBytes,totalCpuGeometryBytes:(network?.totalCpuGeometryBytes??0)+extraBytes,streetObjects};
  }
  dispose():void {this.disposed=true;this.abort.abort();this.ocean.dispose();this.packages?.dispose();this.streetObjects.dispose();this.collision.dispose();}
}
