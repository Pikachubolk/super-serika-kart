// Full-screen overlays that live in #overlay (owner: frontend agent): boot splash, loading screen,
// wipe transition, toasts, fps meter and a lightweight 2D confetti system.

import { getTrackEntry, CUPS } from '../../data/tracks/index.js';
import { getCharacter } from '../../data/characters.js';
import { el, esc, sleep, TIPS, MODE_LABEL } from './kit.js';
import { logoSVG } from './logo.js';
import { mountOutline } from './trackPreview.js';
import { coinIconSVG, crystalIconSVG } from '../itemIcons.js';

// ------------------------------------------------------------------------------------------------
// Boot splash
// ------------------------------------------------------------------------------------------------

export class BootSplash {
  constructor(root) {
    this.el = el(`<div class="mn-boot">
      <div class="mn-boot-stripes"></div>
      <div class="mn-boot-center">
        <div class="mn-boot-logo">${logoSVG({ id: 'mnbootlogo', animated: false })}</div>
        <div class="mn-boot-bar"><div class="mn-boot-fill"></div></div>
        <div class="mn-boot-status">Connecting to the Shittim Chest...</div>
      </div>
      <div class="mn-boot-foot">Fan-made tribute &middot; not affiliated with NEXON Games or Yostar</div>
    </div>`);
    root.appendChild(this.el);
    this.fill = this.el.querySelector('.mn-boot-fill');
    this.status = this.el.querySelector('.mn-boot-status');
  }

  set(progress, text) {
    this.fill.style.transform = `scaleX(${Math.max(0.02, Math.min(1, progress))})`;
    if (text) this.status.textContent = text;
  }

  async close() {
    this.set(1);
    await sleep(180);
    this.el.classList.add('is-out');
    await sleep(520);
    this.el.remove();
  }
}

// ------------------------------------------------------------------------------------------------
// Loading screen (between menus and a race)
// ------------------------------------------------------------------------------------------------

export class LoadingScreen {
  /**
   * @param {HTMLElement} root overlay root
   * @param {{ trackId, mode, cc, raceIndex?, cupId?, characterId, portraits }} info
   */
  constructor(root, info) {
    this.info = info;
    this.shownAt = performance.now();
    const entry = getTrackEntry(info.trackId);
    const cup = CUPS.find((c) => c.id === (info.cupId || entry?.cup));
    const cupIcon = cup ? (cup.icon === 'coin' ? coinIconSVG() : crystalIconSVG()) : '';
    const modeBits = [MODE_LABEL[info.mode] || 'Race'];
    if (info.mode !== 'tt' && info.cc) modeBits.push(`${info.cc}cc`);
    if (info.mode === 'gp' && info.raceIndex != null) modeBits.push(`Race ${info.raceIndex + 1}/4`);
    const ch = getCharacter(info.characterId || 'serika');
    const serika = info.portraits?.get?.('serika') || '';
    const runner = info.portraits?.get?.(ch.id) || '';
    this.tipIndex = Math.floor(Math.random() * TIPS.length);
    this.el = el(`<div class="mn-loading" style="--mn-accent:${esc(entry?.color || '#1fb6ff')}">
      <div class="mn-loading-bg"></div>
      <div class="mn-loading-head">
        <div class="mn-loading-mode">${modeBits.map((b) => `<span>${esc(b)}</span>`).join('')}</div>
      </div>
      <div class="mn-loading-card">
        <div class="mn-loading-outline"></div>
        <div class="mn-loading-info">
          ${cup ? `<div class="mn-loading-cup"><span class="mn-loading-cupicon">${cupIcon}</span>${esc(cup.name)}</div>` : ''}
          <h2 class="mn-loading-name">${esc(entry?.name || info.trackId)}</h2>
          <p class="mn-loading-blurb">${esc(entry?.blurb || '')}</p>
        </div>
      </div>
      <div class="mn-loading-tip">
        <div class="mn-loading-tipface">${serika ? `<img src="${serika}" alt="">` : ''}</div>
        <div class="mn-loading-bubble"><b>SERIKA'S TIP</b><span class="mn-loading-tiptext">${TIPS[this.tipIndex]}</span></div>
      </div>
      <div class="mn-loading-foot">
        <div class="mn-loading-label">NOW LOADING<i>.</i><i>.</i><i>.</i></div>
        <div class="mn-loading-bar"><div class="mn-loading-fill"></div>
          <div class="mn-loading-runner">${runner ? `<img src="${runner}" alt="">` : ''}</div>
        </div>
      </div>
    </div>`);
    root.appendChild(this.el);
    mountOutline(this.el.querySelector('.mn-loading-outline'), info.trackId, { animated: true, cls: 'mn-outline mn-outline-big' });
    this.fill = this.el.querySelector('.mn-loading-fill');
    this.runner = this.el.querySelector('.mn-loading-runner');
    this.tipText = this.el.querySelector('.mn-loading-tiptext');
    this.progress = 0;
    this.setProgress(0.03);
    this._tipTimer = setInterval(() => this._nextTip(), 3800);
    requestAnimationFrame(() => this.el.classList.add('is-in'));
  }

  _nextTip() {
    this.tipIndex = (this.tipIndex + 1) % TIPS.length;
    this.tipText.classList.remove('is-swap');
    void this.tipText.offsetWidth;
    this.tipText.innerHTML = TIPS[this.tipIndex];
    this.tipText.classList.add('is-swap');
  }

