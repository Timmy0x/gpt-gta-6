import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DirectionalLight, LoadAssetContainerAsync, Material, NullEngine, Scene, ShadowGenerator, Vector3 } from '@babylonjs/core';
import { Character } from '../src/gameplay/Character';
import { prepareCharacterAssets, prepareCivilianAssets } from '../src/gameplay/characters/RocketboxSkin';
import { applyBodyImpact, advanceBodyInjuries, bodyInjuryEffects, type BodyRegion } from '../src/gameplay/Injuries';
import { skinFrameMetrics } from '../scripts/characters/interaction/frame-metrics';

test('licensed player and civilian skins keep limb lengths and clear the floor throughout limp, fall, crawl and rise', async context => {
  const engine = new NullEngine(), scene = new Scene(engine); scene.defaultMaterial = new Material('test/no-shader', scene);
  const shadows = new ShadowGenerator(16, new DirectionalLight('sun', Vector3.Down(), scene));
  const load = async (url: string) => LoadAssetContainerAsync(new Uint8Array(await readFile(new URL('../public' + new URL(url).pathname, import.meta.url))), scene, { pluginExtension: '.glb', pluginOptions: { gltf: { skipMaterials: true } } });
  let vertexChecks = 0, minimum = Infinity, maximum = 0, maxPalmGap = 0, maxSoleGap = 0, maxPlantedPalmGap = 0, maxBodyContact = 0, maxCrawlJointStep = 0;
  try {
    await prepareCharacterAssets(scene, 'http://local/characters/rocketbox/', load); await prepareCivilianAssets(scene, 'http://local/characters/civilians/', load);
    for (const variant of ['Jason', 'Lucia', 'male-adult-03', 'female-adult-06'] as const) {
      const player = variant === 'Jason' || variant === 'Lucia';
      const model = new Character(scene, shadows, variant, '#fff', variant === 'Lucia' || variant.startsWith('female'), undefined, player ? { licensedPlayerSkin: true } : { licensedCivilianSkin: variant });
      try {
        const lengths = model.skeleton.bones.map(bone => bone.getPosition().length());
        for (const region of ['leftLeg', 'rightLeg', 'torso', 'leftArm', 'rightArm', 'head'] as BodyRegion[]) {
          model.bodyInjuries = applyBodyImpact(null, { region, kind: 'projectile', damage: region === 'head' ? 32 : region === 'torso' ? 55 : 25, health: 50 });
          const critical = model.bodyInjuries.critical;
          let previousCrawlJoints: Vector3[] | undefined;
          for (let frame = 0; frame < (critical ? 310 : 75); frame++) {
            if (critical && frame === 110) {
              for (const injury of Object.values(model.bodyInjuries.regions)) injury.healDelay = 0;
              const release = (model.bodyInjuries.regions[region].severity - (region === 'head' ? .38 : .55)) * 300;
              advanceBodyInjuries(model.bodyInjuries, release + .001);
              assert.equal(bodyInjuryEffects(model.bodyInjuries).mode, 'recovering', 'sample the actual complete rise rather than skipping it with a large heal step');
            }
            const effects = bodyInjuryEffects(model.bodyInjuries), speed = effects.mode === 'crawling' ? .45 : effects.canStand ? .8 : 0;
            model.animate(1 / 60, speed); model.applyInjuryPose(effects, 1 / 60, speed);
            scene.onBeforeActiveMeshesEvaluationObservable.notifyObservers(scene);
            const metric = skinFrameMetrics(model.parts.slice(1), []);
            minimum = Math.min(minimum, metric.minimumY); maximum = Math.max(maximum, metric.maximumY); vertexChecks += metric.vertices;
            assert.ok(metric.minimumY >= 0, `${variant} ${region} ${effects.mode} frame ${frame}: ${metric.minimumY} (${metric.minimumBone})`);
            assert.ok(metric.maximumY < 2.05, `${variant} ${region}: body extent ${metric.maximumY}`);
            for (let i = 1; i < model.skeleton.bones.length; i++) assert.ok(Math.abs(model.skeleton.bones[i].getPosition().length() - lengths[i]) < .000001, 'no damage pose stretches or folds bone translations');
            assert.ok(model.skeleton.bones.every(bone => [...bone.getAbsoluteMatrix().m].every(Number.isFinite)));
            if (effects.mode === 'crawling') {
              const bodyContact = Math.min(...Object.entries(metric.minimumByBone).filter(([name]) => /Bip01_(?:Pelvis|Spine|[LR]_(?:Thigh|Calf))/.test(name)).map(([,y]) => y));
              maxBodyContact = Math.max(maxBodyContact,bodyContact);
              const joints=model.skeleton.bones.map(b=>b.getAbsolutePosition(model.root));
              if(previousCrawlJoints)for(let index=0;index<joints.length;index++){const step=Vector3.Distance(joints[index],previousCrawlJoints[index]);maxCrawlJointStep=Math.max(maxCrawlJointStep,step);assert.ok(step<.08,`${variant} crawl frame ${frame}: ${model.skeleton.bones[index].name} moved ${step} m`);}
              previousCrawlJoints=joints;
              assert.ok(bodyContact < .035, `${variant} unsupported trunk/legs: ${bodyContact}; frame ${frame}; ${metric.minimumBone} ${metric.minimumY}; pelvis ${model.jointPosition("pelvis").y}; phase ${model.phase}`);
              for (const side of ['L','R']) {
                const palm = Math.min(...Object.entries(metric.minimumByBone).filter(([name]) => name.startsWith(`Bip01_${side}_Hand`) || name.startsWith(`Bip01_${side}_Finger`)).map(([,y])=>y));
                const sole = Math.min(...Object.entries(metric.minimumByBone).filter(([name]) => name.startsWith(`Bip01_${side}_Foot`) || name.startsWith(`Bip01_${side}_Toe`)).map(([,y])=>y));
                maxPalmGap=Math.max(maxPalmGap,palm);maxSoleGap=Math.max(maxSoleGap,sole);
                const planted = Math.sin(model.phase + (side === 'R' ? Math.PI : 0)) <= 0;
                if (planted) { maxPlantedPalmGap = Math.max(maxPlantedPalmGap, palm); assert.ok(palm < .025, `${variant} planted ${side} palm gap: ${palm}`); }
                assert.ok(palm < .09, `${variant} crawl ${side} palm hover: ${palm}`);
                assert.ok(sole < .09, `${variant} crawl ${side} sole hover: ${sole}`);
              }

              for (const foot of model.skeleton.bones.filter(bone => /(?:left|right)Foot$/.test(bone.name))) {
                const angles = foot.getRotationQuaternion().toEulerAngles();
                assert.ok(angles.x >= -.65 && angles.x <= 1.10 && Math.abs(angles.y) < .001 && Math.abs(angles.z) < .001, 'prone ankles remain within anatomical flexion limits without twist');
              }
              assert.ok(model.jointPosition('chest').y < .43, 'critical chest stays low enough for a wounded forearm crawl');
              assert.ok(Math.max(model.jointPosition('leftForearm').y, model.jointPosition('rightForearm').y) < .26, 'elbows stay near ground support rather than holding a push-up plank');
              assert.ok(Vector3.Distance(model.jointPosition('leftCalf'), model.jointPosition('rightCalf')) > .15, 'knees remain separated');
            }
            advanceBodyInjuries(model.bodyInjuries, 1 / 60);
          }
        }
        // Physical handoff can finish on any gait phase while the survivor is idle.
        // Moving-only captures missed a loose sleeve crossing the floor here.
        for (const region of ['leftLeg', 'rightLeg', 'torso', 'leftArm', 'rightArm', 'head'] as BodyRegion[]) {
          for (let phase = 0; phase < 12; phase++) {
            model.bodyInjuries = applyBodyImpact(null, { region, kind: 'projectile', damage: 60, health: 18 });
            model.bodyInjuries.fallRemaining = 0;
            model.phase = phase * Math.PI / 6;
            model.animate(0, 0); model.applyInjuryPose(bodyInjuryEffects(model.bodyInjuries), 0, 0);
            scene.onBeforeActiveMeshesEvaluationObservable.notifyObservers(scene);
            const metric = skinFrameMetrics(model.parts.slice(1), []);
            minimum = Math.min(minimum, metric.minimumY); maximum = Math.max(maximum, metric.maximumY); vertexChecks += metric.vertices;
            assert.ok(metric.minimumY >= 0, `${variant} idle ${region} phase ${phase}: ${metric.minimumY} (${metric.minimumBone})`);
            const bodyContact = Math.min(...Object.entries(metric.minimumByBone).filter(([name]) => /Bip01_(?:Pelvis|Spine|[LR]_(?:Thigh|Calf))/.test(name)).map(([,y]) => y));
            maxBodyContact = Math.max(maxBodyContact, bodyContact);
            assert.ok(bodyContact < .035, `${variant} idle ${region} phase ${phase}: unsupported trunk/legs ${bodyContact}`);
            for (const side of ['L','R']) {
              const palm = Math.min(...Object.entries(metric.minimumByBone).filter(([name]) => name.startsWith(`Bip01_${side}_Hand`) || name.startsWith(`Bip01_${side}_Finger`)).map(([,y]) => y));
              maxPlantedPalmGap = Math.max(maxPlantedPalmGap, palm);
              assert.ok(palm < .025, `${variant} idle ${region} phase ${phase}: ${side} hand support ${palm}`);
            }
            for (const side of ['left', 'right'] as const) {
              const thigh = model.jointPosition(`${side}Calf`).subtract(model.jointPosition(`${side}Thigh`)).normalize();
              const calf = model.jointPosition(`${side}Foot`).subtract(model.jointPosition(`${side}Calf`)).normalize();
              assert.ok(Math.acos(Math.max(-1, Math.min(1, Vector3.Dot(thigh, calf)))) < 2.4, 'idle crawl knees never fold back against the thighs');
            }
          }
        }
        for (const state of ['dead', 'ragdoll']) {
          model.dead = state === 'dead'; model.root.metadata = { ragdollActive: state === 'ragdoll' };
          const before = model.skeleton.bones.map(bone => [...bone.getLocalMatrix().m]);
          model.applyInjuryPose(bodyInjuryEffects(model.bodyInjuries), 1, 1);
          assert.deepEqual(model.skeleton.bones.map(bone => [...bone.getLocalMatrix().m]), before);
        }
      } finally { model.dispose(); }
    }
    context.diagnostic(`${vertexChecks} actual indexed skin vertices checked; minimum ${minimum.toFixed(5)} m, maximum ${maximum.toFixed(5)} m; max palm/sole surface gap ${maxPalmGap.toFixed(5)} / ${maxSoleGap.toFixed(5)} m; max planted palm gap ${maxPlantedPalmGap.toFixed(5)} m; max trunk/leg support gap ${maxBodyContact.toFixed(5)} m; max consecutive crawl joint movement ${maxCrawlJointStep.toFixed(5)} m.`);
  } finally { shadows.dispose(); scene.dispose(); engine.dispose(); }
});


