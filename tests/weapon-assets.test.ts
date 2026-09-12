import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { DirectionalLight, NullEngine, Scene, ShadowGenerator, Vector3 } from '@babylonjs/core';
import { Character } from '../src/gameplay/Character';
import { HeldWeapon } from '../src/gameplay/combat/Weapons';
import { prepareWeaponAssets } from '../src/gameplay/combat/WeaponAssets';

test('licensed firearm packages retain mechanical parts, metre scale, normals and source hashes', async () => {
  const manifest = JSON.parse(await readFile('data/weapons/tabasco/runtime-manifest.json', 'utf8'));
  let bytes = 0;
  for (const model of manifest) {
    const packed = await readFile(model.file); bytes += packed.length;
    assert.equal(createHash('sha256').update(packed).digest('hex'), model.sha256);
    const data = JSON.parse(gunzipSync(packed).toString());
    assert.equal(data.meshes.length, model.parts);
    let min = Infinity, max = -Infinity;
    for (const mesh of data.meshes) {
      assert.equal(mesh.positions.length, mesh.normals.length);
      assert.ok(mesh.positions.every(Number.isFinite));
      for (const index of mesh.indices) assert.ok(index >= 0 && index < mesh.positions.length / 3);
      for (let i = 2; i < mesh.positions.length; i += 3) {min = Math.min(min, mesh.positions[i]); max = Math.max(max, mesh.positions[i]);}
    }
    assert.ok(Math.abs(max - min - model.lengthMetres) < .003, model.id + ' has a real weapon scale');
    assert.ok(data.meshes.some((m: {metadata: {part: string}}) => /Slide|ChargingHandle|Bolt/.test(m.metadata.part)));
  }
  assert.ok(bytes < 460_000, 'three source assets have a bounded compressed download');
});

for (const decoded of [false, true]) test(`native Babylon asset loading, attachment and switching with ${decoded ? 'HTTP-decoded' : 'raw gzip'} data retain bounded resources`, async () => {
  const engine = new NullEngine(), scene = new Scene(engine), shadows = new ShadowGenerator(128, new DirectionalLight('sun', Vector3.Down(), scene));
  const character = new Character(scene, shadows, 'asset-review'), held = new HeldWeapon(scene);
  try {
    await prepareWeaponAssets(scene, async url => {const bytes = await readFile('public' + url); return new Uint8Array(decoded ? gunzipSync(bytes) : bytes);});
    character.animate(.2, 0, true);
    const counts: number[] = [];
    for (let loop = 0; loop < 4; loop++) {
      for (const index of [0, 3, 5, 0, 7]) {
        held.update(character, index, index !== 7, 1 / 60);
        assert.ok(held.muzzle().asArray().every(Number.isFinite));
        if ([0, 3, 5].includes(index)) assert.ok(held.root!.getChildMeshes().some(m => m.metadata?.licensedSource === 'Tabasco CC0'));
      }
      counts.push(scene.meshes.length);
    }
    assert.equal(new Set(counts).size, 1, 'switching does not accumulate instantiated parts');
    held.update(character, 0, true, 0); const slide = held.root!.getChildMeshes().find(m => m.metadata?.part === 'Slide')!;
    const rest = slide.position.z; held.recoil(); held.update(character, 0, true, 1 / 60); assert.ok(slide.position.z < rest - .015);
    held.update(character, 0, true, 1); assert.equal(slide.position.z, rest);
  } finally {held.dispose(); character.dispose(); scene.dispose(); engine.dispose();}
});
