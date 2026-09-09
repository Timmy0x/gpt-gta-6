export type Action =
  | "forward"
  | "back"
  | "left"
  | "right"
  | "sprint"
  | "jump"
  | "interact"
  | "crouch"
  | "reload"
  | "switch"
  | "map"
  | "creative"
  | "repair"
  | "horn"
  | "melee";
export const DEFAULT_BINDINGS: Readonly<Record<Action, string>> = {
  forward: "KeyW",
  back: "KeyS",
  left: "KeyA",
  right: "KeyD",
  sprint: "ShiftLeft",
  jump: "Space",
  interact: "KeyE",
  crouch: "KeyC",
  reload: "KeyR",
  switch: "Tab",
  map: "KeyM",
  creative: "F2",
  repair: "KeyG",
  horn: "KeyH",
  melee: "KeyF",
};
const ACTIONS = Object.keys(DEFAULT_BINDINGS) as Action[];
const STORAGE_KEY = "leonida.controls";
const RESERVED = new Set(["Escape", "Digit1", "Digit2", "Digit3", "KeyT"]);

/** Standard Gamepad mapping (Xbox names; equivalent PlayStation positions work). */
export const GAMEPAD_BINDINGS: Readonly<Partial<Record<number, Action>>> =
  Object.freeze({
    0: "jump",
    1: "crouch",
    2: "reload",
    3: "interact",
    5: "horn",
    8: "creative",
    9: "map",
    10: "sprint",
    11: "crouch",
    12: "switch",
    13: "repair",
  });
const GAMEPAD_RAW: Readonly<Record<number, string>> = {
  4: "Digit3",
  14: "Digit1",
  15: "Digit2",
};

export function validBindingCode(code: unknown): code is string {
  return (
    typeof code === "string" &&
    !RESERVED.has(code) &&
    /^(?:Key[A-Z]|Digit[0-9]|Numpad[0-9]|Arrow(?:Up|Down|Left|Right)|Shift(?:Left|Right)|Control(?:Left|Right)|Alt(?:Left|Right)|Space|Tab|Enter|Backspace|CapsLock|F(?:[1-9]|1[0-2])|Comma|Period|Slash|Semicolon|Quote|BracketLeft|BracketRight|Backslash|Minus|Equal|Backquote|Home|End|PageUp|PageDown|Insert|Delete)$/.test(
      code,
    )
  );
}

/** Ignore corrupt/unknown fields, preserve all actions, and resolve duplicate codes by swapping. */
export function validateBindings(value: unknown): Record<Action, string> {
  const result = { ...DEFAULT_BINDINGS };
  if (!value || typeof value !== "object" || Array.isArray(value))
    return result;
  for (const action of ACTIONS) {
    const code = (value as Record<string, unknown>)[action];
    if (!validBindingCode(code)) continue;
    const duplicate = ACTIONS.find(
      (other) => other !== action && result[other] === code,
    );
    if (duplicate) result[duplicate] = result[action];
    result[action] = code;
  }
  return result;
}

/** Radial deadzone avoids stick drift and preserves smooth analog magnitude outside the centre. */
export function stickWithDeadzone(
  x: number,
  y: number,
  deadzone = 0.16,
): [number, number] {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return [0, 0];
  const length = Math.hypot(x, y);
  if (length <= deadzone) return [0, 0];
  const scale = (Math.min(1, length) - deadzone) / (1 - deadzone) / length;
  return [x * scale, y * scale];
}

export class Input {
  keys = new Set<string>();
  pressed = new Set<string>();
  dx = 0;
  dy = 0;
  bindings: Record<Action, string> = { ...DEFAULT_BINDINGS };
  gamepad: Gamepad | null = null;
  private mouseFire = false;
  private mouseAim = false;
  private padFire = false;
  private padAim = false;
  private padHeld = new Set<Action>();
  private padPressed = new Set<Action>();
  private padRawPressed = new Set<string>();
  private previousButtons: boolean[] = [];
  private blockedButtons = new Set<number>();
  private padIndex: number | null = null;
  private active = true;
  private events = new AbortController();
  get mouseDown() {
    return this.mouseFire || this.padFire;
  }
  get aim() {
    return this.mouseAim || this.padAim;
  }

