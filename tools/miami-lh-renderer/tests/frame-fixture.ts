import {readFile} from 'node:fs/promises';
import {LoadAssetContainerAsync,Matrix,NullEngine,Scene,TransformNode,Vector3,VertexBuffer,type Mesh} from '@babylonjs/core';
import '@babylonjs/loaders/glTF/2.0';
export interface GeometryRecord {name:string;sourcePositions:number[];sourceNormals:number[];sourceIndices:number[];nodeWorld:number[];gltfWorld:number[][];rhWorld:number[][];lhWorld:number[][];}
export interface Expected {glbSha256:string;up:number[];tileParent:number[];tileChild:number[];frame:number[];combined:number[];records:GeometryRecord[];}
export const expected:Expected=JSON.parse(await readFile(new URL('../fixtures/expected.json',import.meta.url),'utf8'));
export const glb=new Uint8Array(await readFile(new URL('../fixtures/asymmetric.glb',import.meta.url)));
export const mirror=(v:Vector3)=>new Vector3(v.x,v.y,-v.z);
export function matrixProduct(a:number[],b:number[]){return Array.from({length:16},(_,i)=>{let n=0;const r=i%4,c=Math.floor(i/4);for(let k=0;k<4;k++)n+=a[k*4+r]*b[c*4+k];return n;});}
export function transform(m:number[],p:number[]){return [0,1,2].map(r=>m[r]*p[0]+m[4+r]*p[1]+m[8+r]*p[2]+m[12+r]);}
export async function loadFixture(rightHanded:boolean){
 const engine=new NullEngine({renderWidth:1600,renderHeight:900,textureSize:512,deterministicLockstep:false,lockstepMaxSteps:4}),scene=new Scene(engine);scene.useRightHandedSystem=rightHanded;
 const container=await LoadAssetContainerAsync(glb,scene,{pluginExtension:'.glb'});container.addAllToScene();
 const root=container.rootNodes[0] as TransformNode,meshes=container.meshes.filter(m=>m.getTotalVertices()>0) as Mesh[];
 for(const mesh of meshes)mesh.computeWorldMatrix(true);
 return {engine,scene,container,root,meshes,dispose(){container.dispose();scene.dispose();engine.dispose();}};
}
export type Fixture=Awaited<ReturnType<typeof loadFixture>>;
/** Known synthetic fixture placement, not a traversal/auth/geographic tile adapter. */
export function placeCanonical(f:Fixture,mode:'correct'|'double-importer-conversion'|'reverse-tiles'|'omit-up'='correct'){
 let combined=expected.combined;
 if(mode==='reverse-tiles')combined=matrixProduct(expected.frame,matrixProduct(expected.tileChild,matrixProduct(expected.tileParent,expected.up)));
 if(mode==='omit-up')combined=matrixProduct(expected.frame,matrixProduct(expected.tileParent,expected.tileChild));
 let desired=Matrix.FromArray(combined);if(!f.scene.useRightHandedSystem)desired=desired.multiply(Matrix.Scaling(1,1,-1));
 const wrapper=new TransformNode('known-fixture-frame',f.scene),conversion=f.root.computeWorldMatrix(true).clone();
 wrapper.freezeWorldMatrix(mode==='double-importer-conversion'?desired:conversion.invert().multiply(desired));f.root.parent=wrapper;
 for(const mesh of f.meshes)mesh.computeWorldMatrix(true);return wrapper;
}
export function vertices(mesh:Mesh){const p=mesh.getVerticesData(VertexBuffer.PositionKind)!,world=mesh.computeWorldMatrix(true);return Array.from({length:p.length/3},(_,i)=>Vector3.TransformCoordinates(Vector3.FromArray(p,i*3),world));}
export function fixtureError(f:Pick<Fixture,'scene'|'meshes'>){let worst=0;for(const r of expected.records){const mesh=f.meshes.find(m=>m.name===r.name);if(!mesh)throw new Error('Missing mesh '+r.name);const target=f.scene.useRightHandedSystem?r.rhWorld:r.lhWorld;for(const [i,p]of vertices(mesh).entries())worst=Math.max(worst,Vector3.Distance(p,Vector3.FromArray(target[i])));}return worst;}
