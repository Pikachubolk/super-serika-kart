// Sound Test / jukebox (owner: frontend agent): every song of the soundtrack (src/core/audio/songs.js
// SOUNDTRACK), a live spectrum from the AudioManager's analyser, prev / play-stop / next, and "Use for races"
// for the race-capable tracks (sets Options -> Race Music). Opened from Options -> Sound.

import { Screen, topbar, footer, chip } from './Screen.js';
import { el, esc, ICONS } from './kit.js';
import { SONGS, SOUNDTRACK } from '../../core/audio/songs.js';

const BARS = 40;

let cssDone = false;
function injectCSS() {
  if (cssDone || typeof document === 'undefined') return;
  cssDone = true;
  const s = document.createElement('style');
  s.id = 'ssk-sound-css';
  s.textContent = `
.mn-snd-body { position:absolute; inset: calc(clamp(58px,9.5vh,76px) + clamp(10px,2.4vh,22px)) clamp(12px,3vw,44px) 56px; display:grid; grid-template-columns: minmax(0,1.1fr) minmax(0,1fr); gap: clamp(10px,1.8vw,24px); }
.mn-snd-list { overflow:auto; padding: 8px; scrollbar-width: thin; animation: mn-rise .45s var(--mn-smooth) both; }
.mn-snd-row { display:grid; grid-template-columns: 30px minmax(0,1fr) auto 22px; gap:10px; align-items:center; width:100%; padding:6px 10px; margin:2px 0; border:none; border-radius:10px; background:transparent; color:var(--mn-navy); text-align:left; cursor:pointer; transition: background .15s, transform .15s var(--mn-bounce); }
.mn-snd-row:nth-child(odd) { background: #f5f9ff; }
.mn-snd-row.is-focus { background: linear-gradient(100deg,#e6f5ff,#d4ecff); box-shadow: inset 4px 0 0 var(--mn-blue); transform: translateX(3px); }
.mn-snd-row.is-playing { background: linear-gradient(100deg,#fff6c4,#ffe58a); }
.mn-snd-no { font:400 15px/1 var(--ssk-font-display); color:#8a97b0; text-align:right; }
.mn-snd-name { min-width:0; }
.mn-snd-name b { display:block; font:400 17px/1.1 var(--ssk-font-display); letter-spacing:.02em; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.mn-snd-name small { display:block; margin-top:2px; font:800 11px/1.2 var(--ssk-font-ui); color:#6b7893; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.mn-snd-tag { font:800 10px/1 var(--ssk-font-ui); padding:4px 7px; border-radius:999px; background:#dfe7f3; color:#52617e; letter-spacing:.06em; text-transform:uppercase; white-space:nowrap; }
.mn-snd-tag.is-race { background: linear-gradient(90deg,#ff6b87,#ff3355); color:#fff; }
.mn-snd-eq { display:flex; gap:2px; align-items:flex-end; height:14px; opacity:0; }
.mn-snd-row.is-playing .mn-snd-eq { opacity:1; }
.mn-snd-eq i { width:4px; background: var(--mn-blue2); border-radius:2px; animation: mn-snd-eq .8s ease-in-out infinite; }
.mn-snd-eq i:nth-child(2) { animation-delay: -.3s; } .mn-snd-eq i:nth-child(3) { animation-delay: -.55s; }
@keyframes mn-snd-eq { 0%,100% { height:4px; } 50% { height:14px; } }
.mn-snd-now { display:flex; flex-direction:column; gap:10px; padding: clamp(12px,2vh,20px) clamp(14px,2vw,24px); animation: mn-rise .45s .08s var(--mn-smooth) both; min-height:0; }
.mn-snd-now > small { font:800 12px/1 var(--ssk-font-ui); letter-spacing:.14em; color: var(--mn-blue); }
.mn-snd-title { margin:0; font:400 clamp(24px,4.4vh,36px)/1.05 var(--ssk-font-display); color: var(--mn-navy); }
.mn-snd-where { margin:0; font:800 13px/1.3 var(--ssk-font-ui); color:#52617e; }
.mn-snd-viz { width:100%; flex:1 1 auto; min-height:60px; max-height:200px; border-radius:14px; background: linear-gradient(180deg,#16213a,#0d1730); box-shadow: inset 0 0 0 2px #2a3b66; }
.mn-snd-pos { font:800 13px/1 var(--ssk-font-ui); color:#52617e; display:flex; justify-content:space-between; }
.mn-snd-ctrl { display:flex; gap:8px; flex-wrap:wrap; }
.mn-snd-ctrl .mn-btn { flex:1 1 auto; min-width:0; font-size:17px; padding:10px 12px; }
.mn-snd-ctrl .mn-btn.is-on { background: linear-gradient(90deg,#2fd27e,#1fb86a); color:#fff; }
.mn-snd-ctrl .mn-btn[hidden] { display:none; }
@media (max-width: 760px) and (orientation: portrait) {
  .mn-snd-body { grid-template-columns: minmax(0,1fr); grid-template-rows: auto minmax(0,1fr); }
  .mn-snd-now { order:-1; }
  .mn-snd-viz { max-height: 90px; }
}
@media (orientation: landscape) and (max-height: 500px) {
  .mn-snd-body { inset: 58px max(10px, env(safe-area-inset-right,0px)) 8px max(10px, env(safe-area-inset-left,0px)); gap:10px; }
  .mn-snd-row { padding:3px 8px; }
  .mn-snd-name b { font-size:15px; }
  .mn-snd-now { gap:6px; padding:8px 12px; }
  .mn-snd-title { font-size:20px; }
  .mn-snd-ctrl .mn-btn { font-size:14px; padding:7px 8px; }
}`;
  document.head.appendChild(s);
}

