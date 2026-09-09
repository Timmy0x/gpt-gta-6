import { DirectionalLight, Material, Mesh, NullEngine, Scene, SceneSerializer, ShadowGenerator, Vector3 } from '@babylonjs/core';
import { WorldBuilder, type AuthoringSink } from '../../src/world/authoring/WorldBuilder';
import type { ColliderRecord, StreamingStats, WorldDetail } from '../../src/world/ChunkResidency';
import type { WorldManifest, ChunkPackage } from '../../src/world/packages';

declare global { interface Window { writeWorldAsset: (name:string,text:string,kind:'json'|'png')=>Promise<{bytes:number;sha256:string}>; } }
export async function exportWorld() {
  const engine = new NullEngine();
  engine.getCaps().maxTextureSize=4096; // Preserve1024px authoring canvases; NullEngine defaults to512.
  // A real DOM canvas preserves original generated signage and normal-map pixels; no GPU context.
  engine.createCanvas = (w,h) => {const c=document.createElement('canvas');c.width=w;c.height=h;return c;};
  const scene = new Scene(engine);
  scene.defaultMaterial = new Material('export/no-shader',scene);
  const shadows = new ShadowGenerator(16,new DirectionalLight('export/sun',Vector3.Down(),scene));
  const meshes:{mesh:Mesh;detail:WorldDetail;casts:boolean}[]=[],colliders:ColliderRecord[]=[];
  const sink:AuthoringSink = {
    registerMesh(mesh,detail,casts=false){mesh.id=mesh.name;mesh.metadata={...mesh.metadata,worldCasts:casts,worldDetail:detail};meshes.push({mesh,detail,casts});return mesh.id;},
    registerCollider(record){colliders.push(record);}, update(){},ensureCollision(){},setActiveAnchors(){},dispose(){},
    getStats(){return {} as StreamingStats;},
  };
  const world = new WorldBuilder({scene,shadows},sink);
  const seen = new Set(meshes.map(r=>r.mesh));
  for (const mesh of scene.meshes) if(mesh instanceof Mesh && mesh.isEnabled()&&!seen.has(mesh)) sink.registerMesh(mesh,'global',false);
  const usedMaterials = [...new Set(meshes.map(r=>r.mesh.material).filter(Boolean))] as Material[];
  usedMaterials.forEach((m,index)=>m.id=`material-${index.toString().padStart(3,'0')}`);
  const manifest:WorldManifest={version:1,build:'authored-860409-v3',seed:860409,format:'babylon-json+gzip',chunks:[],materials:[],colliders,...world.getAuthoringMetadata(),totals:{meshes:meshes.length,cpuGeometryBytes:0,compressedBytes:0,textureBytes:0}};
  const textures=new Map<string,string>();
  async function externalize(value:any):Promise<void>{
    if(!value||typeof value!=='object')return;
    if(typeof value.base64String==='string'){
      const base64=value.base64String;
      let url=textures.get(base64);
      if(!url){url=`textures/texture-${textures.size.toString().padStart(3,'0')}.png`;textures.set(base64,url);const result=await window.writeWorldAsset(url,base64,'png');manifest.totals.textureBytes+=result.bytes;}
      value.name=url;delete value.base64String;delete value.internalTextureUniqueId;
    }
    delete value.uniqueId;
    for(const child of Object.values(value))if(typeof child==='object')await externalize(child);
  }
  for(const material of usedMaterials){
    const data=material.serialize();
    for(const texture of material.getActiveTextures())if(texture.name.startsWith("sign/")&&texture.getSize().width!==1024)throw new Error(`Sign canvas was clamped: ${texture.name}`);
    await externalize(data);
    const url=`materials/${material.id}.json.gz`;const result=await window.writeWorldAsset(url,JSON.stringify(data),'json');
    manifest.materials.push({id:material.id,name:material.name,url,bytes:result.bytes});
    manifest.totals.compressedBytes+=result.bytes;
  }
  for(const material of usedMaterials)material.doNotSerialize=true;
  const groups=new Map<string,typeof meshes>();
  for(const record of meshes){
    const mesh=record.mesh;mesh.computeWorldMatrix(true);const b=mesh.getBoundingInfo().boundingBox;
    const x=(b.minimumWorld.x+b.maximumWorld.x)/2,z=(b.minimumWorld.z+b.maximumWorld.z)/2;
    const id=record.detail==='global'?'global':`${Math.floor((x+72)/144)}_${Math.floor((z+72)/144)}_${record.detail}`;
    const group=groups.get(id)||[];group.push(record);groups.set(id,group);
  }
  for(const [id,records] of groups){
    let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity,cpuBytes=0,vertices=0;
    for(const {mesh} of records){
      if(mesh.geometry)mesh.geometry.id=`${mesh.id}/geometry`;
      const b=mesh.getBoundingInfo().boundingBox;minX=Math.min(minX,b.minimumWorld.x);maxX=Math.max(maxX,b.maximumWorld.x);minZ=Math.min(minZ,b.minimumWorld.z);maxZ=Math.max(maxZ,b.maximumWorld.z);
      const count=mesh.getTotalVertices();vertices+=count;cpuBytes+=count*32+mesh.getTotalIndices()*(count>65535?4:2);
    }
    const data=SceneSerializer.SerializeMesh(records.map(r=>r.mesh),false,false);
    for(const geometry of data.geometries.vertexData){
      const count=geometry.positions.length/3;
      if(!Number.isInteger(count)||geometry.positions.some((n:number)=>!Number.isFinite(n))||geometry.indices.some((i:number)=>!Number.isInteger(i)||i<0||i>=count))
        throw new Error(`Invalid exported topology: ${geometry.id}`);
    }
    delete data.materials;delete data.multiMaterials;
    const materialByMesh=new Map(records.map(r=>[r.mesh.id,r.mesh.material!.id]));
    for(const mesh of data.meshes){mesh.materialId=materialByMesh.get(mesh.id);delete mesh.materialUniqueId;delete mesh.uniqueId;}
    const url=`chunks/${id}.babylon.gz`;const result=await window.writeWorldAsset(url,JSON.stringify(data),'json');
    const descriptor:ChunkPackage={id,url,bounds:{minX,maxX,minZ,maxZ},detail:records[0].detail,meshes:records.length,vertices,cpuBytes,compressedBytes:result.bytes,materials:[...new Set(records.map(r=>r.mesh.material!.id))],sha256:result.sha256};
    manifest.chunks.push(descriptor);manifest.totals.cpuGeometryBytes+=cpuBytes;manifest.totals.compressedBytes+=result.bytes;
  }
  await window.writeWorldAsset('manifest.json',JSON.stringify(manifest,null,2),'json');
  world.dispose();shadows.dispose();scene.dispose();engine.dispose();
  return {packages:manifest.chunks.length,materials:manifest.materials.length,textures:textures.size,...manifest.totals};
}
