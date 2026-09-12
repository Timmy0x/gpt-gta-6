import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import HavokPhysics from '@babylonjs/havok';
import { DirectionalLight, HavokPlugin, MeshBuilder, NullEngine, PhysicsAggregate, PhysicsShapeType, Scene, ShadowGenerator, Vector3, type PhysicsEngineV2 } from '@babylonjs/core';
import { Character } from '../src/gameplay/Character';
import { Player } from '../src/gameplay/Player';
import { NpcLocomotion } from '../src/gameplay/NpcLocomotion';
import { damageCharacter, recoverCharacter } from '../src/gameplay/CharacterDamage';
import { advanceBodyInjuries, bodyInjuryEffects, cloneBodyInjuries } from '../src/gameplay/Injuries';
import { castSegment } from '../src/gameplay/combat/queries';
import { RagdollReactions } from '../src/gameplay/combat/RagdollReactions';
import { DamageSystem } from '../src/gameplay/Damage';
import type { Input } from '../src/core/Input';

async function fixture() {
  const wasm = await readFile(new URL('../node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm', import.meta.url));
  const havok = await HavokPhysics({wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer});
  const engine = new NullEngine(), scene = new Scene(engine);
  scene.enablePhysics(new Vector3(0, -9.81, 0), new HavokPlugin(false, havok));
  const physics = scene.getPhysicsEngine() as PhysicsEngineV2;
  const shadows = new ShadowGenerator(128, new DirectionalLight('sun', Vector3.Down(), scene));
  const box = (name: string, p: Vector3, size: number[]) => {
    const mesh = MeshBuilder.CreateBox(name, {width: size[0], height: size[1], depth: size[2]}, scene);
    mesh.position.copyFrom(p); const aggregate = new PhysicsAggregate(mesh, PhysicsShapeType.BOX, {mass: 0}, scene);
    return {mesh, dispose() {aggregate.dispose(); mesh.dispose();}};
  };
  box('ground', new Vector3(0, -.5, 0), [100, 1, 100]); physics._step(1 / 60);
  let walking = 0;
  const input = {aim: false, down: (key: string) => key === 'sprint', take: () => false, axis: (key: string) => key === 'y' ? walking : 0, dx: 0, dy: 0, gamepad: null} as unknown as Input;
  const player = new Player(scene, shadows, input, new Vector3(0, .94, 0));
  const step = (frames: number) => {for (let i = 0; i < frames; i++) {player.update(1 / 60); physics._step(1 / 60);}};
  return {scene, engine, physics, shadows, player, box, step, walk(value: number) {walking = value;}, dispose() {player.controller.dispose(); player.queries.dispose(); scene.dispose(); engine.dispose();}};
}

test('player and NPC share partial region damage, torso armor and region-dependent critical reactions', async t => {
  const f = await fixture(); t.after(() => f.dispose());
  const npc = new Character(f.scene, f.shadows, 'damage-target');
  npc.root.position.x = 5; npc.animate(1 / 60, 0);
  f.player.hurt(20, false, {kind: 'projectile', region: 'leftLeg'});
  const result = damageCharacter(npc, 100, 20, 'projectile', {region: 'leftLeg'}, 50);
  assert.equal(f.player.health, 87); assert.equal(f.player.armor, 50);
  assert.equal(result.health, f.player.health); assert.deepEqual(npc.bodyInjuries, f.player.model.bodyInjuries);
  assert.equal(bodyInjuryEffects(npc.bodyInjuries).limpSide, -1);
  assert.equal(npc.bodyInjuries!.regions.rightLeg.severity, 0);
  f.walk(1); f.step(120);
  assert.ok(f.player.position.z > 4 && f.player.position.z < 6.2, `injured leg prevents 7.1m/s sprint: ${f.player.position.z}`);
  f.player.restoreBodyState(null); f.player.health = 100;
  f.player.hurt(20, false, {kind: 'projectile', region: 'torso'});
  assert.equal(f.player.health, 91); assert.equal(f.player.armor, 39);
  assert.ok(Math.abs(f.player.model.bodyInjuries!.regions.torso.severity - .1275) < 1e-8);
  f.player.restoreBodyState(null); f.player.health = 100;
  f.player.hurt(32, false, {kind: 'projectile', region: 'head'});
  assert.equal(f.player.health, 36); assert.equal(f.player.armor, 39);
  assert.equal(bodyInjuryEffects(f.player.model.bodyInjuries).mode, 'down');
  f.walk(0); f.step(1200);
  assert.equal(bodyInjuryEffects(f.player.model.bodyInjuries).mode, 'crawling', 'twenty seconds does not erase severe trauma');
  assert.equal(f.player.controller.shapeOptions.capsuleHeight, .64);
});

