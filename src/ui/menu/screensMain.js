// Title, main menu, engine class, options and how-to-play screens (owner: frontend agent).

import { Screen, topbar, footer, chip } from './Screen.js';
import { el, esc, ICONS, ENGINE_META, MODE_LABEL, kbd, pad, gaugeSVG } from './kit.js';
import { logoSVG } from './logo.js';
import { CC_LIST } from '../../data/engine.js';
import { ITEMS, ITEM_IDS } from '../../data/items.js';
import { itemIconSVG, coinIconSVG } from '../itemIcons.js';

// ================================================================================================
// Title
// ================================================================================================

// Controls reference (keyboard / controller / touch). No modifier keys: Ctrl/Alt combos trigger browser shortcuts.
const CONTROL_REF = [
  { action: 'Accelerate', keys: ['W', '↑'], pad: ['A'], touch: 'Automatic (AUTO GAS) or GAS' },
  { action: 'Brake / Reverse', keys: ['S', '↓'], pad: ['B', 'LT'], touch: 'BRAKE' },
  { action: 'Steer', keys: ['A', 'D', '←', '→'], pad: ['L-Stick', 'D-Pad'], touch: 'Left thumb: stick, pads or tilt' },
  { action: 'Drift / Hop', keys: ['Space', 'Shift'], pad: ['RB', 'RT'], touch: 'Hold DRIFT' },
  { action: 'Use Item', keys: ['E', 'J', 'X', 'L'], pad: ['X', 'LB'], touch: 'ITEM' },
  { action: 'Look Back', keys: ['Q', 'C'], pad: ['Y'], touch: 'Look-back button' },
  { action: 'Pause', keys: ['Esc', 'P'], pad: ['Start'], touch: 'II (top of screen)' },
];
const ctrlCell = (c, key) => (key === 'keys' ? c.keys.map(kbd).join('') : key === 'pad' ? c.pad.map(pad).join('') : `<span class="mn-ctrl-touch">${esc(c.touch)}</span>`);

export class TitleScreen extends Screen {
  get music() {
    return 'title';
  }
  stageSetup(stage) {
    stage.setMode('title', { characterId: 'serika' });
  }
  build() {
    this.t = 0;
    this.started = false;
    const e = el(`<div class="mn-title">
      <div class="mn-title-shine"></div>
      <div class="mn-title-stripes"></div>
      <div class="mn-title-logo">${logoSVG({ id: 'mntitlelogo' })}</div>
      <div class="mn-title-sub"><span>KIVOTOS GRAND PRIX</span></div>
      <button class="mn-title-press" data-focus data-key="start">
        <span class="mn-hint-kb">PRESS ENTER / CLICK TO START</span>
        <span class="mn-hint-pad">PRESS <b class="mn-kbd mn-padkey mn-pad-a">A</b> TO START</span>
      </button>
      <div class="mn-title-foot"><span>Fan-made tribute &middot; not affiliated with NEXON Games or Yostar</span><span>v1.0</span></div>
    </div>`);
    e.addEventListener('click', () => this._start());
    return e;
  }
  update(dt) {
    this.t += dt;
    if (this.t > 0.5 && !this.started && this.game.input.anyPressed?.()) this._start();
  }
  onConfirm() {
    this._start();
  }
  onBack() {}
  _start() {
    if (this.started || this.t < 0.35) return;
    this.started = true;
    this.game.unlockAudio?.();
    this.sfx('menuSelect');
    this.el.classList.add('is-leaving');
    this.menus.go('main');
  }
}

// ================================================================================================
// Main menu
// ================================================================================================

