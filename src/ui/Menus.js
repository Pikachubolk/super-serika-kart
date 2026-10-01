// Menu manager (owner: frontend agent): screen stack, modal layers (pause / confirm), input routing
// (keyboard, mouse, gamepad via game.input.menuPressed), focus handling, loading screen and transitions.
// DOM lives in #menu (screens) and #overlay (loading, wipes, toasts). Styles: src/styles/menus.css.
//
// Private API used by Game.js:
//   menus.go(id, params, { reset, replace })   menus.back()   menus.setStack(['title','main',...])
//   menus.clear()   menus.update(dt)   menus.openPause(params)   menus.confirm(opts)   menus.closeModals()
//   menus.showLoading(info) -> LoadingScreen   menus.wipe(async fn)   menus.toast(text, opts)   menus.flow

import '../styles/menus.css';
import '../styles/mobile.css';
import { TitleScreen, MainMenuScreen, EngineScreen, OptionsScreen, HowToScreen } from './menu/screensMain.js';
import { CharacterScreen, CupScreen, TrackScreen } from './menu/screensSelect.js';
import { ResultsScreen, TTResultsScreen, TrophyScreen } from './menu/screensResults.js';
import { PauseMenu, ConfirmDialog } from './menu/screensModal.js';
import { OnlineScreen, OnlineResultsScreen } from './menu/screensOnline.js';
import { SoundTestScreen } from './menu/screensSound.js';
import { LoadingScreen, wipe, toast } from './menu/overlays.js';
import { pickDirectional } from './menu/kit.js';

export const SCREENS = {
  title: TitleScreen,
  main: MainMenuScreen,
  cc: EngineScreen,
  character: CharacterScreen,
  cup: CupScreen,
  track: TrackScreen,
  options: OptionsScreen,
  howto: HowToScreen,
  results: ResultsScreen,
  ttresults: TTResultsScreen,
  trophy: TrophyScreen,
  online: OnlineScreen,
  onlineresults: OnlineResultsScreen,
  soundtest: SoundTestScreen,
};

const DIRS = ['up', 'down', 'left', 'right'];

export class Menus {
  constructor(root, game) {
    this.root = root;
    this.game = game;
    this.overlay = game.overlayRoot || root;
    this.stack = []; // [{ id, params, focusKey }]
    this.base = null; // current Screen
    this.modals = []; // modal Screens on top
    this.flow = { mode: 'gp', cc: 150, characterId: 'serika', cupId: 'credit', trackId: null };
    this._lock = 0;
    this._device = '';

    this._onPointerMove = (e) => {
      const layer = this.top;
      if (!layer?.el) return;
      const t = e.target.closest?.('[data-focus]');
      if (!t || !layer.el.contains(t) || t.hasAttribute('disabled')) return;
      if (layer.focusEl !== t) this.setFocus(layer, t);
    };
    this._onClick = (e) => {
      const layer = this.top;
      if (!layer?.el || !layer.el.contains(e.target) || this._lock > 0) return;
      if (e.target.closest('[data-action="back"]')) {
        layer.onBack();
        return;
      }
      const t = e.target.closest('[data-focus]');
      if (t && !t.hasAttribute('disabled')) {
        this.setFocus(layer, t, { silent: true });
        layer.onConfirm(t, e);
      }
    };
    this._onWheel = (e) => this.top?.onWheel?.(e);
    root.addEventListener('pointermove', this._onPointerMove);
    root.addEventListener('click', this._onClick);
    root.addEventListener('wheel', this._onWheel, { passive: true });
    window.__ssk = window.__ssk || {};
    window.__ssk.menus = this;
  }

  get top() {
    return this.modals[this.modals.length - 1] || this.base;
  }

  /** Ignore menu input for `sec` seconds (debounce after transitions / confirmations). */
  lock(sec) {
    this._lock = Math.max(this._lock, sec);
  }

  // ----------------------------------------------------------------------------------------------
  // navigation
  // ----------------------------------------------------------------------------------------------

  go(id, params = {}, { reset = false, replace = false } = {}) {
    const Cls = SCREENS[id];
    if (!Cls) throw new Error(`Unknown menu screen "${id}"`);
    const cur = this.stack[this.stack.length - 1];
    if (cur && this.base) cur.focusKey = this.base.focusEl?.dataset?.key;
    if (reset) this.stack = [];
    if (replace) this.stack.pop();
    this.stack.push({ id, params });
    this._mount(new Cls(this, params), 'fwd');
  }

  /** Replace the whole back-stack and show its last entry. Entries: 'id' or { id, params }. */
  setStack(entries) {
    this.stack = entries.map((e) => (typeof e === 'string' ? { id: e, params: {} } : { params: {}, ...e }));
    const top = this.stack[this.stack.length - 1];
    this._mount(new SCREENS[top.id](this, top.params), 'fwd');
  }

  back() {
    if (this.stack.length <= 1) return false;
    this.stack.pop();
    const top = this.stack[this.stack.length - 1];
    this.game.audio?.sfx?.('menuBack');
    this._mount(new SCREENS[top.id](this, top.params), 'back', top.focusKey);
    return true;
  }

