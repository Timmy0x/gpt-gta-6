import test from 'node:test';
import assert from 'node:assert/strict';
import { WeaponHandling } from '../src/gameplay/combat/WeaponHandling';
import { WeaponInventory } from '../src/gameplay/combat/Weapons';
import { UNARMED, WEAPON_SPECS, validWeaponSave } from '../src/gameplay/combat/WeaponCatalog';
import { weaponWheelSector } from '../src/ui/WeaponWheel';

test('drawing acquires the grip before revealing a gun, and stowing completes before switching', () => {
  const h = new WeaponHandling(); assert.equal(h.ready, false); assert.equal(h.visible, false);
  h.request(0); h.update(.1); assert.equal(h.visible, false); assert.equal(h.ready, false);
  h.update(.1); assert.equal(h.visible, true); assert.equal(h.ready, false);
  h.update(.4); assert.equal(h.ready, true);
  h.request(5); assert.equal(h.phase, 'stowing'); assert.equal(h.current, 0); assert.equal(h.ready, false);
  h.update(.2); assert.equal(h.current, 0); h.update(.21); assert.equal(h.current, 5); assert.equal(h.phase, 'drawing');
  h.update(.9); assert.equal(h.ready, false); h.update(.03); assert.equal(h.ready, true);
  h.holster(); h.update(1); assert.equal(h.phase, 'holstered'); assert.equal(h.visible, false);
});
test('rapid wheel choices resolve to the latest weapon without refilling magazines or firing during transitions', () => {
  const h = new WeaponHandling(), inventory = new WeaponInventory(); inventory.ammo = 4;
  h.request(0); h.update(1); h.request(3); h.update(.1); h.request(6); h.update(1);
  inventory.select(h.current); assert.equal(inventory.selected, 6); assert.equal(h.ready, false);
  h.request(UNARMED); h.update(1); inventory.select(h.current);
  assert.equal(h.current, UNARMED); assert.equal(h.visible, false); assert.equal(inventory.consume(), false);
  inventory.select(0); assert.equal(inventory.ammo, 4);
});
test('original three-weapon saves migrate without changing their ammunition, and all added weapons persist', () => {
  const i = new WeaponInventory(); assert.ok(i.restore({selected: 1, magazines: [2, 11, 1], reserves: [8, 21, 3]}));
  assert.deepEqual(i.magazines.slice(0, 3), [2, 11, 1]); assert.equal(i.magazines.length, WEAPON_SPECS.length);
  i.select(5); i.ammo = 1; i.reserve = 9;
  const s = {selected: i.selected, magazines: [...i.magazines], reserves: [...i.reserves]}, restored = new WeaponInventory();
  assert.ok(validWeaponSave(s)); assert.ok(restored.restore(s)); assert.equal(restored.ammo, 1); assert.equal(restored.reserve, 9);
  assert.equal(validWeaponSave({...s, selected: 80}), false);
  assert.equal(validWeaponSave({...s, magazines: s.magazines.map((n, j) => j === 5 ? 6 : n)}), false);
});
test('wheel selection follows eight directions and the centre retains the highlighted weapon', () => {
  assert.equal(weaponWheelSector(0, 0, 5), 5);
  for (let slot = 0; slot < 8; slot++) { const a = slot * Math.PI / 4; assert.equal(weaponWheelSector(Math.sin(a) * 100, -Math.cos(a) * 100, 0), slot); }
  assert.equal(WEAPON_SPECS.filter(w => w.automatic).length, 2);
  assert.deepEqual(WEAPON_SPECS[5].scope, [2, 4, 8]);
  assert.ok(WEAPON_SPECS[4].pellets > 1); assert.equal(WEAPON_SPECS[5].driveBy, false);
});