const pad2 = (n) => String(n).padStart(2, '0');

export class SoundTestScreen extends Screen {
  /** Keep whatever is playing until the player picks a track. */
  get music() {
    return null;
  }

  build() {
    injectCSS();
    const rows = SOUNDTRACK.map((t, i) => {
      const song = SONGS[t.key];
      return `<button class="mn-snd-row" data-focus data-key="song:${t.key}">
        <span class="mn-snd-no">${pad2(i + 1)}</span>
        <span class="mn-snd-name"><b>${esc(song?.name || t.key)}</b><small>${esc(t.where)} &middot; ${song?.bpm || '?'} BPM</small></span>
        <span class="mn-snd-tag${t.race ? ' is-race' : ''}">${esc(t.style)}</span>
        <span class="mn-snd-eq"><i></i><i></i><i></i></span>
      </button>`;
    }).join('');
    const e = el(`<div class="mn-sound">
      ${topbar({ title: 'Sound Test', crumb: 'Shittim Chest Jukebox', right: chip(`${SOUNDTRACK.length} tracks`, 'mn-chip-mode'), color: '#ff4d8d' })}
      <div class="mn-snd-body">
        <section class="mn-panel mn-snd-list">${rows}</section>
        <section class="mn-panel mn-snd-now">
          <small>NOW PLAYING</small>
          <h2 class="mn-snd-title"></h2>
          <p class="mn-snd-where"></p>
          <canvas class="mn-snd-viz"></canvas>
          <div class="mn-snd-pos"><span data-pos></span><span data-bpm></span></div>
          <div class="mn-snd-ctrl">
            <button class="mn-btn" data-focus data-key="prev" aria-label="Previous">${ICONS.arrowL}</button>
            <button class="mn-btn mn-btn-primary" data-focus data-key="toggle"><span data-toggle>Stop</span></button>
            <button class="mn-btn" data-focus data-key="next" aria-label="Next">${ICONS.arrowR}</button>
            <button class="mn-btn" data-focus data-key="race">${ICONS.flag}<span data-race>Use for Races</span></button>
          </div>
        </section>
      </div>
      ${footer([
        ['ud', 'Choose'],
        ['confirm', 'Play'],
        ['back', 'Back'],
      ])}
    </div>`);
    this.canvas = e.querySelector('.mn-snd-viz');
    this._bins = null;
    this._levels = new Float32Array(BARS);
    return e;
  }

  enter() {
    this._sync();
  }

  get audio() {
    return this.game.audio;
  }

  get current() {
    const k = this.audio?.musicKey;
    return SOUNDTRACK.some((t) => t.key === k) ? k : null;
  }

  defaultFocus() {
    return this.el.querySelector(`[data-key="song:${this.current}"]`) || super.defaultFocus();
  }

  _play(key) {
    const a = this.audio;
    if (!a || !SONGS[key]) return;
    if (!a.unlocked) this.game.unlockAudio?.();
    a.setMusicTempo?.(1);
    a.playMusic(key, { fadeIn: 0.25, crossfade: 0.5, restart: true });
    // menus should restart their own music once we leave
    this.game._musicPlaying = null;
    this.game._musicKey = key;
    this._sync();
  }

  _step(dir) {
    const i = SOUNDTRACK.findIndex((t) => t.key === this.current);
    const next = SOUNDTRACK[(Math.max(0, i) + dir + SOUNDTRACK.length) % SOUNDTRACK.length];
    this._play(next.key);
    const row = this.el.querySelector(`[data-key="song:${next.key}"]`);
    row?.scrollIntoView({ block: 'nearest' });
  }