test('the entire crawling body collides with walls and can leave a low ceiling before standing', async t => {
  const f = await fixture(); t.after(() => f.dispose());
  f.box('wall', new Vector3(0, .6, 2.2), [4, 1.2, .1]);
  const roof = f.box('low roof', new Vector3(0, .92, -.5), [4, .1, 3]);
  f.physics._step(1 / 60);
  f.player.hurt(55, false, {kind: 'projectile', region: 'leftLeg'});
  f.walk(1); f.step(480);
  assert.ok(f.player.position.z < 1.36, `forward end stops at wall: ${f.player.position.asArray()}`);
  assert.ok(f.player.position.y < .5, `body remains under roof: ${f.player.position.asArray()}`);
  f.player.teleport(new Vector3(0, .35, -.5));
  const state = f.player.model.bodyInjuries!;
  advanceBodyInjuries(state, 600);
  state.riseRemaining = 3;
  f.walk(0); f.step(120);
  assert.equal(f.player.controller.shapeOptions.capsuleHeight, .64, 'solid roof blocks healing rise');
  const start = f.player.position.clone();
  f.walk(-1); f.step(360);
  assert.ok(f.player.position.z < start.z - 1, `healed crawler can escape: ${f.player.position.asArray()}`);
  roof.dispose(); f.walk(0); f.step(240);
  assert.equal(f.player.controller.shapeOptions.capsuleHeight, 1.8, JSON.stringify({position:f.player.position.asArray(),foot:f.player.controller.footOffset,state,clear:f.player.queries.clear(f.player.position.add(new Vector3(0,.9-f.player.controller.footOffset,0)))}));
  assert.ok(f.player.position.y > .85 && f.player.position.y < 1.05);
});

test('nearby civilian controllers stop at cover and release all native bodies across activity cycles', async t => {
  const f = await fixture(); t.after(() => f.dispose());
  f.box('npc wall', new Vector3(6, 1, 2), [3, 2, .1]);
  const npc = new Character(f.scene, f.shadows, 'walking-target'); npc.root.position.set(6, .03, 0);
  const movement = new NpcLocomotion(f.scene, npc, {ped: {model: npc}}), baseline = f.physics.getBodies().length;
  for (let cycle = 0; cycle < 8; cycle++) {
    npc.root.position.set(6, .03, 0);
    for (let i = 0; i < 120; i++) {movement.move(1 / 60, Vector3.Forward(), 2, bodyInjuryEffects(null)); f.physics._step(1 / 60);}
    assert.ok(npc.root.position.z > 1.3 && npc.root.position.z < 1.72, `cycle${cycle}: ${npc.root.position.asArray()}`);
    assert.equal(f.physics.getBodies().length, baseline + 1);
    movement.pause(); assert.equal(f.physics.getBodies().length, baseline);
  }
  movement.dispose(); npc.dispose(); assert.equal(f.physics.getBodies().length, baseline);
});

test('anatomical combat queries leave the calf gap empty and respect actual cover in front of a moving limb', async t => {
  const f = await fixture(); t.after(() => f.dispose());
  f.player.teleport(new Vector3(8, .94, 0)); f.player.update(1 / 60);
  const npc = new Character(f.scene, f.shadows, 'ray-target'); npc.animate(1 / 60, 0);
  npc.parts.forEach(mesh => mesh.metadata = {...mesh.metadata, ped: {model: npc}});
  const options = {characters: [npc, f.player.model], roots: [f.player.model.root]};
  const shot = (x: number) => castSegment(f.scene, new Vector3(x, .34, -3), new Vector3(x, .34, 3), options);
  assert.ok(!shot(0), 'anatomical calf gap must remain empty');
  assert.equal(shot(-.108)?.region, 'leftLeg');
  const cover = f.box('cover', new Vector3(-.108, .34, -1), [.3, .4, .1]); f.physics._step(1 / 60);
  assert.ok(shot(-.108)?.mesh === cover.mesh, 'native cover wins over anatomical hit'); assert.equal(shot(-.108)?.region, undefined);
  cover.dispose(); assert.equal(shot(-.108)?.region, 'leftLeg');
});

