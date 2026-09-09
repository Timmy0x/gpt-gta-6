import test from 'node:test';
import assert from 'node:assert/strict';
import { createInnerCityPlan, emitInnerCity } from '../src/world/authoring/expansion/InnerCity';
import { INNER_CITY_BOUNDS, INNER_CITY_CONNECTIONS, INNER_CITY_EXISTING_GROUND, INNER_CITY_GROUND, connectInnerCityRoads } from '../src/world/authoring/expansion/innerCityLayout';
import { createLaneGraph, RESTRICTED_COMPOUND } from '../src/world/layout';
import type { RoadNode } from '../src/core/contracts';
import type { BoundsXZ } from '../src/world/ChunkResidency';

const plan = createInnerCityPlan();
const contains = (bounds: BoundsXZ, x: number, z: number, pad = 0) => x >= bounds.minX - pad && x <= bounds.maxX + pad && z >= bounds.minZ - pad && z <= bounds.maxZ + pad;
const intersects = (a: BoundsXZ, b: BoundsXZ) => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
function reach(roads: RoadNode[], start: number, reverse = false) {
  const graph = new Map(roads.map(node => [node.id, reverse ? [] as number[] : node.next]));
  if (reverse) for (const node of roads) for (const next of node.next) graph.get(next)!.push(node.id);
  const seen = new Set<number>(), pending = [start];
  while (pending.length) { const id = pending.pop()!; if (seen.has(id)) continue; seen.add(id); pending.push(...graph.get(id)!); }
  return seen;
}

test('VC-INNER adds a connected metric street network with three two-way joins and no dead ends', () => {
  const original = createLaneGraph(), snapshot = structuredClone(original), combined = connectInnerCityRoads(original);
  assert.deepEqual(original, snapshot, 'building the expansion graph does not mutate the source graph');
  assert.ok(combined.length > original.length + 200);
  const byId = new Map(combined.map(node => [node.id, node]));
  assert.equal(byId.size, combined.length);
  for (const node of combined) { assert.ok(Number.isFinite(node.x) && Number.isFinite(node.z)); assert.ok(node.next.length); assert.equal(new Set(node.next).size, node.next.length); for (const next of node.next) assert.ok(byId.has(next), `missing road ${next}`); }
  assert.equal(reach(combined, original[0].id).size, combined.length, 'all new roads are reachable from central streets');
  assert.equal(reach(combined, original[0].id, true).size, combined.length, 'every new lane can return to the central streets');
  for (const connection of INNER_CITY_CONNECTIONS) {
    const oldWestbound = original.find(node => Math.hypot(node.x - connection.x - 10, node.z - connection.z - 3.3) < .01)!;
    assert.ok(byId.get(oldWestbound.id)!.next.some(id => byId.get(id)!.x < connection.x), 'old road can enter the western expansion');
    const newEastbound = combined.find(node => node.id >= original.length && Math.hypot(node.x - connection.x + 10, node.z - connection.z + 3.3) < .01)!;
    assert.ok(newEastbound.next.some(id => id < original.length), 'expansion can return through the existing junction');
  }
  assert.throws(() => connectInnerCityRoads([]), /requires the existing lane/, 'missing physical junctions are not silently joined to unrelated nodes');
});

test('every new lane remains on paved geometry over physical ground, away from the annex and buildings', () => {
  const original = createLaneGraph(), roads = connectInnerCityRoads(original), byId = new Map(roads.map(node => [node.id, node]));
  const pavement = plan.boxes.filter(box => box.material === 'asphalt').map(box => ({ minX: box.x - box.w / 2, maxX: box.x + box.w / 2, minZ: box.z - box.d / 2, maxZ: box.z + box.d / 2 }));
  const ground: BoundsXZ[] = [...INNER_CITY_GROUND, INNER_CITY_EXISTING_GROUND, ...plan.connectorBounds];
  const obstacles = plan.colliders.filter(collider => collider.obstacle);
  let sampled = 0;
  for (const node of roads.filter(node => node.id >= original.length)) for (const id of node.next) {
    const next = byId.get(id)!;
    for (let t = 0; t <= 1; t += .1) {
      const x = node.x + (next.x - node.x) * t, z = node.z + (next.z - node.z) * t;
      if (x > -432) continue; // Inside the unchanged central junction.
      assert.ok(ground.some(bounds => contains(bounds, x, z)), `lane over missing ground at ${x},${z}`);
      assert.ok(pavement.some(bounds => contains(bounds, x, z, .01)), `lane off new pavement at ${x},${z}`);
      assert.ok(!contains(RESTRICTED_COMPOUND, x, z, 1.1), 'expansion does not cross the annex perimeter');
      assert.ok(!obstacles.some(collider => Math.abs(collider.x - x) < collider.w / 2 + 1.05 && Math.abs(collider.z - z) < collider.d / 2 + 1.05), `vehicle corridor blocked at ${x},${z}`);
      sampled++;
    }
  }
  assert.ok(sampled > 3000);
});

