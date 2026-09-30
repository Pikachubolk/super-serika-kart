// In-race HUD (owner: hud agent) — Mario-Kart-8-Deluxe-inspired DOM overlay inside #hud, re-themed with
// Blue Archive flair. Styles live in src/styles/hud.css (every class is prefixed `hud-`).
//
// API CONTRACT (ARCHITECTURE.md §11):
//   new HUD(root, { racers:[{id, characterId, name, isPlayer}], laps, track:{ name, outline:[{x,z}], bounds }, portraits, mode, settings })
//   hud.show() / hud.hide()
//   hud.update(state: HudState, dt)
//   hud.countdown(n)            // 3, 2, 1, then 0 = "GO!"
//   hud.lapBanner(lap, laps)    // "LAP 2/3" or "FINAL LAP!"
//   hud.finishBanner(place)     // "FINISH!"
//   hud.titleCard(name, subtitle)   // intro track title card
//   hud.notify(text, { color, icon, duration })   // toast, e.g. "Hina hit you with a Drone Missile!"
//   hud.flash(kind)             // 'hit' | 'boost' | 'shrink' | 'halo' | 'coin' | 'tablet' | 'respawn' | 'item' | ...
//   hud.dispose()
// Additions (optional, all safe to ignore):
//   opts.sfx(name)              // if given, the HUD plays 'rouletteTick' in sync with the slot-machine reel
//   opts.cupName / opts.subtitle // used by the automatic intro title card
//   hud.titleCard(name, subtitle, { duration })   // duration in s (default: until countdown / 6 s)
//   hud.hideTitleCard(), hud.setTrack(track), hud.setSettings(settings)
//   hud.flash(kind, { intensity })
//
// Performance: DOM is only touched when a displayed value changes; one-shot animations use the Web Animations
// API (no forced reflows); the minimap and speed lines are canvases redrawn per frame.

import '../styles/hud.css';
import { formatRaceTime, ordinalSuffix, clamp, clamp01, TAU } from '../core/utils.js';
import { CHARACTERS } from '../data/characters.js';
import { ITEMS } from '../data/items.js';
import { itemIconURL, coinIconSVG } from './itemIcons.js';

const CHAR_MAP = Object.fromEntries(CHARACTERS.map((c) => [c.id, c]));
const REEL_ORDER = ['drink', 'bullet', 'ramen', 'missile', 'card', 'halo', 'grenade', 'credits', 'bullet3', 'tablet', 'drink3', 'decoy', 'missile3', 'seeker', 'ramen3'];
const DIAL_TICKS = 24;
const MODE_LABEL = { gp: 'Grand Prix', vs: 'VS Race', tt: 'Time Trial' };
const INK = '#13204a';

// ---------------------------------------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------------------------------------

function h(tag, cls, parent, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  if (parent) parent.appendChild(e);
  return e;
}

function play(elem, frames, opts) {
  if (!elem || typeof elem.animate !== 'function') return null;
  try {
    return elem.animate(frames, opts);
  } catch {
    return null;
  }
}

const racerColor = (characterId) => CHAR_MAP[characterId]?.kart?.body || '#8aa0c8';
const racerInitial = (r) => (CHAR_MAP[r.characterId]?.name || r.name || '?')[0].toUpperCase();

function portraitURL(portraits, characterId) {
  try {
    return portraits?.get?.(characterId) || '';
  } catch {
    return '';
  }
}

/** Outlined display text (outline / rim / gradient fill copies stacked). */
class OText {
  constructor(parent, cls = '', text = '') {
    this.wrap = h('span', cls, parent);
    this.el = h('span', 'hud-ot', this.wrap);
    this.b = h('span', 'hud-ot-b', this.el);
    this.m = h('span', 'hud-ot-m', this.el);
    this.f = h('span', 'hud-ot-f', this.el);
    this.m.setAttribute('aria-hidden', 'true');
    this.f.setAttribute('aria-hidden', 'true');
    this.text = null;
    this.set(text);
  }

  set(t) {
    t = String(t);
    if (t === this.text) return false;
    this.text = t;
    this.b.textContent = t;
    this.m.textContent = t;
    this.f.textContent = t;
    return true;
  }
}

// ---------------------------------------------------------------------------------------------------------
// static SVG snippets
// ---------------------------------------------------------------------------------------------------------

const ITEM_DECO_SVG = (() => {
  let ticks = '';
  for (let i = 0; i < 4; i++) {
    const a = i * 90;
    ticks += `<path d="M50 -1.5 L52.6 3 L50 7.5 L47.4 3 Z" transform="rotate(${a} 50 50)" fill="#fff" stroke="${INK}" stroke-width="0.8"/>`;
  }
  return `<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="48.5" fill="none" stroke="rgba(255,255,255,.95)" stroke-width="1.1" stroke-dasharray="7 2.2 1.2 2.2"/>${ticks}</svg>`;
})();

const DIAL_SVG = (() => {
  let s = '<svg viewBox="0 0 100 100">';
  for (let i = 0; i < DIAL_TICKS; i++) {
    s += `<rect x="49" y="-3.5" width="2" height="4.6" rx="1" transform="rotate(${(i * 360) / DIAL_TICKS} 50 50)"/>`;
  }
  return s + '</svg>';
})();

const EMPTY_SVG = `<svg viewBox="0 0 100 100"><ellipse cx="50" cy="50" rx="38" ry="14" fill="none" stroke="#fff" stroke-width="7" transform="rotate(-12 50 50)"/><ellipse cx="50" cy="50" rx="46" ry="19" fill="none" stroke="#fff" stroke-width="2" stroke-dasharray="4 5" transform="rotate(-12 50 50)"/></svg>`;

const PTR_SVG = `<svg viewBox="0 0 26 32"><path d="M2 2 L24 16 L2 30 Z" fill="#ffd23f" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/><path d="M6 8 L16 15" stroke="#fff" stroke-width="2.4" stroke-linecap="round" opacity=".8"/></svg>`;

const CARD_RING_SVG = `<svg class="hud-item-timer" viewBox="0 0 100 100"><circle cx="50" cy="50" r="47" fill="none" stroke="rgba(10,20,60,.55)" stroke-width="6"/><circle class="hud-card-arc" cx="50" cy="50" r="47" fill="none" stroke="#ffd23f" stroke-width="4.2" stroke-linecap="round" stroke-dasharray="295.3" stroke-dashoffset="0" style="filter:drop-shadow(0 0 2px #ffe98a)"/></svg>`;

const TIMER_ICON_SVG = `<svg viewBox="0 0 100 100"><circle cx="50" cy="54" r="36" fill="#fff" stroke="${INK}" stroke-width="9"/><circle cx="50" cy="54" r="26" fill="none" stroke="#27d3f0" stroke-width="5" stroke-dasharray="4 6.5"/><path d="M50 54 L50 34 M50 54 L64 62" stroke="${INK}" stroke-width="7" stroke-linecap="round"/><rect x="40" y="6" width="20" height="10" rx="3" fill="#27d3f0" stroke="${INK}" stroke-width="5"/></svg>`;

const UTURN_SVG = `<svg viewBox="0 0 100 100">
  <path d="M72 86 V44 A22 22 0 0 0 28 44 V56" fill="none" stroke="${INK}" stroke-width="25" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M8 50 L28 80 L48 50 Z" fill="${INK}" stroke="${INK}" stroke-width="10" stroke-linejoin="round"/>
  <path d="M72 86 V44 A22 22 0 0 0 28 44 V56" fill="none" stroke="#fff" stroke-width="17" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M12 52 L28 76 L44 52 Z" fill="#fff" stroke="#fff" stroke-width="5" stroke-linejoin="round"/>
  <path d="M72 86 V44 A22 22 0 0 0 28 44 V56" fill="none" stroke="#ff3355" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M18 54 L28 69 L38 54 Z" fill="#ff3355" stroke="#ff3355" stroke-width="3" stroke-linejoin="round"/>
</svg>`;

const ARROW_UP_SVG = `<svg viewBox="0 0 100 100"><path d="M50 8 L90 52 H66 V92 H34 V52 H10 Z" fill="#5dff8a" stroke="${INK}" stroke-width="8" stroke-linejoin="round"/></svg>`;
const ARROW_DOWN_SVG = `<svg viewBox="0 0 100 100"><path d="M50 92 L90 48 H66 V8 H34 V48 H10 Z" fill="#ff5a6e" stroke="${INK}" stroke-width="8" stroke-linejoin="round"/></svg>`;

// ---------------------------------------------------------------------------------------------------------
// Item slot (top-left): glossy bubble + slot-machine roulette + triple count + Sensei's Card timer ring
// ---------------------------------------------------------------------------------------------------------

class ItemSlot {
  constructor(parent, hud) {
    this.hud = hud;
    this.wrap = h('div', 'hud-item-wrap', parent);
    this.root = h('div', 'hud-item', this.wrap);
    h('div', 'hud-item-deco', this.root, ITEM_DECO_SVG);
    this.dial = h('div', 'hud-item-dial', this.root, DIAL_SVG);
    this.dialTicks = [...this.dial.querySelectorAll('rect')];
    this.bubble = h('div', 'hud-item-bubble', this.root);
    this.window = h('div', 'hud-item-window', this.bubble);
    h('div', 'hud-item-empty', this.window, EMPTY_SVG);
    this.reel = h('div', 'hud-item-reel', this.window);
    const n = REEL_ORDER.length;
    this.reel.style.height = `${(n + 1) * 100}%`;
    for (const id of [...REEL_ORDER, REEL_ORDER[0]]) {
      const cell = h('div', 'hud-item-cell', this.reel);
      cell.style.height = `${100 / (n + 1)}%`;
      const img = h('img', '', cell);
      img.alt = '';
      img.decoding = 'async';
      img.src = itemIconURL(id);
    }
    this.icon = h('img', 'hud-item-icon', this.window);
    this.icon.alt = '';
    h('div', 'hud-item-shade', this.window);
    h('div', 'hud-item-gloss', this.bubble);
    this.root.insertAdjacentHTML('beforeend', CARD_RING_SVG);
    this.cardArc = this.root.querySelector('.hud-card-arc');
    this.ptrL = h('div', 'hud-item-ptr hud-item-ptr-l', this.root, PTR_SVG);
    this.ptrR = h('div', 'hud-item-ptr hud-item-ptr-r', this.root, PTR_SVG);
    this.burst = h('div', 'hud-item-burst', this.root);
    this.countBox = h('div', 'hud-item-count', this.root);
    this.count = new OText(this.countBox, '', '×3');

    this.id = null;
    this.uses = 0;
    this.rolling = false;
    this.pos = 0;
    this.tickIdx = 0;
    this.lit = -1;
    this.blur = -1;
    this.cardFrac = -1;
    this.showCount = false;
    this.iconId = null;
    this.cls = { has: false, rolling: false, card: false };
  }

