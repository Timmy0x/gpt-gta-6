import test from 'node:test';
import assert from 'node:assert/strict';
import { applyBodyImpact, advanceBodyInjuries, bodyInjuryEffects, cloneBodyInjuries, hasBodyInjuries, validateBodyInjuries, regionalHealthDamage, blockedCrawlEffects, type BodyRegion } from '../src/gameplay/Injuries';
const hit = (region: BodyRegion, damage = 20, health = 80) => ({ region, kind: 'projectile' as const, damage, health });

test('left and right damage remain independent and affect gait, mobility, aiming and handling', () => {
  const left = applyBodyImpact(null, hit('leftLeg')), right = applyBodyImpact(null, hit('rightLeg'));
  const a = bodyInjuryEffects(left), b = bodyInjuryEffects(right);
  assert.equal(a.mode, 'limping'); assert.equal(a.limpSide, -1); assert.equal(b.limpSide, 1);
  assert.equal(left.regions.rightLeg.severity, 0); assert.equal(right.regions.leftLeg.severity, 0);
  assert.equal(a.speedScale, b.speedScale); assert.ok(a.speedScale < .8); assert.equal(a.canSprint, false); assert.equal(a.canJump, false); assert.equal(a.canStand, true);
  const arm = bodyInjuryEffects(applyBodyImpact(null, hit('leftArm', 55)));
  assert.equal(arm.canAim, false); assert.ok(arm.handlingScale < .6); assert.equal(arm.canStand, true);
  const torso = bodyInjuryEffects(applyBodyImpact(null, hit('torso', 25)));
  assert.equal(torso.mode, 'hunched'); assert.ok(torso.speedScale < 1); assert.equal(torso.leftLeg, 0);
});

test('critical injury falls, stays crawling beyond a few seconds, and rises only after gradual healing', () => {
  let state = applyBodyImpact(null, hit('leftLeg', 40));
  assert.equal(bodyInjuryEffects(state).mode, 'limping');
  state = applyBodyImpact(state, hit('rightLeg', 40, 30));
  assert.equal(bodyInjuryEffects(state).mode, 'down'); assert.equal(bodyInjuryEffects(state).canStand, false);
  advanceBodyInjuries(state, 1.2); assert.equal(bodyInjuryEffects(state).mode, 'crawling');
  advanceBodyInjuries(state, 20); assert.equal(bodyInjuryEffects(state).mode, 'crawling'); assert.equal(state.regions.leftLeg.severity, 2 / 3);
  let rise = false;
  for (let i = 0; i < 300; i++) { advanceBodyInjuries(state, .5); if (bodyInjuryEffects(state).mode === 'recovering') { rise = true; break; } }
  assert.ok(rise, 'healing crosses the recovery threshold and begins a staged rise');
  assert.ok(state.regions.leftLeg.severity > .4, 'standing does not erase partial limb impairment');
  assert.equal(bodyInjuryEffects(state).canJump, false);
  advanceBodyInjuries(state, 3); assert.equal(bodyInjuryEffects(state).mode, 'limping');
  advanceBodyInjuries(state, 600); assert.equal(hasBodyInjuries(state), false);
});

test('healing uses elapsed simulation time, survives serialization, and cannot mutate a previous saved snapshot', () => {
  const original = applyBodyImpact(null, hit('torso', 58)), saved = JSON.parse(JSON.stringify(original));
  assert.equal(validateBodyInjuries(saved), true);
  const state = applyBodyImpact(original, hit('leftArm', 10));
  assert.deepEqual(original, saved); assert.notDeepEqual(state, original);
  advanceBodyInjuries(state, 0); assert.deepEqual(original, saved);
  const single = cloneBodyInjuries(original), partitioned = cloneBodyInjuries(original);
  advanceBodyInjuries(single, 390);
  for (let i = 0; i < 3900; i++) advanceBodyInjuries(partitioned, .1);
  for (const key of Object.keys(single.regions) as BodyRegion[]) assert.ok(Math.abs(single.regions[key].severity - partitioned.regions[key].severity) < 1e-8);
  assert.equal(single.critical, partitioned.critical); assert.ok(Math.abs(single.riseRemaining - partitioned.riseRemaining) < 1e-7);
  for (const invalid of [{...saved,fallRemaining:99},{...saved,critical:'yes'},{...saved,regions:{...saved.regions,leftLeg:{severity:NaN,healDelay:0}}}]) assert.equal(validateBodyInjuries(invalid),false);
});

test('repeated hits extend the affected injury without reviving or instantly recovering a critical survivor', () => {
  const first = applyBodyImpact(null, hit('head', 32)); advanceBodyInjuries(first, 10);
  const second = applyBodyImpact(first, hit('leftArm', 5));
  assert.equal(second.critical, true); assert.equal(bodyInjuryEffects(second).mode, 'crawling');
  assert.ok(second.regions.head.severity > .6); assert.equal(second.regions.rightArm.severity,0);
});


test('distributed critical health records systemic impairment without inventing a torso wound', () => {
  const state = applyBodyImpact(null, hit('rightArm', 5, 18));
  assert.equal(state.regions.torso.severity, 0); assert.equal(state.regions.rightArm.severity, 5 / 60);
  assert.ok(state.systemic.severity >= .82); assert.equal(bodyInjuryEffects(state).mode, 'down');
  advanceBodyInjuries(state, 30); assert.equal(bodyInjuryEffects(state).mode, 'crawling');
  assert.equal(validateBodyInjuries(JSON.parse(JSON.stringify(state))), true);
  assert.equal(regionalHealthDamage(20, 'head', 'projectile'), 40);
  assert.equal(regionalHealthDamage(20, 'leftLeg', 'projectile'), 13);
  assert.equal(regionalHealthDamage(20, 'torso', 'projectile'), 20);
  assert.equal(regionalHealthDamage(20, 'head', 'melee'), 27);
  assert.equal(regionalHealthDamage(20, 'head', 'explosion'), 20);
});


test('blocked standing remains a controllable crawl and preserves actual regional state', () => {
  const state = applyBodyImpact(null, hit('leftArm', 20)), before = cloneBodyInjuries(state);
  const original = bodyInjuryEffects(state), blocked = blockedCrawlEffects(original);
  assert.equal(blocked.mode, 'crawling'); assert.equal(blocked.groundBlend, 1);
  assert.ok(blocked.maxSpeed > .4 && blocked.speedScale > 0);
  assert.equal(blocked.canStand, false); assert.equal(blocked.canJump, false); assert.equal(blocked.canAim, false);
  assert.equal(blocked.leftArm, original.leftArm); assert.equal(blocked.handlingScale, original.handlingScale);
  assert.deepEqual(state, before); assert.equal(original.mode, 'hunched');
});
