import test from "node:test";
import assert from "node:assert/strict";
import { Persistence } from "../src/core/Persistence";
function fixture() {
  return {
    version: 1,
    savedAt: "2026-09-09",
    player: { x: 0, y: 1, z: 0, character: "Jason", health: 100, armor: 35 },
    time: 16,
    weather: "Clear",
    cash: 100,
    vehicles: [],
    destroyed: [],
    props: [
      {
        id: "box",
        x: 0,
        y: 0.55,
        z: 4,
        rotation: [0, 0, 0, 1],
        material: "wood",
        health: 72,
        burning: 0,
        kind: "street",
        vertices: [[0, 1, 2]],
      },
    ],
    civilians: [{ id: "creative-ped-1", x: 2, y: 0, z: 0, health: 75 }],
    combat: { selected: 1, magazines: [5, 17, 2], reserves: [50, 60, 3] },
    settings: { quality: "high" },
  };
}
function load(value: unknown) {
  const old = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: () => JSON.stringify(value) },
  });
  try {
    return Persistence.load();
  } finally {
    if (old) Object.defineProperty(globalThis, "localStorage", old);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
}
test("save validation accepts extended and original version-one snapshots", () => {
  const data = fixture();
  assert.deepEqual(load(data), data);
  const { combat, civilians, props, ...legacy } = data;
  assert.ok(load(legacy));
});
test("malformed prop rotation and duplicate IDs are rejected before world restoration", () => {
  for (const rotation of [undefined, [], [0, 0, 0, 0], [0, 0, 1]]) {
    const data = fixture();
    Object.assign(data.props[0], { rotation });
    assert.equal(load(data), null);
  }
  const duplicate = fixture();
  duplicate.props.push({ ...duplicate.props[0] });
  assert.equal(load(duplicate), null);
  const peds = fixture();
  peds.civilians.push({ ...peds.civilians[0] });
  assert.equal(load(peds), null);
});
test("invalid ammunition cannot create impossible magazines or unusable weapon selection", () => {
  const data = fixture();
  data.combat.magazines[0] = 1000;
  assert.equal(load(data), null);
  data.combat.magazines[0] = 5;
  data.combat.selected = 4;
  assert.equal(load(data), null);
});
test("casualty saves round trip and invalid records are rejected before restoring the world", () => {
  const casualties = {
    version: 1, nextOfficerId: 7,
    civilians: [{ id: "ped-2", x: 3, y: 0.2, z: 4, yaw: 0.4 }],
    guards: [{ id: "reserve-guard-1", x: -500, y: 0.2, z: 620, yaw: 0 }],
    police: [{ id: "officer-6", role: "patrol", x: 4, y: 0.2, z: 8, yaw: 1 }],
  };
  const data = { ...fixture(), casualties };
  assert.deepEqual(load(data), data);
  for (const corrupt of [
    { ...casualties, version: 2 },
    { ...casualties, nextOfficerId: 0 },
    { ...casualties, civilians: [...casualties.civilians, ...casualties.civilians] },
    { ...casualties, guards: [{ ...casualties.guards[0], id: "unknown-guard" }] },
    { ...casualties, police: [{ ...casualties.police[0], role: "civilian" }] },
    { ...casualties, civilians: [{ ...casualties.civilians[0], x: Infinity }] },
  ]) assert.equal(load({ ...data, casualties: corrupt }), null);
});