  constructor(public canvas: HTMLCanvasElement) {
    try {
      this.bindings = validateBindings(
        JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"),
      );
    } catch {}
    const options = { signal: this.events.signal };
    window.addEventListener(
      "keydown",
      (e) => {
        const target = e.target as HTMLElement | null;
        if (
          target?.closest?.('input,select,textarea,[contenteditable="true"]') ||
          e.metaKey
        )
          return;
        if (
          Object.values(this.bindings).includes(e.code) ||
          ["ArrowUp", "ArrowDown"].includes(e.code)
        )
          e.preventDefault();
        if (!this.keys.has(e.code)) this.pressed.add(e.code);
        this.keys.add(e.code);
      },
      options,
    );
    window.addEventListener("keyup", (e) => this.keys.delete(e.code), options);
    window.addEventListener(
      "blur",
      () => {
        this.active = false;
        this.clear();
        this.gamepad = null;
      },
      options,
    );
    window.addEventListener(
      "focus",
      () => {
        this.active = true;
      },
      options,
    );
    window.addEventListener(
      "gamepaddisconnected",
      (e) => {
        if (e.gamepad.index === this.padIndex) this.resetGamepad();
      },
      options,
    );
    const pressMouseButton = (e: MouseEvent) => {
      if (e.button === 0) this.mouseFire = true;
      if (e.button === 2) this.mouseAim = true;
    };
    const releaseMouseButton = (e: MouseEvent) => {
      if (e.button === 0) this.mouseFire = false;
      if (e.button === 2) this.mouseAim = false;
    };
    // Babylon may cancel pointerdown and thereby suppress compatibility mouse
    // events before pointer lock. Both paths safely write the same held flags.
    canvas.addEventListener("pointerdown", pressMouseButton, options);
    canvas.addEventListener("mousedown", pressMouseButton, options);
    window.addEventListener("pointerup", releaseMouseButton, options);
    window.addEventListener("mouseup", releaseMouseButton, options);
    window.addEventListener("pointercancel", () => {
      this.mouseFire = false;
      this.mouseAim = false;
    }, options);
    window.addEventListener("pointermove", (e) => {
      // Additional mouse-button chords use pointermove, rather than another
      // pointerdown. This preserves RMB aim + LMB fire without mouse fallback.
      if (this.mouseFire || this.mouseAim) {
        this.mouseFire = (e.buttons & 1) !== 0;
        this.mouseAim = (e.buttons & 2) !== 0;
      }
    }, options);
    canvas.addEventListener("contextmenu", (e) => e.preventDefault(), options);
    window.addEventListener(
      "mousemove",
      (e) => {
        if (document.pointerLockElement === canvas || this.mouseAim) {
          this.dx += e.movementX;
          this.dy += e.movementY;
        }
      },
      options,
    );
    document.addEventListener(
      "pointerlockchange",
      () => {
        if (document.pointerLockElement !== canvas) {
          this.mouseFire = false;
          this.mouseAim = false;
        }
      },
      options,
    );
  }