const MAIN_ITEMS = [
  { key: 'gp', label: 'Grand Prix', sub: '4 races · win the trophy', color: '#ff9f1f', desc: 'Race all four courses of a cup against seven rivals. Earn points, climb the standings and bring home the trophy!' },
  { key: 'vs', label: 'VS Race', sub: 'Any course · any class', color: '#ff4d8d', desc: 'A single race on the course of your choice. Pick an engine class and fight for first place.' },
  { key: 'tt', label: 'Time Trial', sub: 'Race the clock', color: '#2fd27e', desc: 'Just you, the clock and a six-pack of energy drinks. Set records on every course!' },
  { key: 'online', icon: 'people', label: 'Online Race', sub: 'Room codes · up to 8 players', color: '#27d3f0', desc: 'Create a room and share its code or invite link, or join a friend with their code. Race each other online (with CPU racers if you like)!' },
  { key: 'options', label: 'Options', sub: 'Sound · graphics · HUD', color: '#1fb6ff', desc: 'Adjust volume, graphics quality and the HUD layout, and check the controls.' },
  { key: 'howto', label: 'How to Play', sub: 'Controls · drifting · items', color: '#9b6bff', desc: 'Learn the controls, drifting and mini-turbos, and every item in the Shittim Chest.' },
];

export class MainMenuScreen extends Screen {
  stageSetup(stage) {
    stage.setMode('hero', { characterId: this.menus.flow.characterId || 'serika' });
  }
  build() {
    const items = MAIN_ITEMS.map(
      (it, i) => `<button class="mn-main-btn" data-focus data-key="${it.key}" style="--i:${i};--mn-accent:${it.color}">
        <span class="mn-main-ico">${ICONS[it.icon || it.key]}</span>
        <span class="mn-main-txt"><b>${esc(it.label)}</b><small>${esc(it.sub)}</small></span>
        <span class="mn-main-arrow">${ICONS.arrowR}</span>
      </button>`
    ).join('');
    return el(`<div class="mn-main">
      <div class="mn-main-side"></div>
      <div class="mn-main-logo">${logoSVG({ id: 'mnmainlogo', animated: false })}</div>
      <nav class="mn-main-list">${items}</nav>
      <div class="mn-main-desc mn-panel"><div class="mn-main-desc-ico"></div><div><h3></h3><p></p></div></div>
      ${footer([
        ['ud', 'Move'],
        ['confirm', 'Select'],
        ['back', 'Title'],
      ])}
    </div>`);
  }
  defaultFocus() {
    const k = this.menus.flow.mode === 'tt' ? 'tt' : this.menus.flow.mode === 'vs' ? 'vs' : 'gp';
    return this.el.querySelector(`[data-key="${k}"]`) || super.defaultFocus();
  }
  onFocus(e) {
    const it = MAIN_ITEMS.find((m) => m.key === e.dataset.key);
    if (!it) return;
    const d = this.el.querySelector('.mn-main-desc');
    d.style.setProperty('--mn-accent', it.color);
    d.querySelector('h3').textContent = it.label;
    d.querySelector('p').textContent = it.desc;
    d.querySelector('.mn-main-desc-ico').innerHTML = ICONS[it.icon || it.key];
    d.classList.remove('is-pop');
    void d.offsetWidth;
    d.classList.add('is-pop');
  }
  onConfirm(e) {
    const k = e?.dataset.key;
    const flow = this.menus.flow;
    this.sfx('menuSelect');
    if (k === 'gp' || k === 'vs') {
      flow.mode = k;
      this.menus.go('cc');
    } else if (k === 'tt') {
      flow.mode = 'tt';
      flow.cc = 150;
      this.menus.go('character');
    } else if (k === 'options') this.menus.go('options');
    else if (k === 'howto') this.menus.go('howto');
    else if (k === 'online') this.menus.go('online');
  }
}

// ================================================================================================
// Engine class
// ================================================================================================

