// Input (owner: physics agent) — keyboard + Gamepad API for driving and menus.
//
// API CONTRACT (ARCHITECTURE.md §7 Input):
//   new Input()
//   input.update()                           call once per rendered frame BEFORE reading (polls gamepads)
//   input.getDriveControls() -> DriveControls
//   input.menuPressed(action) -> bool        'up'|'down'|'left'|'right'|'confirm'|'back'|'pause'
//   input.anyPressed() -> bool               any key / gamepad button went down this frame
//   input.endFrame()                         call once per rendered frame AFTER all reads (clears per-frame edges)
//   input.dispose()
//   input.lastDevice                         'keyboard' | 'gamepad' | 'touch'
//
// Additions (optional helpers):
//   input.peekDriveControls()                like getDriveControls() but never claims the drive edges
//   input.lookBack                           bool getter (non-claiming) — use this for the camera
//   input.isDown(code) / input.wasPressed(code)   raw keyboard state (KeyboardEvent.code)
//   input.menuHeld(action)                   direction/confirm currently held
//   input.rumble(strong=0.5, weak=0.5, ms=150)  gamepad vibration (no-op when unsupported)
//   input.hasGamepad                         bool
//   input.enabled                            set false to ignore all input (e.g. while a text field is focused)
//   input.enableTouch()                      create the on-screen touch controls (auto on coarse pointers,
//                                            first touch, or ?touch=1); input.touch = the TouchControls | null
//   input.setTouchMode('race'|'menu'|null)   force which touch layout shows (null = auto-detect from
//                                            window.__ssk.game each frame; Race needs no changes)
//   input.touchPress('drift'|'item')         latch a drive edge from a virtual button (used by TouchControls)
//   input.virtualMenuPress(action)           inject a menu edge ('pause', 'confirm', ...) until endFrame()
//   input.touchState                         { throttle, brake, steer, drift, item, lookBack } merged into drive
//
// Keyboard layout has NO modifier keys (Ctrl/Alt/Meta combos open bookmarks, save dialogs ...). While a race
// is running, browser shortcuts that collide with game keys (Ctrl+D, Ctrl+S, Ctrl+E, Ctrl+J, Ctrl+L, '/', "'",
// F1, F3, Alt menu focus ...) are suppressed where the browser allows it. F5 / F11 / F12 / Esc are never blocked.
//
// Edge semantics for DRIVING (driftPressed / itemPressed):
//   Race reads getDriveControls() once per 120 Hz physics step and sometimes again for the camera. To make an
//   edge fire exactly once no matter how many steps run in a rendered frame (0, 1, 2, 3...), each returned
//   DriveControls object lazily *claims* the pending edge the first time its `driftPressed` / `itemPressed`
//   property is read. The same object keeps answering consistently afterwards; later objects see `false`.
//   A read that never touches the edge fields (e.g. `getDriveControls().lookBack`) does not consume anything.
//   Unclaimed edges expire after 250 ms (so e.g. pressing Space in the pause menu never makes the kart hop).
//
// Edge semantics for MENUS: menuPressed()/anyPressed() are per-frame edges cleared by endFrame(); directions
// auto-repeat while held (keyboard OS repeat / gamepad repeat 0.38 s then every 0.11 s).

import { TouchControls, showToast } from '../ui/TouchControls.js';

const DRIVE_KEYS = {
  throttle: ['ArrowUp', 'KeyW'],
  brake: ['ArrowDown', 'KeyS'],
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  drift: ['Space', 'ShiftLeft', 'ShiftRight'],
  item: ['KeyE', 'KeyJ', 'KeyX', 'KeyL'],
  lookBack: ['KeyQ', 'KeyC'],
};
const MENU_KEYS = {
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  confirm: ['Enter', 'Space', 'NumpadEnter'],
  back: ['Escape', 'Backspace'],
  pause: ['Escape', 'KeyP'],
};
const MENU_REPEATABLE = new Set(['up', 'down', 'left', 'right']);

