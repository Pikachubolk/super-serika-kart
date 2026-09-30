// TouchControls (owner: controls agent) — on-screen controls for phones / tablets, plus the small toast helper.
//
// Created by Input (src/core/Input.js) when a coarse pointer / first touch is detected, or with ?touch=1.
// Buttons write into input.touchState and latch drive edges via input.touchPress(), so Race / Kart need no
// changes. Menus already work with taps (click events); in menus this layer only shows a fullscreen button and
// a rotate-to-landscape hint on portrait phones.
//
// API:
//   new TouchControls(input)
//   tc.frame(dt, forcedMode)       called by Input.update() every rendered frame; forcedMode 'race'|'menu'|null
//   tc.setVisible(bool)            hidden while keyboard / gamepad is the active device
//   tc.mode                        'race' | 'menu'
//   tc.opts                        { autoAccel, steer: 'stick'|'pads'|'tilt', haptics }  (localStorage 'ssk.touch')
//   tc.dispose()
//   showToast(title, sub?, kind?)  small top-centre toast in #overlay (used for "Controller connected")
//
// Race layout (landscape): left = steering (floating joystick, big ◀ ▶ pads, or tilt), right = DRIFT (hold),
// ITEM, BRAKE, LOOK-back (+ GAS when auto-accelerate is off), top-centre = pause + AUTO / STEER toggles.
// Auto-accelerate engages at GO (so touch players never stall at the start); braking with auto-accelerate on
// cuts the gas so the kart can reverse.

import '../styles/touch.css';

const LS_KEY = 'ssk.touch';
const STICK_RADIUS = 56; // px of thumb travel for full lock
const STICK_DEADZONE = 0.1;
const TILT_MAX_DEG = 28; // device roll for full lock
const STEER_MODES = ['stick', 'pads', 'tilt'];
const STEER_LABEL = { stick: 'STICK', pads: 'PADS', tilt: 'TILT' };

const ICON = {
  pause: '<svg viewBox="0 0 24 24"><rect x="6" y="4" width="4.2" height="16" rx="1.4"/><rect x="13.8" y="4" width="4.2" height="16" rx="1.4"/></svg>',
  full: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
  unfull: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>',
  left: '<svg viewBox="0 0 24 24"><path d="M15.5 4 6.5 12l9 8z"/></svg>',
  right: '<svg viewBox="0 0 24 24"><path d="M8.5 4l9 8-9 8z"/></svg>',
  look: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>',
  rotate: '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><rect x="20" y="6" width="24" height="40" rx="4"/><path d="M50 30a20 20 0 0 1-8 22M42 52l1 -7M42 52l-7-1"/></svg>',
};

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function loadOpts() {
  const def = { autoAccel: true, steer: 'stick', haptics: true };
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    if (raw && typeof raw === 'object') {
      if (typeof raw.autoAccel === 'boolean') def.autoAccel = raw.autoAccel;
      if (STEER_MODES.includes(raw.steer) && raw.steer !== 'tilt') def.steer = raw.steer; // tilt needs a gesture to re-enable
      if (typeof raw.haptics === 'boolean') def.haptics = raw.haptics;
    }
  } catch {
    /* private mode */
  }
  return def;
}

function overlayRoot() {
  return document.getElementById('overlay') || document.body;
}

// ------------------------------------------------------------------------------------------------ toast