export class EngineScreen extends Screen {
  build() {
    const flow = this.menus.flow;
    const cards = CC_LIST.map((cc, i) => {
      const m = ENGINE_META[cc];
      const stars = Array.from({ length: 4 }, (_, s) => `<span class="${s < m.stars ? 'is-on' : ''}">${ICONS.star}</span>`).join('');
      return `<button class="mn-cc-card" data-focus data-key="${cc}" style="--i:${i};--mn-accent:${m.color};--mn-accent2:${m.color2}">
        <span class="mn-cc-band"><b>${cc}</b><small>cc</small></span>
        <span class="mn-cc-gauge">${gaugeSVG(m.stars, m.color)}</span>
        <span class="mn-cc-name">${esc(m.name)}</span>
        <span class="mn-cc-stars">${stars}</span>
        <span class="mn-cc-desc">${esc(m.desc)}</span>
      </button>`;
    }).join('');
    return el(`<div class="mn-cc">
      ${topbar({ title: 'Engine Class', crumb: MODE_LABEL[flow.mode] || '', right: chip(MODE_LABEL[flow.mode] || '', 'mn-chip-mode') })}
      <div class="mn-cc-row">${cards}</div>
      ${footer([
        ['lr', 'Move'],
        ['confirm', 'Select'],
        ['back', 'Back'],
      ])}
    </div>`);
  }
  defaultFocus() {
    return this.el.querySelector(`[data-key="${this.menus.flow.cc || 150}"]`) || super.defaultFocus();
  }
  onConfirm(e) {
    if (!e) return;
    this.menus.flow.cc = Number(e.dataset.key);
    this.sfx('menuSelect');
    this.menus.go('character');
  }
}

// ================================================================================================
// Options
// ================================================================================================

const QUALITY = [
  { v: 'high', label: 'High', desc: 'Full shadows, anti-aliasing and scenery detail.' },
  { v: 'medium', label: 'Medium', desc: 'Lower resolution and lighter shadows. Good for laptops.' },
  { v: 'low', label: 'Low', desc: 'No shadows, reduced resolution and scenery. Maximum speed.' },
];
const HUDMAP = [
  { v: 'both', label: 'Map + Ranks', desc: 'Show the course minimap and the racer ranking column.' },
  { v: 'map', label: 'Minimap Only', desc: 'Show only the course minimap.' },
  { v: 'ranks', label: 'Ranks Only', desc: 'Show only the racer ranking column.' },
  { v: 'none', label: 'Hidden', desc: 'A clean screen. For the purists, Sensei.' },
];

