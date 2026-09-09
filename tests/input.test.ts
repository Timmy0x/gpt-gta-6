import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  Input,
  DEFAULT_BINDINGS,
  validateBindings,
  validBindingCode,
  stickWithDeadzone,
  type Action,
} from "../src/core/Input";

/** Use real EventTargets with controlled browser globals; restore them after every test. */
function browserFixture(t: TestContext) {
  const windowTarget = new EventTarget();
  const documentTarget = Object.assign(new EventTarget(), {
    pointerLockElement: null as EventTarget | null,
  });
  const canvas = new EventTarget();
  const storage = new Map<string, string>();
  const pad = {
    id: "Synthetic standard controller",
    index: 0,
    connected: true,
    mapping: "standard",
    timestamp: 0,
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({
      pressed: false,
      value: 0,
      touched: false,
    })),
    vibrationActuator: null,
  };
  const devices = { pads: [pad as unknown as Gamepad] as (Gamepad | null)[] };
  const replacements: Record<string, unknown> = {
    window: windowTarget,
    document: documentTarget,
    navigator: { getGamepads: () => devices.pads },
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  };
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(replacements)) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const input = new Input(canvas as unknown as HTMLCanvasElement);
  t.after(() => {
    input.dispose();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  function button(index: number, held: boolean, value = Number(held)) {
    pad.buttons[index].pressed = held;
    pad.buttons[index].value = value;
  }
  function emit(
    target: EventTarget,
    type: string,
    fields: Record<string, unknown> = {},
  ) {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, fields);
    target.dispatchEvent(event);
    return event;
  }
  return {
    input,
    pad,
    devices,
    button,
    emit,
    windowTarget,
    documentTarget,
    canvas,
    storage,
  };
}

test("saved key bindings reject reserved/corrupt fields and keep every action reachable", () => {
  for (const bad of [null, false, 12, [], "KeyW"]) {
    assert.deepEqual(validateBindings(bad), DEFAULT_BINDINGS);
  }
  assert.deepEqual(
    validateBindings({
      forward: null,
      jump: "Escape",
      creative: "bad-code",
      surprise: "KeyP",
    }),
    DEFAULT_BINDINGS,
  );
  for (const code of [
    "Escape",
    "Digit1",
    "Digit2",
    "Digit3",
    "KeyT",
    "Keyw",
    "F13",
    12,
  ]) {
    assert.equal(
      validBindingCode(code),
      false,
      `${String(code)} must not claim an action`,
    );
  }
  for (const code of [
    "KeyP",
    "ArrowUp",
    "ShiftRight",
    "Numpad8",
    "F2",
    "Space",
  ]) {
    assert.equal(validBindingCode(code), true);
  }
  const swapped = validateBindings({ forward: "KeyE" });
  assert.equal(swapped.forward, "KeyE");
  assert.equal(
    swapped.interact,
    "KeyW",
    "displaced action receives the old key",
  );
  assert.deepEqual(
    validateBindings(JSON.parse(JSON.stringify(swapped))),
    swapped,
  );
  const duplicate = validateBindings({
    forward: "KeyE",
    back: "KeyE",
    jump: "KeyE",
  });
  assert.equal(
    Object.keys(duplicate).length,
    Object.keys(DEFAULT_BINDINGS).length,
  );
  assert.equal(
    new Set(Object.values(duplicate)).size,
    Object.keys(DEFAULT_BINDINGS).length,
    "duplicate save entries cannot strand an action",
  );
  assert.equal(
    DEFAULT_BINDINGS.forward,
    "KeyW",
    "validation never changes global defaults",
  );
});