  _toggle(key, cls, on) {
    if (this.cls[key] === on) return;
    this.cls[key] = on;
    this.root.classList.toggle(cls, on);
  }

  update(item, dt, phase) {
    const rolling = !!item.roulette;
    const id = item.id || null;
    const uses = item.uses ?? (id ? ITEMS[id]?.uses ?? 1 : 0);

    // --- roulette reel
    if (rolling && !this.rolling) this._startRoll();
    if (rolling) this._roll(clamp01(item.rouletteProgress ?? 0), dt);
    if (!rolling && this.rolling) this._stopRoll();

    // --- held item
    if (id !== this.id) {
      const prev = this.id;
      this.id = id;
      if (id) {
        this.iconId = id;
        this.icon.src = itemIconURL(id);
        if (!rolling) this._land(!!prev);
      } else if (prev && !rolling) {
        this._useOut(this.iconId || prev);
      }
      this._toggle('has', 'hud-has-item', !!id);
      this.uses = uses;
    } else if (id && uses !== this.uses) {
      if (uses < this.uses) this._useOne();
      this.uses = uses;
    }

    // triple items: once one is used, show the single item (like a shrinking cluster) + the remaining count
    const maxUses = ITEMS[id]?.uses ?? 1;
    const base = id && maxUses > 1 && uses < maxUses ? id.replace(/3$/, '') : id;
    const iconId = base && base !== id && ITEMS[base] ? base : id;
    if (iconId && iconId !== this.iconId) {
      this.iconId = iconId;
      this.icon.src = itemIconURL(iconId);
    } else if (!iconId) this.iconId = null;

    const showCount = !!id && !rolling && uses > 1;
    if (showCount) this.count.set(`×${Math.max(0, uses)}`);
    if (showCount !== this.showCount) {
      this.showCount = showCount;
      this.root.classList.toggle('hud-show-count', showCount);
    }

    // --- Sensei's Card timer ring
    const cardTime = item.cardTime ?? 0;
    const cardOn = cardTime > 0.001;
    this._toggle('card', 'hud-card-on', cardOn);
    if (cardOn) {
      const dur = ITEMS.card?.duration || 7;
      const frac = clamp01(cardTime / dur);
      if (Math.abs(frac - this.cardFrac) > 0.002) {
        this.cardFrac = frac;
        this.cardArc.setAttribute('stroke-dashoffset', ((1 - frac) * 295.3).toFixed(1));
        this.cardArc.setAttribute('stroke', frac < 0.25 ? '#ff5a6e' : '#ffd23f');
      }
    } else this.cardFrac = -1;
  }

  _startRoll() {
    this.rolling = true;
    this._toggle('rolling', 'hud-rolling', true);
    this.pos = Math.floor(Math.random() * REEL_ORDER.length);
    this.tickIdx = Math.floor(this.pos);
    play(this.bubble, [{ transform: 'scale(1)' }, { transform: 'scale(1.12)' }, { transform: 'scale(0.96)' }, { transform: 'scale(1)' }], { duration: 320, easing: 'ease-out' });
  }

  _roll(p, dt) {
    // fast then decelerating: icons per second
    const v = 3.2 + 27 * Math.pow(1 - p, 2.1);
    this.pos += v * dt;
    const n = REEL_ORDER.length;
    const m = ((this.pos % n) + n) % n;
    this.reel.style.transform = `translate3d(0, ${(-(n - m) / (n + 1)) * 100}%, 0)`;
    const blur = v > 20 ? 3 : v > 13 ? 2 : v > 8 ? 1 : 0;
    if (blur !== this.blur) {
      this.reel.classList.remove(`hud-reel-b${this.blur}`);
      if (blur) this.reel.classList.add(`hud-reel-b${blur}`);
      this.blur = blur;
    }
    const tick = Math.floor(this.pos);
    if (tick !== this.tickIdx) {
      this.tickIdx = tick;
      this._tick(v);
    }
    const lit = Math.floor(p * DIAL_TICKS + 0.001);
    if (lit !== this.lit) this._setLit(lit);
  }

  _setLit(lit) {
    for (let i = 0; i < DIAL_TICKS; i++) {
      const on = i < lit;
      if (i >= Math.min(this.lit, lit) || this.lit < 0) this.dialTicks[i].classList.toggle('hud-lit', on);
    }
    this.lit = lit;
  }

  _tick(v) {
    const amp = v > 14 ? 0.35 : 0.9;
    const k = [{ translate: '0 0' }, { translate: `calc(var(--u) * ${amp}) 0` }, { translate: '0 0' }];
    play(this.ptrL, k, { duration: 90 });
    play(this.ptrR, [{ translate: '0 0' }, { translate: `calc(var(--u) * ${-amp}) 0` }, { translate: '0 0' }], { duration: 90 });
    this.hud._sfx('rouletteTick');
  }

  _stopRoll() {
    this.rolling = false;
    this._toggle('rolling', 'hud-rolling', false);
    this._setLit(-1);
    this.lit = -1;
    if (this.id) this._land(false);
  }

  _land(swap) {
    play(
      this.icon,
      [
        { transform: 'scale(0.25) rotate(-30deg)', opacity: 0 },
        { transform: 'scale(1.32) rotate(8deg)', opacity: 1, offset: 0.42 },
        { transform: 'scale(0.9) rotate(-3deg)', offset: 0.68 },
        { transform: 'scale(1.04) rotate(1deg)', offset: 0.85 },
        { transform: 'scale(1) rotate(0)' },
      ],
      { duration: swap ? 380 : 520, easing: 'ease-out' },
    );
    play(this.burst, [{ transform: 'scale(0.75)', opacity: 1 }, { transform: 'scale(1.55)', opacity: 0 }], { duration: 520, easing: 'cubic-bezier(.2,.8,.3,1)' });
    play(
      this.bubble,
      [
        { transform: 'scale(1)', filter: 'brightness(1)' },
        { transform: 'scale(1.1)', filter: 'brightness(1.6)', offset: 0.3 },
        { transform: 'scale(1)', filter: 'brightness(1)' },
      ],
      { duration: 420, easing: 'ease-out' },
    );
  }

  _useOut(prevId) {
    const ghost = h('img', 'hud-item-ghost', this.bubble);
    ghost.alt = '';
    ghost.src = itemIconURL(prevId);
    const a = play(
      ghost,
      [
        { transform: 'translate(0,0) scale(1)', opacity: 1 },
        { transform: 'translate(calc(var(--u) * 6), calc(var(--u) * -3)) scale(1.5) rotate(18deg)', opacity: 0 },
      ],
      { duration: 360, easing: 'cubic-bezier(.2,.7,.3,1)' },
    );
    if (a) a.onfinish = () => ghost.remove();
    else ghost.remove();
    play(this.bubble, [{ transform: 'scale(0.9)' }, { transform: 'scale(1.05)' }, { transform: 'scale(1)' }], { duration: 300, easing: 'ease-out' });
  }

  _useOne() {
    play(this.icon, [{ transform: 'scale(1)' }, { transform: 'scale(0.78) rotate(-8deg)' }, { transform: 'scale(1.1)' }, { transform: 'scale(1)' }], { duration: 300, easing: 'ease-out' });
    play(this.countBox, [{ transform: 'scale(1)' }, { transform: 'scale(1.5) rotate(-8deg)' }, { transform: 'scale(1)' }], { duration: 320, easing: 'ease-out' });
  }

  pulse() {
    play(this.bubble, [{ filter: 'brightness(1)' }, { filter: 'brightness(1.8)' }, { filter: 'brightness(1)' }], { duration: 400 });
  }
}

// ---------------------------------------------------------------------------------------------------------
// Incoming missile / seeker alert
// ---------------------------------------------------------------------------------------------------------

class IncomingAlert {
  constructor(parent) {
    this.root = h('div', 'hud-alert', parent);
    h('div', 'hud-alert-ring', this.root);
    this.core = h('div', 'hud-alert-core', this.root);
    this.img = h('img', '', this.core);
    this.img.alt = '';
    new OText(h('div', 'hud-alert-bang', this.root), '', '!');
    this.kind = null;
    this.level = -1;
    this.on = false;
  }

  /** @returns danger level 0 (none) .. 2 (imminent) */
  update(incoming) {
    let best = null;
    if (Array.isArray(incoming)) for (const w of incoming) if (w && (!best || (w.distance ?? 1e9) < (best.distance ?? 1e9))) best = w;
    const on = !!best;
    if (on !== this.on) {
      this.on = on;
      this.root.classList.toggle('hud-on', on);
    }
    if (!best) return 0;
    const kind = best.kind === 'seeker' ? 'seeker' : 'missile';
    if (kind !== this.kind) {
      this.kind = kind;
      this.img.src = itemIconURL(kind);
    }
    const d = best.distance ?? 50;
    const level = d < 22 ? 2 : d < 60 ? 1 : 0;
    if (level !== this.level) {
      this.root.classList.remove(`hud-alert-l${this.level}`);
      this.root.classList.add(`hud-alert-l${level}`);
      this.level = level;
    }
    return level === 2 ? 2 : 1;
  }
}

