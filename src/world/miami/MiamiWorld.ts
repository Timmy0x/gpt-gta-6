import { Vector3, type Scene, type Texture } from '@babylonjs/core';
import polygonClipping from 'polygon-clipping';
import type { BuildContext, Obstacle, RoadNode, WorldContract, WorldLocation } from '../../core/contracts';
import { MovementQueries } from '../../gameplay/MovementQueries';
import { Ocean } from '../Ocean';
import { StreetObjects } from '../StreetObjectSystem';
import type { NetworkStreamingStats } from '../packages';
import { MiamiResidency } from './MiamiResidency';
import type { MiamiPackageManifest } from './MiamiPackages';
import { buildMiamiLaneGraph } from './MiamiRoads';
import { loadPublicCollisionQueries } from './frame/PublicCollisionQueries';
import { miamiPolygonGeometry, miamiRectangle } from './MiamiGeometry';
import { inMiamiBounds, insideMiamiPolygon } from './MiamiQueries';

import type { MiamiDataset } from './types';

/** Miami's source world is independent of the retired fictional grid and coast. */
export class MiamiWorld implements WorldContract {
  readonly spawn=new Vector3();
  private referenceWaterLevel=0;
  get waterLevel(){return this.referenceWaterLevel;}
  readonly restrictedFacility=false;
  readonly obstacles:Obstacle[]=[];
  readonly lightPositions:Vector3[]=[];
  readonly roads:RoadNode[]=[];
  readonly locations:WorldLocation[]=[];
  readonly pedestrianSpawns:Vector3[]=[];
  readonly streetObjects:StreetObjects;
  readonly ready:Promise<void>;
  ocean!:Ocean;
  mapData!:MiamiDataset;
  private residency!:MiamiResidency;
  private queries!:Awaited<ReturnType<typeof loadPublicCollisionQueries>>;
  private disposed=false;
  get worldId(){return this.mapData.id;}
  get bounds(){return this.mapData.bounds;}
  constructor(private ctx:BuildContext,options:{baseUrl?:string;fetch?:typeof fetch;loadTexture?:(url:string,scene:Scene)=>Texture}={}){
    this.streetObjects=new StreetObjects(ctx.scene,this.obstacles,this.lightPositions,ctx.shadows);
    const baseUrl=options.baseUrl??new URL('world/miami/',document.baseURI).href;
    this.ready=this.initialize(baseUrl,options.fetch??fetch,options.loadTexture);
  }
  private async initialize(baseUrl:string,fetcher:typeof fetch,loadTexture?: (url:string,scene:Scene)=>Texture){
    const request=async(path:string)=>{try{const response=await fetcher(new URL(path,baseUrl));if(!response.ok)throw new Error(`HTTP ${response.status}`);return response;}catch(cause){throw new Error(`Miami ${path} could not load: ${cause instanceof Error?cause.message:String(cause)}`,{cause});}};
    const read=async(path:string)=>{const response=await request(path);return response.json();};
    const [dataset,packages]:[MiamiDataset,MiamiPackageManifest]=await Promise.all([read('dataset.json'),read('packages.json')]);
    if(dataset.version!==1||packages.version!==1||dataset.id!==packages.worldId)throw new Error('Miami dataset/package identity mismatch');
    if(this.disposed)throw new Error('Miami world disposed');
    this.queries=await loadPublicCollisionQueries(baseUrl,fetcher);
    if(this.queries.worldId!==dataset.id)throw new Error('Miami public coordinate frame mismatch');
    this.mapData=dataset;
    this.referenceWaterLevel=this.queries.frame.navd88ToLocal(-80.1907,25.7662,0)[1];
    const bounds=dataset.bounds,box=miamiRectangle(bounds.minX,bounds.minZ,bounds.maxX,bounds.maxZ);
    const water=dataset.water.length?polygonClipping.intersection(polygonClipping.union(dataset.water.flatMap(w=>w.polygons)),box):[];
    this.ocean=new Ocean(this.ctx.scene,{waterLevel:this.waterLevel,bounds,shorelineX:bounds.minX,
      surfaceGeometry:miamiPolygonGeometry(water,0),containsPoint:(x,z)=>dataset.water.some(w=>w.polygons.some(p=>insideMiamiPolygon(x,z,p))),
      floorHeightAt:(x,z)=>this.floorHeightAt(x,z),shoreFoam:false});
    if(!water.length){this.ocean.mesh.setEnabled(false);this.ocean.material.enableRenderTargets(false);}
    this.residency=new MiamiResidency(this.ctx.scene,this.ctx.shadows,packages,baseUrl,()=>{throw new Error('Public collision records must be non-rendered');},fetcher);
    this.residency.onMeshLoaded=(mesh,kind)=>{if(kind!=='building')return;const b=mesh.getBoundingInfo().boundingBox;
      this.obstacles.push({x:(b.minimumWorld.x+b.maximumWorld.x)/2,z:(b.minimumWorld.z+b.maximumWorld.z)/2,w:b.maximumWorld.x-b.minimumWorld.x,d:b.maximumWorld.z-b.minimumWorld.z,height:b.maximumWorld.y-b.minimumWorld.y,mesh});};
    this.residency.onMeshDisposed=mesh=>{const i=this.obstacles.findIndex(o=>o.mesh===mesh);if(i>=0)this.obstacles.splice(i,1);};
    const supported=dataset.roads.filter(r=>!r.unavailableReason&&!r.bridge&&!r.tunnel&&r.layer===0);
    const dryCoverage={polygons:dataset.land.flatMap(l=>l.polygons),sourceIds:dataset.land.flatMap(l=>l.sourceIds),confidence:'mapped' as const,gaps:[]};
    const heightAt=(x:number,z:number)=>this.queries.floorHeightAt(x,z)??Number.NaN;
    this.roads.push(...buildMiamiLaneGraph(supported,{bounds,heightAt,dryCoverage,pruneDeadEnds:false}));
    const reference=Vector3.FromArray(this.queries.frame.navd88ToLocal(-80.1907224560056,25.7661748271726,2.5));
    this.spawn.copyFrom(reference);await this.residency.preparePosition(reference);
    const candidates:Vector3[]=[];
    for(const road of supported){
      if(road.sidewalkWidthM<1)continue;
      for(let i=1;i<road.centerline.length;i++){
        const a=road.centerline[i-1],b=road.centerline[i],dx=b[0]-a[0],dz=b[2]-a[2],length=Math.hypot(dx,dz);if(length<2)continue;
        for(const t of [.2,.4,.6,.8])for(const side of [-1,1]){
          const offset=road.widthM/2+road.sidewalkWidthM*.65;
          const x=a[0]+dx*t+side*dz/length*offset,z=a[2]+dz*t-side*dx/length*offset;
          const groundY=this.queries.floorHeightAt(x,z);if(groundY===null)continue;
          const p=new Vector3(x,groundY+1.5,z);
          if(inMiamiBounds(p,bounds,20)&&!dataset.buildings.some(b=>insideMiamiPolygon(p.x,p.z,b.footprint))&&!this.ocean.contains(p.x,p.z))candidates.push(p);
        }
      }
    }
    candidates.sort((a,b)=>Vector3.DistanceSquared(a,reference)-Vector3.DistanceSquared(b,reference));
    const queries=new MovementQueries(this.ctx.scene);
    try{
      for(const p of candidates){
        if(Vector3.Distance(p,reference)>170)continue;
        const ground=queries.ground(p,12,20);if(!ground||Math.abs(ground.y-p.y)>4)continue;
        const center=ground.add(new Vector3(0,.94,0));if(!queries.clear(center))continue;
        if(!this.pedestrianSpawns.length)this.spawn.copyFrom(center);
        if(this.pedestrianSpawns.every(other=>Vector3.Distance(other,ground)>6))this.pedestrianSpawns.push(ground);
        if(this.pedestrianSpawns.length>=30)break;
      }
      if(!this.pedestrianSpawns.length)throw new Error('No verified clear Brickell sidewalk spawn');
    }finally{queries.dispose();}
    this.locations.push({id:'brickell-se8',name:'Brickell Avenue · SE 8th Street',x:this.spawn.x,z:this.spawn.z,type:'landmark'});
    for(const name of [...new Set(supported.map(r=>r.name))]){
      const points=supported.filter(r=>r.name===name).flatMap(r=>r.centerline).map(p=>({x:p[0],z:p[2]})).filter(p=>inMiamiBounds(p,bounds,25)&&!this.ocean.contains(p.x,p.z));
      if(!points.length)continue;points.sort((a,b)=>Math.hypot(a.x-this.spawn.x,a.z-this.spawn.z)-Math.hypot(b.x-this.spawn.x,b.z-this.spawn.z));
      this.locations.push({id:`miami-street-${this.locations.length}`,name,...points[0],type:'street'});
    }
  }
  collisionReady(position:Vector3){return this.residency?.collisionReady(position)??false;}
  setSourceVisible(visible:boolean){this.residency?.setVisualVisibility(!visible);if(this.ocean)this.ocean.mesh.isVisible=!visible;}
  floorHeightAt(x:number,z:number){return this.queries?.floorHeightAt(x,z)??this.spawn.y-.94;}
  async preparePosition(position:Vector3){await this.ready;if(!inMiamiBounds(position,this.bounds)||!this.queries.hasSourceGround(position.x,position.z))throw new Error('Destination is outside the constructed area');await this.residency.preparePosition(position);}
  setActiveAnchors(anchors:Vector3[]){this.residency?.setActiveAnchors(anchors);this.streetObjects.setActiveAnchors(anchors);}
  ensureCollision(position:Vector3){this.residency?.ensureCollision(position);this.streetObjects.ensureCollision(position);}
  update(dt:number,position:Vector3,time:number,weather:string){if(!this.residency||this.disposed)return;this.residency.update(position);this.streetObjects.updateResidency(position);this.ocean.update(dt,position,weather,Math.max(0,Math.sin((time-6)/12*Math.PI)));}
  getStreamingStats():NetworkStreamingStats{return {...this.residency.getStats(),streetObjects:this.streetObjects.getStats()};}
  dispose(){this.disposed=true;this.residency?.dispose();this.ocean?.dispose();this.streetObjects.dispose();}
}