test("radial stick deadzone removes drift, preserves direction and gives analog travel", () => {
  assert.deepEqual(stickWithDeadzone(0.08, 0.08), [0, 0]);
  assert.deepEqual(stickWithDeadzone(0.16, 0), [0, 0]);
  assert.deepEqual(stickWithDeadzone(Number.NaN, 0), [0, 0]);
  assert.deepEqual(stickWithDeadzone(0, Number.POSITIVE_INFINITY), [0, 0]);
  assert.deepEqual(stickWithDeadzone(1, 0), [1, 0]);
  const half = stickWithDeadzone(0.58, 0);
  assert.ok(Math.abs(half[0] - 0.5) < 1e-9);
  const diagonal = stickWithDeadzone(1, 1);
  assert.ok(
    Math.abs(Math.hypot(...diagonal) - 1) < 1e-9,
    "diagonal magnitude is bounded",
  );
  const angled = stickWithDeadzone(0.6, 0.3);
  assert.ok(
    Math.abs(angled[0] / angled[1] - 2) < 1e-9,
    "deadzone does not bend the intended direction",
  );
});

test("standard gamepad buttons supply held actions and exactly one press edge", (t) => {
  const { input, button } = browserFixture(t);
  const expected: [number, Action][] = [
    [0, "jump"],
    [1, "crouch"],
    [2, "reload"],
    [3, "interact"],
    [5, "horn"],
    [8, "creative"],
    [9, "map"],
    [10, "sprint"],
    [11, "crouch"],
    [12, "switch"],
    [13, "repair"],
  ];
  for (const [index, action] of expected) {
    button(index, true);
    input.poll();
    assert.ok(input.down(action), `${action} held`);
    assert.ok(input.take(action), `${action} pressed`);
    assert.equal(input.take(action), false, `${action} press is consumed once`);
    input.endFrame();
    input.poll();
    assert.ok(input.down(action));
    assert.equal(
      input.take(action),
      false,
      `${action} does not repeat while held`,
    );
    button(index, false);
    input.poll();
    assert.equal(input.down(action), false, `${action} released`);
  }
});

test("holding Start while opening an overlay does not immediately toggle it closed", (t) => {
  const { input, button } = browserFixture(t);
  button(9, true);
  input.poll();
  assert.ok(input.take("map"));
  input.clear();
  for (let frame = 0; frame < 4; frame++) {
    input.poll();
    assert.equal(input.take("map"), false);
    input.endFrame();
  }
  button(9, false);
  input.poll();
  button(9, true);
  input.poll();
  assert.ok(
    input.take("map"),
    "releasing then pressing Start closes the overlay",
  );
  button(3, true);
  input.poll();
  input.endFrame();
  assert.equal(
    input.take("interact"),
    false,
    "unused press edges expire after a frame",
  );
});

test("analog axes support movement/braking and camera filtering without digitalizing the stick", (t) => {
  const { input, pad, emit, windowTarget } = browserFixture(t);
  pad.axes = [0.05, 0.02, 0.1, -0.04];
  input.poll();
  assert.equal(input.axis("x"), 0);
  assert.equal(input.axis("y"), 0);
  assert.deepEqual(input.gamepad?.axes, [0, 0, 0, 0]);
  pad.axes = [0.5, -0.5, 0.4, 0];
  input.poll();
  assert.ok(input.axis("x") > 0 && input.axis("x") < 0.5);
  assert.ok(input.axis("y") > 0 && input.axis("y") < 0.5);
  assert.ok(input.down("forward"));
  assert.ok(
    input.gamepad!.axes[2] > 0,
    "camera receives filtered right-stick input",
  );
  assert.deepEqual(
    pad.axes,
    [0.5, -0.5, 0.4, 0],
    "browser Gamepad data is never mutated",
  );
  pad.axes = [0, 0.8, 0, 0];
  input.poll();
  assert.ok(
    input.down("back"),
    "reverse stick also satisfies the game's existing brake rule",
  );
  assert.ok(input.axis("y") < -0.5);
  emit(windowTarget, "keydown", { code: "KeyW", metaKey: false });
  assert.equal(
    input.axis("y"),
    1,
    "keyboard movement wins over an opposing stick",
  );
  emit(windowTarget, "keyup", { code: "KeyW" });
  assert.ok(input.axis("y") < -0.5);
});