// Keys whose browser default action we suppress (scrolling, back-navigation, find-as-you-type ...)
const GAME_KEYS = new Set([
  ...Object.values(DRIVE_KEYS).flat(),
  ...Object.values(MENU_KEYS).flat(),
  'Tab',
]);
GAME_KEYS.delete('Escape'); // never fight the browser's Escape (fullscreen exit, dialogs)
// Keys with annoying browser defaults (quick-find, scrolling, focus hopping, back navigation) - always blocked
// outside text fields when no modifier is held.
for (const k of ['Slash', 'Quote', 'Tab', 'Backspace', 'Space', 'PageUp', 'PageDown', 'Home', 'End']) GAME_KEYS.add(k);
// Extra keys only blocked while a race is running (help / find-next / Alt menu-bar focus).
const RACE_ONLY_BLOCK = new Set(['F1', 'F3', 'AltLeft', 'AltRight', 'ContextMenu', 'MetaLeft', 'MetaRight']);
const NEVER_BLOCK = new Set(['F5', 'F11', 'F12', 'Escape']);

/** True while the player is actually driving (race running, not paused, no modal/results on top). */
function raceActive() {
  const w = typeof window !== 'undefined' ? window : null;
  const g = w?.__ssk?.game;
  if (!g) return !!w?.__ssk?.driving; // debug scenes may set this flag
  const r = g.race;
  return !!(r && g.raceRunning && !g.paused && !g.resultsShown && r.phase !== 'finished' && !g.menus?.top);
}

// Standard gamepad mapping (https://w3c.github.io/gamepad/#remapping)
const PAD = {
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  LB: 4,
  RB: 5,
  LT: 6,
  RT: 7,
  BACK: 8,
  START: 9,
  LS: 10,
  RS: 11,
  UP: 12,
  DOWN: 13,
  LEFT: 14,
  RIGHT: 15,
  HOME: 16,
};
const STICK_DEADZONE = 0.16;
const STICK_CURVE = 1.35; // response exponent (>1 = finer control near the centre)
const TRIGGER_DEADZONE = 0.08;
const TRIGGER_DIGITAL = 0.35; // RT as drift button
const MENU_STICK = 0.55;
const MENU_REPEAT_DELAY = 0.38;
const MENU_REPEAT_RATE = 0.11;
const EDGE_TTL_MS = 250;
const MAX_PADS = 4;

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function isEditable(el) {
  if (!el || el === document.body) return false;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const t = (el.type || 'text').toLowerCase();
    return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'color', 'file', 'image'].includes(t);
  }
  return !!el.isContentEditable;
}

// Enumerable own accessors (shared descriptors, no per-call closures) so that `{ ...controls }` and
// Object.assign() copy the (claimed) edge values like plain fields.
const EDGE_PROPS = {
  driftPressed: {
    enumerable: true,
    configurable: true,
    get() {
      if (this._drift === undefined) this._drift = this._input ? this._input._claim('drift') : false;
      return this._drift;
    },
    set(v) {
      this._drift = !!v;
    },
  },
  itemPressed: {
    enumerable: true,
    configurable: true,
    get() {
      if (this._item === undefined) this._item = this._input ? this._input._claim('item') : false;
      return this._item;
    },
    set(v) {
      this._item = !!v;
    },
  },
};
const HIDDEN = { writable: true, enumerable: false, configurable: true, value: undefined };

/** A DriveControls snapshot whose edge fields claim the Input's pending edge on first read. */
class DriveControls {
  constructor(input, base) {
    Object.defineProperty(this, '_input', HIDDEN);
    Object.defineProperty(this, '_drift', HIDDEN);
    Object.defineProperty(this, '_item', HIDDEN);
    this._input = input;
    this.throttle = base.throttle;
    this.brake = base.brake;
    this.steer = base.steer;
    this.drift = base.drift;
    Object.defineProperties(this, EDGE_PROPS);
    this.item = base.item;
    this.lookBack = base.lookBack;
  }
  toJSON() {
    return {
      throttle: this.throttle,
      brake: this.brake,
      steer: this.steer,
      drift: this.drift,
      driftPressed: this._drift ?? null,
      item: this.item,
      itemPressed: this._item ?? null,
      lookBack: this.lookBack,
    };
  }
}

