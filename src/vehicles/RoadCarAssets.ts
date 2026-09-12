import { AssetContainer, LoadAssetContainerAsync, Matrix, Mesh, PBRMaterial, TransformNode, Vector3, VertexData } from '@babylonjs/core';
import type { BuildContext } from '../core/contracts';
import type { VehicleModel } from './models';
import { LatticeDeformation } from './LatticeDeformation';
import { ROAD_CARS, type RoadCarKind } from './RoadCarCatalog';

type Part = { mesh: Mesh; group: string; role: string; origin: Vector3 };
type Cached = { container: AssetContainer; parts: Part[]; origins: Map<string,Vector3> };
const WHEELS = ['Wheel_Front_Left','Wheel_Front_Right','Wheel_Rear_Left','Wheel_Rear_Right'];

function sharedMaterial(source: PBRMaterial, name: string): PBRMaterial {
  const copy = source.clone(name)!;
  const allocated = new Set(copy.getActiveTextures());
  for (const key of ['albedoTexture','ambientTexture','opacityTexture','reflectionTexture','emissiveTexture','reflectivityTexture','metallicTexture','microSurfaceTexture','bumpTexture','lightmapTexture','metallicReflectanceTexture','reflectanceTexture','environmentBRDFTexture'] as const) copy[key] = source[key];
  copy.clearCoat.texture = source.clearCoat.texture;
  copy.clearCoat.textureRoughness = source.clearCoat.textureRoughness;
  copy.clearCoat.bumpTexture = source.clearCoat.bumpTexture;
  const shared = new Set(source.getActiveTextures());
  for (const texture of allocated) if (!shared.has(texture)) texture.dispose();
  return copy;
}