  _sync() {
    const key = this.current;
    const t = SOUNDTRACK.find((x) => x.key === key);
    const song = key ? SONGS[key] : null;
    for (const r of this.el.querySelectorAll('.mn-snd-row')) r.classList.toggle('is-playing', r.dataset.key === `song:${key}`);
    this.el.querySelector('.mn-snd-title').textContent = song ? song.name : 'Nothing playing';
    this.el.querySelector('.mn-snd-where').textContent = t ? `${t.where} · ${t.style}` : 'Pick a track from the list.';
    this.el.querySelector('[data-bpm]').textContent = song ? `${song.bpm} BPM` : '';
    this.el.querySelector('[data-toggle]').textContent = key ? 'Stop' : 'Play';
    const raceBtn = this.el.querySelector('[data-key="race"]');
    raceBtn.hidden = !t?.race;
    const isRace = this.game.settings.raceMusic === key;
    raceBtn.classList.toggle('is-on', isRace);
    raceBtn.querySelector('[data-race]').textContent = isRace ? 'Race Music ✓' : 'Use for Races';
  }

  onFocus(e) {
    if (e.classList.contains('mn-snd-row')) e.scrollIntoView({ block: 'nearest' });
  }

  onConfirm(e) {
    if (!e) return;
    const k = e.dataset.key;
    if (k.startsWith('song:')) {
      const key = k.slice(5);
      if (key === this.current) return;
      this._play(key);
    } else if (k === 'prev') this._step(-1);
    else if (k === 'next') this._step(1);
    else if (k === 'toggle') {
      if (this.current) {
        this.audio?.stopMusic(0.4);
        this.game._musicPlaying = null;
        this._sync();
      } else this._play(this._last || SOUNDTRACK[0].key);
    } else if (k === 'race') {
      const key = this.current;
      if (!key) return;
      const on = this.game.settings.raceMusic === key;
      this.game.applySettings({ raceMusic: on ? 'course' : key });
      this.sfx('menuSelect');
      this.menus.toast(on ? 'Race music: course themes' : `Race music: ${SONGS[key].name}`);
      this._sync();
    }
    if (this.current) this._last = this.current;
  }

  update() {
    const a = this.audio;
    const pos = a?.getMusicPosition?.();
    const p = this.el.querySelector('[data-pos]');
    const txt = pos ? `Bar ${(pos.bar ?? 0) + 1}${pos.section ? ` · ${String(pos.section).toUpperCase()}` : ''}` : '';
    if (p && p.textContent !== txt) p.textContent = txt;
    this._draw(a?.analyser);
  }

  _draw(an) {
    const c = this.canvas;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(c.clientWidth * dpr);
    const h = Math.round(c.clientHeight * dpr);
    if (!w || !h) return;
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    const g = c.getContext('2d');
    g.clearRect(0, 0, w, h);
    const L = this._levels;
    if (an) {
      if (!this._bins || this._bins.length !== an.frequencyBinCount) this._bins = new Uint8Array(an.frequencyBinCount);
      an.getByteFrequencyData(this._bins);
      const n = this._bins.length;
      // log-spaced bands from ~40 Hz to ~16 kHz
      const ny = (an.context?.sampleRate || 48000) / 2;
      for (let i = 0; i < BARS; i++) {
        const f0 = 40 * Math.pow(400, i / BARS);
        const f1 = 40 * Math.pow(400, (i + 1) / BARS);
        const a0 = Math.max(0, Math.floor((f0 / ny) * n));
        const a1 = Math.min(n, Math.max(a0 + 1, Math.ceil((f1 / ny) * n)));
        let m = 0;
        for (let j = a0; j < a1; j++) m = Math.max(m, this._bins[j]);
        const v = m / 255;
        L[i] = v > L[i] ? v : L[i] * 0.9 + v * 0.1;
      }
    } else L.fill(0);
    const gap = Math.max(1, Math.round(w / BARS / 6));
    const bw = w / BARS - gap;
    for (let i = 0; i < BARS; i++) {
      const v = L[i];
      const bh = Math.max(2 * dpr, v * v * (h - 6 * dpr));
      const x = i * (bw + gap) + gap / 2;
      const hue = 200 - (i / BARS) * 170;
      g.fillStyle = `hsl(${hue} 95% ${55 + v * 15}%)`;
      g.fillRect(x, h - bh - 3 * dpr, bw, bh);
    }
  }
}