  _mount(screen, dir, focusKey) {
    this.closeModals();
    const old = this.base;
    if (old) {
      try {
        old.leave();
      } catch (err) {
        console.error('[menus] leave failed', err);
      }
      const oe = old.el;
      if (oe) {
        oe.classList.remove('mn-in', 'mn-dir-fwd', 'mn-dir-back');
        oe.classList.add('mn-out', `mn-dir-${dir}`);
        oe.inert = true;
        setTimeout(() => oe.remove(), 420);
      }
    }
    this.base = screen;
    this.root.dataset.screen = this.stack[this.stack.length - 1]?.id || ''; // for screen-specific overlay CSS
    const e = screen.build();
    screen.el = e;
    e.classList.add('mn-screen', 'mn-in', `mn-dir-${dir}`);
    this.root.appendChild(e);
    try {
      screen.stageSetup(this.game.stage);
    } catch (err) {
      console.warn('[menus] stage setup failed', err);
    }
    if (screen.music) this.game.playMusic?.(screen.music);
    this._syncDevice(true);
    screen.enter();
    const f = (focusKey && [...e.querySelectorAll('[data-focus]')].find((x) => x.dataset.key === focusKey)) || screen.defaultFocus();
    screen.focusEl = null;
    if (f) this.setFocus(screen, f, { silent: true });
    this.lock(0.18);
  }

  /** Remove every screen and modal (e.g. when a race takes over the screen). */
  clear() {
    this.closeModals();
    if (this.base) {
      try {
        this.base.leave();
      } catch {
        /* ignore */
      }
      this.base = null;
    }
    this.stack = [];
    this.root.dataset.screen = '';
    this.root.replaceChildren();
  }

  // ----------------------------------------------------------------------------------------------
  // modal layers
  // ----------------------------------------------------------------------------------------------

  pushModal(screen) {
    const e = screen.build();
    screen.el = e;
    e.classList.add('mn-layer', 'mn-in');
    this.root.appendChild(e);
    this.modals.push(screen);
    this._syncDevice(true);
    screen.enter();
    const f = screen.defaultFocus();
    if (f) this.setFocus(screen, f, { silent: true });
    this.lock(0.15);
    return screen;
  }

  popModal(screen = this.top) {
    const i = this.modals.indexOf(screen);
    if (i < 0) return;
    this.modals.splice(i, 1);
    try {
      screen.leave();
    } catch {
      /* ignore */
    }
    const e = screen.el;
    if (e) {
      e.classList.add('mn-out');
      e.inert = true;
      setTimeout(() => e.remove(), 260);
    }
    this.lock(0.1);
  }

  closeModals() {
    while (this.modals.length) this.popModal(this.modals[this.modals.length - 1]);
  }

  openPause(params) {
    return this.pushModal(new PauseMenu(this, params));
  }

  confirm(opts) {
    return this.pushModal(new ConfirmDialog(this, opts));
  }

  // ----------------------------------------------------------------------------------------------
  // focus
  // ----------------------------------------------------------------------------------------------

  setFocus(layer, el, { silent = false } = {}) {
    if (!layer || !el || layer.focusEl === el) return;
    layer.focusEl?.classList.remove('is-focus');
    layer.focusEl = el;
    el.classList.add('is-focus');
    if (!silent) this.game.audio?.sfx?.('menuMove');
    try {
      layer.onFocus(el);
    } catch (err) {
      console.error('[menus] onFocus failed', err);
    }
  }

  /** Move focus without sound (e.g. when new buttons appear). */
  refocus(layer, el) {
    if (layer.focusEl && layer.focusEl.isConnected && layer.focusEl.closest('.mn-res-actions')) return;
    this.setFocus(layer, el, { silent: true });
  }

  // ----------------------------------------------------------------------------------------------
  // per frame
  // ----------------------------------------------------------------------------------------------

  update(dt) {
    if (this._lock > 0) this._lock -= dt;
    const top = this.top;
    try {
      this.base?.update(dt);
      for (const m of this.modals) m.update(dt);
    } catch (err) {
      console.error('[menus] screen update failed', err);
    }
    this._syncDevice();
    if (!top || top !== this.top || this._lock > 0) return;
    const inp = this.game.input;
    if (!inp) return;
    const acts = [];
    for (const d of DIRS) if (inp.menuPressed(d)) acts.push(d); // Input auto-repeats held directions
    if (inp.menuPressed('confirm')) acts.push('confirm');
    const back = inp.menuPressed('back');
    if (back) acts.push('back');
    else if (inp.menuPressed('pause')) acts.push('pause');
    for (const a of acts) {
      this._dispatch(top, a);
      if (this.top !== top || this._lock > 0) break;
    }
  }

  _dispatch(layer, action) {
    const f = layer.focusEl?.isConnected ? layer.focusEl : null;
    try {
      if (DIRS.includes(action)) {
        if (layer.onDir(action, f)) return;
        const els = layer.focusables();
        if (!els.length) return;
        if (!f) {
          this.setFocus(layer, els[0]);
          return;
        }
        const n = pickDirectional(f, action, els, { wrap: layer.wrap });
        if (n) this.setFocus(layer, n);
        return;
      }
      if (action === 'confirm') layer.onConfirm(f, null);
      else if (action === 'back') layer.onBack();
      else if (action === 'pause') layer.onPause();
    } catch (err) {
      console.error(`[menus] ${action} handler failed`, err);
    }
  }

  _syncDevice(force = false) {
    const dev = this.game.input?.lastDevice === 'gamepad' ? 'pad' : 'kb';
    if (dev === this._device && !force) return;
    this._device = dev;
    for (const r of [this.root, this.overlay]) r?.classList.toggle('mn-dev-pad', dev === 'pad');
  }

  // ----------------------------------------------------------------------------------------------
  // overlays
  // ----------------------------------------------------------------------------------------------

  showLoading(info) {
    return new LoadingScreen(this.overlay, { ...info, portraits: this.game.portraits });
  }

  wipe(midway) {
    return wipe(this.overlay, midway);
  }

  toast(text, opts) {
    toast(this.overlay, text, opts);
  }

  dispose() {
    this.clear();
    this.root.removeEventListener('pointermove', this._onPointerMove);
    this.root.removeEventListener('click', this._onClick);
    this.root.removeEventListener('wheel', this._onWheel);
  }
}