/** Licensed cars share immutable geometry and textures; damage owns each instance's state. */
export class RoadCarAssets {
  private readonly cache = new Map<RoadCarKind,Cached>();
  private readonly pending = new Map<RoadCarKind,Promise<void>>();
  private disposed = false;
  constructor(private ctx: BuildContext, private sources?: Partial<Record<RoadCarKind,Uint8Array>>, private skipMaterials=false) {}
  ready(kind: RoadCarKind) { return this.cache.has(kind); }
  async prepare(kind: RoadCarKind): Promise<void> {
    if (this.disposed) throw new Error('Road car cache disposed');
    if (this.cache.has(kind)) return;
    const pending = this.pending.get(kind); if (pending) return pending;
    const promise = this.load(kind).finally(() => this.pending.delete(kind));
    this.pending.set(kind,promise); return promise;
  }
  private async load(kind: RoadCarKind): Promise<void> {
    const definition = ROAD_CARS[kind];
    let data = this.sources?.[kind];
    if (!data) {
      const response = await fetch(`/vehicles/carla/${definition.file}`,{signal:AbortSignal.timeout(30000)});
      if (!response.ok) throw new Error(`Car download failed: ${response.status}`);
      data = new Uint8Array(await response.arrayBuffer());
    }
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',Uint8Array.from(data))),v=>v.toString(16).padStart(2,'0')).join('');
    if (hash!==definition.hash) throw new Error(`Car integrity check failed: ${kind}`);
    await import('@babylonjs/loaders/glTF/index.js');
    const container = await LoadAssetContainerAsync(data,this.ctx.scene,{pluginExtension:'.glb',name:definition.file,pluginOptions:{gltf:{createInstances:false,animationStartMode:0,skipMaterials:this.skipMaterials}}});
    if (this.disposed) { container.dispose(); throw new Error('Road car cache disposed'); }
    try {
      const nodes = [...container.meshes,...container.transformNodes];
      const groups = new Map(nodes.filter(n=>!n.name.includes('--')&&(n.name==='Vehicle_Base'||n.name.startsWith('Wheel_')||n.name.startsWith('Door_'))).map(n=>[n.name,n]));
      const offset = Vector3.FromArray(definition.offset), origins = new Map<string,Vector3>();
      for (const [name,node] of groups) { node.computeWorldMatrix(true); origins.set(name,name==='Vehicle_Base'?Vector3.Zero():node.getAbsolutePosition().add(offset)); }
      for (const name of WHEELS) if (!origins.has(name)) throw new Error(`Car missing wheel pivot: ${name}`);
      const records = container.meshes.filter((m):m is Mesh=>m instanceof Mesh&&m.getTotalVertices()>0).map(mesh=>({mesh,world:mesh.computeWorldMatrix(true).clone(),group:[...groups].find(([,n])=>mesh===n||mesh.isDescendantOf(n))?.[0]??'Vehicle_Base'}));
      const parts: Part[] = [];
      for (const {mesh,world,group} of records) {
        const origin = origins.get(group)??Vector3.Zero();
        const geometry = VertexData.ExtractFromMesh(mesh,true,true);
        geometry.transform(world.multiply(Matrix.Translation(offset.x-origin.x,offset.y-origin.y,offset.z-origin.z)));
        mesh.makeGeometryUnique(); geometry.applyToMesh(mesh,true);
        mesh.parent=null;mesh.position.setAll(0);mesh.rotation.setAll(0);mesh.rotationQuaternion=null;mesh.scaling.setAll(1);mesh.setEnabled(false);
        const role = mesh.metadata?.gltf?.extras?.role ?? mesh.material?.name.split('--')[0] ?? 'interior';
        parts.push({mesh,group,role,origin});
      }
      container.removeAllFromScene();this.cache.set(kind,{container,parts,origins});
    } catch(error) {container.dispose();throw error;}
  }
  create(kind: RoadCarKind,id:number): VehicleModel {
    const cached = this.cache.get(kind);if (!cached||this.disposed) throw new Error(`Car assets not ready: ${kind}`);
    const {scene}=this.ctx, definition=ROAD_CARS[kind], root=new Mesh(`vehicle-${id}`,scene);
    root.metadata={vehicleId:`vehicle-${id}`,vehicleKind:kind,sourceModel:definition.source,damageModel:`carla-v1:${kind}:${definition.hash.slice(0,12)}`};
    const model:VehicleModel={root,panels:[],windows:[],bumpers:[],lights:[],wheels:[],doors:[],materials:[],seat:Vector3.FromArray(definition.seat),seatPose:definition.seatPose};
    try {
      const materials=new Map<PBRMaterial,PBRMaterial>();
      for(const source of new Set(cached.parts.map(p=>p.mesh.material))) if(source instanceof PBRMaterial) {
        const material=sharedMaterial(source,`${source.name.split('--')[0]}-${id}-${source.name}`);
        material.imageProcessingConfiguration=scene.imageProcessingConfiguration;
        if(source.name.startsWith('glass--')) {material.subSurface.isRefractionEnabled=false;material.alpha=.2;material.transparencyMode=PBRMaterial.PBRMATERIAL_ALPHABLEND;material.backFaceCulling=false;}
        materials.set(source,material);model.materials.push(material);
      }
      const groups=new Map<string,TransformNode>();
      for(const [i,name] of WHEELS.entries()) {
        const pivot=new TransformNode(`road-wheel-${id}-${i}`,scene);pivot.parent=root;pivot.position.copyFrom(cached.origins.get(name)!);
        const rolling=new TransformNode(`road-axle-${id}-${i}`,scene);rolling.parent=pivot;
        const tire=new Mesh(`road-tire-${id}-${i}`,scene);tire.parent=rolling;
        const rim=new Mesh(`road-rim-${id}-${i}`,scene);rim.parent=rolling;
        const local=pivot.position.clone();local.y+=.35;
        model.wheels.push({pivot,rolling,tire,rim,local,front:i<2,damaged:false});groups.set(name,tire);
      }
      const copies=new Map<Part,Mesh>();
      for(const part of cached.parts) {
        const mesh=part.mesh.clone(`road-${id}-${part.mesh.name}`,null,true)!;
        mesh.parent=root;mesh.setEnabled(true);mesh.isPickable=true;mesh.receiveShadows=true;mesh.metadata=root.metadata;
        mesh.material=materials.get(part.mesh.material as PBRMaterial)??null;copies.set(part,mesh);
        if(part.role==='paint')model.panels.push(mesh);
        if(part.role==='glass')model.windows.push(mesh);
        if(part.role==='lamp'||part.role==='lamp-glass'||part.role.startsWith('police-'))model.lights.push(mesh);
      }
      for(const [name,origin] of cached.origins) if(name.startsWith('Door_')) {
        const parts=cached.parts.filter(p=>p.group===name);
        const skin=parts.filter(p=>p.role==='paint').sort((a,b)=>b.mesh.getTotalVertices()-a.mesh.getTotalVertices())[0]??parts.sort((a,b)=>b.mesh.getTotalVertices()-a.mesh.getTotalVertices())[0];
        if(!skin)throw new Error(`Car door pivot has no source geometry: ${name}`);
        const mesh=copies.get(skin)!;mesh.position.copyFrom(origin);groups.set(name,mesh);
        model.doors.push({mesh,side:Math.sign(origin.x)||1,front:!/(?:Rear|_R[LR])/.test(name),angle:0,hold:0});
      }
      for(const part of cached.parts) {
        const mesh=copies.get(part)!,parent=groups.get(part.group);
        if(parent&&parent!==mesh)mesh.parent=parent;
      }
      // Component origins belong to their actual panes so local impacts choose
      // the nearby window instead of every chassis pane sharing the car origin.
      for(const pane of model.windows){
        const center=pane.getBoundingInfo().boundingBox.center.clone();
        pane.makeGeometryUnique();pane.bakeTransformIntoVertices(Matrix.Translation(-center.x,-center.y,-center.z));pane.position.addInPlace(center);
      }
      for(const lamp of model.lights) {
        const center=lamp.getBoundingInfo().boundingBox.center.clone();lamp.makeGeometryUnique();lamp.bakeTransformIntoVertices(Matrix.Translation(-center.x,-center.y,-center.z));lamp.position.addInPlace(center);
        const relativeCenter=Vector3.TransformCoordinates(lamp.getBoundingInfo().boundingBox.center,lamp.computeWorldMatrix(true));
        const sourceRole=cached.parts.find(part=>copies.get(part)===lamp)!.role;
        const prefix=sourceRole.startsWith('police-')?sourceRole:relativeCenter.z>definition.tuning.length*.25?'headlight':relativeCenter.z<-definition.tuning.length*.25?'taillight':'indicator';
        lamp.name=`${prefix}-${id}-${lamp.name}`;
        if(lamp.material instanceof PBRMaterial){
          const material=sharedMaterial(lamp.material,`${prefix}-${id}-${lamp.material.name}`);
          if(prefix==='headlight')material.emissiveColor.setAll(.03);
          else if(prefix==='taillight')material.emissiveColor.set(.12,.003,.006);
          lamp.material=material;model.materials.push(material);
        }
      }
      model.deformation=new LatticeDeformation(model.panels,root,{min:Vector3.FromArray(definition.bounds.min),max:Vector3.FromArray(definition.bounds.max)});
      this.ctx.shadows.addShadowCaster(root,true);return model;
    }catch(error){root.dispose();for(const material of model.materials)material.dispose();throw error;}
  }
  dispose(){this.disposed=true;for(const entry of this.cache.values())entry.container.dispose();this.cache.clear();}
}