// ---------------------------------------------------------------------------------------------------------
// Credits counter + lap counter (bottom-left)
// ---------------------------------------------------------------------------------------------------------

class Coins {
  constructor(parent) {
    this.root = h('div', 'hud-coins', parent);
    h('div', 'hud-coins-panel', this.root);
    this.icon = h('div', 'hud-coins-icon', this.root, coinIconSVG());
    h('div', 'hud-coins-x', this.root, '×');
    this.num = new OText(this.root, 'hud-coins-num', '0');
    h('div', 'hud-coins-max', this.root, 'MAX');
    this.value = -1;
    this.full = false;
    this.sparks = 0;
  }

  update(coins, max) {
    coins = Math.max(0, coins | 0);
    if (coins === this.value) return;
    const prev = this.value;
    this.value = coins;
    this.num.set(String(coins));
    const full = coins >= max;
    if (full !== this.full) {
      this.full = full;
      this.root.classList.toggle('hud-coins-full', full);
    }
    if (prev < 0) return;
    if (coins > prev) this.gain(coins - prev);
    else this.lose(prev - coins);
  }

  gain(n = 1) {
    play(this.num.wrap, [{ transform: 'scale(1)' }, { transform: 'scale(1.45) rotate(-6deg)', offset: 0.3 }, { transform: 'scale(0.92)', offset: 0.6 }, { transform: 'scale(1)' }], { duration: 380, easing: 'ease-out' });
    play(this.icon, [{ transform: 'rotateY(0) scale(1)' }, { transform: 'rotateY(180deg) scale(1.25)' }, { transform: 'rotateY(360deg) scale(1)' }], { duration: 420, easing: 'ease-out' });
    this.sparkle(Math.min(10, 5 + n * 2));
  }

  sparkle(count = 6) {
    if (this.sparks > 30) return;
    for (let i = 0; i < count; i++) {
      const s = h('div', `hud-spark${i % 2 ? ' hud-gold' : ''}`, this.root);
      this.sparks++;
      const a = (i / count) * TAU + Math.random() * 0.6;
      const r = 4.5 + Math.random() * 4;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      const sc = 0.5 + Math.random() * 0.8;
      const an = play(
        s,
        [
          { transform: `translate(0,0) scale(${sc * 0.3}) rotate(0deg)`, opacity: 1 },
          { transform: `translate(calc(var(--u) * ${x}), calc(var(--u) * ${y})) scale(${sc}) rotate(90deg)`, opacity: 1, offset: 0.55 },
          { transform: `translate(calc(var(--u) * ${x * 1.25}), calc(var(--u) * ${y * 1.25})) scale(0) rotate(160deg)`, opacity: 0 },
        ],
        { duration: 520 + Math.random() * 200, easing: 'cubic-bezier(.2,.8,.3,1)' },
      );
      const done = () => {
        s.remove();
        this.sparks--;
      };
      if (an) an.onfinish = done;
      else done();
    }
  }

  lose(n = 1) {
    play(
      this.num.wrap,
      [
        { transform: 'translateX(0)', filter: 'none' },
        { transform: 'translateX(calc(var(--u) * -0.8))', filter: 'sepia(1) saturate(6) hue-rotate(-40deg)' },
        { transform: 'translateX(calc(var(--u) * 0.8))' },
        { transform: 'translateX(calc(var(--u) * -0.5))' },
        { transform: 'translateX(0)', filter: 'none' },
      ],
      { duration: 420 },
    );
    const count = Math.min(4, n);
    for (let i = 0; i < count; i++) {
      const c = h('div', 'hud-lost-coin', this.root, coinIconSVG());
      const x = (i - (count - 1) / 2) * 3.4 + 2;
      const an = play(
        c,
        [
          { transform: 'translate(0,0) rotate(0)', opacity: 1 },
          { transform: `translate(calc(var(--u) * ${x}), calc(var(--u) * -7)) rotate(${120 * (i % 2 ? 1 : -1)}deg)`, opacity: 1, offset: 0.4 },
          { transform: `translate(calc(var(--u) * ${x * 1.6}), calc(var(--u) * 6)) rotate(${300 * (i % 2 ? 1 : -1)}deg)`, opacity: 0 },
        ],
        { duration: 700, delay: i * 60, easing: 'cubic-bezier(.3,.6,.6,1)', fill: 'backwards' },
      );
      if (an) an.onfinish = () => c.remove();
      else c.remove();
    }
  }
}

class LapCounter {
  constructor(parent) {
    this.root = h('div', 'hud-lap', parent);
    h('div', 'hud-lap-label', this.root, 'LAP');
    const body = h('div', 'hud-lap-body', this.root);
    this.num = new OText(body, 'hud-lap-num', '1');
    this.den = new OText(body, 'hud-lap-den', '/3');
    this.lap = -1;
    this.laps = -1;
    this.final = false;
  }

  set(lap, laps) {
    if (lap === this.lap && laps === this.laps) return;
    const bump = this.lap > 0 && lap !== this.lap;
    this.lap = lap;
    this.laps = laps;
    this.num.set(String(lap));
    this.den.set(`/${laps}`);
    const final = laps > 1 && lap >= laps;
    if (final !== this.final) {
      this.final = final;
      this.root.classList.toggle('hud-lap-final', final);
    }
    if (bump) play(this.num.wrap, [{ transform: 'scale(1)' }, { transform: 'scale(1.6) rotate(-8deg)', offset: 0.35 }, { transform: 'scale(0.9)', offset: 0.65 }, { transform: 'scale(1)' }], { duration: 520, easing: 'ease-out' });
  }
}

// ---------------------------------------------------------------------------------------------------------
// Place indicator (bottom-right)
// ---------------------------------------------------------------------------------------------------------

class PlaceIndicator {
  constructor(parent) {
    this.root = h('div', 'hud-place hud-place-p8', parent);
    this.inner = h('div', 'hud-place-inner', this.root);
    h('div', 'hud-place-halo', this.inner);
    this.num = new OText(this.inner, 'hud-place-num', '8');
    this.suf = new OText(this.inner, 'hud-place-suf', 'th');
    this.arrow = h('div', 'hud-place-arrow', this.root);
    this.place = -1;
    this.cls = 'hud-place-p8';
  }

  set(place) {
    place = Math.max(1, place | 0);
    if (place === this.place) return;
    const prev = this.place;
    this.place = place;
    this.num.set(String(place));
    this.suf.set(ordinalSuffix(place));
    const cls = `hud-place-p${Math.min(8, place)}`;
    if (cls !== this.cls) {
      this.root.classList.replace(this.cls, cls);
      this.cls = cls;
    }
    if (prev < 0) return;
    const up = place < prev;
    play(
      this.inner,
      [
        { transform: 'scale(1) rotate(0)' },
        { transform: `scale(${up ? 1.38 : 0.72}) rotate(${up ? -7 : 5}deg)`, offset: 0.28 },
        { transform: `scale(${up ? 0.9 : 1.1}) rotate(${up ? 2 : -2}deg)`, offset: 0.56 },
        { transform: 'scale(1.03) rotate(0)', offset: 0.8 },
        { transform: 'scale(1) rotate(0)' },
      ],
      { duration: 560, easing: 'ease-out' },
    );
    this.arrow.innerHTML = up ? ARROW_UP_SVG : ARROW_DOWN_SVG;
    play(
      this.arrow,
      [
        { transform: `translateY(calc(var(--u) * ${up ? 3 : -3})) scale(0.5)`, opacity: 0 },
        { transform: 'translateY(0) scale(1.1)', opacity: 1, offset: 0.25 },
        { transform: 'translateY(0) scale(1)', opacity: 1, offset: 0.7 },
        { transform: `translateY(calc(var(--u) * ${up ? -2 : 2})) scale(0.9)`, opacity: 0 },
      ],
      { duration: 900, easing: 'ease-out' },
    );
  }
}

// ---------------------------------------------------------------------------------------------------------
// Race timer + lap splits (top-right)
// ---------------------------------------------------------------------------------------------------------

class RaceTimer {
  constructor(parent, mode) {
    this.mode = mode;
    this.wrap = h('div', 'hud-timer-wrap', parent);
    const t = h('div', 'hud-timer', this.wrap);
    h('div', 'hud-timer-panel', t);
    h('div', 'hud-timer-icon', t, TIMER_ICON_SVG);
    this.text = h('div', 'hud-timer-text', t);
    this.record = h('div', 'hud-split hud-record', this.wrap);
    h('span', 'hud-split-l', this.record, 'RECORD');
    this.recordText = h('span', '', this.record);
    this.recordVal = undefined;
    this.splits = h('div', 'hud-splits', this.wrap);
    this.spans = [];
    this.str = '';
    this.splitRows = [];
    this.popTimer = 0;
  }

  set(seconds) {
    const s = formatRaceTime(seconds);
    if (s === this.str) return;
    if (s.length !== this.str.length) {
      this.text.textContent = '';
      this.spans = [];
      for (const ch of s) {
        const sp = h('span', /\d/.test(ch) ? 'hud-tc' : 'hud-tc-s', this.text);
        sp.textContent = ch;
        this.spans.push(sp);
      }
    } else {
      for (let i = 0; i < s.length; i++) if (s[i] !== this.str[i]) this.spans[i].textContent = s[i];
    }
    this.str = s;
  }

