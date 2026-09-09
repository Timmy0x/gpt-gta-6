import test from 'node:test';
import assert from 'node:assert/strict';
import { DirectionalLight, NullEngine, Quaternion, Scene, ShadowGenerator, Vector3 } from '@babylonjs/core';
import { Character } from '../src/gameplay/Character';
import { SwimAnimation } from '../src/gameplay/SwimAnimation';

test('swim presentation transitions smoothly between vertical treading, prone travel and land', () => {
  const animation = new SwimAnimation();
  for (let i = 0; i < 120; i++) animation.update(1 / 60, true, 0, false, 0);
  assert.ok(animation.pitch < .13 && animation.stroke < .01);
  let maxPitchStep = 0;
  for (let i = 0; i < 120; i++) {
    const before = animation.pitch; animation.update(1 / 60, true, 1.8, false, 0);
    maxPitchStep = Math.max(maxPitchStep, Math.abs(animation.pitch - before));
  }
  assert.ok(animation.pitch > 1.16 && animation.pitch < 1.18, 'body becomes prone while travelling');
  assert.ok(maxPitchStep < .06, 'entry blends without a one-frame torso flip');
  for (let i = 0; i < 120; i++) animation.update(1 / 60, true, 1.8, true, -1.8);
  assert.ok(animation.pitch > 2, 'underwater forward descent angles into the dive');
  for (let i = 0; i < 120; i++) animation.update(1 / 60, false, 0, false, 0);
  assert.ok(animation.pitch < .001 && animation.blend < .001, 'walking restores the upright transform');
  animation.reset(); assert.deepEqual([animation.blend, animation.pitch, animation.phase], [0, 0, 0]);
});

test('actual character joints form a head-first crawl with alternating hands and trailing fluttering feet', () => {
  const engine = new NullEngine(), scene = new Scene(engine), shadows = new ShadowGenerator(16, new DirectionalLight('sun', Vector3.Down(), scene));
  try {
    for (const female of [false, true]) for (const heading of [0, Math.PI / 2, -2.2]) {
      const character = new Character(scene, shadows, 'swimmer', '#ffffff', female);
      const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading));
      let firstWrist: Vector3 | undefined, strokeDistance = 0;
      for (let frame = 0; frame < 90; frame++) {
        const phase = frame / 90 * Math.PI * 2;
        character.animate(1 / 60, 1.8); character.swimPose(phase, 1, false);
        character.root.rotationQuaternion = Quaternion.RotationYawPitchRoll(heading, 1.17, Math.sin(phase) * .075);
        character.root.computeWorldMatrix(true); character.skeleton.computeAbsoluteMatrices(true);
        const joint = (name: string) => character.skeleton.bones.find(bone => bone.name.endsWith('/' + name))!.getAbsolutePosition(character.root);
        const pelvis = joint('pelvis'), head = joint('head'), wrist = joint('leftHand');
        assert.ok(Vector3.Dot(head.subtract(pelvis), forward) > .4, 'head leads the pelvis instead of standing over it');
        assert.ok(Vector3.Dot(joint('leftFoot').subtract(pelvis), forward) < -.65, 'feet trail behind the swimmer');
        assert.ok(head.y - pelvis.y < .4, 'torso is near-horizontal');
        for (const bone of character.skeleton.bones) assert.ok(bone.getAbsolutePosition(character.root).asArray().every(Number.isFinite));
        if (!firstWrist) firstWrist = wrist.clone(); else strokeDistance = Math.max(strokeDistance, Vector3.Distance(wrist, firstWrist));
      }
      assert.ok(strokeDistance > .7, 'hands perform a full stroke'); character.dispose();
    }
  } finally { shadows.dispose(); scene.dispose(); engine.dispose(); }
});