test('new district has explicit coverage, substantial architecture and traversable public destinations', () => {
  assert.equal((INNER_CITY_BOUNDS.maxX - INNER_CITY_BOUNDS.minX) * (INNER_CITY_BOUNDS.maxZ - INNER_CITY_BOUNDS.minZ), 585000);
  assert.ok(plan.buildings.length >= 85);
  assert.ok(plan.boxes.length > 5000 && plan.boxes.length < 16000, `geometry recipe count ${plan.boxes.length}`);
  assert.ok(plan.colliders.length > 150 && plan.colliders.length < 700);
  assert.equal(plan.ground.length, 2);
  const ids = [...plan.boxes, ...plan.cylinders].map(record => record.id);
  assert.equal(new Set(ids).size, ids.length, 'stable geometry IDs are unique');
  for (const box of plan.boxes) {
    assert.ok([box.x, box.y, box.z, box.w, box.h, box.d].every(Number.isFinite));
    assert.ok(box.w > 0 && box.h > 0 && box.d > 0);
    const bounds = { minX: box.x - box.w / 2, maxX: box.x + box.w / 2, minZ: box.z - box.d / 2, maxZ: box.z + box.d / 2 };
    assert.ok(!intersects(bounds, RESTRICTED_COMPOUND), `geometry changes existing annex: ${box.id}`);
  }
  const blocked = (x: number, z: number, radius = .4) => plan.colliders.some(collider => collider.obstacle && collider.y - collider.h / 2 < 2 && collider.y + collider.h / 2 > .4 && Math.abs(x - collider.x) < collider.w / 2 + radius && Math.abs(z - collider.z) < collider.d / 2 + radius);
  for (const point of [...plan.locations, ...plan.spawns]) {
    assert.ok(contains(INNER_CITY_BOUNDS, point.x, point.z));
    assert.ok(!blocked(point.x, point.z), `destination/spawn ${point.id} is inside a solid obstacle`);
  }
  for (let z = 160; z <= 181; z += .5) assert.ok(!blocked(-870, z), `café 4 m doorway and center aisle remain open at ${z}`);
  assert.ok(plan.colliders.filter(collider => collider.id.includes('cafe-roof')).every(collider => !collider.obstacle), 'overhead café roof is not a ground-level navigation obstacle');
  for (let z = 12; z <= 84; z += .5) assert.ok(!blocked(-762, z), 'market center aisle is a real walking route');
  const heights = new Set(plan.buildings.filter(building => building.kind === 'house').map(building => building.height));
  assert.ok(heights.size > 1);
  assert.ok(plan.buildings.some(building => building.height >= 16));
  assert.deepEqual(plan.futureConnections.map(connection => connection.status), ['reserved-unbuilt', 'reserved-unbuilt']);
});

test('authoring sink receives complete stable recipes and collision records without Babylon runtime dependency', () => {
  const counts = { boxes: 0, cylinders: 0, signs: 0, props: 0, colliders: 0 };
  emitInnerCity(plan, { box() { counts.boxes++; }, cylinder() { counts.cylinders++; }, sign() { counts.signs++; }, prop() { counts.props++; }, collider() { counts.colliders++; } });
  assert.deepEqual(counts, { boxes: plan.boxes.length, cylinders: plan.cylinders.length, signs: plan.signs.length, props: plan.props.length, colliders: plan.colliders.length });
  assert.deepEqual(createInnerCityPlan(), plan, 'repeated authoring produces identical geometry and IDs');
});