  setProgress(p) {
    p = Math.max(this.progress, Math.max(0, Math.min(1, Number(p) || 0)));
    this.progress = p;
    this.fill.style.transform = `scaleX(${p})`;
    this.runner.style.left = `${p * 100}%`;
  }

  /** Waits for the minimum display time, completes the bar. Call close() afterwards. */
  async finish(minMs = 1300) {
    this.setProgress(1);
    const elapsed = performance.now() - this.shownAt;
    if (elapsed < minMs) await sleep(minMs - elapsed);
    await sleep(200);
  }

  async close() {
    clearInterval(this._tipTimer);
    this.el.classList.add('is-out');
    await sleep(480);
    this.el.remove();
  }

  destroy() {
    clearInterval(this._tipTimer);
    this.el.remove();
  }
}

// ------------------------------------------------------------------------------------------------
// Wipe transition (three slanted bands sweep across the screen)
// ------------------------------------------------------------------------------------------------

export async function wipe(root, midway) {
  const w = el(`<div class="mn-wipe"><i></i><i></i><i></i><div class="mn-wipe-halo"></div></div>`);
  root.appendChild(w);
  await sleep(30);
  w.classList.add('is-in');
  await sleep(430);
  try {
    await midway?.();
  } finally {
    await sleep(60);
    w.classList.add('is-out');
    await sleep(520);
    w.remove();
  }
}

// ------------------------------------------------------------------------------------------------
// Toast
// ------------------------------------------------------------------------------------------------

export function toast(root, text, { kind = 'info', duration = 3200 } = {}) {
  const t = el(`<div class="mn-toast mn-toast-${esc(kind)}">${esc(text)}</div>`);
  root.appendChild(t);
  requestAnimationFrame(() => t.classList.add('is-in'));
  setTimeout(() => {
    t.classList.remove('is-in');
    setTimeout(() => t.remove(), 400);
  }, duration);
}

// ------------------------------------------------------------------------------------------------
// FPS meter
// ------------------------------------------------------------------------------------------------

export class FpsMeter {
  constructor(root) {
    this.el = el(`<div class="mn-fps">-- fps</div>`);
    root.appendChild(this.el);
    this._t = 0;
  }
  set visible(v) {
    this.el.style.display = v ? '' : 'none';
  }
  update(dt, fps) {
    this._t += dt;
    if (this._t < 0.25) return;
    this._t = 0;
    this.el.textContent = `${fps} fps`;
    this.el.classList.toggle('is-low', fps < 50);
  }
  dispose() {
    this.el.remove();
  }
}

// ------------------------------------------------------------------------------------------------
// Confetti (canvas 2D, driven by the game loop)
// ------------------------------------------------------------------------------------------------

const CONFETTI_COLORS = ['#ff3355', '#ffd23f', '#1fb6ff', '#2fd27e', '#ff7ab8', '#ffffff', '#9b6bff', '#27d3f0'];

export class Confetti {
  constructor(parent, { max = 420 } = {}) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'mn-confetti';
    parent.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.parts = [];
    this.max = max;
    this.rainRate = 0;
    this._acc = 0;
    this._resize();
  }

  _resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    this.w = w;
    this.h = h;
    this.dpr = dpr;
  }

  _spawn(x, y, vx, vy) {
    if (this.parts.length >= this.max) return;
    this.parts.push({
      x,
      y,
      vx,
      vy,
      rot: Math.random() * 6.28,
      vr: (Math.random() - 0.5) * 12,
      flip: Math.random() * 6.28,
      vf: 4 + Math.random() * 8,
      w: 7 + Math.random() * 7,
      h: 4 + Math.random() * 5,
      color: CONFETTI_COLORS[(Math.random() * CONFETTI_COLORS.length) | 0],
      shape: Math.random() < 0.18 ? 1 : 0,
      life: 0,
    });
  }

  /** Burst from a point (fractions of the screen). */
  burst(fx, fy, n = 120, power = 1) {
    this._resize();
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
      const s = (380 + Math.random() * 620) * power;
      this._spawn(fx * this.w, fy * this.h, Math.cos(a) * s, Math.sin(a) * s);
    }
  }

  /** Continuous rain from the top (particles per second). */
  rain(rate = 60) {
    this.rainRate = rate;
  }

  update(dt) {
    this._resize();
    if (this.rainRate > 0) {
      this._acc += dt * this.rainRate;
      while (this._acc >= 1) {
        this._acc -= 1;
        this._spawn(Math.random() * this.w, -20, (Math.random() - 0.5) * 80, 60 + Math.random() * 120);
      }
    }
    const g = this.ctx;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.w, this.h);
    const drag = Math.exp(-1.6 * dt);
    const parts = this.parts;
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life += dt;
      p.vx *= drag;
      p.vy = p.vy * drag + 520 * dt;
      if (p.vy > 170) p.vy = damp1(p.vy, 170, dt);
      p.x += (p.vx + Math.sin(p.life * 3 + p.flip) * 40) * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      p.flip += p.vf * dt;
      if (p.y > this.h + 30) {
        parts.splice(i, 1);
        continue;
      }
      g.save();
      g.translate(p.x, p.y);
      g.rotate(p.rot);
      g.scale(1, Math.cos(p.flip));
      g.fillStyle = p.color;
      if (p.shape) {
        g.beginPath();
        g.arc(0, 0, p.h * 0.7, 0, Math.PI * 2);
        g.fill();
      } else g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      g.restore();
    }
  }

  dispose() {
    this.canvas.remove();
    this.parts.length = 0;
  }
}

const damp1 = (v, target, dt) => target + (v - target) * Math.exp(-4 * dt);
