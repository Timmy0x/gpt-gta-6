import test from 'node:test';
import assert from 'node:assert/strict';
import { Persistence } from '../src/core/Persistence';
import { loadCompatibleWorldSave } from '../src/core/WorldSave';

test('the expanded Brickell world restores the previous coordinate-compatible sandbox without resetting it or mutating storage', t => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  } });
  t.after(() => { if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor); else Reflect.deleteProperty(globalThis, 'localStorage'); });
  const previous = Persistence.save({
    worldId: 'brickell-public-common-frame-r1',
    player: { x: 30, y: -21.5, z: -40, character: 'Lucia', health: 65, armor: 12, postureHeight: 1.8 },
    time: 17.5, weather: 'Rain', cash: 8735,
    vehicles: [], destroyed: [], civilians: [{ id: 'creative-local', x: 35, y: -22.4, z: -39, health: 73 }],
    settings: { god: false, traffic: .5 },
  });
  const before = [...values];
  const migrated = loadCompatibleWorldSave('brickell-public-common-frame-r2');
  assert.deepEqual(migrated, { ...previous, worldId: 'brickell-public-common-frame-r2' });
  assert.deepEqual([...values], before, 'reading does not discard or rewrite an earlier sandbox');
  assert.equal(loadCompatibleWorldSave('unrelated-world'), null);
  assert.equal(loadCompatibleWorldSave('brickell-public-common-frame-r3'), null, 'future frames require an explicit compatibility decision');
  const current = Persistence.save({ ...migrated!, cash: 9500 });
  assert.deepEqual(loadCompatibleWorldSave('brickell-public-common-frame-r2'), current, 'a newer save always takes priority');
  assert.deepEqual(Persistence.load('brickell-public-common-frame-r1'), previous, 'old save remains available');
});
