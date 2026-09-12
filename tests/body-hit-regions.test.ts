import test from 'node:test';
import assert from 'node:assert/strict';
import { DirectionalLight, NullEngine, Scene, ShadowGenerator, Vector3 } from '@babylonjs/core';
import { Character } from '../src/gameplay/Character';
import { bodyRegionAtPoint, bodyVolumes, hitCharacterBody, rayBodyVolume } from '../src/gameplay/combat/BodyHitRegions';

test('posed anatomical ray volumes distinguish all six regions and leave empty space unhittable', t => {
  const engine = new NullEngine(), scene = new Scene(engine), shadows = new ShadowGenerator(128, new DirectionalLight('sun', Vector3.Down(), scene));
  const model = new Character(scene, shadows, 'target');
  t.after(() => {model.dispose(); scene.dispose(); engine.dispose();});
  model.animate(1 / 60, 0);
  const points = {
    head: new Vector3(0, 1.69, 0), torso: new Vector3(0, 1.29, 0),
    leftArm: new Vector3(-.255, 1.1, 0), rightArm: new Vector3(.255, 1.1, 0),
    leftLeg: new Vector3(-.108, .34, 0), rightLeg: new Vector3(.108, .34, 0),
  };
  for (const [region, point] of Object.entries(points)) {
    const hit = hitCharacterBody(model, point.add(new Vector3(0, 0, -3)), point.add(new Vector3(0, 0, 3)));
    assert.equal(hit?.region, region, region);
    assert.equal(bodyRegionAtPoint(model, point), region);
  }
  assert.equal(hitCharacterBody(model, new Vector3(0, .34, -3), new Vector3(0, .34, 3)), null, 'a shot between the calves misses');
  assert.equal(hitCharacterBody(model, new Vector3(.8, 1.1, -3), new Vector3(.8, 1.1, 3)), null, 'no broad full-body proxy turns a near miss into damage');
  model.root.position.set(4, .15, 9); model.root.rotation.set(Math.PI / 2, Math.PI * .42, 0); model.root.computeWorldMatrix(true);
  const leg = bodyVolumes(model).find(v => v.region === 'leftLeg')!;
  const midpoint = Vector3.Lerp(leg.a, leg.b, .75), right = model.root.right.normalize();
  assert.equal(bodyRegionAtPoint(model, midpoint), 'leftLeg', 'side identity follows the fallen body');
  const hit = hitCharacterBody(model, midpoint.subtract(right.scale(.15)), midpoint.add(right.scale(.1)));
  assert.equal(hit?.region, 'leftLeg');
});

test('capsule rays handle parallel segments, end caps, interior starts and finite length', () => {
  const volume = {region: 'torso' as const, a: Vector3.Zero(), b: Vector3.Up(), radius: .2};
  assert.ok(Math.abs(rayBodyVolume(new Vector3(0, 3, 0), Vector3.Down(), volume)! - 1.8) < 1e-8);
  assert.equal(rayBodyVolume(new Vector3(.3, 3, 0), Vector3.Down(), volume), null);
  assert.equal(rayBodyVolume(new Vector3(0, .5, 0), Vector3.Right(), volume), 0);
  assert.ok(Math.abs(rayBodyVolume(new Vector3(0, .5, -2), Vector3.Forward(), volume)! - 1.8) < 1e-8);
});