test('opposite leg wounds mirror the actual gait and shorten only the injured stride; torso wounds visibly hunch and guard', () => {
  const engine=new NullEngine(),scene=new Scene(engine),shadows=new ShadowGenerator(16,new DirectionalLight('sun',Vector3.Down(),scene));
  const left=new Character(scene,shadows,'left'),right=new Character(scene,shadows,'right'),torso=new Character(scene,shadows,'torso'),healthy=new Character(scene,shadows,'healthy');
  try {
    left.bodyInjuries=applyBodyImpact(null,{region:'leftLeg',kind:'projectile',damage:25,health:75});right.bodyInjuries=applyBodyImpact(null,{region:'rightLeg',kind:'projectile',damage:25,health:75});
    const injured:number[]=[],support:number[]=[];
    right.phase=Math.PI;
    for(let frame=0;frame<90;frame++){
      for(const c of [left,right]){c.animate(1/60,.8);c.applyInjuryPose(bodyInjuryEffects(c.bodyInjuries),1/60,.8);}
      for(const [a,b] of [['leftFoot','rightFoot'],['rightFoot','leftFoot'],['leftCalf','rightCalf']] as const){const p=left.jointPosition(a),q=right.jointPosition(b);assert.ok(Math.abs(p.x+q.x)<.012&&Math.abs(p.y-q.y)<.012&&Math.abs(p.z-q.z)<.012,`${a}/${b} mirrors under the opposite wound`);}
      injured.push(left.jointPosition('leftFoot').z);support.push(left.jointPosition('rightFoot').z);
    }
    const range=(v:number[])=>Math.max(...v)-Math.min(...v);assert.ok(range(injured)<range(support)*.75,'damaged side has a materially shorter stride');
    torso.bodyInjuries=applyBodyImpact(null,{region:'torso',kind:'projectile',damage:30,health:70});torso.animate(.1,0);healthy.animate(.1,0);torso.applyInjuryPose(bodyInjuryEffects(torso.bodyInjuries),.1,0);
    assert.ok(torso.jointPosition('head').z>healthy.jointPosition('head').z+.04,'upper body bends forward to guard the torso');
    assert.ok(torso.jointPosition('rightHand').y>healthy.jointPosition('rightHand').y+.10,'hands rise to guard the injured torso');
  } finally {for(const c of [left,right,torso,healthy])c.dispose();shadows.dispose();scene.dispose();engine.dispose();}
});