export class OptionsScreen extends Screen {
  build() {
    const s = this.game.settings;
    const slider = (key, label) => `<div class="mn-opt" data-focus data-key="${key}" data-kind="slider">
        <span class="mn-opt-label">${label}</span>
        <div class="mn-slider"><div class="mn-slider-track"><div class="mn-slider-fill"></div><div class="mn-slider-knob"></div></div><span class="mn-slider-val"></span></div>
      </div>`;
    const select = (key, label) => `<div class="mn-opt" data-focus data-key="${key}" data-kind="select">
        <span class="mn-opt-label">${label}</span>
        <div class="mn-select"><span class="mn-sel-arrow" data-dir="left">${ICONS.arrowL}</span><span class="mn-sel-val"></span><span class="mn-sel-arrow" data-dir="right">${ICONS.arrowR}</span></div>
      </div>`;
    const ctrlRows = CONTROL_REF.map((c) => `<tr><th>${esc(c.action)}</th><td>${ctrlCell(c, 'keys')}</td><td>${ctrlCell(c, 'pad')}</td></tr>`).join('');
    const e = el(`<div class="mn-options">
      ${topbar({ title: 'Options', crumb: 'Settings', color: '#1fb6ff' })}
      <div class="mn-options-body">
        <section class="mn-panel mn-options-panel">
          <h2 class="mn-sec">Sound</h2>
          ${slider('master', 'Master Volume')}
          ${slider('music', 'Music')}
          ${slider('sfx', 'Sound Effects')}
          <h2 class="mn-sec">Display</h2>
          ${select('quality', 'Graphics Quality')}
          ${select('hudMap', 'HUD Map')}
          <div class="mn-opt" data-focus data-key="showFps" data-kind="toggle"><span class="mn-opt-label">Show FPS</span><span class="mn-toggle"><i></i></span></div>
          <div class="mn-opt mn-opt-btn" data-focus data-key="reset"><span class="mn-opt-label">Reset to Defaults</span>${ICONS.retry}</div>
          <p class="mn-opt-help"></p>
        </section>
        <section class="mn-panel mn-controls-panel">
          <h2 class="mn-sec">Controls</h2>
          <table class="mn-ctrl-table"><thead><tr><th></th><td>Keyboard</td><td>Controller</td></tr></thead><tbody>${ctrlRows}</tbody></table>
          <p class="mn-ctrl-note">Menus: arrows / WASD to move, Enter / Space to select, Esc / Backspace to go back. Controllers (Xbox / PlayStation / Switch Pro) plug and play: D-pad or left stick with A / B. On phones and tablets just tap &mdash; on-screen driving controls appear during races.</p>
        </section>
      </div>
      ${footer([
        ['ud', 'Move'],
        ['lr', 'Adjust'],
        ['back', 'Back'],
      ])}
    </div>`);
    // slider dragging
    for (const sl of e.querySelectorAll('[data-kind="slider"] .mn-slider-track')) {
      const opt = sl.closest('.mn-opt');
      const setFromX = (x) => {
        const r = sl.getBoundingClientRect();
        const v = Math.round(Math.max(0, Math.min(1, (x - r.left) / r.width)) * 20) / 20;
        this._set(opt.dataset.key, v);
      };
      sl.addEventListener('pointerdown', (ev) => {
        ev.preventDefault();
        sl.setPointerCapture?.(ev.pointerId);
        this.menus.setFocus(this, opt, { silent: true });
        setFromX(ev.clientX);
        const move = (m) => setFromX(m.clientX);
        const up = () => {
          sl.removeEventListener('pointermove', move);
          sl.removeEventListener('pointerup', up);
          sl.removeEventListener('pointercancel', up);
          this.sfx('menuMove');
        };
        sl.addEventListener('pointermove', move);
        sl.addEventListener('pointerup', up);
        sl.addEventListener('pointercancel', up);
      });
    }
    this._render(e, s);
    return e;
  }

  _render(root = this.el, s = this.game.settings) {
    for (const key of ['master', 'music', 'sfx']) {
      const o = root.querySelector(`[data-key="${key}"]`);
      const v = Math.max(0, Math.min(1, Number(s[key]) || 0));
      o.querySelector('.mn-slider-fill').style.transform = `scaleX(${v})`;
      o.querySelector('.mn-slider-knob').style.left = `${v * 100}%`;
      o.querySelector('.mn-slider-val').textContent = Math.round(v * 100);
    }
    const q = QUALITY.find((x) => x.v === s.quality) || QUALITY[0];
    root.querySelector('[data-key="quality"] .mn-sel-val').textContent = q.label;
    const hm = HUDMAP.find((x) => x.v === s.hudMap) || HUDMAP[0];
    root.querySelector('[data-key="hudMap"] .mn-sel-val').textContent = hm.label;
    root.querySelector('[data-key="showFps"]').classList.toggle('is-on', !!s.showFps);
  }

  _help(key) {
    const s = this.game.settings;
    const map = {
      master: 'Overall volume of everything.',
      music: 'Volume of the background music.',
      sfx: 'Volume of engines, items, voices and menu sounds.',
      quality: (QUALITY.find((x) => x.v === s.quality) || QUALITY[0]).desc,
      hudMap: (HUDMAP.find((x) => x.v === s.hudMap) || HUDMAP[0]).desc,
      showFps: 'Show a frame-rate counter in the corner of the screen.',
      reset: 'Restore every option to its default value.',
    };
    return map[key] || '';
  }

  _set(key, value) {
    this.game.applySettings({ [key]: value });
    this._render();
    const help = this.el.querySelector('.mn-opt-help');
    if (help) help.textContent = this._help(key);
  }

