import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { HavokPlugin, MeshBuilder, NullEngine, PhysicsAggregate, PhysicsShapeType, Scene, UniversalCamera, Vector3 } from '@babylonjs/core';
import HavokPhysics from '@babylonjs/havok';

// Execute the actual application callbacks, not a second implementation of their gates.
const source = ts.createSourceFile('main.ts', readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
function callback(name: string): ts.ArrowFunction {
  let found: ts.ArrowFunction | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(source) === name && ts.isArrowFunction(node.arguments[0])) found = node.arguments[0];
    ts.forEachChild(node, visit);
  };
  visit(source); assert.ok(found, `application callback ${name}`); return found;
}
function run(code: string, env: Record<string, unknown>) {
  const output = ts.transpile(code, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None });
  return new Function(...Object.keys(env), output)(...Object.values(env));
}
const frameCallback = callback('engine.runRenderLoop');
assert.ok(ts.isBlock(frameCallback.body));
const inputBlock = frameCallback.body.statements.find(statement => ts.isIfStatement(statement) && statement.expression.getText(source) === 'started');
assert.ok(inputBlock);

function controls(visualHeld: boolean, sourcePanelOpen = false) {
  const effects: string[] = [], pending = new Set(['interact', 'switch', 'repair', 'reload', 'horn', 'lights', 'siren', 'melee']);
  let wheelAllowed: boolean | undefined;
  const env = {
    visualHeld, sourcePanelOpen, started: true, paused: false, collisionHeld: false, loadingWorld: false,
    dt: 1 / 60, simSpeed: 1, recoveryTimer: 0, wheelWasActive: false,
    input: { pressed: new Set(['Digit1']), take: (key: string) => pending.delete(key), wheel: 0 },
    ui: { panel: '', onAction: (action: string) => effects.push(action), toast() {} },
    weaponWheel: { active: false, update(...args: unknown[]) { wheelAllowed = args.at(-1) as boolean; } },
    player: { transitioning: false, deadTimer: 0, vehicle: null, weaponInputBlocked: false, switchCharacter: () => effects.push('switch') },
    combat: { handling: { target: 0 }, inventory: { magazines: [], reserves: [] }, weapons: [{}], reload: () => effects.push('reload'), melee: () => effects.push('melee'), select: () => effects.push('select') },
    interact: () => effects.push('interact'), beginRace: () => effects.push('race'), physics: { setSubTimeStep() {} }, audio: { effect: () => effects.push('audio') },
  };
  run(inputBlock!.getText(source), env);
  return { effects, wheelAllowed };
}

test('normal frame controls remain available after Miami scenery is ready', () => {
  assert.deepEqual(controls(false).effects, ['interact', 'switch', 'repair', 'reload', 'melee', 'melee', 'select']);
  assert.equal(controls(false).wheelAllowed, true);
});
test('missing Miami scenery blocks melee, entry, repair and weapon changes in the real frame callback', () => {
  assert.deepEqual(controls(true).effects, []);
  assert.equal(controls(true).wheelAllowed, false);
});
test('opening the source panel also closes the weapon wheel input path', () => {
  assert.deepEqual(controls(false, true).effects, []);
  assert.equal(controls(false, true).wheelAllowed, false);
});
test('a visual hold renders the current physical pose while still permitting camera recovery', () => {
  const render = callback('scene.onBeforeRenderObservable.add'); assert.ok(ts.isBlock(render.body));
  const throughPlayer = render.body.statements.slice(0, 4).map(statement => statement.getText(source)).join('\n');
  let alpha = -1, look = false;
  run(throughPlayer, {
    scene: { _physicsTimeAccumulator: 4 }, physics: { getSubTimeStep: () => 1000 / 60 },
    paused: false, collisionHeld: false, sourcePanelOpen: false, loadingWorld: false, visualHeld: true,
    interpolation: { render: (value: number) => { alpha = value; } }, renderDt: 1 / 60,
    player: { deadTimer: 0, render: (_dt: number, _alpha: number, allowLook: boolean) => { look = allowLook; } },
    ui: { panel: '' }, weaponWheel: { active: false },
  });
  assert.equal(alpha, 1); assert.equal(look, true, 'camera rotation is needed to recover a view with no tiles in its frustum');
});
test('native Babylon scene.physicsEnabled suspends Havok and its gameplay observers together', async t => {
  const bytes = readFileSync(new URL('../node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm', import.meta.url));
  const havok = await HavokPhysics({ wasmBinary: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer });
  const engine = new NullEngine(), scene = new Scene(engine); scene.enablePhysics(new Vector3(0, -9.81, 0), new HavokPlugin(false, havok));
  scene.activeCamera = new UniversalCamera('fixture', new Vector3(0, 4, -10), scene);
  const mesh = MeshBuilder.CreateSphere('moving', {}, scene); mesh.position.y = 10;
  const body = new PhysicsAggregate(mesh, PhysicsShapeType.SPHERE, { mass: 1 }, scene);
  let steps = 0; scene.onBeforePhysicsObservable.add(() => steps++);
  t.after(() => { body.dispose(); scene.dispose(); engine.dispose(); });
  body.body.setLinearVelocity(new Vector3(2, -1, 0));
  scene.physicsEnabled = false;
  for (let i = 0; i < 120; i++) scene.render();
  assert.equal(steps, 0); assert.deepEqual(mesh.position.asArray(), [0, 10, 0]);
  scene.physicsEnabled = true; scene.render();
  assert.ok(steps > 0); assert.ok(mesh.position.y < 10);
});