test("triggers and weapon buttons work, and unplugging clears only controller input", (t) => {
  const { input, button, devices, pad, emit, windowTarget, canvas } =
    browserFixture(t);
  button(6, false, 0.6);
  button(7, false, 0.7);
  input.poll();
  assert.ok(input.aim, "analog LT aims even when pressed is false");
  assert.ok(input.mouseDown, "analog RT feeds the normal combat firing state");
  for (const [index, key] of [
    [4, "Digit3"],
    [14, "Digit1"],
    [15, "Digit2"],
  ] as const) {
    button(index, true);
    input.poll();
    assert.ok(input.pressed.has(key));
    input.endFrame();
    input.poll();
    assert.equal(input.pressed.has(key), false, "weapon selection is one-shot");
    button(index, false);
    input.poll();
  }
  emit(canvas, "mousedown", { button: 0 });
  devices.pads = [];
  emit(windowTarget, "gamepaddisconnected", { gamepad: pad });
  assert.equal(input.aim, false);
  assert.equal(input.gamepad, null);
  assert.ok(
    input.mouseDown,
    "disconnect does not cancel a physical mouse press",
  );
  emit(windowTarget, "mouseup", { button: 0 });
  assert.equal(input.mouseDown, false);
  input.poll();
  assert.equal(input.axis("x"), 0);
  assert.equal(input.axis("y"), 0);
});

test("rebindings survive reload, swap duplicates and preserve keyboard/mouse release behavior", (t) => {
  const { input, canvas, windowTarget, documentTarget, emit, storage } =
    browserFixture(t);
  assert.ok(input.rebind("forward", "KeyE"));
  assert.equal(input.bindings.interact, "KeyW");
  assert.equal(
    new Set(Object.values(input.bindings)).size,
    Object.keys(DEFAULT_BINDINGS).length,
  );
  assert.equal(input.rebind("jump", "Escape"), false);
  assert.equal(input.rebind("jump", "Digit1"), false);
  assert.equal(input.rebind("jump", "not-a-code"), false);
  assert.deepEqual(
    JSON.parse(storage.get("leonida.controls")!),
    input.bindings,
  );
  input.dispose();
  const reloaded = new Input(canvas as unknown as HTMLCanvasElement);
  t.after(() => reloaded.dispose());
  assert.equal(reloaded.bindings.forward, "KeyE");
  assert.equal(reloaded.bindings.interact, "KeyW");
  const key = emit(windowTarget, "keydown", { code: "KeyW", metaKey: false });
  assert.ok(key.defaultPrevented);
  assert.ok(reloaded.take("interact"));
  emit(windowTarget, "keydown", { code: "KeyW", metaKey: false });
  assert.equal(
    reloaded.take("interact"),
    false,
    "OS key-repeat does not create extra interactions",
  );
  emit(windowTarget, "keyup", { code: "KeyW" });
  assert.equal(reloaded.down("interact"), false);
  emit(canvas, "mousedown", { button: 2 });
  assert.ok(reloaded.aim);
  emit(windowTarget, "mousemove", { movementX: 5, movementY: -3 });
  assert.equal(reloaded.dx, 5);
  assert.equal(reloaded.dy, -3);
  documentTarget.pointerLockElement = null;
  emit(documentTarget, "pointerlockchange");
  assert.equal(reloaded.aim, false, "losing pointer lock releases aim");
  reloaded.endFrame();
  assert.equal(reloaded.dx, 0);
  assert.equal(reloaded.dy, 0);
});

test("focus loss cancels firing/movement and held controller buttons must release before resuming", (t) => {
  const { input, button, emit, windowTarget } = browserFixture(t);
  button(7, true);
  button(0, true);
  input.poll();
  emit(windowTarget, "keydown", { code: "KeyW", metaKey: false });
  emit(windowTarget, "blur");
  input.poll();
  assert.equal(input.gamepad, null);
  assert.equal(input.mouseDown, false);
  assert.equal(input.down("forward"), false);
  assert.equal(input.take("jump"), false);
  emit(windowTarget, "focus");
  input.poll();
  assert.equal(input.mouseDown, false, "held RT is suppressed on focus return");
  assert.equal(input.take("jump"), false);
  button(7, false);
  button(0, false);
  input.poll();
  button(7, true);
  button(0, true);
  input.poll();
  assert.ok(input.mouseDown);
  assert.ok(input.take("jump"));
});