  poll() {
    if (!this.active) return;
    let pads: readonly (Gamepad | null)[] = [];
    try {
      pads = navigator.getGamepads?.() ?? [];
    } catch {
      this.resetGamepad();
      return;
    }
    const pad =
      pads.find((p) => p?.connected && p.index === this.padIndex) ??
      pads.find((p) => p?.connected) ??
      null;
    if (!pad) {
      this.resetGamepad();
      return;
    }
    if (this.padIndex !== pad.index) {
      this.resetGamepad();
      this.padIndex = pad.index;
    }
    const left = stickWithDeadzone(pad.axes[0] ?? 0, pad.axes[1] ?? 0),
      right = stickWithDeadzone(pad.axes[2] ?? 0, pad.axes[3] ?? 0);
    // Camera consumers already read gamepad.axes; expose filtered axes without mutating browser state.
    this.gamepad = {
      id: pad.id,
      index: pad.index,
      connected: pad.connected,
      mapping: pad.mapping,
      timestamp: pad.timestamp,
      buttons: pad.buttons,
      axes: [...left, ...right, ...pad.axes.slice(4)],
      vibrationActuator: pad.vibrationActuator,
    };
    this.padHeld.clear();
    this.padFire = false;
    this.padAim = false;
    for (let i = 0; i < pad.buttons.length; i++) {
      const held = pad.buttons[i].pressed || pad.buttons[i].value > 0.25;
      if (!held) this.blockedButtons.delete(i);
      if (held && !this.blockedButtons.has(i)) {
        const action = GAMEPAD_BINDINGS[i];
        if (action) {
          this.padHeld.add(action);
          if (!this.previousButtons[i]) this.padPressed.add(action);
        }
        if (i === 6) this.padAim = true;
        if (i === 7) this.padFire = true;
        const raw = GAMEPAD_RAW[i];
        if (raw && !this.previousButtons[i]) {
          this.pressed.add(raw);
          this.padRawPressed.add(raw);
        }
      }
      this.previousButtons[i] = held;
    }
    // Movement remains analog through axis(); these flags also drive the existing car brake rule.
    if (left[0] > 0.08) this.padHeld.add("right");
    if (left[0] < -0.08) this.padHeld.add("left");
    if (left[1] < -0.08) this.padHeld.add("forward");
    if (left[1] > 0.08) this.padHeld.add("back");
  }

  down(action: Action) {
    return this.keys.has(this.bindings[action]) || this.padHeld.has(action);
  }
  take(action: Action) {
    const key = this.bindings[action],
      has = this.pressed.has(key) || this.padPressed.has(action);
    this.pressed.delete(key);
    this.padPressed.delete(action);
    return has;
  }
  axis(axis: "x" | "y") {
    const key =
      axis === "x"
        ? Number(this.keys.has(this.bindings.right)) -
          Number(this.keys.has(this.bindings.left))
        : Number(this.keys.has(this.bindings.forward)) -
          Number(this.keys.has(this.bindings.back));
    const analog = this.gamepad?.axes[axis === "x" ? 0 : 1] ?? 0;
    return key || (analog === 0 ? 0 : analog * (axis === "y" ? -1 : 1));
  }
  /** Returns false for invalid/reserved keys. Existing assignments swap so every action remains usable. */
  rebind(action: Action, key: string): boolean {
    if (!ACTIONS.includes(action) || !validBindingCode(key)) return false;
    const duplicate = ACTIONS.find(
      (other) => other !== action && this.bindings[other] === key,
    );
    if (duplicate) this.bindings[duplicate] = this.bindings[action];
    this.bindings[action] = key;
    this.clear();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.bindings));
    } catch {}
    return true;
  }
  clear() {
    this.keys.clear();
    this.pressed.clear();
    this.padPressed.clear();
    this.padHeld.clear();
    this.padRawPressed.clear();
    this.mouseFire = false;
    this.mouseAim = false;
    this.padFire = false;
    this.padAim = false;
    this.dx = 0;
    this.dy = 0;
    // Opening an overlay must not re-trigger its still-held button on the following frame.
    this.previousButtons.forEach((held, index) => {
      if (held) this.blockedButtons.add(index);
    });
  }
  private resetGamepad() {
    this.gamepad = null;
    this.padIndex = null;
    this.padFire = false;
    this.padAim = false;
    this.padHeld.clear();
    this.padPressed.clear();
    for (const raw of this.padRawPressed) this.pressed.delete(raw);
    this.padRawPressed.clear();
    this.previousButtons = [];
    this.blockedButtons.clear();
  }
  endFrame() {
    // Jump is consumed by fixed-step locomotion. A render frame may contain no
    // physics step, especially on high-refresh displays or in slow motion.
    const jumpKey = this.bindings.jump;
    const keyboardJump = this.pressed.has(jumpKey);
    const padJump = this.padPressed.has("jump");
    this.pressed.clear();
    this.padPressed.clear();
    if (keyboardJump) this.pressed.add(jumpKey);
    if (padJump) this.padPressed.add("jump");
    this.padRawPressed.clear();
    this.dx = 0;
    this.dy = 0;
  }
  dispose() {
    this.events.abort();
    this.clear();
    this.resetGamepad();
  }
}