test('player physical fall hands back movement once and explicit recovery preserves other casualties', async t => {
  const f = await fixture(); t.after(() => f.dispose());
  const reactions = new RagdollReactions(f.scene); t.after(() => reactions.dispose());
  let handoffs = 0;
  reactions.onHandoff = (model, anchor) => {if (model === f.player.model) {handoffs++; f.player.resumeFromFall(anchor);}};
  f.player.onCharacterHit = (model, impulse, fatal, impact) => reactions.hit(model, impulse, fatal, impact);
  f.player.update(1 / 60);
  f.player.hurt(55, false, {kind: 'projectile', region: 'leftLeg', direction: Vector3.Forward()});
  assert.equal(f.player.controller.shape.filterMembershipMask, 0, 'a hit after movement excludes the controller before the first physical fall step');
  const original = cloneBodyInjuries(f.player.model.bodyInjuries!);
  for (let i = 0; i < 180; i++) {f.player.update(1 / 60); f.physics._step(1 / 60); reactions.update(1 / 60);}
  assert.equal(handoffs, 1); assert.equal(reactions.active.length, 0);
  assert.equal(bodyInjuryEffects(f.player.model.bodyInjuries).mode, 'crawling');
  assert.equal(f.player.model.bodyInjuries!.regions.leftLeg.severity, original.regions.leftLeg.severity);
  assert.notEqual(f.player.controller.shape.filterMembershipMask, 0);
  const dead = new Character(f.scene, f.shadows, 'persistent-victim'); dead.root.position.x = 5;
  reactions.hit(dead, Vector3.Forward(), true);
  f.player.hurt(200, false, {kind: 'projectile', region: 'torso'});
  reactions.resetCharacter(f.player.model); f.player.restoreBodyState(null); f.player.health = 100; f.player.deadTimer = 0;
  assert.equal(dead.dead, true); assert.equal(dead.root.metadata.ragdollActive, true);
  assert.equal(f.player.model.dead, false); assert.equal(f.player.model.bodyInjuries, null);
  assert.equal(reactions.active.length, 1, 'only the other fatal reaction remains');
});

test('simulation-time health recovery waits for wounds, agrees across time partitions and never revives a fatal actor', async t => {
  const f = await fixture(); t.after(() => f.dispose());
  f.player.hurt(32, false, {kind:'projectile',region:'head'});
  const initial = cloneBodyInjuries(f.player.model.bodyInjuries!), twin = new Character(f.scene,f.shadows,'healing-partition');
  twin.bodyInjuries = cloneBodyInjuries(initial);
  let health = 36;
  for(let i=0;i<360;i++) health=recoverCharacter(twin,health,.5);
  const combined=recoverCharacter(f.player.model,36,180);
  assert.ok(Math.abs(combined-health)<1e-6);
  assert.ok(combined>36 && combined<100);
  assert.ok(Math.abs(twin.bodyInjuries!.regions.head.severity-f.player.model.bodyInjuries!.regions.head.severity)<1e-6);
  f.player.model.bodyInjuries=cloneBodyInjuries(initial);
  assert.equal(recoverCharacter(f.player.model,36,30),36,'serious wound is not healed after a few seconds');
  const paused=cloneBodyInjuries(f.player.model.bodyInjuries!);recoverCharacter(f.player.model,36,0);assert.deepEqual(f.player.model.bodyInjuries,paused);
  f.player.model.dead=true;assert.equal(recoverCharacter(f.player.model,0,600),0);assert.deepEqual(f.player.model.bodyInjuries,paused);
});

test('fire reaches a character through its own capsule while a solid wall still shields it', async t => {
  const f = await fixture(); t.after(() => f.dispose());
  const damage = new DamageSystem(f.scene, f.shadows, {spawn: Vector3.Zero(), roads: [], obstacles: [], locations: [], waterLevel: -.35, update() {}, dispose() {}}, false);
  t.after(() => damage.dispose());
  const prop = damage.spawn(new Vector3(0, .5, 1), 'wood'); damage.ignite(prop, 20);
  f.physics._step(1 / 60);
  assert.ok(damage.heatAt(f.player.position) > 3, 'the target capsule does not shield its own body');
  const wall = f.box('fire cover', new Vector3(0, 1, .39), [2, 2, .06]); f.physics._step(1 / 60);
  assert.equal(damage.heatAt(f.player.position), 0, 'real cover still blocks thermal exposure');
  wall.dispose();
  f.player.heading = f.player.yaw = Math.PI / 2;
  f.player.hurt(55, true, {kind: 'projectile', region: 'leftLeg'}); f.step(150);
  assert.equal(f.player.controller.shapeOptions.capsuleHeight, .64);
  assert.ok(damage.heatAt(f.player.position) > 0, `prone compound colliders also exclude their owner: ${JSON.stringify({heat:damage.heatAt(f.player.position),player:f.player.position.asArray(),prop:prop.mesh.position.asArray()})}`);
});
