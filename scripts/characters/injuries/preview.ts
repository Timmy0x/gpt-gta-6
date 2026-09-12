// @ts-nocheck -- source alias is frozen by the review builder.
import { ArcRotateCamera, Color3, Color4, DirectionalLight, Engine, HemisphericLight, MeshBuilder, PBRMaterial, Scene, ShadowGenerator, Vector3, Viewport } from '@babylonjs/core';
import { Character } from '@injury-source/gameplay/Character';
import { prepareCharacterAssets, prepareCivilianAssets } from '@injury-source/gameplay/characters/RocketboxSkin';
import { applyBodyImpact, advanceBodyInjuries, bodyInjuryEffects } from '@injury-source/gameplay/Injuries';
const canvas = document.querySelector('canvas'), engine = new Engine(canvas,true,{preserveDrawingBuffer:true});
const scene = new Scene(engine); scene.clearColor=new Color4(.13,.17,.21,1);
const hemi=new HemisphericLight('sky',Vector3.Up(),scene);hemi.intensity=.9;
const sun=new DirectionalLight('sun',new Vector3(-.3,-1,.3),scene);sun.position.set(4,10,-4);sun.intensity=2;
const shadows=new ShadowGenerator(2048,sun);shadows.usePercentageCloserFiltering=true;
const floor=MeshBuilder.CreateGround('floor',{width:30,height:30},scene);floor.receiveShadows=true;
const mat=new PBRMaterial('asphalt',scene);mat.albedoColor=new Color3(.22,.24,.26);mat.roughness=.95;floor.material=mat;
const front=new ArcRotateCamera('front',Math.PI/2,1.34,5.8,new Vector3(0,.82,0),scene);front.viewport=new Viewport(0,0,1,.5);
const oblique=new ArcRotateCamera('oblique',.9,1.20,6.5,new Vector3(0,.70,0),scene);oblique.viewport=new Viewport(0,.5,1,.5);scene.activeCameras=[front,oblique];
await prepareCharacterAssets(scene,new URL('/characters/rocketbox/',location.href).href);await prepareCivilianAssets(scene,new URL('/characters/civilians/',location.href).href);
let actors=[],frame=-1;
async function setup(variant='Jason'){
 actors.forEach(a=>a.dispose());actors=[];frame=-1;
 front.viewport=new Viewport(0,0,1,.5);front.radius=5.8;front.setTarget(new Vector3(0,.82,0));oblique.viewport=new Viewport(0,.5,1,.5);oblique.radius=6.5;oblique.setTarget(new Vector3(0,.7,0));
 front.alpha=Math.PI/2;front.beta=1.34;oblique.alpha=.9;oblique.beta=1.20;
 for(const [i,region] of ['leftLeg','rightLeg','torso','systemic'].entries()){
  const player=variant==='Jason'||variant==='Lucia';const a=new Character(scene,shadows,variant+'-'+region,'#fff',variant==='Lucia'||variant.startsWith('female'),undefined,player?{licensedPlayerSkin:true}:{licensedCivilianSkin:variant});
  a.position(new Vector3((i-1.5)*1.65,0,0));a.bodyInjuries=applyBodyImpact(null,{region:region==='systemic'?'leftArm':region,kind:'projectile',damage:region==='systemic'?5:25,health:region==='systemic'?18:70});actors.push(a);
 }
 scene.render(); await scene.whenReadyAsync(); scene.render();
 return{variant,order:['left leg','right leg','torso','systemic critical']};
}
function step(next){if(next!==frame+1)throw Error('Consecutive pose frames required');frame=next;
 const result=actors.map((a,i)=>{const e=bodyInjuryEffects(a.bodyInjuries),speed=e.canStand?.8:e.mode==='crawling'?.45:0;a.animate(1/60,speed);a.applyInjuryPose(e,1/60,speed);advanceBodyInjuries(a.bodyInjuries,1/60);return{name:a.root.name,mode:e.mode,groundBlend:e.groundBlend};});
 document.querySelector('#label').textContent=`${actors[0].root.name.replace(/-leftLeg$/,'')} · Critical / Torso / Right leg / Left leg · frame ${frame}`;scene.render();return{frame,result};
}
function focus(index,view='front'){const actor=actors[index],target=actor.root.position.add(new Vector3(0,index===3?.27:.9,0));front.viewport=new Viewport(0,0,.5,1);front.radius=3.0;front.setTarget(target);oblique.viewport=new Viewport(.5,0,.5,1);oblique.radius=3.4;oblique.setTarget(target);front.alpha=view==='side'?Math.PI:Math.PI/2;front.beta=view==='side'?1.52:1.34;oblique.alpha=view==='side'?-2.5:.9;oblique.beta=view==='side'?1.40:1.20;actors.forEach((a,i)=>a.root.setEnabled(i===index));scene.render();}
Object.assign(window,{injuryReview:{ready:true,setup,step,focus}});
