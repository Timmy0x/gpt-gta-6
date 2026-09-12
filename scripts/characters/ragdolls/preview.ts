// @ts-nocheck -- source alias is frozen by the review builder.
import { ArcRotateCamera, Color3, Color4, DirectionalLight, Engine, HavokPlugin, HemisphericLight, MeshBuilder, PBRMaterial, PhysicsAggregate, PhysicsShapeType, Scene, ShadowGenerator, Vector3, Viewport } from '@babylonjs/core';
import HavokPhysics from '@babylonjs/havok';
import havokWasm from '@babylonjs/havok/lib/esm/HavokPhysics.wasm?url';
import { Character } from '@ragdoll-source/gameplay/Character';
import { Officer } from '@ragdoll-source/gameplay/police/Officer';
import { prepareCharacterAssets, prepareCivilianAssets } from '@ragdoll-source/gameplay/characters/RocketboxSkin';
import { applyBodyImpact, advanceBodyInjuries, bodyInjuryEffects } from '@ragdoll-source/gameplay/Injuries';
import { RagdollReactions } from '@ragdoll-source/gameplay/combat/RagdollReactions';
import { skinFrameMetrics } from '../interaction/frame-metrics';
const canvas=document.querySelector('canvas'),engine=new Engine(canvas,true,{preserveDrawingBuffer:true});
const scene=new Scene(engine);scene.clearColor=new Color4(.13,.17,.21,1);
scene.enablePhysics(new Vector3(0,-9.81,0),new HavokPlugin(true,await HavokPhysics({locateFile:()=>havokWasm})));
scene.physicsEnabled=false;const physics=scene.getPhysicsEngine();
const hemi=new HemisphericLight('sky',Vector3.Up(),scene);hemi.intensity=.9;
const sun=new DirectionalLight('sun',new Vector3(-.3,-1,.3),scene);sun.position.set(4,10,-4);sun.intensity=2;
const shadows=new ShadowGenerator(2048,sun);shadows.usePercentageCloserFiltering=true;
const floor=MeshBuilder.CreateBox('floor',{width:30,height:1,depth:30},scene);floor.position.y=-.5;floor.receiveShadows=true;
new PhysicsAggregate(floor,PhysicsShapeType.BOX,{mass:0},scene);
const mat=new PBRMaterial('asphalt',scene);mat.albedoColor=new Color3(.22,.24,.26);mat.roughness=.95;floor.material=mat;
const front=new ArcRotateCamera('front',Math.PI/2,1.22,4.2,new Vector3(0,.70,0),scene);front.viewport=new Viewport(0,0,.5,1);
const oblique=new ArcRotateCamera('oblique',.15,1.28,4.2,new Vector3(0,.70,0),scene);oblique.viewport=new Viewport(.5,0,.5,1);scene.activeCameras=[front,oblique];
await prepareCharacterAssets(scene,new URL('/characters/rocketbox/',location.href).href);await prepareCivilianAssets(scene,new URL('/characters/civilians/',location.href).href);
const reactions=new RagdollReactions(scene);let actor,officer,frame=-1,mode='regional',yaw=0,renderMetric=null;
scene.onAfterActiveMeshesEvaluationObservable.add(()=>{if(actor)renderMetric=skinFrameMetrics(actor.parts.filter(part=>part.isVisible),[]);});
async function setup(variant='Jason',heading=0,fatal=false,sourcePose='standing',zeroImpulse=false){
 reactions.reset();if(officer)officer.dispose();else actor?.dispose();officer=null;frame=-1;yaw=heading;mode=fatal?'fatal':'regional';
 const player=variant==='Jason'||variant==='Lucia';
 if(variant==='military'){officer=new Officer('review','military','none',scene,shadows);actor=officer.model;}
 else actor=new Character(scene,shadows,variant,'#fff',variant==='Lucia'||variant.startsWith('female'),undefined,player?{licensedPlayerSkin:true}:{licensedCivilianSkin:variant});
 actor.root.position.set(0,.025,0);actor.root.rotation.y=yaw;for(let f=0;f<30;f++)actor.animate(1/60,sourcePose==='walking'?2.1:0);
 scene.render();await scene.whenReadyAsync();scene.render();
 const impact={region:zeroImpulse?'torso':'leftLeg',kind:zeroImpulse?'fire':'projectile',damage:58,health:fatal?0:45};
 actor.bodyInjuries=applyBodyImpact(null,impact);
 reactions.hit(actor,zeroImpulse?Vector3.Zero():new Vector3(Math.sin(yaw)*2,0,Math.cos(yaw)*2),fatal,impact);
 return {variant,heading,fatal};
}
function step(next){
 if(next!==frame+1)throw Error('Consecutive physical frames required');frame=next;
 if(!actor.dead)advanceBodyInjuries(actor.bodyInjuries,1/60);
 if(frame===240&&!actor.dead){mode='fatal after crawl';reactions.hit(actor,new Vector3(0,0,1),true,{region:'torso',kind:'projectile',damage:50,health:0});}
 if(!actor.root.metadata.ragdollActive&&!actor.root.metadata.ragdollHandoffActive){const effects=bodyInjuryEffects(actor.bodyInjuries),speed=effects.mode==='crawling'?.25:0;actor.animate(1/60,speed);actor.applyInjuryPose(effects,1/60,speed);}
 reactions.update(1/60);physics._step(1/60);
 document.querySelector('#label').textContent=`${actor.root.name} · ${mode} · frame ${frame} · ${actor.root.metadata.ragdollActive?'physical':actor.root.metadata.ragdollHandoffActive?'roll to crawl':bodyInjuryEffects(actor.bodyInjuries).mode}`;
 const center=actor.jointPosition('pelvis').add(actor.jointPosition('chest')).scale(.5);
 front.target.set(center.x,.65,center.z);oblique.target.copyFrom(front.target);
 scene.render();
 const metric=renderMetric;
 return {frame,phase:actor.phase,mode:actor.root.metadata.ragdollActive?'physical':actor.root.metadata.ragdollHandoffActive?'handoff':bodyInjuryEffects(actor.bodyInjuries).mode,minimumY:metric.minimumY,minimumBone:metric.minimumBone,minimumByBone:metric.minimumByBone,physicsBodies:physics.getBodies().length,pelvis:actor.jointPosition('pelvis').asArray(),joints:Object.fromEntries(['leftHand','rightHand','leftCalf','rightCalf','leftFoot','rightFoot'].map(name=>[name,actor.jointPosition(name).asArray()]))};
}
Object.assign(window,{ragdollReview:{ready:true,setup,step}});
