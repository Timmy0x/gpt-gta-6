import { test } from "node:test";
import assert from "node:assert/strict";
import { WantedSystem } from "../src/gameplay/Wanted";
import { lineBlocked, random } from "../src/core/math";
test("unwitnessed crime does not dispatch police", () => {
  const w = new WantedSystem();
  w.crime(100, { x: 3, z: 8 }, false);
  w.update(10, { x: 3, z: 8 }, false, null, "Jason");
  assert.equal(w.stars, 0);
  assert.equal(w.phase, "clear");
});
test("report, pursuit, last known, search, reacquisition and escape", () => {
  const w = new WantedSystem();
  w.crime(150, { x: 3, z: 8 }, true);
  assert.equal(w.phase, "reporting");
  w.update(3.1, { x: 100, z: 100 }, false, null, "Jason");
  assert.equal(w.stars, 2);
  assert.deepEqual(w.lastKnown, { x: 3, z: 8 });
  w.update(5, { x: 100, z: 100 }, false, null, "Jason");
  assert.equal(w.phase, "search");
  w.update(1, { x: 10, z: 10 }, true, "car", "Jason");
  assert.equal(w.phase, "pursuit");
  assert.deepEqual(w.lastKnown, { x: 10, z: 10 });
  w.update(5, { x: 100, z: 100 }, false, null, "Jason");
  w.update(35, { x: 100, z: 100 }, false, null, "Jason");
  assert.equal(w.phase, "cooldown");
  w.update(10, { x: 100, z: 100 }, false, null, "Jason");
  assert.equal(w.stars, 0);
});
test("walls block witnesses; parallel and open lines remain clear", () => {
  const box = [{ x: 0, z: 0, w: 10, d: 10 }];
  assert.equal(lineBlocked({ x: -20, z: 0 }, { x: 20, z: 0 }, box), true);
  assert.equal(lineBlocked({ x: -20, z: 8 }, { x: 20, z: 8 }, box), false);
  assert.equal(lineBlocked({ x: 12, z: -10 }, { x: 12, z: 10 }, box), false);
});
test("seeded world randomness is reproducible", () => {
  const a = random(417),
    b = random(417);
  for (let i = 0; i < 100; i++) assert.equal(a(), b());
});
test("police profile supports configured levels without claiming reference parity", () => {
  const w = new WantedSystem({
    maxStars: 6,
    reportDelay: 3,
    searchSeconds: 20,
    cooldownSeconds: 5,
  });
  w.setLevel(8, { x: 0, z: 0 });
  assert.equal(w.stars, 6);
  w.setLevel(-1, { x: 0, z: 0 });
  assert.equal(w.phase, "clear");
});
test("last-known coordinates copy public getters used by Babylon vectors", () => {
  class Position {
    get x() {
      return 91;
    }
    get z() {
      return 94;
    }
  }
  const p = new Position();
  const w = new WantedSystem();
  w.crime(100, p, true);
  w.update(4, { x: 0, z: 0 }, false, null, "Jason");
  assert.deepEqual(w.lastKnown, { x: 91, z: 94 });
  w.setLevel(3, p);
  assert.deepEqual(w.lastKnown, { x: 91, z: 94 });
  w.update(1, p, true, null, "Jason");
  assert.deepEqual(w.lastKnown, { x: 91, z: 94 });
});