  /** Time Trial: show the stored record under the timer (null / non-finite hides it). */
  setRecord(sec) {
    const v = Number.isFinite(sec) && sec > 0 ? sec : null;
    if (v === this.recordVal) return;
    this.recordVal = v;
    this.record.classList.toggle('hud-on', v != null);
    if (v != null) this.recordText.textContent = formatRaceTime(v);
  }

  addSplit(index, time, all, persistent) {
    const best = all.length > 1 && time <= Math.min(...all) + 1e-6;
    if (!persistent) {
      for (const r of this.splitRows) r.remove();
      this.splitRows = [];
    }
    const row = h('div', 'hud-split', this.splits);
    h('span', 'hud-split-l', row, `LAP ${index + 1}`);
    h('span', '', row, formatRaceTime(time));
    if (best) {
      row.classList.add('hud-best');
      h('span', 'hud-split-tag', row, 'BEST');
      for (const r of this.splitRows) {
        r.classList.remove('hud-best');
        r.querySelector('.hud-split-tag')?.remove();
      }
    }
    this.splitRows.push(row);
    play(row, [{ transform: 'translateX(calc(var(--u) * 20))', opacity: 0 }, { transform: 'translateX(calc(var(--u) * -1))', opacity: 1, offset: 0.7 }, { transform: 'translateX(0)', opacity: 1 }], { duration: 420, easing: 'ease-out' });
    if (!persistent) {
      clearTimeout(this.popTimer);
      this.popTimer = setTimeout(() => {
        const a = play(row, [{ opacity: 1, transform: 'translateX(0)' }, { opacity: 0, transform: 'translateX(calc(var(--u) * 12))' }], { duration: 300, fill: 'forwards' });
        const rm = () => {
          row.remove();
          this.splitRows = this.splitRows.filter((r) => r !== row);
        };
        if (a) a.onfinish = rm;
        else rm();
      }, 3600);
    }
  }

  dispose() {
    clearTimeout(this.popTimer);
  }
}

// ---------------------------------------------------------------------------------------------------------
// Ranking column (left edge) — rows slide to their new slot (transform transitions = FLIP for free)
// ---------------------------------------------------------------------------------------------------------

class Ranking {
  constructor(parent, racers, portraits) {
    this.root = h('div', 'hud-rank', parent);
    this.portraits = portraits;
    this.rows = new Map();
    this.root.style.height = `calc(var(--row) * ${Math.max(1, racers.length)})`;
    racers.forEach((r, i) => {
      const row = h('div', `hud-rank-row${r.isPlayer ? ' hud-rank-me' : ''}`, this.root);
      row.style.setProperty('--i', i);
      row.style.setProperty('--rc', racerColor(r.characterId));
      h('div', 'hud-rank-bar', row);
      const pos = new OText(row, 'hud-rank-pos', String(i + 1));
      const face = h('div', 'hud-rank-face', row);
      const flag = h('div', 'hud-rank-flag', row);
      const entry = { racer: r, row, pos, face, flag, idx: i, done: false, url: null, pcls: '' };
      this._setPlaceClass(entry, i + 1);
      this.rows.set(r.id, entry);
    });
    this.key = '';
    this.refreshPortraits();
  }

  _setPlaceClass(e, place) {
    const cls = place <= 3 ? `hud-rank-p${place}` : '';
    if (cls === e.pcls) return;
    if (e.pcls) e.row.classList.remove(e.pcls);
    if (cls) e.row.classList.add(cls);
    e.pcls = cls;
  }

  refreshPortraits() {
    for (const e of this.rows.values()) {
      const url = portraitURL(this.portraits, e.racer.characterId);
      if (url === e.url) continue;
      e.url = url;
      e.face.textContent = '';
      if (url) {
        const img = h('img', '', e.face);
        img.alt = '';
        img.src = url;
      } else {
        h('b', '', e.face, racerInitial(e.racer));
      }
    }
  }

  update(racers) {
    let key = '';
    for (const r of racers) key += `${r.id}${r.finished ? '!' : ''},`;
    if (key === this.key) {
      this._pendingKey = null;
      return;
    }
    // Neck-and-neck karts swap places every few frames; re-sorting on each swap restarts the row
    // transitions and leaves overlapping rows / gaps. Only apply an order once it has been stable a moment.
    const now = performance.now();
    if (key !== this._pendingKey) {
      this._pendingKey = key;
      this._pendingSince = now;
      if (this.key) return;
    } else if (now - this._pendingSince < 250) return;
    this._pendingKey = null;
    this.key = key;
    racers.forEach((r, i) => {
      const e = this.rows.get(r.id);
      if (!e) return;
      if (e.idx !== i) {
        const up = i < e.idx;
        e.idx = i;
        e.row.style.setProperty('--i', i);
        e.pos.set(String(i + 1));
        this._setPlaceClass(e, i + 1);
        if (e.racer.isPlayer) play(e.face, [{ scale: '1' }, { scale: up ? '1.3' : '0.85' }, { scale: '1' }], { duration: 420, easing: 'ease-out' });
      }
      const done = !!r.finished;
      if (done !== e.done) {
        e.done = done;
        e.row.classList.toggle('hud-rank-done', done);
      }
    });
  }
}

// ---------------------------------------------------------------------------------------------------------
// Minimap (canvas): static track layer + per-frame racer markers with portrait icons
// ---------------------------------------------------------------------------------------------------------

function normalizeOutline(outline) {
  const out = [];
  if (!Array.isArray(outline)) return out;
  for (const p of outline) {
    if (!p) continue;
    if (Array.isArray(p)) out.push({ x: +p[0], z: +p[1], y: 0 });
    else if (Number.isFinite(p.x) && Number.isFinite(p.z)) out.push({ x: p.x, z: p.z, y: Number.isFinite(p.y) ? p.y : 0 });
  }
  // drop a duplicated closing point
  if (out.length > 2) {
    const a = out[0];
    const b = out[out.length - 1];
    if (Math.hypot(a.x - b.x, a.z - b.z) < 1e-3) out.pop();
  }
  return out;
}

function segIntersect(a, b, c, d) {
  const d1x = b.x - a.x;
  const d1z = b.z - a.z;
  const d2x = d.x - c.x;
  const d2z = d.z - c.z;
  const den = d1x * d2z - d1z * d2x;
  if (Math.abs(den) < 1e-9) return false;
  const t = ((c.x - a.x) * d2z - (c.z - a.z) * d2x) / den;
  const u = ((c.x - a.x) * d1z - (c.z - a.z) * d1x) / den;
  return t > 0 && t < 1 && u > 0 && u < 1;
}

class Minimap {
  constructor(parent, track, racers, portraits) {
    this.root = h('div', 'hud-map', parent);
    this.canvas = h('canvas', '', this.root);
    this.ctx = this.canvas.getContext('2d');
    this.bg = document.createElement('canvas');
    this.portraits = portraits;
    this.racers = racers;
    this.markers = new Map();
    for (const r of racers) {
      this.markers.set(r.id, { racer: r, color: racerColor(r.characterId), url: null, img: null, ready: false, sprite: null, spriteR: 0 });
    }
    this.cssW = 0;
    this.cssH = 0;
    this.needsMeasure = true;
    this.setTrack(track);
    this.refreshPortraits();
    this._order = [];
  }

  setTrack(track) {
    this.pts = normalizeOutline(track?.outline);
    this.ok = this.pts.length >= 4;
    this.root.style.display = this.ok ? '' : 'none';
    if (!this.ok) return;
    // pick the rotation that makes the track as large as possible in the map box (prefer small angles)
    this.rot = this._bestRotation(this.root.clientWidth ? this.root.clientWidth / Math.max(1, this.root.clientHeight) : 34 / 46);
    this._findOverpasses();
    this.dirty = true;
  }

  _bestRotation(aspect) {
    let best = 0;
    let bestScore = -1;
    for (let deg = 0; deg < 180; deg += 3) {
      const a = (deg * Math.PI) / 180;
      const c = Math.cos(a);
      const s = Math.sin(a);
      let x0 = Infinity;
      let x1 = -Infinity;
      let y0 = Infinity;
      let y1 = -Infinity;
      for (const p of this.pts) {
        const rx = p.x * c - p.z * s;
        const ry = p.x * s + p.z * c;
        if (rx < x0) x0 = rx;
        if (rx > x1) x1 = rx;
        if (ry < y0) y0 = ry;
        if (ry > y1) y1 = ry;
      }
      const score = Math.min(aspect / Math.max(1e-6, x1 - x0), 1 / Math.max(1e-6, y1 - y0));
      const penalty = 1 - 0.04 * Math.min(1, Math.min(deg, 180 - deg) / 90);
      if (score * penalty > bestScore) {
        bestScore = score * penalty;
        best = a;
      }
    }
    return best;
  }

  _findOverpasses() {
    const n = this.pts.length;
    this.upper = new Uint8Array(n);
    this.hasBridges = false;
    const ys = this.pts.map((p) => p.y);
    if (Math.max(...ys) - Math.min(...ys) < 4) return;
    const gap = Math.max(6, Math.floor(n / 40));
    for (let i = 0; i < n; i++) {
      const a = this.pts[i];
      const b = this.pts[(i + 1) % n];
      for (let j = i + 2; j < n; j++) {
        const di = Math.min(j - i, n - (j - i));
        if (di < gap) continue;
        const c = this.pts[j];
        const d = this.pts[(j + 1) % n];
        if (!segIntersect(a, b, c, d)) continue;
        const yi = (a.y + b.y) / 2;
        const yj = (c.y + d.y) / 2;
        if (Math.abs(yi - yj) < 3) continue;
        const top = yi > yj ? i : j;
        const ext = Math.max(3, Math.floor(n / 60));
        for (let k = -ext; k <= ext; k++) this.upper[(top + k + n) % n] = 1;
        this.hasBridges = true;
      }
    }
  }