  onFocus(e) {
    const help = this.el.querySelector('.mn-opt-help');
    if (help) help.textContent = this._help(e.dataset.key);
  }

  _cycle(key, list, dir) {
    const cur = list.findIndex((x) => x.v === this.game.settings[key]);
    const next = list[(Math.max(0, cur) + dir + list.length) % list.length];
    this._set(key, next.v);
  }

  onDir(dir, e) {
    if (!e || (dir !== 'left' && dir !== 'right')) return false;
    const d = dir === 'left' ? -1 : 1;
    const key = e.dataset.key;
    const kind = e.dataset.kind;
    if (kind === 'slider') {
      const v = Math.round(Math.max(0, Math.min(1, (Number(this.game.settings[key]) || 0) + d * 0.05)) * 20) / 20;
      this._set(key, v);
      this.sfx('menuMove');
      return true;
    }
    if (kind === 'select') {
      this._cycle(key, key === 'quality' ? QUALITY : HUDMAP, d);
      this.sfx('menuMove');
      this._bump(e);
      return true;
    }
    if (kind === 'toggle') {
      this._set(key, !this.game.settings[key]);
      this.sfx('menuMove');
      return true;
    }
    return false;
  }

  _bump(e) {
    const v = e.querySelector('.mn-sel-val');
    if (!v) return;
    v.classList.remove('is-bump');
    void v.offsetWidth;
    v.classList.add('is-bump');
  }

  onConfirm(e, ev) {
    if (!e) return;
    const key = e.dataset.key;
    const kind = e.dataset.kind;
    if (kind === 'select') {
      const arrow = ev?.target?.closest?.('[data-dir]');
      const d = arrow?.dataset.dir === 'left' ? -1 : 1;
      this._cycle(key, key === 'quality' ? QUALITY : HUDMAP, d);
      this._bump(e);
      this.sfx('menuSelect');
    } else if (kind === 'toggle') {
      this._set(key, !this.game.settings[key]);
      this.sfx('menuSelect');
    } else if (key === 'reset') {
      this.game.resetSettings?.();
      this._render();
      this.sfx('menuSelect');
      this.menus.toast('Options reset to defaults');
    }
  }
}

// ================================================================================================
// How to play
// ================================================================================================

const TECHNIQUES = [
  {
    title: 'Drift & Mini-Turbo',
    html: `Hold <b>Drift</b> while steering at speed to hop into a powerslide. Keep drifting to charge the sparks, then release for a <b>Mini-Turbo</b>. Steering into the drift charges faster!
      <div class="mn-sparks"><span class="mn-spark mn-spark-b"><i></i>Blue<small>0.9 s &rarr; short boost</small></span><span class="mn-spark mn-spark-o"><i></i>Orange<small>1.9 s &rarr; strong boost</small></span><span class="mn-spark mn-spark-p"><i></i>Purple<small>3.0 s &rarr; ULTRA boost</small></span></div>`,
  },
  { title: 'Rocket Start', html: 'Press <b>Accelerate</b> just as the <b>2</b> fades during the countdown for a boost off the line. Press too early and your engine stalls!' },
  { title: 'Ramps & Tricks', html: 'Press <b>Drift</b> while flying off a ramp to perform a trick. Stick the landing for a speed boost.' },
  { title: 'Dash Panels', html: 'Drive over the glowing chevrons for an instant burst of speed. Boosts ignore off-road slowdown.' },
  { title: 'Credits', html: `<span class="mn-inline-ico">${coinIconSVG()}</span>Each Credit (up to 10) adds <b>+1% top speed</b>. Getting hit makes you drop some &mdash; collect them back!` },
  { title: 'Off-road & Edges', html: 'Sand, grass and snow slow you down (high <b>Traction</b> helps). Fall off a course edge and a drone carries you back.' },
  { title: 'Items', html: 'Drive through <b>item boxes</b> to spin the roulette. Racers further behind get stronger items. Hold <b>Look Back</b> to throw items backwards.' },
  { title: 'Grand Prix Points', html: 'Points per place: <b>15 · 12 · 10 · 8 · 6 · 4 · 2 · 1</b>. The highest total after four races wins the cup.' },
];