let toastWrap = null;
/** Small non-blocking toast at the top of the screen (auto-dismisses). */
export function showToast(title, sub = '', kind = '') {
  if (typeof document === 'undefined') return;
  try {
    if (!toastWrap || !toastWrap.isConnected) {
      toastWrap = document.createElement('div');
      toastWrap.className = 'tc-toasts';
      overlayRoot().appendChild(toastWrap);
    }
    const t = document.createElement('div');
    t.className = `tc-toast${kind ? ' tc-toast-' + kind : ''}`;
    const padIco =
      kind === 'pad' || kind === 'pad-off'
        ? '<svg class="tc-toast-ico" viewBox="0 0 32 24"><path d="M9 3h14c4.4 0 7.4 3.7 8 9l.8 6.2c.4 3.4-3.8 5-5.9 2.3L23 17H9l-2.9 3.5C4 23.2-.2 21.6.2 18.2L1 12C1.6 6.7 4.6 3 9 3z" fill="currentColor"/><path d="M7 8v6M4 11h6" stroke="#16213a" stroke-width="2" stroke-linecap="round"/><circle cx="23" cy="9" r="1.6" fill="#16213a"/><circle cx="26" cy="12" r="1.6" fill="#16213a"/></svg>'
        : '';
    t.innerHTML = `${padIco}<div><b></b><small></small></div>`;
    t.querySelector('b').textContent = title;
    t.querySelector('small').textContent = sub || '';
    if (!sub) t.querySelector('small').remove();
    toastWrap.appendChild(t);
    while (toastWrap.childElementCount > 3) toastWrap.firstElementChild.remove();
    setTimeout(() => t.classList.add('is-out'), 2600);
    setTimeout(() => t.remove(), 3100);
  } catch {
    /* never break input over a toast */
  }
}

// ------------------------------------------------------------------------------------------------ controls

export class TouchControls {
  constructor(input) {
    this.input = input;
    this.opts = loadOpts();
    this.mode = 'menu';
    this.visible = false;
    this._phase = '';
    this._held = { brake: false, gas: false, drift: false, item: false, lookBack: false, left: false, right: false };
    this._stick = { id: null, ox: 0, oy: 0, x: 0 };
    this._tilt = { value: 0, neutral: 0, have: false };
    this._listeners = [];

    const root = (this.root = document.createElement('div'));
    root.className = 'tc-root tc-hidden';
    root.dataset.mode = 'menu';
    root.innerHTML = `
      <div class="tc-race">
        <div class="tc-steer-zone" data-steer="${this.opts.steer}">
          <div class="tc-stick"><div class="tc-stick-ring"></div><div class="tc-stick-knob"></div></div>
          <div class="tc-pads">
            <div class="tc-pad" data-act="left">${ICON.left}</div>
            <div class="tc-pad" data-act="right">${ICON.right}</div>
          </div>
          <div class="tc-tilt"><div class="tc-tilt-bar"><i></i></div><span>TILT TO STEER · tap to re-centre</span></div>
        </div>
        <div class="tc-btns">
          <div class="tc-btn tc-item" data-act="item"><span>ITEM</span></div>
          <div class="tc-btn tc-drift" data-act="drift"><span>DRIFT</span><small>hold</small></div>
          <div class="tc-btn tc-brake" data-act="brake"><span>BRAKE</span></div>
          <div class="tc-btn tc-gas" data-act="gas"><span>GAS</span></div>
          <div class="tc-btn tc-look" data-act="lookBack" title="Look back">${ICON.look}</div>
        </div>
        <div class="tc-top">
          <div class="tc-chip" data-opt="auto"></div>
          <div class="tc-pause" data-act="pause" aria-label="Pause">${ICON.pause}</div>
          <div class="tc-chip" data-opt="steer"></div>
        </div>
      </div>
      <div class="tc-menu">
        <div class="tc-fs" aria-label="Fullscreen">${ICON.full}</div>
      </div>
      <div class="tc-rotate"><div>${ICON.rotate}<b>Rotate your phone</b><small>Super Serika Kart plays best in landscape</small><span class="tc-rotate-skip">Continue anyway</span></div></div>`;
    overlayRoot().appendChild(root);

    this._stickEl = root.querySelector('.tc-stick');
    this._knobEl = root.querySelector('.tc-stick-knob');
    this._zoneEl = root.querySelector('.tc-steer-zone');
    this._tiltBar = root.querySelector('.tc-tilt-bar i');
    this._autoChip = root.querySelector('[data-opt="auto"]');
    this._steerChip = root.querySelector('[data-opt="steer"]');
    this._fsBtn = root.querySelector('.tc-fs');
    this._refreshChips();

    // --- hold buttons (multi-touch: every pointer is captured by the element it started on)
    for (const btn of root.querySelectorAll('.tc-btn, .tc-pad')) this._bindHold(btn, btn.dataset.act);

    // --- pause / toggles / fullscreen / rotate hint (tap)
    this._tap(root.querySelector('.tc-pause'), () => this.input.virtualMenuPress('pause'));
    this._tap(this._autoChip, () => {
      this.opts.autoAccel = !this.opts.autoAccel;
      this._save();
      this._refreshChips();
    });
    this._tap(this._steerChip, () => this._cycleSteer());
    this._tap(this._fsBtn, () => this._toggleFullscreen());
    this._tap(root.querySelector('.tc-rotate'), () => root.classList.add('tc-rotate-dismissed'));

    // --- joystick / tilt zone
    const zone = this._zoneEl;
    this._on(zone, 'pointerdown', (e) => this._stickDown(e));
    this._on(zone, 'pointermove', (e) => this._stickMove(e));
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) this._on(zone, ev, (e) => this._stickUp(e));