  refreshPortraits() {
    for (const m of this.markers.values()) {
      const url = portraitURL(this.portraits, m.racer.characterId);
      if (url === m.url) continue;
      m.url = url;
      m.ready = false;
      m.sprite = null;
      if (url) {
        const img = new Image();
        img.decoding = 'async';
        img.onload = () => {
          if (m.url !== url) return;
          m.ready = true;
          m.sprite = null;
        };
        img.src = url;
        m.img = img;
      } else m.img = null;
    }
  }

  measure() {
    if (!this.ok || !this.needsMeasure) return;
    this.needsMeasure = false;
    const w = this.root.clientWidth;
    const hh = this.root.clientHeight;
    if (!w || !hh) {
      this.needsMeasure = true;
      return;
    }
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.cssW = w;
    this.cssH = hh;
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(hh * dpr);
    this.bg.width = this.canvas.width;
    this.bg.height = this.canvas.height;
    this.rot = this._bestRotation(w / hh);
    this.dirty = true;
  }

  _layout() {
    const W = this.canvas.width;
    const H = this.canvas.height;
    const c = Math.cos(this.rot);
    const s = Math.sin(this.rot);
    this.c = c;
    this.s = s;
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const p of this.pts) {
      const rx = p.x * c - p.z * s;
      const ry = p.x * s + p.z * c;
      if (rx < x0) x0 = rx;
      if (rx > x1) x1 = rx;
      if (ry < y0) y0 = ry;
      if (ry > y1) y1 = ry;
    }
    const minDim = Math.min(W, H);
    this.lw = Math.max(4, minDim * 0.058);
    this.border = Math.max(2, this.lw * 0.24);
    this.markR = Math.max(6, this.lw * 0.95);
    const pad = this.lw + this.markR * 0.9 + 4 * this.dpr;
    this.scale = Math.min((W - pad * 2) / Math.max(1, x1 - x0), (H - pad * 2) / Math.max(1, y1 - y0));
    this.ox = W / 2 - ((x0 + x1) / 2) * this.scale;
    this.oy = H / 2 - ((y0 + y1) / 2) * this.scale;
  }

  _map(x, z, out) {
    out.x = this.ox + (x * this.c - z * this.s) * this.scale;
    out.y = this.oy + (x * this.s + z * this.c) * this.scale;
    return out;
  }

  _renderStatic() {
    this._layout();
    const g = this.bg.getContext('2d');
    const W = this.bg.width;
    const H = this.bg.height;
    g.clearRect(0, 0, W, H);
    const P = this.pts.map((p) => this._map(p.x, p.z, { x: 0, y: 0 }));
    const n = P.length;
    const path = () => {
      g.beginPath();
      g.moveTo(P[0].x, P[0].y);
      for (let i = 1; i < n; i++) g.lineTo(P[i].x, P[i].y);
      g.closePath();
    };
    g.lineJoin = 'round';
    g.lineCap = 'round';
    const lw = this.lw;
    const b = this.border;
    // soft drop shadow + glow
    g.save();
    g.shadowColor = 'rgba(4, 14, 44, 0.55)';
    g.shadowBlur = 6 * this.dpr;
    g.shadowOffsetY = 3 * this.dpr;
    path();
    g.strokeStyle = INK;
    g.lineWidth = lw + b * 2 + 2 * this.dpr;
    g.stroke();
    g.restore();
    // cyan halo rim
    path();
    g.strokeStyle = 'rgba(39, 211, 240, 0.95)';
    g.lineWidth = lw + b * 2;
    g.stroke();
    path();
    g.strokeStyle = INK;
    g.lineWidth = lw + b * 0.9;
    g.stroke();
    // road
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(1, '#dcecff');
    path();
    g.strokeStyle = grad;
    g.lineWidth = lw;
    g.stroke();
    path();
    g.strokeStyle = 'rgba(160, 205, 255, 0.55)';
    g.lineWidth = lw * 0.28;
    g.setLineDash([lw * 0.6, lw * 0.8]);
    g.stroke();
    g.setLineDash([]);

    // overpasses: redraw the upper runs on top with butt caps (no seams across the road)
    if (this.hasBridges) {
      const runs = [];
      let cur = null;
      for (let i = 0; i <= n; i++) {
        const k = i % n;
        if (this.upper[k]) {
          if (!cur) cur = [];
          cur.push(P[k]);
        } else if (cur) {
          runs.push(cur);
          cur = null;
        }
      }
      if (cur) runs.push(cur);
      g.lineCap = 'butt';
      for (const run of runs) {
        if (run.length < 2) continue;
        const rp = () => {
          g.beginPath();
          g.moveTo(run[0].x, run[0].y);
          for (let i = 1; i < run.length; i++) g.lineTo(run[i].x, run[i].y);
        };
        g.save();
        g.shadowColor = 'rgba(4, 14, 44, 0.6)';
        g.shadowBlur = 5 * this.dpr;
        rp();
        g.strokeStyle = 'rgba(39, 211, 240, 0.95)';
        g.lineWidth = lw + b * 2;
        g.stroke();
        g.restore();
        rp();
        g.strokeStyle = INK;
        g.lineWidth = lw + b * 0.9;
        g.stroke();
        rp();
        g.strokeStyle = grad;
        g.lineWidth = lw;
        g.stroke();
      }
      g.lineCap = 'round';
    }

    // start / finish line: checkered bar across the road
    const p0 = P[0];
    const p1 = P[1 % n];
    const ang = Math.atan2(p1.y - p0.y, p1.x - p0.x);
    g.save();
    g.translate(p0.x, p0.y);
    g.rotate(ang);
    const len = lw + b * 2;
    const th = Math.max(4, lw * 0.5);
    const cols = 4;
    const cell = len / cols;
    g.fillStyle = INK;
    g.fillRect(-th / 2 - this.dpr, -len / 2 - this.dpr, th + 2 * this.dpr, len + 2 * this.dpr);
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < cols; c++) {
        g.fillStyle = (r + c) % 2 ? '#ffffff' : '#1b2340';
        g.fillRect(-th / 2 + (r * th) / 2, -len / 2 + c * cell, th / 2, cell);
      }
    }
    g.restore();
    this.dirty = false;
    for (const m of this.markers.values()) m.sprite = null;
  }

  _sprite(m, r) {
    if (m.sprite && m.spriteR === r) return m.sprite;
    const ring = Math.max(2, r * 0.2);
    const ol = Math.max(1.5, r * 0.14);
    const R = r + ring + ol;
    const size = Math.ceil(R * 2 + 4);
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const g = cv.getContext('2d');
    const c = size / 2;
    g.beginPath();
    g.arc(c, c, R, 0, TAU);
    g.fillStyle = INK;
    g.fill();
    g.beginPath();
    g.arc(c, c, r + ring, 0, TAU);
    g.fillStyle = m.racer.isPlayer ? '#ffffff' : m.color;
    g.fill();
    g.save();
    g.beginPath();
    g.arc(c, c, r, 0, TAU);
    g.clip();
    const bgG = g.createRadialGradient(c, c - r * 0.4, r * 0.1, c, c, r);
    bgG.addColorStop(0, '#ffffff');
    bgG.addColorStop(1, m.racer.isPlayer ? '#9fe6ff' : '#cfe0f5');
    g.fillStyle = bgG;
    g.fillRect(c - r, c - r, r * 2, r * 2);
    if (m.ready && m.img) {
      try {
        g.drawImage(m.img, c - r * 1.08, c - r * 1.02, r * 2.16, r * 2.16);
      } catch {
        /* ignore */
      }
    } else {
      g.fillStyle = m.color;
      g.fillRect(c - r, c - r, r * 2, r * 2);
      g.fillStyle = '#fff';
      g.font = `${Math.round(r * 1.2)}px ${getComputedStyle(document.documentElement).getPropertyValue('--ssk-font-display') || 'sans-serif'}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(racerInitial(m.racer), c, c + r * 0.08);
    }
    g.restore();
    m.sprite = cv;
    m.spriteR = r;
    return cv;
  }

  draw(state, time) {
    if (!this.ok || !this.cssW) return;
    if (this.dirty) this._renderStatic();
    const g = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    g.clearRect(0, 0, W, H);
    g.drawImage(this.bg, 0, 0);
    const racers = state.racers;
    if (!Array.isArray(racers)) return;
    const pt = { x: 0, y: 0 };
    let player = null;
    for (let i = racers.length - 1; i >= 0; i--) {
      const r = racers[i];
      if (!Number.isFinite(r.x) || !Number.isFinite(r.z)) continue;
      if (r.isPlayer) {
        player = r;
        continue;
      }
      const m = this.markers.get(r.id);
      if (!m) continue;
      this._map(r.x, r.z, pt);
      const sp = this._sprite(m, Math.round(this.markR));
      g.drawImage(sp, Math.round(pt.x - sp.width / 2), Math.round(pt.y - sp.height / 2));
    }
    if (player) {
      const m = this.markers.get(player.id);
      this._map(player.x, player.z, pt);
      const r = Math.round(this.markR * 1.28);
      // pulsing highlight ring
      const pulse = (Math.sin(time * 6) + 1) / 2;
      g.beginPath();
      g.arc(pt.x, pt.y, r * (1.45 + pulse * 0.35), 0, TAU);
      g.fillStyle = `rgba(39, 211, 240, ${0.18 + 0.2 * (1 - pulse)})`;
      g.fill();
      g.lineWidth = Math.max(1.5, r * 0.14);
      g.strokeStyle = `rgba(255, 255, 255, ${0.55 + 0.45 * (1 - pulse)})`;
      g.stroke();
      // heading arrow
      if (Number.isFinite(player.yaw)) {
        const fx = Math.sin(player.yaw);
        const fz = Math.cos(player.yaw);
        const ang = Math.atan2(fx * this.s + fz * this.c, fx * this.c - fz * this.s);
        g.save();
        g.translate(pt.x, pt.y);
        g.rotate(ang);
        const tip = r * 1.95;
        g.beginPath();
        g.moveTo(tip, 0);
        g.lineTo(r * 1.1, -r * 0.62);
        g.lineTo(r * 1.1, r * 0.62);
        g.closePath();
        g.lineJoin = 'round';
        g.lineWidth = Math.max(2, r * 0.22);
        g.strokeStyle = INK;
        g.stroke();
        g.fillStyle = '#ffd23f';
        g.fill();
        g.restore();
      }
      if (m) {
        const sp = this._sprite(m, r);
        g.drawImage(sp, Math.round(pt.x - sp.width / 2), Math.round(pt.y - sp.height / 2));
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------------------
// Traffic light (top-centre)
// ---------------------------------------------------------------------------------------------------------

class TrafficLight {
  constructor(parent) {
    this.root = h('div', 'hud-lights', parent);
    h('div', 'hud-lights-halo', this.root);
    const panel = h('div', 'hud-lights-panel', this.root);
    this.lamps = [0, 1, 2].map(() => h('div', 'hud-lamp', panel));
    this.hideTimer = 0;
  }

  set(n) {
    clearTimeout(this.hideTimer);
    this.root.classList.add('hud-on');
    const lit = n > 0 ? 4 - n : 3;
    this.lamps.forEach((l, i) => {
      l.classList.toggle('hud-red', n > 0 && i < lit);
      l.classList.toggle('hud-go', n <= 0);
    });
    const newest = this.lamps[Math.min(2, Math.max(0, lit - 1))];
    if (n > 0) play(newest, [{ transform: 'scale(1.35)' }, { transform: 'scale(1)' }], { duration: 260, easing: 'ease-out' });
    else {
      for (const l of this.lamps) play(l, [{ transform: 'scale(1.3)' }, { transform: 'scale(1)' }], { duration: 300, easing: 'ease-out' });
      this.hideTimer = setTimeout(() => this.hide(), 1500);
    }
  }

  hide() {
    clearTimeout(this.hideTimer);
    this.root.classList.remove('hud-on');
  }

  dispose() {
    clearTimeout(this.hideTimer);
  }
}

// ---------------------------------------------------------------------------------------------------------
// Speed lines (canvas, drawn only while boosting)
// ---------------------------------------------------------------------------------------------------------

class SpeedLines {
  constructor(parent) {
    this.canvas = h('canvas', 'hud-fx-speed', parent);
    this.ctx = this.canvas.getContext('2d');
    this.active = false;
    this.fade = 0;
    this.frame = 0;
    this.needsSize = true;
    this.seed = 1;
  }

  _rand() {
    // cheap LCG so the flicker pattern costs no allocations
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  update(on, dt, intensity = 1) {
    this.fade = on ? Math.min(1, this.fade + dt * 8) : Math.max(0, this.fade - dt * 3);
    if (this.fade <= 0) {
      if (this.active) {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.active = false;
      }
      return;
    }
    this.active = true;
    if (this.needsSize) {
      this.needsSize = false;
      const s = Math.min(0.5, 960 / Math.max(1, window.innerWidth));
      this.canvas.width = Math.max(2, Math.round(window.innerWidth * s));
      this.canvas.height = Math.max(2, Math.round(window.innerHeight * s));
    }
    if (this.frame++ % 2) return; // ~30 Hz flicker, like hand-drawn anime speed lines
    const g = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    g.clearRect(0, 0, W, H);
    const cx = W / 2;
    const cy = H * 0.52;
    const rx = W * 0.62;
    const ry = H * 0.66;
    const n = 70;
    for (let i = 0; i < n; i++) {
      const a = this._rand() * TAU;
      const w = 0.004 + this._rand() * 0.012;
      const r0 = 0.62 + this._rand() * 0.3;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      g.globalAlpha = (0.25 + this._rand() * 0.55) * this.fade * intensity;
      g.fillStyle = i % 5 === 0 ? '#bfefff' : '#ffffff';
      g.beginPath();
      g.moveTo(cx + ca * rx * r0, cy + sa * ry * r0);
      g.lineTo(cx + Math.cos(a - w) * rx * 1.7, cy + Math.sin(a - w) * ry * 1.7);
      g.lineTo(cx + Math.cos(a + w) * rx * 1.7, cy + Math.sin(a + w) * ry * 1.7);
      g.closePath();
      g.fill();
    }
    g.globalAlpha = 1;
  }
}

// ---------------------------------------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------------------------------------

export class HUD {
  constructor(root, opts = {}) {
    this.root = root;
    this.opts = opts;
    this.settings = opts.settings || {};
    this.mode = opts.mode || 'vs';
    this.laps = opts.laps || 3;
    this.racers = Array.isArray(opts.racers) ? opts.racers : [];
    this.portraits = opts.portraits || null;
    this.track = opts.track || {};
    this.time = 0;
    this.disposed = false;
    this.visible = false;
    this.phase = null;
    this.mapMode = null;
    this.flags = {};
    this._lastCount = null;
    this._lapCount = 0;
    this._finishTime = null;
    this._portraitCheck = 0;
    this._titleShown = false;
    this._timers = new Set();

    const el = h('div', `hud-root hud-hidden hud-mode-${this.mode}`, root);
    this.el = el;
    if (this.racers.length <= 1) el.classList.add('hud-solo');
    this.fx = h('div', 'hud-fx', el);
    this.panels = h('div', 'hud-panels', el);
    this.center = h('div', 'hud-center', el);
    this.topLayer = h('div', 'hud-top', el);

    // effects (bottom layer)
    this.speed = new SpeedLines(this.fx);
    h('div', 'hud-fx-boost', this.fx);
    h('div', 'hud-fx-shrink', this.fx);
    h('div', 'hud-fx-danger', this.fx);
    h('div', 'hud-fx-inv-glow', this.fx);
    h('div', 'hud-fx-inv', this.fx);
    h('div', 'hud-fx-respawn', this.fx, '<i></i>');
    this.flashEl = h('div', 'hud-fx-flash', this.fx);

    // panels
    this.item = new ItemSlot(this.panels, this);
    this.alert = new IncomingAlert(this.item.wrap);
    this.ranking = new Ranking(this.panels, this.racers, this.portraits);
    const bl = h('div', 'hud-bl', this.panels);
    this.coins = new Coins(bl);
    this.lap = new LapCounter(bl);
    this.place = new PlaceIndicator(this.panels);
    this.timer = new RaceTimer(this.panels, this.mode);
    this.map = new Minimap(this.panels, this.track, this.racers, this.portraits);

    // centre stage
    this.lights = new TrafficLight(this.center);
    this.wrong = h('div', 'hud-wrong', this.center);
    h('div', 'hud-wrong-icon', this.wrong, UTURN_SVG);
    const plate = h('div', 'hud-wrong-plate', this.wrong);
    new OText(plate, 'hud-wrong-text', 'WRONG WAY!');
    this.toasts = h('div', 'hud-toasts', this.topLayer);

    this.lap.set(1, this.laps);
    this.place.set(this.racers.length || 1);
    this.timer.set(0);
    this.coins.update(0, 10);
    this._setPhase('intro');
    this._applyMapMode();

    this._onResize = () => {
      this.map.needsMeasure = true;
      this.speed.needsSize = true;
    };
    window.addEventListener('resize', this._onResize);
  }

  // ------------------------------------------------------------------------------------------ public API

  show() {
    if (this.disposed) return;
    this.visible = true;
    this.el.classList.remove('hud-hidden');
    this.map.needsMeasure = true;
  }

  hide() {
    this.visible = false;
    this.el.classList.add('hud-hidden');
  }

  setSettings(settings) {
    this.settings = settings || {};
    this._applyMapMode();
  }

  setTrack(track) {
    this.track = track || {};
    this.map.setTrack(this.track);
    this.map.needsMeasure = true;
  }

  update(s, dt = 1 / 60) {
    if (this.disposed || !s) return;
    dt = clamp(Number.isFinite(dt) ? dt : 1 / 60, 0, 0.1);
    this.time += dt;
    // reads first (layout), writes after
    this.map.measure();

    const phase = s.phase || 'racing';
    if (phase !== this.phase) this._setPhase(phase, s);
    this._applyMapMode();
    if (s.laps && s.laps !== this.laps) this.laps = s.laps;

    // countdown fallback (Race normally calls countdown(n) itself)
    if (phase === 'countdown' && s.countdown != null) {
      const n = Math.ceil(s.countdown);
      if (n >= 1 && n <= 3 && n !== this._lastCount) this.countdown(n);
    }
    if (phase === 'racing' && this._lastCount != null && this._lastCount > 0) this.countdown(0);

    // timer
    let t = phase === 'intro' || phase === 'countdown' ? 0 : s.time || 0;
    if (s.finished) {
      if (this._finishTime == null) {
        const lt = s.lapTimes || [];
        const sum = lt.reduce((a, b) => a + b, 0);
        this._finishTime = lt.length >= (s.laps || this.laps) && sum > 0 ? sum : t;
      }
      t = this._finishTime;
    }
    this.timer.set(t);
    if (this.mode === 'tt') this.timer.setRecord(s.ttRecord);
    this._flag('finished', 'hud-finished', !!s.finished);

    const laps = s.laps || this.laps;
    this.lap.set(clamp(s.lap || 1, 1, laps), laps);
    if (s.place) this.place.set(s.place);
    this.coins.update(s.coins ?? 0, s.maxCoins ?? 10);
    this.item.update(s.item || {}, dt, phase);
    const danger = this.alert.update(s.incoming);
    this._flag('danger1', 'hud-danger-1', danger === 1);
    this._flag('danger2', 'hud-danger-2', danger === 2);
    if (Array.isArray(s.racers)) this.ranking.update(s.racers);
    if (this.visible) this.map.draw(s, this.time);

    // effects
    const racing = phase === 'racing';
    this._flag('boost', 'hud-boost', !!s.boosting && racing);
    this.speed.update(!!s.boosting && racing && this.visible, dt, s.invincible ? 1.2 : 1);
    this._flag('shrunk', 'hud-shrunk', !!s.shrunk);
    this._flag('inv', 'hud-invincible', !!s.invincible);
    this._flag('respawn', 'hud-respawning', !!s.respawning);
    this._flag('wrong', null, !!s.wrongWay && racing && !s.finished, (on) => this.wrong.classList.toggle('hud-on', on));

    // lap splits
    const lt = s.lapTimes;
    if (Array.isArray(lt) && lt.length !== this._lapCount) {
      if (lt.length > this._lapCount) for (let i = this._lapCount; i < lt.length; i++) this.timer.addSplit(i, lt[i], lt.slice(0, i + 1), this.mode === 'tt');
      this._lapCount = lt.length;
    }

    // portraits may finish generating after the HUD was built
    this._portraitCheck -= dt;
    if (this._portraitCheck <= 0) {
      this._portraitCheck = 1;
      this.ranking.refreshPortraits();
      this.map.refreshPortraits();
    }
  }

  countdown(n) {
    if (this.disposed) return;
    n = Math.max(0, n | 0);
    this._lastCount = n;
    this.hideTitleCard();
    this.lights.set(n);
    const go = n === 0;
    const wrap = h('div', `hud-count${go ? ' hud-count-go' : ''}`, this.center);
    const box = h('div', 'hud-count-in', wrap);
    if (go) {
      h('div', 'hud-go-ray', box);
      h('div', 'hud-go-ring', box);
      h('div', 'hud-go-ring', box);
    }
    new OText(box, '', go ? 'GO!' : String(n));
    for (const old of this.center.querySelectorAll('.hud-count')) if (old !== wrap) old.remove();
    const dur = go ? 1300 : 950;
    const a = play(
      box,
      go
        ? [
            { transform: 'scale(3) rotate(-10deg)', opacity: 0 },
            { transform: 'scale(0.86) rotate(2deg)', opacity: 1, offset: 0.14 },
            { transform: 'scale(1.1) rotate(-1deg)', opacity: 1, offset: 0.24 },
            { transform: 'scale(1) rotate(0)', opacity: 1, offset: 0.34 },
            { transform: 'scale(1.04) rotate(0)', opacity: 1, offset: 0.75 },
            { transform: 'scale(1.6) rotate(0)', opacity: 0 },
          ]
        : [
            { transform: 'scale(2.6) rotate(-12deg)', opacity: 0 },
            { transform: 'scale(0.82) rotate(3deg)', opacity: 1, offset: 0.16 },
            { transform: 'scale(1.12) rotate(-2deg)', opacity: 1, offset: 0.28 },
            { transform: 'scale(1) rotate(0)', opacity: 1, offset: 0.38 },
            { transform: 'scale(1) rotate(0)', opacity: 1, offset: 0.78 },
            { transform: 'scale(0.55) translateY(-18%)', opacity: 0 },
          ],
      { duration: dur, easing: 'linear', fill: 'forwards' },
    );
    if (go) {
      box.querySelectorAll('.hud-go-ring').forEach((r, i) =>
        play(r, [{ transform: 'scale(0.4)', opacity: 1 }, { transform: 'scale(2.2)', opacity: 0 }], { duration: 700, delay: 80 + i * 160, easing: 'cubic-bezier(.2,.8,.3,1)', fill: 'backwards' }),
      );
      play(box.querySelector('.hud-go-ray'), [{ transform: 'rotate(0) scale(0.6)', opacity: 0 }, { transform: 'rotate(20deg) scale(1)', opacity: 1, offset: 0.2 }, { transform: 'rotate(60deg) scale(1.2)', opacity: 0 }], { duration: 1200 });
    }
    const rm = () => wrap.remove();
    if (a) a.onfinish = rm;
    else this._later(rm, dur);
  }

  lapBanner(lap, laps) {
    if (this.disposed) return;
    laps = laps || this.laps;
    const final = lap >= laps && laps > 1;
    const b = h('div', `hud-banner ${final ? 'hud-banner-final' : 'hud-banner-lap'}`, this.center);
    const band = h('div', 'hud-banner-band', b);
    const text = h('div', 'hud-banner-text', b);
    if (final) new OText(text, 'hud-banner-big', 'FINAL LAP!');
    else {
      new OText(text, 'hud-banner-lab', 'LAP');
      new OText(text, 'hud-banner-big', `${lap}/${laps}`);
    }
    const dur = final ? 2900 : 2300;
    play(band, [{ transform: 'skewY(-3deg) scaleY(0)', opacity: 0 }, { transform: 'skewY(-3deg) scaleY(1.15)', opacity: 1, offset: 0.08 }, { transform: 'skewY(-3deg) scaleY(1)', opacity: 1, offset: 0.14 }, { transform: 'skewY(-3deg) scaleY(1)', opacity: 1, offset: 0.84 }, { transform: 'skewY(-3deg) scaleY(0)', opacity: 0 }], { duration: dur, fill: 'forwards' });
    const a = play(
      text,
      [
        { transform: 'translateX(70vw) skewX(-18deg)', opacity: 0 },
        { transform: 'translateX(-3vw) skewX(8deg)', opacity: 1, offset: 0.13 },
        { transform: 'translateX(1vw) skewX(-3deg)', opacity: 1, offset: 0.2 },
        { transform: 'translateX(0) skewX(0)', opacity: 1, offset: 0.26 },
        { transform: 'translateX(-1.5vw) skewX(0)', opacity: 1, offset: 0.8 },
        { transform: 'translateX(-75vw) skewX(18deg)', opacity: 0 },
      ],
      { duration: dur, easing: 'ease-in-out', fill: 'forwards' },
    );
    if (final) play(text, [{ filter: 'brightness(1)' }, { filter: 'brightness(1.5)' }, { filter: 'brightness(1)' }], { duration: 260, delay: 600, iterations: 5 });
    const rm = () => b.remove();
    if (a) a.onfinish = rm;
    else this._later(rm, dur);
    play(this.lap.root, [{ transform: 'scale(1)' }, { transform: 'scale(1.18)' }, { transform: 'scale(1)' }], { duration: 500, delay: 250, easing: 'ease-out' });
  }

  finishBanner(place) {
    if (this.disposed) return;
    this.center.querySelector('.hud-finish')?.remove();
    this.hideTitleCard();
    const f = h('div', 'hud-finish', this.center);
    const ca = h('div', 'hud-finish-check hud-a', f);
    const cb = h('div', 'hud-finish-check hud-b', f);
    const band = h('div', 'hud-finish-band', f);
    const txt = new OText(f, 'hud-finish-text', 'FINISH!');
    if (place > 0) {
      const sub = h('div', 'hud-finish-sub', f);
      h('b', '', sub).textContent = `${place | 0}${ordinalSuffix(place | 0)}`;
      sub.appendChild(document.createTextNode(' PLACE'));
      play(sub, [{ opacity: 0, transform: 'translate(-50%, 60%) scale(0.8)' }, { opacity: 1, transform: 'translate(-50%, 0) scale(1)' }], { duration: 420, delay: 650, fill: 'backwards', easing: 'cubic-bezier(.3,1.4,.5,1)' });
    }
    play(band, [{ transform: 'skewY(-3deg) scaleY(0)' }, { transform: 'skewY(-3deg) scaleY(1.1)', offset: 0.6 }, { transform: 'skewY(-3deg) scaleY(1)' }], { duration: 380, easing: 'ease-out' });
    play(ca, [{ transform: 'skewY(-3deg) translateX(-60%)', opacity: 0 }, { transform: 'skewY(-3deg) translateX(0)', opacity: 1 }], { duration: 520, easing: 'cubic-bezier(.2,.9,.3,1)' });
    play(cb, [{ transform: 'skewY(-3deg) translateX(60%)', opacity: 0 }, { transform: 'skewY(-3deg) translateX(0)', opacity: 1 }], { duration: 520, easing: 'cubic-bezier(.2,.9,.3,1)' });
    play(ca, [{ backgroundPosition: '0 0' }, { backgroundPosition: 'calc(var(--u) * 32) 0' }], { duration: 1600, iterations: Infinity, delay: 520 });
    play(cb, [{ backgroundPosition: '0 0' }, { backgroundPosition: 'calc(var(--u) * -32) 0' }], { duration: 1600, iterations: Infinity, delay: 520 });
    play(
      txt.wrap,
      [
        { transform: 'scale(3.2) rotate(-8deg)', opacity: 0 },
        { transform: 'scale(0.85) rotate(2deg)', opacity: 1, offset: 0.45 },
        { transform: 'scale(1.08) rotate(-1deg)', offset: 0.7 },
        { transform: 'scale(1) rotate(0)' },
      ],
      { duration: 620, easing: 'ease-out' },
    );
    this.flash('finish');
  }

  titleCard(name, subtitle, opts = {}) {
    if (this.disposed) return;
    this.hideTitleCard(true);
    this._titleShown = true;
    const card = h('div', 'hud-title', this.topLayer);
    this.title = card;
    h('div', 'hud-title-bg', card);
    h('div', 'hud-title-accent', card);
    h('div', 'hud-title-halo', card);
    const mapBox = h('div', 'hud-title-map', card);
    const sub = h('div', 'hud-title-sub', card);
    sub.textContent = subtitle || this._defaultSubtitle();
    const nm = h('div', 'hud-title-name', card);
    nm.textContent = name || this.track?.name || '';
    const line = h('div', 'hud-title-line', card);
    const foot = h('div', 'hud-title-foot', card);
    const chip = h('span', 'hud-title-chip', foot);
    chip.textContent = this.mode === 'tt' ? `${this.laps} LAPS · TIME TRIAL` : `${this.laps} LAPS · ${this.racers.length || 8} RACERS`;
    h('span', 'hud-title-skip', foot, '<kbd>Enter</kbd> Skip');
    this._drawTitleMap(mapBox);
    play(card, [{ transform: 'translateX(-105%) skewX(0)', opacity: 0 }, { transform: 'translateX(2%) skewX(0)', opacity: 1, offset: 0.7 }, { transform: 'translateX(0)', opacity: 1 }], { duration: 650, easing: 'cubic-bezier(.2,.9,.3,1)' });
    play(nm, [{ transform: 'translateX(-12%)', opacity: 0 }, { transform: 'translateX(0)', opacity: 1 }], { duration: 520, delay: 220, easing: 'ease-out', fill: 'backwards' });
    play(sub, [{ opacity: 0, transform: 'translateY(60%)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 400, delay: 120, fill: 'backwards' });
    play(line, [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: 900, delay: 350, easing: 'cubic-bezier(.2,.9,.3,1)', fill: 'backwards' });
    play(mapBox, [{ opacity: 0, transform: 'scale(0.6) rotate(-10deg)' }, { opacity: 1, transform: 'scale(1) rotate(0)' }], { duration: 600, delay: 380, easing: 'cubic-bezier(.3,1.4,.5,1)', fill: 'backwards' });
    const dur = opts.duration ?? 0;
    if (dur > 0) this._later(() => this.title === card && this.hideTitleCard(), dur * 1000);
  }

  hideTitleCard(instant = false) {
    const card = this.title;
    if (!card) return;
    this.title = null;
    if (instant) {
      card.remove();
      return;
    }
    const a = play(card, [{ transform: 'translateX(0)', opacity: 1 }, { transform: 'translateX(-110%)', opacity: 0 }], { duration: 420, easing: 'cubic-bezier(.6,0,.8,.4)', fill: 'forwards' });
    if (a) a.onfinish = () => card.remove();
    else card.remove();
  }

  notify(text, opts = {}) {
    if (this.disposed || !text) return;
    const t = h('div', 'hud-toast', this.toasts);
    if (opts.color) t.style.setProperty('--tc', opts.color);
    const icon = opts.icon;
    if (icon) {
      const box = h('div', 'hud-toast-icon', t);
      if (typeof icon === 'string' && ITEMS[icon]) {
        const img = h('img', '', box);
        img.alt = '';
        img.src = itemIconURL(icon);
      } else if (typeof icon === 'string' && icon === 'coin') box.innerHTML = coinIconSVG();
      else if (typeof icon === 'string' && /^<svg[\s>]/i.test(icon.trim())) box.innerHTML = icon;
      else if (typeof icon === 'string' && /^(data:image\/|blob:|\/|\.\/|https?:)/.test(icon)) {
        const img = h('img', '', box);
        img.alt = '';
        img.src = icon;
      } else box.remove();
    }
    const span = h('span', 'hud-toast-text', t);
    span.textContent = String(text);
    while (this.toasts.children.length > 3) this.toasts.firstElementChild.remove();
    play(t, [{ transform: 'translateY(-60%) scale(0.8)', opacity: 0 }, { transform: 'translateY(4%) scale(1.04)', opacity: 1, offset: 0.7 }, { transform: 'translateY(0) scale(1)', opacity: 1 }], { duration: 320, easing: 'ease-out' });
    const dur = (opts.duration ?? 2.6) * 1000;
    this._later(() => {
      if (!t.isConnected) return;
      const a = play(t, [{ transform: 'translateX(0)', opacity: 1 }, { transform: 'translateX(12%)', opacity: 0 }], { duration: 280, fill: 'forwards' });
      if (a) a.onfinish = () => t.remove();
      else t.remove();
    }, dur);
  }

  flash(kind = 'white', opts = {}) {
    if (this.disposed) return;
    const k = String(kind);
    const i = opts.intensity ?? 1;
    const fl = (bg, dur = 450, peak = 1) =>
      play(this.flashEl, [{ opacity: 0, background: bg }, { opacity: peak * i, background: bg, offset: 0.12 }, { opacity: 0, background: bg }], { duration: dur, easing: 'ease-out' });
    switch (k) {
      case 'hit':
        fl('radial-gradient(ellipse 75% 70% at 50% 50%, rgba(255,40,60,.12) 30%, rgba(255,20,50,.75) 100%)', 650);
        play(this.panels, [{ transform: 'translate(0,0)' }, { transform: 'translate(-0.8vmin, 0.5vmin)' }, { transform: 'translate(0.7vmin, -0.6vmin)' }, { transform: 'translate(-0.4vmin, 0.3vmin)' }, { transform: 'translate(0,0)' }], { duration: 360 });
        break;
      case 'boost':
        fl('radial-gradient(ellipse 80% 70% at 50% 55%, rgba(180,240,255,0) 45%, rgba(180,240,255,.6) 100%)', 380, 0.9);
        break;
      case 'shrink':
      case 'tablet':
        fl('radial-gradient(circle at 50% 50%, rgba(120,220,255,.55), rgba(40,140,255,.8))', 700, 0.85);
        break;
      case 'halo':
      case 'invincible':
        fl('radial-gradient(ellipse 80% 70% at 50% 50%, rgba(255,240,170,.25) 30%, rgba(255,200,40,.75) 100%)', 600, 0.9);
        break;
      case 'coin':
        this.coins.sparkle(8);
        break;
      case 'item':
      case 'itemGet':
        this.item.pulse();
        break;
      case 'respawn':
        fl('rgba(255,255,255,.9)', 600, 0.7);
        break;
      case 'finish':
        fl('radial-gradient(circle at 50% 40%, rgba(255,255,255,.85), rgba(255,236,150,.4) 60%, rgba(255,210,63,0))', 700, 0.8);
        break;
      default:
        fl('rgba(255,255,255,.85)', 400, 0.8);
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    window.removeEventListener('resize', this._onResize);
    for (const t of this._timers) clearTimeout(t);
    this._timers.clear();
    this.timer.dispose();
    this.lights.dispose();
    this.el.remove();
  }

  // ------------------------------------------------------------------------------------------ internals

  _sfx(name) {
    try {
      this.opts.sfx?.(name);
    } catch {
      /* ignore */
    }
  }

  _later(fn, ms) {
    const id = setTimeout(() => {
      this._timers.delete(id);
      if (!this.disposed) fn();
    }, ms);
    this._timers.add(id);
    return id;
  }

  _flag(key, cls, on, fn) {
    if (this.flags[key] === on) return;
    this.flags[key] = on;
    if (cls) this.el.classList.toggle(cls, on);
    fn?.(on);
  }

  _setPhase(phase, s) {
    const prev = this.phase;
    if (prev) this.el.classList.remove(`hud-phase-${prev}`);
    this.phase = phase;
    this.el.classList.add(`hud-phase-${phase}`);
    if (phase === 'intro' && prev && !this._titleShown && this.track?.name) this.titleCard(this.track.name, this.opts.subtitle);
    if (phase === 'countdown' || phase === 'racing') this.hideTitleCard();
    if (phase === 'finished' && s && !this.center.querySelector('.hud-finish') && s.finished) this.finishBanner(s.place);
  }

  _applyMapMode() {
    const hm = this.settings?.hudMap;
    const m = hm === 'map' || hm === 'ranks' || hm === 'none' ? hm : 'both';
    if (m === this.mapMode) return;
    if (this.mapMode) this.el.classList.remove(`hud-map-${this.mapMode}`);
    this.mapMode = m;
    this.el.classList.add(`hud-map-${m}`);
    this.map.needsMeasure = true;
  }

  _defaultSubtitle() {
    const parts = [];
    if (this.opts.cupName) parts.push(this.opts.cupName);
    parts.push(MODE_LABEL[this.mode] || 'Race');
    return parts.join('  ·  ');
  }

  _drawTitleMap(box) {
    const pts = normalizeOutline(this.track?.outline);
    if (pts.length < 4) {
      box.remove();
      return;
    }
    const cv = h('canvas', '', box);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const size = Math.round((box.clientWidth || 120) * dpr);
    cv.width = cv.height = size;
    const g = cv.getContext('2d');
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (const p of pts) {
      x0 = Math.min(x0, p.x);
      x1 = Math.max(x1, p.x);
      z0 = Math.min(z0, p.z);
      z1 = Math.max(z1, p.z);
    }
    const pad = size * 0.1;
    const sc = Math.min((size - pad * 2) / Math.max(1, x1 - x0), (size - pad * 2) / Math.max(1, z1 - z0));
    const ox = size / 2 - ((x0 + x1) / 2) * sc;
    const oz = size / 2 - ((z0 + z1) / 2) * sc;
    g.beginPath();
    pts.forEach((p, i) => (i ? g.lineTo(ox + p.x * sc, oz + p.z * sc) : g.moveTo(ox + p.x * sc, oz + p.z * sc)));
    g.closePath();
    g.lineJoin = 'round';
    g.strokeStyle = 'rgba(31,182,255,.35)';
    g.lineWidth = size * 0.1;
    g.stroke();
    g.strokeStyle = INK;
    g.lineWidth = size * 0.05;
    g.stroke();
    g.strokeStyle = '#ffffff';
    g.lineWidth = size * 0.022;
    g.stroke();
    const p0 = pts[0];
    g.beginPath();
    g.arc(ox + p0.x * sc, oz + p0.z * sc, size * 0.045, 0, TAU);
    g.fillStyle = '#ffd23f';
    g.fill();
    g.lineWidth = size * 0.015;
    g.strokeStyle = INK;
    g.stroke();
  }
}

export default HUD;
