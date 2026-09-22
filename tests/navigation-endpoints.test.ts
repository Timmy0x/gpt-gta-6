import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { Navigation, roadRoute, ROUTE_APPROACH } from '../src/gameplay/Navigation';

// The nearest lane at x=0 is a cul-de-sac. A nearby directed lane at x=3
// reaches the destination and joins that cul-de-sac only in the reverse direction.
const roads = [
  { id: 1, x: 0, z: 0, next: [] },
  { id: 2, x: 3, z: 0, next: [3] },
  { id: 3, x: 3, z: 40, next: [4] },
  { id: 4, x: 0, z: 40, next: [1] },
];
test('a nearby traversable lane rescues an unreachable nearest-lane snap', () => {
  const route = roadRoute(roads, { x: .4, z: 0 }, { x: 3, z: 40 });
  assert.deepEqual(route.slice(1, -1), [{ x: 3, z: 0 }, { x: 3, z: 40 }]);
  assert.ok(Math.hypot(route[1].x - route[0].x, route[1].z - route[0].z) <= ROUTE_APPROACH.maximum);
});
test('destination alternatives also use actual directed connections', () => {
  const route = roadRoute(roads, { x: 3, z: 40 }, { x: 2.6, z: 0 });
  assert.deepEqual(route.slice(1, -1), [{ x: 3, z: 40 }, { x: 0, z: 40 }, { x: 0, z: 0 }]);
});
test('exact source nodes retain one-way constraints and nearest legal routes retain priority', () => {
  assert.deepEqual(roadRoute(roads, { x: 0, z: 0 }, { x: 3, z: 40 }), []);
  const route = roadRoute(roads, { x: 2.6, z: 0 }, { x: .4, z: 0 });
  assert.deepEqual(route.slice(1, -1), [{ x: 3, z: 0 }, { x: 3, z: 40 }, { x: 0, z: 40 }, { x: 0, z: 0 }]);
});
test('bounded approaches never replace isolated nearby streets or accept a distant map pin', () => {
  const isolated = [...roads, { id: 5, x: 5, z: 40, next: [] }];
  assert.deepEqual(roadRoute(isolated, { x: .4, z: 0 }, { x: 4.7, z: 40 }), []);
  assert.deepEqual(roadRoute(roads, { x: .4, z: 0 }, { x: 100, z: 100 }), []);
  assert.deepEqual(roadRoute(roads, { x: NaN, z: 0 }, { x: 3, z: 40 }), []);
});
test('navigation distinguishes unavailable, restored, arrived and cleared routes', () => {
  const nav = new Navigation(roads);
  assert.equal(nav.set({ x: 3, z: 40, name: 'North' }, { x: 0, z: 0 }), 'unavailable');
  assert.equal(nav.status, 'unavailable'); assert.equal(nav.route.length, 0); assert.equal(nav.destination?.name, 'North');
  nav.update(2, { x: 2.6, z: 0 });
  assert.equal(nav.status, 'ready'); assert.ok(nav.remaining > 39);
  nav.update(1, { x: 3, z: 40 });
  assert.equal(nav.status, 'arrived'); assert.equal(nav.destination, null);
  nav.clear(); assert.equal(nav.status, 'idle');
});

test('the actual map action keeps unavailable routes open and the HUD never calls them zero metres', () => {
  const source = ts.createSourceFile('main.ts', readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let action: ts.IfStatement | undefined, label: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isIfStatement(node) && node.expression.getText(source).includes('action === "route"')) action = node;
    if (ts.isPropertyAssignment(node) && node.name.getText(source) === 'destination' && node.initializer.getText(source).includes('navigation.destination')) label = node.initializer;
    ts.forEachChild(node, visit);
  };
  visit(source); assert.ok(action); assert.ok(label);
  for (const available of [false, true]) {
    const navigation = new Navigation(roads), messages: string[] = [], panels: string[] = [];
    const env = { action: 'route', value: 'north', navigation,
      world: { locations: [{ id: 'north', x: 3, z: 40, name: 'North' }] },
      player: { position: { x: available ? .4 : 0, z: 0 } },
      ui: { toast: (message: string) => messages.push(message), showPanel: (panel: string) => panels.push(panel) }, setPause() {},
    };
    const output = ts.transpile(action.getText(source), { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None });
    new Function(...Object.keys(env), output)(...Object.values(env));
    const hud: string = new Function('navigation', `return (${label.getText(source)});`)(navigation);
    if (available) { assert.match(messages[0], /Route set/); assert.deepEqual(panels, ['']); assert.match(hud, / m$/); }
    else { assert.match(messages[0], /No road route/); assert.deepEqual(panels, []); assert.equal(hud, 'North · No road route'); }
  }
});