    // no scrolling / pinch-zoom / long-press menus over the controls
    this._on(root, 'touchstart', (e) => e.cancelable && e.target.closest?.('.tc-race, .tc-fs') && e.preventDefault(), { passive: false });
    this._on(root, 'contextmenu', (e) => e.preventDefault());
    this._on(document, 'gesturestart', (e) => e.preventDefault(), { passive: false });
    this._on(document, 'fullscreenchange', () => this._refreshFs());

    this._onMotion = (e) => this._motion(e);
    if (this.opts.steer === 'tilt') this._enableTilt();
    this._refreshFs();
  }

  // ---------------------------------------------------------------------------------------------- helpers

  _on(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    this._listeners.push([target, type, fn, opts]);
  }

  _tap(el, fn) {
    if (!el) return;
    this._on(el, 'pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._buzz(8);
      this.input._setDevice?.('touch');
      fn(e);
    });
  }

  _buzz(ms) {
    if (!this.opts.haptics) return;
    try {
      navigator.vibrate?.(ms);
    } catch {
      /* unsupported */
    }
  }

  _save() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(this.opts));
    } catch {
      /* private mode */
    }
  }

  _refreshChips() {
    this._autoChip.innerHTML = `<small>AUTO GAS</small>${this.opts.autoAccel ? 'ON' : 'OFF'}`;
    this._autoChip.classList.toggle('is-on', this.opts.autoAccel);
    this._steerChip.innerHTML = `<small>STEER</small>${STEER_LABEL[this.opts.steer]}`;
    this.root.classList.toggle('tc-auto', this.opts.autoAccel);
    this._zoneEl.dataset.steer = this.opts.steer;
  }

  _refreshFs() {
    const can = !!(document.fullscreenEnabled || document.documentElement.webkitRequestFullscreen);
    this._fsBtn.classList.toggle('tc-hidden', !can);
    this._fsBtn.innerHTML = document.fullscreenElement ? ICON.unfull : ICON.full;
  }

  /** Fullscreen + landscape lock (phones). Must run inside a tap handler; silently ignored elsewhere. */
  enterFullscreen() {
    if (document.fullscreenElement || document.webkitFullscreenElement) return;
    this._toggleFullscreen();
  }

  _toggleFullscreen() {
    const de = document.documentElement;
    try {
      if (document.fullscreenElement) document.exitFullscreen?.();
      else {
        const p = (de.requestFullscreen || de.webkitRequestFullscreen)?.call(de, { navigationUI: 'hide' });
        p?.then?.(() => screen.orientation?.lock?.('landscape').catch(() => {}))?.catch?.(() => {});
      }
    } catch {
      /* not allowed */
    }
  }

  _cycleSteer() {
    const i = STEER_MODES.indexOf(this.opts.steer);
    this.opts.steer = STEER_MODES[(i + 1) % STEER_MODES.length];
    if (this.opts.steer === 'tilt') this._enableTilt();
    else this._disableTilt();
    this._save();
    this._refreshChips();
  }

  _enableTilt() {
    const start = () => {
      window.addEventListener('devicemotion', this._onMotion);
      this._tilt.have = false;
      this._tilt.neutral = 0;
    };
    try {
      // iOS 13+: permission must be requested from a user gesture (we are inside a pointerdown here)
      if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
        DeviceMotionEvent.requestPermission()
          .then((r) => (r === 'granted' ? start() : showToast('Tilt steering unavailable', 'Motion access was denied')))
          .catch(() => showToast('Tilt steering unavailable', 'Tap STEER again from a race'));
      } else start();
    } catch {
      /* unsupported */
    }
  }

  _disableTilt() {
    window.removeEventListener('devicemotion', this._onMotion);
    this._tilt.value = 0;
  }

  /** Roll of the device around the screen normal, from gravity, in screen space (degrees, + = rolled right). */
  _motion(e) {
    const g = e.accelerationIncludingGravity;
    if (!g || g.x == null) return;
    const ang = (((screen.orientation?.angle ?? window.orientation ?? 0) % 360) + 360) % 360;
    const a = (ang * Math.PI) / 180;
    // device -> screen axes
    // (angle 90 = device turned counter-clockwise: screen right = device -y, screen up = device +x)
    const sx = g.x * Math.cos(a) - g.y * Math.sin(a);
    const sy = g.x * Math.sin(a) + g.y * Math.cos(a);
    // gravity reaction points "up" the screen at rest (some older iOS builds report it inverted, hence the sign
    // taken at calibration); rolling the phone clockwise (steer right) swings it towards screen-left
    if (!this._tilt.have) this._tilt.sign = sy < 0 ? -1 : 1;
    const sg = this._tilt.sign || 1;
    const roll = (Math.atan2(-sx * sg, Math.abs(sy) + 1e-3) * 180) / Math.PI;
    if (!this._tilt.have) {
      this._tilt.have = true;
      this._tilt.neutral = clamp(roll, -15, 15);
    }
    this._tilt.raw = roll;
    this._tilt.value = clamp((roll - this._tilt.neutral) / TILT_MAX_DEG, -1, 1);
  }

  _bindHold(el, act) {
    const pointers = new Set();
    const set = (on) => {
      const was = this._held[act];
      this._held[act] = on;
      el.classList.toggle('is-down', on);
      if (on && !was) {
        this._buzz(act === 'item' ? 14 : 8);
        if (act === 'drift') this.input.touchPress('drift');
        else if (act === 'item') this.input.touchPress('item');
        else this.input._setDevice?.('touch');
        if (this.mode === 'race' && this._phase === 'intro') this.input.virtualMenuPress('confirm');
      }
    };
    this._on(el, 'pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* synthetic events */
      }
      pointers.add(e.pointerId);
      set(true);
    });
    const up = (e) => {
      pointers.delete(e.pointerId);
      if (!pointers.size) set(false);
    };
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) this._on(el, ev, up);
    el._tcRelease = () => {
      pointers.clear();
      set(false);
    };
  }

  _stickDown(e) {
    if (e.target.closest('.tc-pad')) return;
    e.preventDefault();
    this.input._setDevice?.('touch');
    if (this.mode === 'race' && this._phase === 'intro') this.input.virtualMenuPress('confirm');
    if (this.opts.steer === 'tilt') {
      // tap = re-centre tilt
      this._tilt.have = false;
      this._buzz(10);
      return;
    }
    if (this.opts.steer !== 'stick' || this._stick.id !== null) return;
    const r = this._zoneEl.getBoundingClientRect();
    this._stick.id = e.pointerId;
    this._stick.ox = e.clientX - r.left;
    this._stick.oy = e.clientY - r.top;
    this._stick.x = 0;
    try {
      this._zoneEl.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic */
    }
    this._stickEl.style.left = `${this._stick.ox}px`;
    this._stickEl.style.top = `${this._stick.oy}px`;
    this._stickEl.classList.add('is-active');
    this._knobEl.style.transform = 'translate(-50%, -50%)';
  }

  _stickMove(e) {
    if (e.pointerId !== this._stick.id) return;
    const r = this._zoneEl.getBoundingClientRect();
    let dx = e.clientX - r.left - this._stick.ox;
    let dy = e.clientY - r.top - this._stick.oy;
    // drag the base along when the thumb slides past the ring (no dead "wall" at the edge)
    const over = Math.abs(dx) - STICK_RADIUS * 1.25;
    if (over > 0) {
      this._stick.ox += Math.sign(dx) * over;
      dx -= Math.sign(dx) * over;
      this._stickEl.style.left = `${this._stick.ox}px`;
    }
    dy = clamp(dy, -STICK_RADIUS * 0.6, STICK_RADIUS * 0.6);
    const kx = clamp(dx, -STICK_RADIUS, STICK_RADIUS);
    this._stick.x = kx / STICK_RADIUS;
    this._knobEl.style.transform = `translate(calc(-50% + ${kx}px), calc(-50% + ${dy}px))`;
  }

  _stickUp(e) {
    if (e.pointerId !== this._stick.id) return;
    this._stick.id = null;
    this._stick.x = 0;
    this._stickEl.classList.remove('is-active');
    this._stickEl.style.left = '';
    this._stickEl.style.top = '';
    this._knobEl.style.transform = 'translate(-50%, -50%)';
  }

  _releaseAll() {
    for (const el of this.root.querySelectorAll('.tc-btn, .tc-pad')) el._tcRelease?.();
    if (this._stick.id !== null) this._stickUp({ pointerId: this._stick.id });
    const S = this.input.touchState;
    S.throttle = 0;
    S.brake = 0;
    S.steer = 0;
    S.drift = false;
    S.item = false;
    S.lookBack = false;
  }

  // ---------------------------------------------------------------------------------------------- public

  setVisible(v) {
    v = !!v;
    if (v === this.visible) return;
    this.visible = v;
    this.root.classList.toggle('tc-hidden', !v);
    if (!v) this._releaseAll();
    this._syncDocClasses();
  }

  /** <html> classes other stylesheets can key off: ssk-touch (touch UI active), ssk-touch-race (driving pads shown). */
  _syncDocClasses() {
    const de = document.documentElement;
    de.classList.toggle('ssk-touch', this.visible);
    de.classList.toggle('ssk-touch-race', this.visible && this.mode === 'race');
  }

  _detectMode() {
    const g = window.__ssk?.game;
    const r = g?.race;
    this._phase = r?.phase || '';
    if (!g || !r) return 'menu';
    const driving = g.raceRunning && !g.paused && !g.resultsShown && !g._starting && !g.menus?.top;
    return driving && (r.phase === 'intro' || r.phase === 'countdown' || r.phase === 'racing') ? 'race' : 'menu';
  }

  /** Called by Input.update() every rendered frame. */
  frame(dt, forced) {
    const mode = forced || this._detectMode();
    if (mode !== this.mode) {
      this.mode = mode;
      this.root.dataset.mode = mode;
      if (mode !== 'race') this._releaseAll();
      this._syncDocClasses();
    }
    if (forced === 'race' && !this._phase) this._phase = 'racing';
    const S = this.input.touchState;
    if (!this.visible || mode !== 'race') {
      if (S.throttle || S.steer || S.brake || S.drift || S.item || S.lookBack) this._releaseAll();
      return;
    }
    const H = this._held;
    let steer = 0;
    if (this.opts.steer === 'stick') {
      const x = this._stick.x;
      const m = Math.abs(x);
      steer = m < STICK_DEADZONE ? 0 : Math.sign(x) * Math.pow((m - STICK_DEADZONE) / (1 - STICK_DEADZONE), 1.2);
    } else if (this.opts.steer === 'pads') {
      steer = (H.right ? 1 : 0) - (H.left ? 1 : 0);
    } else {
      steer = this._tilt.value || 0;
      if (Math.abs(steer) < 0.06) steer = 0;
      if (this._tiltBar) this._tiltBar.style.transform = `translateX(${(steer * 50).toFixed(1)}%)`;
    }
    const racing = this._phase === 'racing';
    const auto = this.opts.autoAccel && racing && !H.brake;
    S.throttle = H.gas || auto ? 1 : 0;
    S.brake = H.brake ? 1 : 0;
    S.steer = clamp(steer, -1, 1);
    S.drift = H.drift;
    S.item = H.item;
    S.lookBack = H.lookBack;
  }

  dispose() {
    this._disableTilt();
    for (const [t, type, fn, opts] of this._listeners) t.removeEventListener(type, fn, opts);
    this._listeners.length = 0;
    this.root.remove();
    document.documentElement.classList.remove('ssk-touch', 'ssk-touch-race');
  }
}

export default TouchControls;
