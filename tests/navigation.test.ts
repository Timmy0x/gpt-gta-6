import test from "node:test";
import assert from "node:assert/strict";
import { roadRoute, Navigation } from "../src/gameplay/Navigation";
test("routing follows directed connections and reports disconnected destinations", () => {
  const roads = [
    { id: 4, x: 0, z: 0, next: [9] },
    { id: 9, x: 10, z: 0, next: [2] },
    { id: 2, x: 10, z: 10, next: [4] },
    { id: 17, x: 100, z: 100, next: [] },
  ];
  assert.deepEqual(
    roadRoute(roads, { x: 10, z: 10 }, { x: 10, z: 0 }).slice(1, -1),
    [
      { x: 10, z: 10 },
      { x: 0, z: 0 },
      { x: 10, z: 0 },
    ],
  );
  assert.deepEqual(roadRoute(roads, { x: 0, z: 0 }, { x: 100, z: 100 }), []);
  const nav = new Navigation(roads);
  nav.set({ x: 10, z: 10, name: "Test" }, { x: 0, z: 0 });
  assert.equal(nav.remaining, 20);
  nav.update(1, { x: 10, z: 10 });
  assert.equal(nav.destination, null);
});