export class HowToScreen extends Screen {
  build() {
    this.tab = this.params.tab || 'controls';
    const ctrlCard = (title, key) => `<div class="mn-howto-card">
        <h3>${title}</h3>
        <table class="mn-ctrl-table">${CONTROL_REF.map((c) => `<tr><th>${esc(c.action)}</th><td>${ctrlCell(c, key)}</td></tr>`).join('')}</table>
      </div>`;
    const items = ITEM_IDS.map((id) => {
      const it = ITEMS[id];
      return `<div class="mn-item-card"><span class="mn-item-ico">${itemIconSVG(id)}</span><div><b>${esc(it.name)}</b><p>${esc(it.desc)}</p></div></div>`;
    }).join('');
    const tech = TECHNIQUES.map((t) => `<div class="mn-howto-card mn-tech"><h3>${esc(t.title)}</h3><div>${t.html}</div></div>`).join('');
    return el(`<div class="mn-howto">
      ${topbar({ title: 'How to Play', crumb: "Arona's Driving School", color: '#9b6bff' })}
      <nav class="mn-tabs">
        <button class="mn-tab" data-focus data-key="controls">Controls</button>
        <button class="mn-tab" data-focus data-key="techniques">Techniques</button>
        <button class="mn-tab" data-focus data-key="items">Items</button>
      </nav>
      <div class="mn-howto-body mn-panel">
        <section class="mn-howto-page" data-page="controls"><div class="mn-howto-grid2">${ctrlCard('Keyboard', 'keys')}${ctrlCard('Controller', 'pad')}${ctrlCard('Touch (phone / tablet)', 'touch')}</div>
          <p class="mn-howto-note">Keyboard: no Ctrl / Alt needed, so browser shortcuts never fire mid-race. Menus: arrows / WASD to move, Enter / Space to select, Esc / Backspace to go back.</p>
          <p class="mn-howto-note">Controller: any standard pad (Xbox, PlayStation, Switch Pro...) &mdash; press a button to wake it; analog stick steering, D-pad or stick + A / B in menus.</p>
          <p class="mn-howto-note">Touch: play in landscape; the corner button at the bottom right goes fullscreen. Left thumb steers &mdash; drag the floating stick, or tap STEER to switch to big arrow pads or tilt steering (tap the left side to re-centre tilt). AUTO GAS accelerates for you from the start line; turn it off to get a GAS button.</p></section>
        <section class="mn-howto-page" data-page="techniques"><div class="mn-howto-grid2">${tech}</div></section>
        <section class="mn-howto-page" data-page="items"><div class="mn-items-grid">${items}</div></section>
      </div>
      ${footer([
        ['lr', 'Tabs'],
        ['ud', 'Scroll'],
        ['back', 'Back'],
      ])}
    </div>`);
  }
  defaultFocus() {
    return this.el.querySelector(`[data-key="${this.tab}"]`);
  }
  onFocus(e) {
    this.tab = e.dataset.key;
    for (const t of this.el.querySelectorAll('.mn-tab')) t.classList.toggle('is-active', t === e);
    for (const p of this.el.querySelectorAll('.mn-howto-page')) p.classList.toggle('is-active', p.dataset.page === this.tab);
    this.el.querySelector('.mn-howto-body').scrollTop = 0;
  }
  onDir(dir) {
    if (dir === 'up' || dir === 'down') {
      const body = this.el.querySelector('.mn-howto-body');
      body.scrollBy({ top: dir === 'down' ? 140 : -140, behavior: 'smooth' });
      return true;
    }
    return false;
  }
  onConfirm() {}
}