export class Input {
  constructor() {
    this.enabled = true;
    this.lastDevice = 'keyboard';
    this.hasGamepad = false;

    // keyboard
    this.down = new Set(); // codes currently held
    this.pressed = new Set(); // codes that went down this frame (non-repeat)
    this._menuRepeat = new Set(); // codes that auto-repeated this frame (for menu directions)
    this._steerOrder = 0; // last pressed steering direction wins: -1 / +1
    this._leftAt = 0;
    this._rightAt = 0;

    // pending drive edges (latched until claimed or expired)
    this._edge = { drift: 0, item: 0 }; // timestamp of the pending press (0 = none)

    // gamepad state (merged over all pads)
    this._pad = {
      throttle: 0,
      brake: 0,
      steer: 0,
      drift: false,
      item: false,
      lookBack: false,
      menu: { up: false, down: false, left: false, right: false, confirm: false, back: false, pause: false },
    };
    this._padPrev = []; // per pad index: array of previous pressed booleans
    this._padMenuPressed = new Set(); // menu actions pressed this frame via gamepad
    this._padAnyPressed = false;
    this._menuRepeatTimer = { up: 0, down: 0, left: 0, right: 0 };
    this._menuHeldPrev = { up: false, down: false, left: false, right: false };
    this._lastUpdate = now();
    this._rumblePads = [];

    this._onDown = (e) => {
      if (!this.enabled) return;
      const code = e.code || e.key;
      if (isEditable(e.target)) return;
      if (!NEVER_BLOCK.has(code)) {
        const mod = e.ctrlKey || e.metaKey || e.altKey;
        if (GAME_KEYS.has(code)) {
          // plain game key: always; with a modifier only mid-race (Ctrl+D bookmark, Ctrl+S save, Ctrl+E search...)
          if (!mod || raceActive()) e.preventDefault();
        } else if (RACE_ONLY_BLOCK.has(code) && raceActive()) e.preventDefault();
      }
      this._setDevice('keyboard');
      if (e.repeat) {
        this._menuRepeat.add(code);
        return;
      }
      if (!this.down.has(code)) {
        this.pressed.add(code);
        const t = now();
        if (DRIVE_KEYS.drift.includes(code)) this._edge.drift = t;
        if (DRIVE_KEYS.item.includes(code)) this._edge.item = t;
        if (DRIVE_KEYS.left.includes(code)) this._leftAt = t;
        if (DRIVE_KEYS.right.includes(code)) this._rightAt = t;
      }
      this.down.add(code);
    };
    this._onUp = (e) => {
      const code = e.code || e.key;
      // releasing Alt alone focuses the browser menu bar in some browsers - not mid-race
      if ((code === 'AltLeft' || code === 'AltRight') && raceActive() && !isEditable(e.target)) e.preventDefault();
      this.down.delete(code);
      // modifier-combo safety: releasing Meta on macOS swallows other keyups
      if (code === 'MetaLeft' || code === 'MetaRight') this.down.clear();
    };
    this._onBlur = () => this._releaseAll();
    this._onVisibility = () => {
      if (document.hidden) this._releaseAll();
    };
    this._padIds = new Map(); // pad.index -> pad.id (hot-plug tracking for the toast)
    this._onPadConnect = () => {
      const pads = this._connectedPads();
      this.hasGamepad = pads.length > 0;
      this._checkPads(pads);
    };

    // touch / virtual controls
    this.touch = null;
    this._touchMode = null; // forced touch layout, null = auto
    this.touchState = { throttle: 0, brake: 0, steer: 0, drift: false, item: false, lookBack: false };
    this._virtMenu = new Set(); // injected menu edges (cleared in endFrame)
    this._virtAny = false;
    this._lastVibrate = 0;
    this._onFirstTouch = (e) => {
      if (e.pointerType && e.pointerType !== 'touch') return;
      if (!this.touch) this.enableTouch();
      this._setDevice('touch');
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this._onDown, { passive: false });
      window.addEventListener('keyup', this._onUp);
      window.addEventListener('blur', this._onBlur);
      window.addEventListener('gamepadconnected', this._onPadConnect);
      window.addEventListener('gamepaddisconnected', this._onPadConnect);
      document.addEventListener('visibilitychange', this._onVisibility);
      window.addEventListener('pointerdown', this._onFirstTouch, { passive: true, capture: true });
      window.addEventListener('touchstart', this._onFirstTouch, { passive: true, capture: true });
      let forced = false;
      let coarse = false;
      try {
        forced = new URLSearchParams(window.location.search).get('touch') === '1';
        coarse = !!window.matchMedia?.('(pointer: coarse)').matches && !window.matchMedia?.('(any-pointer: fine)').matches;
      } catch {
        /* ignore */
      }
      if (forced || coarse) {
        this.enableTouch();
        this._setDevice('touch');
      }
    }
  }

  /** Switch the active device ('keyboard' | 'gamepad' | 'touch'); on-screen controls hide for keyboard/pad. */
  _setDevice(dev) {
    if (this.lastDevice === dev) return;
    this.lastDevice = dev;
    this.touch?.setVisible?.(dev === 'touch');
  }

  /** Create the on-screen touch controls (idempotent). */
  enableTouch() {
    if (this.touch || typeof document === 'undefined') return this.touch;
    try {
      this.touch = new TouchControls(this);
      this.touch.setVisible(this.lastDevice === 'touch');
    } catch (err) {
      console.error('[Input] touch controls failed', err);
      this.touch = null;
    }
    return this.touch;
  }

  setTouchMode(mode) {
    this._touchMode = mode || null;
  }

  /** Latch a drive edge from an on-screen button. */
  touchPress(kind) {
    if (kind in this._edge) this._edge[kind] = now();
    this._virtAny = true;
    this._setDevice('touch');
  }

  /** Inject a one-frame menu edge (e.g. the on-screen pause button). */
  virtualMenuPress(action) {
    this._virtMenu.add(action);
    this._virtAny = true;
  }

  /** Hot-plug tracking: toast + device switch when a pad appears / disappears. */
  _checkPads(pads) {
    const seen = new Set();
    for (const pad of pads) {
      seen.add(pad.index);
      if (this._padIds.get(pad.index) !== pad.id) {
        this._padIds.set(pad.index, pad.id);
        this._padPrev[pad.index] = [];
        this._setDevice('gamepad');
        const name = String(pad.id || '').replace(/\s*\(.*$/, '').slice(0, 40);
        showToast('Controller connected', `${name || 'Gamepad'}${pad.mapping === 'standard' ? '' : ' - non-standard layout'}`, 'pad');
      }
    }
    for (const idx of [...this._padIds.keys()]) {
      if (!seen.has(idx)) {
        this._padIds.delete(idx);
        this._padPrev[idx] = [];
        showToast('Controller disconnected', '', 'pad-off');
        if (this.lastDevice === 'gamepad' && seen.size === 0) this._setDevice(this.touch ? 'touch' : 'keyboard');
      }
    }
  }

  _releaseAll() {
    this.down.clear();
    this.pressed.clear();
    this._menuRepeat.clear();
    this._edge.drift = 0;
    this._edge.item = 0;
  }

  // -------------------------------------------------------------------------------------------
  // Gamepad polling
  // -------------------------------------------------------------------------------------------

  _connectedPads() {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return [];
    let pads;
    try {
      pads = navigator.getGamepads();
    } catch {
      return [];
    }
    const out = [];
    for (let i = 0; i < Math.min(pads.length, MAX_PADS); i++) if (pads[i] && pads[i].connected !== false) out.push(pads[i]);
    return out;
  }

  /** Poll gamepads (call once per rendered frame before reading). */
  update() {
    const t = now();
    const dt = Math.min(0.1, Math.max(0, (t - this._lastUpdate) / 1000));
    this._lastUpdate = t;
    const P = this._pad;
    P.throttle = 0;
    P.brake = 0;
    P.steer = 0;
    P.drift = false;
    P.item = false;
    P.lookBack = false;
    const M = P.menu;
    for (const k in M) M[k] = false;
    this._padMenuPressed.clear();
    this._padAnyPressed = false;
    if (!this.enabled) return;

    const pads = this._connectedPads();
    this.hasGamepad = pads.length > 0;
    this._rumblePads = pads;
    if (pads.length !== this._padIds.size || pads.some((p) => this._padIds.get(p.index) !== p.id)) this._checkPads(pads);
    let steerBest = 0;
    for (const pad of pads) {
      const b = pad.buttons || [];
      const ax = pad.axes || [];
      const prev = this._padPrev[pad.index] || (this._padPrev[pad.index] = []);
      const btn = (i) => {
        const x = b[i];
        if (!x) return false;
        return typeof x === 'object' ? x.pressed || x.value > 0.5 : x > 0.5;
      };
      const val = (i) => {
        const x = b[i];
        if (!x) return 0;
        return typeof x === 'object' ? x.value ?? (x.pressed ? 1 : 0) : x;
      };
      // edges for every button
      let anyNew = false;
      for (let i = 0; i < b.length; i++) {
        const p = btn(i);
        if (p && !prev[i]) {
          anyNew = true;
          if (i === PAD.RB || i === PAD.RT) this._edge.drift = t;
          if (i === PAD.X || i === PAD.LB) this._edge.item = t;
          if (i === PAD.A) this._padMenuPressed.add('confirm');
          if (i === PAD.B) this._padMenuPressed.add('back');
          if (i === PAD.START) this._padMenuPressed.add('pause');
        }
        prev[i] = p;
      }
      // RT as an analog trigger: treat the digital threshold crossing as the edge too (some pads never set .pressed)
      const rt = val(PAD.RT);
      const rtDown = rt > TRIGGER_DIGITAL;
      if (rtDown && !prev.rtDigital) this._edge.drift = t;
      prev.rtDigital = rtDown;

      // left stick with radial deadzone + response curve
      let sx = ax[0] || 0;
      let sy = ax[1] || 0;
      const mag = Math.hypot(sx, sy);
      if (mag < STICK_DEADZONE) {
        sx = 0;
        sy = 0;
      } else {
        const m = Math.min(1, (mag - STICK_DEADZONE) / (1 - STICK_DEADZONE));
        const curved = Math.pow(m, STICK_CURVE);
        sx = (sx / mag) * curved;
        sy = (sy / mag) * curved;
      }
      let steer = sx;
      if (btn(PAD.LEFT)) steer = -1;
      if (btn(PAD.RIGHT)) steer = 1;
      if (Math.abs(steer) > Math.abs(steerBest)) steerBest = steer;

      const lt = val(PAD.LT);
      P.throttle = Math.max(P.throttle, btn(PAD.A) ? 1 : 0);
      P.brake = Math.max(P.brake, btn(PAD.B) ? 1 : 0, lt > TRIGGER_DEADZONE ? Math.min(1, (lt - TRIGGER_DEADZONE) / (1 - TRIGGER_DEADZONE)) : 0);
      P.drift = P.drift || btn(PAD.RB) || rtDown;
      P.item = P.item || btn(PAD.X) || btn(PAD.LB);
      P.lookBack = P.lookBack || btn(PAD.Y);

      // menu directions (d-pad or stick)
      const rawX = ax[0] || 0;
      const rawY = ax[1] || 0;
      M.up = M.up || btn(PAD.UP) || rawY < -MENU_STICK;
      M.down = M.down || btn(PAD.DOWN) || rawY > MENU_STICK;
      M.left = M.left || btn(PAD.LEFT) || rawX < -MENU_STICK;
      M.right = M.right || btn(PAD.RIGHT) || rawX > MENU_STICK;
      M.confirm = M.confirm || btn(PAD.A);
      M.back = M.back || btn(PAD.B);
      M.pause = M.pause || btn(PAD.START);

      if (anyNew || mag > 0.5 || lt > 0.5 || rt > 0.5) {
        if (anyNew) this._padAnyPressed = true;
        this._setDevice('gamepad');
      }
    }
    P.steer = steerBest;

    // on-screen controls: layout + per-frame state
    if (this.touch) {
      try {
        this.touch.frame(dt, this._touchMode);
      } catch (err) {
        console.error('[Input] touch frame failed', err);
      }
    }

    // gamepad menu direction edges + auto-repeat
    for (const dir of MENU_REPEATABLE) {
      const held = M[dir];
      if (held && !this._menuHeldPrev[dir]) {
        this._padMenuPressed.add(dir);
        this._menuRepeatTimer[dir] = MENU_REPEAT_DELAY;
      } else if (held) {
        this._menuRepeatTimer[dir] -= dt;
        if (this._menuRepeatTimer[dir] <= 0) {
          this._padMenuPressed.add(dir);
          this._menuRepeatTimer[dir] += MENU_REPEAT_RATE;
        }
      }
      this._menuHeldPrev[dir] = held;
    }
  }

  // -------------------------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------------------------

  _any(codes, set = this.down) {
    for (let i = 0; i < codes.length; i++) if (set.has(codes[i])) return true;
    return false;
  }

  /** Claim a pending drive edge ('drift' | 'item'). Returns true exactly once per press. */
  _claim(kind) {
    const t = this._edge[kind];
    if (!t) return false;
    this._edge[kind] = 0;
    return now() - t <= EDGE_TTL_MS;
  }

  _baseControls() {
    const kbLeft = this._any(DRIVE_KEYS.left);
    const kbRight = this._any(DRIVE_KEYS.right);
    let kbSteer = 0;
    if (kbLeft && kbRight) kbSteer = this._rightAt >= this._leftAt ? 1 : -1; // last pressed wins
    else if (kbLeft) kbSteer = -1;
    else if (kbRight) kbSteer = 1;
    const P = this._pad;
    const T = this.touchState;
    let steer = Math.abs(P.steer) > Math.abs(kbSteer) ? P.steer : kbSteer;
    if (Math.abs(T.steer) > Math.abs(steer)) steer = T.steer;
    return {
      throttle: Math.max(this._any(DRIVE_KEYS.throttle) ? 1 : 0, P.throttle, T.throttle),
      brake: Math.max(this._any(DRIVE_KEYS.brake) ? 1 : 0, P.brake, T.brake),
      steer: Math.max(-1, Math.min(1, steer)),
      drift: this._any(DRIVE_KEYS.drift) || P.drift || T.drift,
      item: this._any(DRIVE_KEYS.item) || P.item || T.item,
      lookBack: this._any(DRIVE_KEYS.lookBack) || P.lookBack || T.lookBack,
    };
  }

  /** DriveControls for the player (see the edge semantics at the top of this file). */
  getDriveControls() {
    if (!this.enabled) return new DriveControls(null, { throttle: 0, brake: 0, steer: 0, drift: false, item: false, lookBack: false });
    return new DriveControls(this, this._baseControls());
  }

  /** Same as getDriveControls() but the edge fields are plain values that never claim the pending edge. */
  peekDriveControls() {
    const c = new DriveControls(null, this._baseControls());
    c.driftPressed = !!this._edge.drift;
    c.itemPressed = !!this._edge.item;
    return c;
  }

  get lookBack() {
    return this.enabled && (this._any(DRIVE_KEYS.lookBack) || this._pad.lookBack || this.touchState.lookBack);
  }

  isDown(code) {
    return this.down.has(code);
  }

  wasPressed(code) {
    return this.pressed.has(code);
  }

  menuPressed(action) {
    if (!this.enabled) return false;
    const codes = MENU_KEYS[action];
    if (!codes) return false;
    if (this._any(codes, this.pressed)) return true;
    if (MENU_REPEATABLE.has(action) && this._any(codes, this._menuRepeat)) return true;
    return this._padMenuPressed.has(action) || this._virtMenu.has(action);
  }

  menuHeld(action) {
    if (!this.enabled) return false;
    const codes = MENU_KEYS[action];
    if (!codes) return false;
    return this._any(codes) || !!this._pad.menu[action];
  }

  anyPressed() {
    if (!this.enabled) return false;
    return this.pressed.size > 0 || this._padAnyPressed || this._virtAny;
  }

  endFrame() {
    this.pressed.clear();
    this._menuRepeat.clear();
    this._padMenuPressed.clear();
    this._padAnyPressed = false;
    this._virtMenu.clear();
    this._virtAny = false;
    // expire stale drive edges nobody claimed
    const t = now();
    if (this._edge.drift && t - this._edge.drift > EDGE_TTL_MS) this._edge.drift = 0;
    if (this._edge.item && t - this._edge.item > EDGE_TTL_MS) this._edge.item = 0;
  }

  /** Gamepad rumble (dual-rumble effect) on every connected pad. Safe no-op when unsupported. */
  rumble(strong = 0.5, weak = 0.5, ms = 150) {
    if (this.lastDevice === 'touch') {
      // phones: only the bigger hits, throttled (navigator.vibrate is all-or-nothing)
      const t = now();
      if (strong >= 0.45 && t - this._lastVibrate > 350 && this.touch?.opts?.haptics !== false) {
        this._lastVibrate = t;
        try {
          navigator.vibrate?.(Math.min(300, ms));
        } catch {
          /* unsupported */
        }
      }
      return;
    }
    if (this.lastDevice !== 'gamepad') return;
    for (const pad of this._rumblePads) {
      try {
        pad.vibrationActuator?.playEffect?.('dual-rumble', {
          duration: ms,
          strongMagnitude: Math.max(0, Math.min(1, strong)),
          weakMagnitude: Math.max(0, Math.min(1, weak)),
        })?.catch?.(() => {});
      } catch {
        /* unsupported */
      }
    }
  }

  dispose() {
    if (typeof window === 'undefined') return;
    window.removeEventListener('keydown', this._onDown);
    window.removeEventListener('keyup', this._onUp);
    window.removeEventListener('blur', this._onBlur);
    window.removeEventListener('gamepadconnected', this._onPadConnect);
    window.removeEventListener('gamepaddisconnected', this._onPadConnect);
    document.removeEventListener('visibilitychange', this._onVisibility);
    window.removeEventListener('pointerdown', this._onFirstTouch, { capture: true });
    window.removeEventListener('touchstart', this._onFirstTouch, { capture: true });
    this.touch?.dispose?.();
    this.touch = null;
    this._releaseAll();
  }
}

export default Input;
