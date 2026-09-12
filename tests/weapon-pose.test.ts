import test from 'node:test';
import assert from 'node:assert/strict';
import { DirectionalLight, NullEngine, Scene, ShadowGenerator, Vector3 } from '@babylonjs/core';
import { Character } from '../src/gameplay/Character';
import { WeaponHandling } from '../src/gameplay/combat/WeaponHandling';
import { applyWeaponHandlingPose } from '../src/gameplay/combat/WeaponPose';
import { HeldWeapon } from '../src/gameplay/combat/Weapons';

test('long guns remain above the ground throughout drawing, relaxed carry, movement and stowing', t => {
  const engine = new NullEngine(), scene = new Scene(engine), shadows = new ShadowGenerator(128, new DirectionalLight('sun', Vector3.Down(), scene));
  const character = new Character(scene, shadows, 'carry-review'), held = new HeldWeapon(scene);
  t.after(() => {held.dispose(); character.dispose(); scene.dispose(); engine.dispose();});
  for (const index of [3, 4, 5]) {
    const handling = new WeaponHandling(); handling.request(index);
    let visibleFrames = 0, lowestMuzzle = Infinity;
    for (let frame = 0; frame < 240; frame++) {
      if (frame === 160) handling.holster();
      character.animate(1 / 60, frame > 100 && frame < 160 ? 3.7 : 0);
      handling.update(1 / 60); applyWeaponHandlingPose(character, handling, 0);
      held.update(character, handling.current, handling.visible, 1 / 60);
      if (handling.visible) { visibleFrames++; lowestMuzzle = Math.min(lowestMuzzle, held.muzzle().y); }
      for (const side of ['leftHand', 'rightHand'] as const) assert.ok(character.jointPosition(side).asArray().every(Number.isFinite));
    }
    assert.ok(visibleFrames > 120);
    assert.ok(lowestMuzzle > .22, `weapon ${index} lowest muzzle ${lowestMuzzle} m must clear the pavement`);
  }
});