test('jump survives render frames without physics while render actions retain one-frame edges', (t) => {
  const { input, emit, windowTarget, button } = browserFixture(t);
  emit(windowTarget, 'keydown', { code: 'Space' });
  emit(windowTarget, 'keydown', { code: 'KeyE' });
  for (let frame = 0; frame < 4; frame++) input.endFrame();
  assert.equal(input.take('interact'), false, 'render actions still expire normally');
  assert.equal(input.take('jump'), true, 'next slow-motion physics step receives jump');
  input.endFrame();
  assert.equal(input.take('jump'), false, 'consumed edge cannot repeat while held');
  input.clear();
  button(0, true);button(3, true);input.poll();
  for (let frame = 0; frame < 4; frame++) { input.endFrame(); input.poll(); }
  assert.equal(input.take('interact'), false);
  assert.equal(input.take('jump'), true, 'gamepad A survives the same no-step frames');
  input.endFrame();input.poll();assert.equal(input.take('jump'), false);
  input.clear();assert.equal(input.take('jump'), false, 'overlay/reset clears buffered physics input');
});

test('jump buffering follows remapping and clear discards unconsumed jump edges', (t) => {
  const { input, emit, windowTarget } = browserFixture(t);
  input.rebind('jump', 'KeyJ');emit(windowTarget, 'keydown', { code: 'KeyJ' });input.endFrame();assert.equal(input.take('jump'), true);
  emit(windowTarget, 'keyup', { code: 'KeyJ' });emit(windowTarget, 'keydown', { code: 'KeyJ' });input.endFrame();input.clear();assert.equal(input.take('jump'), false);
});

test('pointer buttons aim and fire before mouse compatibility events and release outside canvas', (t) => {
  const { input, emit, canvas, windowTarget } = browserFixture(t);
  emit(canvas, 'pointerdown', { button: 2, buttons: 2 });
  assert.equal(input.aim, true, 'first RMB pointerdown is sufficient without mousedown');
  assert.equal(input.mouseDown, false);
  emit(windowTarget, 'pointerup', { button: 2, buttons: 0 });
  assert.equal(input.aim, false);
  emit(canvas, 'pointerdown', { button: 0, buttons: 1 });
  assert.equal(input.mouseDown, true, 'first LMB pointerdown is sufficient without mousedown');
  emit(windowTarget, 'pointerup', { button: 0, buttons: 0 });
  assert.equal(input.mouseDown, false);
  emit(canvas, 'pointerdown', { button: 0, buttons: 1 });
  emit(canvas, 'mousedown', { button: 0 });
  emit(windowTarget, 'pointerup', { button: 0, buttons: 0 });
  emit(windowTarget, 'mouseup', { button: 0 });
  assert.equal(input.mouseDown, false, 'duplicate compatibility events cannot leave a held flag');
});

test('pointer-only aim/fire chords and cancellation clear flags without clearing controller triggers', (t) => {
  const { input, emit, canvas, windowTarget, button } = browserFixture(t);
  emit(canvas, 'pointerdown', { button: 2, buttons: 2 });
  emit(windowTarget, 'pointermove', { button: 0, buttons: 3 });
  assert.equal(input.aim, true);assert.equal(input.mouseDown, true, 'second chord button arrives as pointermove');
  emit(windowTarget, 'pointermove', { button: 0, buttons: 2 });
  assert.equal(input.mouseDown, false);assert.equal(input.aim, true);
  emit(windowTarget, 'pointercancel', { button: -1, buttons: 0 });
  assert.equal(input.mouseDown, false);assert.equal(input.aim, false);
  emit(canvas, 'pointerdown', { button: 0, buttons: 1 });input.clear();
  emit(windowTarget, 'pointermove', { button: -1, buttons: 1 });assert.equal(input.mouseDown, false, 'overlay clear does not reactivate a held pointer');
  button(7, true);input.poll();emit(windowTarget, 'pointercancel', { buttons: 0 });assert.equal(input.mouseDown, true, 'pointer cancellation leaves independent RT input intact');
});
