// Debug scene (owner: audio agent): /?scene=audio  - "Shittim Chest Sound Test"
// Buttons for every sfx / music key / voice, tempo + volume sliders, engine test, live analyser.
// URL params (for tools/shot.mjs):
//   music=<key>          start a song on load            tempo=<mult>        music tempo multiplier
//   sfx=a,b,c            play sfx on load (staggered)    cycle=sfx|music     auto-cycle through everything
//   engine=<0..1>        start the engine test at speed  char=<id>           engine/voice character
//   voice=<kind>         play a voice on load            report=1            offline level report (sfx/music/voices)
//   test=1               live self-test (every sfx/music/voice through the real graph, engine, tempo, pause,
//                        voice leaks, pre-unlock safety) -> window.__ssk.audioSelfTest (done: true when finished)
// window.__ssk.audio = the AudioManager, window.__ssk.audioTest = helpers.

import { AudioManager, MUSIC_KEYS } from '../core/Audio.js';
import { SFX, SFX_META, SFX_NAMES, SFX_GROUPS, SfxBuilder } from '../core/audio/sfx.js';
import { SONGS } from '../core/audio/songs.js';
import { compileSong } from '../core/audio/notation.js';
import { MusicPlayer } from '../core/audio/sequencer.js';
import { playVoice, VOICE_KINDS } from '../core/audio/voices.js';
import { reverbIR } from '../core/audio/dsp.js';
import { CHARACTERS } from '../data/characters.js';

const CSS = `
.ssk-aud { position:absolute; inset:0; overflow:auto; background:
  radial-gradient(1200px 600px at 85% -10%, #2b6fff55, transparent 60%),
  radial-gradient(900px 500px at -10% 110%, #ff4d8d33, transparent 60%),
  linear-gradient(160deg, #0b1633 0%, #0a1022 55%, #120b24 100%);
  color:#eaf4ff; font-family: var(--ssk-font-ui); padding: 14px 18px 18px; box-sizing:border-box; }
.ssk-aud * { box-sizing: border-box; }
.ssk-aud-head { display:flex; align-items:center; gap:14px; margin-bottom:10px; }
.ssk-aud-halo { width:38px; height:38px; border-radius:50%; border:4px solid #ff3355; box-shadow:0 0 14px #ff335599, inset 0 0 8px #ff335566; position:relative; flex:none; }
.ssk-aud-halo:before, .ssk-aud-halo:after { content:''; position:absolute; background:#ff3355; }
.ssk-aud-halo:before { left:50%; top:-9px; bottom:-9px; width:3px; transform:translateX(-50%); }
.ssk-aud-halo:after { top:50%; left:-9px; right:-9px; height:3px; transform:translateY(-50%); }
.ssk-aud-title { font-family: var(--ssk-font-display); font-size: 30px; letter-spacing: 1px; line-height:1;
  background: linear-gradient(180deg,#fff 0%, #bfe8ff 60%, #6ec8ff 100%); -webkit-background-clip:text; background-clip:text; color:transparent;
  filter: drop-shadow(0 2px 0 #0b5cd6); }
.ssk-aud-sub { font-size: 12px; opacity:.75; font-weight:800; letter-spacing:.5px; text-transform:uppercase; }
.ssk-aud-pills { margin-left:auto; display:flex; gap:8px; flex-wrap:wrap; justify-content:flex-end; }
.ssk-aud-pill { font-size:12px; font-weight:800; padding:5px 10px; border-radius:999px; background:#ffffff14; border:1px solid #ffffff22; white-space:nowrap; }
.ssk-aud-pill.ok { background:#1fb6ff33; border-color:#1fb6ff; color:#bfefff; }
.ssk-aud-pill.bad { background:#ff335533; border-color:#ff3355; color:#ffd0da; cursor:pointer; }
.ssk-aud-grid { display:grid; grid-template-columns: 300px minmax(0,1fr) 300px; gap:12px; align-items:start; }
.ssk-aud-mid { display:flex; flex-direction:column; gap:12px; min-width:0; }
.ssk-aud-panel { background: linear-gradient(180deg,#ffffff12,#ffffff08); border:1px solid #ffffff1f; border-radius:14px; padding:10px 12px 12px;
  box-shadow: 0 10px 30px #0006, inset 0 1px 0 #ffffff22; position:relative; }
.ssk-aud-panel h3 { margin:0 0 8px; font-family: var(--ssk-font-display); font-weight:400; font-size:16px; letter-spacing:.6px; display:flex; align-items:center; gap:8px;
  color:#fff; }
.ssk-aud-panel h3 i { display:inline-block; width:18px; height:6px; background:linear-gradient(90deg,#1fb6ff,#6ef0ff); transform:skewX(-25deg); border-radius:2px; }
.ssk-aud-panel h4 { margin:6px 0 4px; font-size:11px; text-transform:uppercase; letter-spacing:1px; opacity:.65; font-weight:900; }
.ssk-aud-btns { display:flex; flex-wrap:wrap; gap:5px; }
.ssk-aud-btn { font: 800 12px var(--ssk-font-ui); color:#0b1a3a; background: linear-gradient(180deg,#ffffff,#d9ecff); border:none; border-radius:8px;
  padding:4px 8px; cursor:pointer; box-shadow: 0 2px 0 #7fb2e6, 0 3px 8px #0004; transition: transform .06s, filter .1s; }
.ssk-aud-btn:hover { filter: brightness(1.08); transform: translateY(-1px); }
.ssk-aud-btn:active, .ssk-aud-btn.hit { transform: translateY(1px); box-shadow: 0 1px 0 #7fb2e6; background: linear-gradient(180deg,#bff0ff,#7fd8ff); }
.ssk-aud-btn.on { background: linear-gradient(180deg,#ffe36e,#ffc21f); box-shadow: 0 2px 0 #c98b00, 0 0 14px #ffd23f88; }
.ssk-aud-btn.warn { background: linear-gradient(180deg,#ffd0da,#ff7a95); box-shadow:0 2px 0 #b3263c; }
.ssk-aud-music { display:grid; grid-template-columns: 1fr 1fr; gap:5px; }
.ssk-aud-music .ssk-aud-btn { text-align:left; padding:5px 8px; min-width:0; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
.ssk-aud-music .ssk-aud-btn small { display:block; font-weight:700; font-size:10px; opacity:.6; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.ssk-aud-row { display:flex; align-items:center; gap:8px; margin:6px 0; font-size:12px; font-weight:800; }
.ssk-aud-row label { width:64px; opacity:.8; }
.ssk-aud-row input[type=range] { flex:1; accent-color:#1fb6ff; }
.ssk-aud-row output { width:44px; text-align:right; font-variant-numeric: tabular-nums; }
.ssk-aud-row select { flex:1; font:800 12px var(--ssk-font-ui); border-radius:6px; border:none; padding:4px; }
.ssk-aud-now { display:flex; gap:12px; align-items:center; }
.ssk-aud-beat { width:46px; height:46px; border-radius:50%; border:3px solid #6ec8ff; display:grid; place-items:center; font-family:var(--ssk-font-display); font-size:18px; flex:none;
  box-shadow:0 0 0 0 #6ec8ff; transition: box-shadow .08s; }
.ssk-aud-song { font-family:var(--ssk-font-display); font-size:18px; }
.ssk-aud-meta { font-size:11px; font-weight:800; opacity:.75; }
.ssk-aud-timeline { display:flex; height:16px; margin-top:8px; border-radius:6px; overflow:hidden; position:relative; background:#0006; }
.ssk-aud-timeline div { border-right:1px solid #0009; font-size:10px; font-weight:900; display:grid; place-items:center; color:#0b1a3a; }
.ssk-aud-playhead { position:absolute; top:-2px; bottom:-2px; width:3px; background:#fff; box-shadow:0 0 6px #fff; border-radius:2px; }
.ssk-aud-viz { }
.ssk-aud-viz canvas { width:100%; height:150px; display:block; border-radius:12px; background:#050a18; box-shadow: inset 0 0 0 1px #ffffff1a; }
.ssk-aud-gauge { display:flex; gap:10px; align-items:center; font-size:12px; font-weight:800; }
.ssk-aud-gauge .bar { flex:1; height:10px; border-radius:6px; background:#0008; overflow:hidden; }
.ssk-aud-gauge .bar i { display:block; height:100%; width:0; background:linear-gradient(90deg,#1fb6ff,#ffd23f,#ff3355); }
.ssk-aud-report { margin-top:10px; font: 700 11px ui-monospace, Consolas, monospace; white-space:pre; max-height:260px; overflow:auto; background:#0008; border-radius:10px; padding:8px; }
.ssk-aud-chars { display:grid; grid-template-columns: repeat(4, 1fr); gap:4px; }
.ssk-aud-chars .ssk-aud-btn { padding:4px 2px; font-size:11px; text-align:center; }
@media (max-width: 1100px) { .ssk-aud-grid { grid-template-columns: 1fr; } }
`;

const SONG_LABEL = Object.fromEntries(Object.entries(SONGS).map(([k, v]) => [k, v.name || k]));
const SECTION_COLORS = ['#6ef0ff', '#ffd23f', '#ff8fc0', '#9dff8a', '#b98cff', '#ffb36e'];

export async function run({ params, menuRoot, container }) {
  const root = menuRoot || container;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const audio = new AudioManager();
  window.__ssk = window.__ssk || {};
  window.__ssk.audio = audio;
  audio.setVolumes({ master: 0.8, music: 0.7, sfx: 0.9 });

  const el = document.createElement('div');
  el.className = 'ssk-aud';
  el.innerHTML = `
    <div class="ssk-aud-head">
      <div class="ssk-aud-halo"></div>
      <div>
        <div class="ssk-aud-title">SOUND TEST</div>
        <div class="ssk-aud-sub">Super Serika Kart &middot; Shittim Chest Audio Lab &middot; 100% synthesized</div>
      </div>
      <div class="ssk-aud-pills">
        <span class="ssk-aud-pill" data-id="state">audio: off</span>
        <span class="ssk-aud-pill" data-id="rate">-- Hz</span>
        <span class="ssk-aud-pill" data-id="voices">0 sfx voices</span>
        <span class="ssk-aud-pill" data-id="level">-- dB</span>
      </div>
    </div>
    <div class="ssk-aud-grid">
      <div class="ssk-aud-panel">
        <h3><i></i>MUSIC</h3>
        <div class="ssk-aud-music" data-id="music"></div>
        <div class="ssk-aud-row" style="margin-top:10px"><label>Tempo</label><input type="range" min="0.5" max="1.6" step="0.01" value="1" data-id="tempo"><output data-id="tempoOut">1.00x</output></div>
        <div class="ssk-aud-btns">
          <button class="ssk-aud-btn" data-act="final">Final lap 1.12x</button>
          <button class="ssk-aud-btn" data-act="tempo1">Tempo 1x</button>
          <button class="ssk-aud-btn" data-act="pause">Pause</button>
          <button class="ssk-aud-btn warn" data-act="stop">Stop music</button>
        </div>
      </div>
      <div class="ssk-aud-mid">
      <div class="ssk-aud-panel">
        <h3><i></i>SOUND EFFECTS <span class="ssk-aud-meta" style="margin-left:auto" data-id="lastSfx"></span></h3>
        <div data-id="sfx"></div>
        <div class="ssk-aud-btns" style="margin-top:8px">
          <button class="ssk-aud-btn" data-act="cycle">Play all SFX</button>
          <button class="ssk-aud-btn" data-act="spam">Stress: 30 coins</button>
          <button class="ssk-aud-btn" data-act="report">Offline level report</button>
        </div>
        <div class="ssk-aud-report" data-id="report" style="display:none"></div>
      </div>
      <div class="ssk-aud-panel ssk-aud-viz">
        <div class="ssk-aud-now">
          <div class="ssk-aud-beat" data-id="beat">-</div>
          <div style="flex:1; min-width:0">
            <div class="ssk-aud-song" data-id="song">No music</div>
            <div class="ssk-aud-meta" data-id="songMeta">click a track to play</div>
            <div class="ssk-aud-timeline" data-id="timeline"></div>
          </div>
        </div>
        <canvas data-id="viz" style="margin-top:10px"></canvas>
      </div>
      </div>
      <div class="ssk-aud-panel">
        <h3><i></i>VOICES</h3>
        <div class="ssk-aud-chars" data-id="chars"></div>
        <div class="ssk-aud-btns" style="margin-top:6px" data-id="kinds"></div>
        <h3 style="margin-top:12px"><i></i>ENGINE</h3>
        <div class="ssk-aud-btns"><button class="ssk-aud-btn" data-act="engine">Engine: OFF</button><button class="ssk-aud-btn" data-act="sweep">Auto lap</button>
          <button class="ssk-aud-btn" data-act="boost">Boost</button><button class="ssk-aud-btn" data-act="drift">Drift</button></div>
        <div class="ssk-aud-row"><label>Speed</label><input type="range" min="0" max="1.3" step="0.01" value="0" data-id="speed"><output data-id="speedOut">0.00</output></div>
        <div class="ssk-aud-row"><label>Throttle</label><input type="range" min="0" max="1" step="0.01" value="1" data-id="thr"><output data-id="thrOut">1.00</output></div>
        <div class="ssk-aud-gauge"><span data-id="gear">G1</span><div class="bar"><i data-id="rpm"></i></div></div>
        <h3 style="margin-top:12px"><i></i>VOLUME</h3>
        <div class="ssk-aud-row"><label>Master</label><input type="range" min="0" max="1" step="0.01" value="0.8" data-id="vmaster"><output>0.80</output></div>
        <div class="ssk-aud-row"><label>Music</label><input type="range" min="0" max="1" step="0.01" value="0.7" data-id="vmusic"><output>0.70</output></div>
        <div class="ssk-aud-row"><label>SFX</label><input type="range" min="0" max="1" step="0.01" value="0.9" data-id="vsfx"><output>0.90</output></div>
      </div>
    </div>`;
  root.appendChild(el);
  const $ = (id) => el.querySelector(`[data-id="${id}"]`);

  // ---------------------------------------------------------------------------------- unlock
  const unlock = () => audio.unlock();
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
  unlock();
  $('state').addEventListener('click', unlock);

  // ---------------------------------------------------------------------------------- music
  const musicBox = $('music');
  const musicBtns = {};
  for (const key of [...MUSIC_KEYS, 'unknown-key']) {
    const b = document.createElement('button');
    b.className = 'ssk-aud-btn';
    b.innerHTML = `${key}<small>${SONG_LABEL[key] || 'unknown -> default race theme'}</small>`;
    b.onclick = () => {
      unlock();
      audio.playMusic(key, { fadeIn: 0.3, crossfade: 0.6 });
      audio.setMusicTempo(Number($('tempo').value));
    };
    musicBox.appendChild(b);
    musicBtns[key] = b;
  }
  const setTempo = (v) => {
    $('tempo').value = v;
    $('tempoOut').textContent = `${Number(v).toFixed(2)}x`;
    audio.setMusicTempo(Number(v));
  };
  $('tempo').oninput = (e) => setTempo(e.target.value);

  // ---------------------------------------------------------------------------------- sfx
  const sfxBox = $('sfx');
  const sfxBtns = {};
  for (const [group, names] of Object.entries(SFX_GROUPS)) {
    const h = document.createElement('h4');
    h.textContent = group;
    sfxBox.appendChild(h);
    const wrap = document.createElement('div');
    wrap.className = 'ssk-aud-btns';
    for (const n of names) {
      const b = document.createElement('button');
      b.className = 'ssk-aud-btn';
      b.textContent = n;
      b.onclick = () => playSfx(n);
      wrap.appendChild(b);
      sfxBtns[n] = b;
    }
    sfxBox.appendChild(wrap);
  }
  const missing = SFX_NAMES.filter((n) => !Object.values(SFX_GROUPS).flat().includes(n));
  if (missing.length) console.warn('[audio debug] sfx not in groups:', missing);

  let lastSfx = '';
  function playSfx(n, opts) {
    unlock();
    audio.sfx(n, opts);
    lastSfx = n;
    $('lastSfx').textContent = `last: ${n}`;
    const b = sfxBtns[n];
    if (b) {
      b.classList.add('hit');
      setTimeout(() => b.classList.remove('hit'), 160);
    }
  }

  // ---------------------------------------------------------------------------------- voices
  let voiceChar = params.get('char') || 'serika';
  const charBox = $('chars');
  const charBtns = {};
  for (const c of CHARACTERS) {
    const b = document.createElement('button');
    b.className = 'ssk-aud-btn';
    b.textContent = c.name;
    b.onclick = () => {
      voiceChar = c.id;
      for (const x of Object.values(charBtns)) x.classList.remove('on');
      b.classList.add('on');
      if (engine) restartEngine();
    };
    charBox.appendChild(b);
    charBtns[c.id] = b;
  }
  charBtns[voiceChar]?.classList.add('on');
  for (const k of VOICE_KINDS) {
    const b = document.createElement('button');
    b.className = 'ssk-aud-btn';
    b.textContent = k;
    b.onclick = () => {
      unlock();
      audio.voice(voiceChar, k);
    };
    $('kinds').appendChild(b);
  }

  // ---------------------------------------------------------------------------------- engine
  let engine = null;
  let boost = false;
  let drift = false;
  let sweep = null;
  const engBtn = el.querySelector('[data-act="engine"]');
  function restartEngine() {
    engine?.stop();
    engine = audio.createEngine(voiceChar);
  }
  function toggleEngine(on = !engine) {
    unlock();
    if (on) {
      restartEngine();
      engBtn.textContent = 'Engine: ON';
      engBtn.classList.add('on');
    } else {
      engine?.stop();
      engine = null;
      sweep = null;
      engBtn.textContent = 'Engine: OFF';
      engBtn.classList.remove('on');
    }
  }
  const setSpeed = (v) => {
    $('speed').value = v;
    $('speedOut').textContent = Number(v).toFixed(2);
  };
  $('speed').oninput = (e) => setSpeed(e.target.value);
  $('thr').oninput = (e) => ($('thrOut').textContent = Number(e.target.value).toFixed(2));

  // ---------------------------------------------------------------------------------- volumes
  for (const k of ['master', 'music', 'sfx']) {
    const inp = $(`v${k}`);
    inp.oninput = () => {
      inp.nextElementSibling.textContent = Number(inp.value).toFixed(2);
      audio.setVolumes({ [k]: Number(inp.value) });
    };
  }

  // ---------------------------------------------------------------------------------- actions
  let cycleTimer = null;
  function cycleSfx(interval = 900) {
    clearInterval(cycleTimer);
    const list = SFX_NAMES.slice();
    let i = 0;
    cycleTimer = setInterval(() => {
      if (i >= list.length) return clearInterval(cycleTimer);
      playSfx(list[i++]);
    }, interval);
  }
  el.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    unlock();
    if (act === 'final') setTempo(1.12);
    else if (act === 'tempo1') setTempo(1);
    else if (act === 'stop') audio.stopMusic(0.8);
    else if (act === 'pause') {
      audio.setPaused(!audio.paused);
      e.target.classList.toggle('on', audio.paused);
      e.target.textContent = audio.paused ? 'Resume' : 'Pause';
      audio.sfx(audio.paused ? 'pause' : 'unpause');
    } else if (act === 'cycle') cycleSfx();
    else if (act === 'spam') for (let i = 0; i < 30; i++) setTimeout(() => playSfx('coin', { pitch: 1 + (i % 5) * 0.03 }), i * 15);
    else if (act === 'report') levelReport();
    else if (act === 'engine') toggleEngine();
    else if (act === 'sweep') {
      if (!engine) toggleEngine(true);
      sweep = { t: 0 };
    } else if (act === 'boost') {
      boost = !boost;
      e.target.classList.toggle('on', boost);
    } else if (act === 'drift') {
      drift = !drift;
      e.target.classList.toggle('on', drift);
    }
  });

  // ---------------------------------------------------------------------------------- offline level report
  async function renderOffline(seconds, fn) {
    const rate = 44100;
    const octx = new OfflineAudioContext(2, Math.ceil(rate * seconds), rate);
    const out = octx.createGain();
    out.connect(octx.destination);
    const revIn = octx.createGain();
    const conv = octx.createConvolver();
    conv.buffer = reverbIR(octx, { seconds: 1.6, decay: 3.4, damp: 0.7 });
    const rOut = octx.createGain();
    rOut.gain.value = 0.7;
    revIn.connect(conv).connect(rOut).connect(out);
    fn(octx, out, revIn);
    const buf = await octx.startRendering();
    let peak = 0;
    let sum = 0;
    let lastLoud = 0;
    let nan = false;
    const n = buf.length;
    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < n; i++) {
        const v = d[i];
        if (v !== v) nan = true;
        const a = Math.abs(v);
        if (a > peak) peak = a;
        sum += v * v;
        if (a > 0.001 && i > lastLoud) lastLoud = i;
      }
    }
    const rms = Math.sqrt(sum / (n * buf.numberOfChannels));
    // loudest 100 ms window (short-term loudness proxy, comparable between short sfx and music)
    const W = Math.round(rate * 0.1);
    const d0 = buf.getChannelData(0);
    const d1 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : d0;
    let loud = 0;
    for (let s = 0; s + W <= n; s += W >> 1) {
      let acc = 0;
      for (let i = s; i < s + W; i++) acc += d0[i] * d0[i] + d1[i] * d1[i];
      if (acc > loud) loud = acc;
    }
    loud = Math.sqrt(loud / (2 * W));
    const db = (x) => (x > 0 ? 20 * Math.log10(x) : -120);
    return { peak: +db(peak).toFixed(1), rms: +db(rms).toFixed(1), loud: +db(loud).toFixed(1), len: +(lastLoud / rate).toFixed(2), nan };
  }

  async function levelReport({ sfx = true, music = true, voices = true, musicSeconds = 8 } = {}) {
    const box = $('report');
    box.style.display = 'block';
    const lines = [];
    const res = { sfx: {}, music: {}, voices: {} };
    const show = () => (box.textContent = lines.join('\n'));
    if (sfx) {
      lines.push('SFX            peak   rms   loud   len');
      for (const n of SFX_NAMES) {
        const r = await renderOffline(3.5, (octx, out, revIn) => {
          const b = new SfxBuilder(octx, out, 0.01, 1, revIn);
          SFX[n](b, {});
        });
        res.sfx[n] = r;
        const gdb = 20 * Math.log10(SFX_META[n]?.gain ?? 1);
        lines.push(`${n.padEnd(14)} ${String(+(r.peak + gdb).toFixed(1)).padStart(5)}  ${String(+(r.rms + gdb).toFixed(1)).padStart(5)}  ${String(+(r.loud + gdb).toFixed(1)).padStart(5)}  ${r.len}${r.nan ? ' NaN!' : ''}`);
        show();
      }
    }
    if (voices) {
      lines.push('', 'VOICES (peak dB per kind)');
      for (const c of CHARACTERS) {
        const row = [];
        for (const k of VOICE_KINDS) {
          const r = await renderOffline(1.4, (octx, out) => playVoice(octx, out, 0.01, c.id, k, c.voice?.pitch ?? 1, 1));
          res.voices[`${c.id}.${k}`] = r;
          row.push(`${k}:${r.peak}`);
        }
        lines.push(`${c.id.padEnd(9)} ${row.join(' ')}`);
        show();
      }
    }
    if (music) {
      lines.push('', `MUSIC (${musicSeconds}s from the top)  peak   rms   loud`);
      for (const key of MUSIC_KEYS) {
        const song = compileSong(key, SONGS[key]);
        const r = await renderOffline(musicSeconds, (octx, out) => {
          const p = new MusicPlayer(octx, out, song, {});
          p.start(0.02, 0);
          p.scheduleUntil(musicSeconds);
        });
        res.music[key] = r;
        lines.push(`${key.padEnd(12)} ${String(r.peak).padStart(6)} ${String(r.rms).padStart(6)} ${String(r.loud).padStart(6)}${r.nan ? ' NaN!' : ''}`);
        show();
      }
    }
    window.__ssk.audioReport = res;
    return res;
  }

  // ---------------------------------------------------------------------------------- visualizer
  const canvas = $('viz');
  const g2 = canvas.getContext('2d');
  let freq = null;
  let wave = null;
  const peaks = new Float32Array(72);
  let lastBeat = -1;
  let timelineKey = null;
  let smoothLvl = -60;

  function drawTimeline(song) {
    const tl = $('timeline');
    tl.innerHTML = '';
    if (!song) return;
    song.sections.forEach((s, i) => {
      const d = document.createElement('div');
      d.style.flex = String(s.length);
      d.style.background = SECTION_COLORS[i % SECTION_COLORS.length];
      d.textContent = s.name;
      tl.appendChild(d);
    });
    const ph = document.createElement('div');
    ph.className = 'ssk-aud-playhead';
    tl.appendChild(ph);
  }

  function frame() {
    requestAnimationFrame(frame);
    const ctx = audio.ctx;
    const st = ctx ? ctx.state : 'off';
    const pill = $('state');
    pill.textContent = `audio: ${st}`;
    pill.className = `ssk-aud-pill ${st === 'running' ? 'ok' : 'bad'}`;
    $('rate').textContent = ctx ? `${ctx.sampleRate} Hz` : '-- Hz';
    $('voices').textContent = `${audio.activeSfxCount || 0} sfx voices`;

    // now playing
    for (const [k, b] of Object.entries(musicBtns)) b.classList.toggle('on', audio.musicKey === k || (k === 'unknown-key' && false));
    const pos = audio.getMusicPosition();
    if (pos && audio.player) {
      const song = audio.player.song;
      if (timelineKey !== song.key) {
        timelineKey = song.key;
        drawTimeline(song);
      }
      $('song').textContent = song.name;
      $('songMeta').textContent = `${song.key} · ${pos.bpm.toFixed(1)} BPM (x${pos.tempo.toFixed(2)}) · section ${pos.section} · bar ${pos.bar} · loop ${pos.loops}${audio.paused ? ' · PAUSED' : ''}`;
      const b = Math.floor(pos.beat);
      $('beat').textContent = String(Math.floor(pos.beatInBar) + 1);
      if (b !== lastBeat) {
        lastBeat = b;
        const bd = $('beat');
        bd.style.boxShadow = `0 0 0 ${pos.beatInBar < 1 ? 10 : 6}px #6ec8ff55`;
        setTimeout(() => (bd.style.boxShadow = '0 0 0 0 #6ec8ff'), 90);
      }
      const ph = el.querySelector('.ssk-aud-playhead');
      if (ph) ph.style.left = `${Math.min(99.5, (pos.beat / song.length) * 100)}%`;
    } else if (timelineKey) {
      timelineKey = null;
      drawTimeline(null);
      $('song').textContent = 'No music';
      $('songMeta').textContent = 'click a track to play';
      $('beat').textContent = '-';
    }

    // engine
    if (engine) {
      let sp = Number($('speed').value);
      let thr = Number($('thr').value);
      if (sweep) {
        sweep.t += 1 / 60;
        const t = sweep.t;
        // accelerate 0..7s, cruise, drift 9-11s, boost 11-12.5s, brake 14-16
        if (t < 7) sp = Math.min(1, t / 6.5) ** 0.8;
        else if (t < 14) sp = 1;
        else if (t < 16) sp = Math.max(0, 1 - (t - 14) / 2);
        else sp = 0;
        thr = t < 14 ? 1 : 0;
        drift = t > 9 && t < 11;
        boost = t > 11 && t < 12.5;
        if (t > 17) sweep = null;
        setSpeed(sp.toFixed(2));
        el.querySelector('[data-act="boost"]').classList.toggle('on', boost);
        el.querySelector('[data-act="drift"]').classList.toggle('on', drift);
      }
      engine.update(sp * (boost ? 1.25 : 1), thr, boost, drift);
      const s = engine.state;
      $('gear').textContent = `G${s.gear}`;
      $('rpm').style.width = `${Math.min(100, s.rpm * 90)}%`;
    }

    // canvas
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(w * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    g2.setTransform(dpr, 0, 0, dpr, 0, 0);
    g2.clearRect(0, 0, w, h);
    // grid
    g2.strokeStyle = '#ffffff10';
    g2.lineWidth = 1;
    for (let y = 0; y <= 4; y++) {
      g2.beginPath();
      g2.moveTo(0, (h * y) / 4 + 0.5);
      g2.lineTo(w, (h * y) / 4 + 0.5);
      g2.stroke();
    }
    const an = audio.analyser;
    if (an) {
      if (!freq || freq.length !== an.frequencyBinCount) {
        freq = new Uint8Array(an.frequencyBinCount);
        wave = new Float32Array(an.fftSize);
      }
      an.getByteFrequencyData(freq);
      an.getFloatTimeDomainData(wave);
      // spectrum bars (log frequency)
      const bands = peaks.length;
      const nyq = ctx.sampleRate / 2;
      const bw = w / bands;
      const grad = g2.createLinearGradient(0, h, 0, 0);
      grad.addColorStop(0, '#1fb6ff');
      grad.addColorStop(0.55, '#6ef0ff');
      grad.addColorStop(0.8, '#ff8fc0');
      grad.addColorStop(1, '#ff3355');
      for (let i = 0; i < bands; i++) {
        const f0 = 30 * Math.pow(16000 / 30, i / bands);
        const f1 = 30 * Math.pow(16000 / 30, (i + 1) / bands);
        const b0 = Math.floor((f0 / nyq) * freq.length);
        const b1 = Math.max(b0 + 1, Math.floor((f1 / nyq) * freq.length));
        let m = 0;
        for (let k = b0; k < b1 && k < freq.length; k++) m = Math.max(m, freq[k]);
        const v = m / 255;
        peaks[i] = Math.max(v, peaks[i] - 0.012);
        const bh = v * (h - 8);
        g2.fillStyle = grad;
        g2.fillRect(i * bw + 1.5, h - bh, bw - 3, bh);
        g2.fillStyle = '#ffffffcc';
        g2.fillRect(i * bw + 1.5, h - peaks[i] * (h - 8) - 3, bw - 3, 2);
      }
      // oscilloscope
      g2.strokeStyle = '#ffffffdd';
      g2.lineWidth = 2;
      g2.shadowColor = '#6ef0ff';
      g2.shadowBlur = 8;
      g2.beginPath();
      const N = wave.length;
      let sum = 0;
      let pk = 0;
      for (let i = 0; i < N; i++) {
        const v = wave[i];
        sum += v * v;
        if (Math.abs(v) > pk) pk = Math.abs(v);
        const x = (i / (N - 1)) * w;
        const y = h * 0.42 - v * h * 0.38;
        if (i === 0) g2.moveTo(x, y);
        else g2.lineTo(x, y);
      }
      g2.stroke();
      g2.shadowBlur = 0;
      const rms = Math.sqrt(sum / N);
      const lvl = rms > 0 ? 20 * Math.log10(rms) : -90;
      smoothLvl += (lvl - smoothLvl) * 0.2;
      $('level').textContent = `${smoothLvl.toFixed(1)} dB rms · pk ${(pk > 0 ? 20 * Math.log10(pk) : -90).toFixed(1)}`;
      // meter
      const mw = Math.max(0, Math.min(1, (smoothLvl + 60) / 60));
      g2.fillStyle = '#ffffff22';
      g2.fillRect(w - 18, 8, 8, h - 16);
      g2.fillStyle = mw > 0.9 ? '#ff3355' : '#9dff8a';
      g2.fillRect(w - 18, 8 + (h - 16) * (1 - mw), 8, (h - 16) * mw);
    } else {
      g2.fillStyle = '#ffffff99';
      g2.font = '800 16px sans-serif';
      g2.fillText('Click anywhere to start audio', 20, h / 2);
    }
  }
  requestAnimationFrame(frame);

  // ---------------------------------------------------------------------------------- URL params
  window.__ssk.audioTest = {
    playSfx,
    cycleSfx,
    levelReport,
    renderOffline,
    toggleEngine,
    setSpeed,
    state: () => ({
      ctx: audio.ctx?.state,
      music: audio.musicKey,
      position: audio.getMusicPosition(),
      activeSfx: audio.activeSfxCount,
      engine: engine?.state,
    }),
  };
  if (params.get('tempo')) setTempo(Number(params.get('tempo')));
  if (params.get('music')) audio.playMusic(params.get('music'), { fadeIn: 0.1 });
  if (params.get('tempo')) setTempo(Number(params.get('tempo')));
  if (params.get('sfx')) params.get('sfx').split(',').forEach((n, i) => setTimeout(() => playSfx(n.trim()), 300 + i * 700));
  if (params.get('voice')) setTimeout(() => audio.voice(voiceChar, params.get('voice')), 400);
  if (params.get('engine')) {
    toggleEngine(true);
    setSpeed(Number(params.get('engine')));
  }
  if (params.get('cycle') === 'sfx') cycleSfx(Number(params.get('interval') || 700));
  if (params.get('cycle') === 'music') {
    let i = 0;
    const keys = MUSIC_KEYS.slice();
    const next = () => {
      if (i >= keys.length) return;
      audio.playMusic(keys[i++], { fadeIn: 0.1, crossfade: 0.2 });
      setTimeout(next, Number(params.get('interval') || 1500));
    };
    next();
  }
  if (params.get('test')) selfTest();

  // ---------------------------------------------------------------------------------- live self-test
  async function selfTest() {
    const R = (window.__ssk.audioSelfTest = { done: false, errors: [], silent: [], sfx: {}, music: {}, voices: {} });
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const an = () => audio.analyser;
    const buf = new Float32Array(2048);
    // max rms (dBFS) of the master output sampled every 20 ms for `ms`
    const measure = async (ms) => {
      let mx = 0;
      const t0 = performance.now();
      while (performance.now() - t0 < ms) {
        const a = an();
        if (a) {
          a.getFloatTimeDomainData(buf);
          let acc = 0;
          for (let i = 0; i < buf.length; i++) acc += buf[i] * buf[i];
          mx = Math.max(mx, Math.sqrt(acc / buf.length));
        }
        await wait(20);
      }
      return mx > 0 ? +(20 * Math.log10(mx)).toFixed(1) : -120;
    };
    const guard = async (label, fn) => {
      try {
        return await fn();
      } catch (e) {
        R.errors.push(`${label}: ${e?.message || e}`);
      }
    };
    // 1. pre-unlock safety
    await guard('preUnlock', async () => {
      const a = new AudioManager();
      const r = [a.sfx('boost'), a.sfx('nope'), a.voice('serika', 'hit'), a.playMusic('title'), a.setMusicTempo(1.1), a.setVolumes({ music: 0.5 })];
      const e = a.createEngine('serika');
      e.update(0.5, 1, true, true);
      e.setVolume(0.5);
      e.stop();
      a.setPaused(true);
      a.duckMusic(0.5, 1);
      a.stopMusic();
      a.dispose();
      R.preUnlock = r[0] === null && r[1] === null ? 'ok' : 'sfx returned non-null';
    });
    audio.unlock();
    await wait(300);
    R.ctx = audio.ctx?.state;
    audio.stopMusic(0.05);
    await wait(400);
    R.silence = await measure(200);
    // 2. unknown names
    await guard('unknown', async () => {
      R.unknownSfx = audio.sfx('definitelyNotASound');
      audio.voice('serika', 'nope');
      audio.voice('nobody', 'hit');
      audio.playMusic('no-such-song', { fadeIn: 0 });
      R.unknownMusic = audio.musicKey;
      audio.stopMusic(0.05);
      await wait(300);
    });
    // 3. every sfx
    for (const n of SFX_NAMES) {
      await guard(`sfx ${n}`, async () => {
        audio.sfx(n);
        R.sfx[n] = await measure(n === 'rouletteTick' ? 120 : 260);
        if (R.sfx[n] < -55) R.silent.push(n);
      });
    }
    await wait(3600);
    R.activeAfterSfx = audio.activeSfxCount;
    // 4. stress: 300 random sfx in ~2 s
    await guard('stress', async () => {
      let peakActive = 0;
      for (let i = 0; i < 100; i++) {
        for (let k = 0; k < 3; k++) audio.sfx(SFX_NAMES[(i * 7 + k * 13) % SFX_NAMES.length], { volume: 0.5, pan: (k - 1) * 0.6, pitch: 0.8 + k * 0.2 });
        peakActive = Math.max(peakActive, audio.activeSfxCount);
        await wait(20);
      }
      R.stressPeakActive = peakActive;
      await wait(4200);
      R.activeAfterStress = audio.activeSfxCount;
    });
    // 5. voices
    for (const c of CHARACTERS) {
      for (const k of c.id === 'serika' ? VOICE_KINDS : ['hit', 'win']) {
        await guard(`voice ${c.id}.${k}`, async () => {
          audio.voice(c.id, k);
          const v = await measure(k === 'hit' ? 350 : 500);
          R.voices[`${c.id}.${k}`] = v;
          if (v < -55) R.silent.push(`voice ${c.id}.${k}`);
          await wait(250);
        });
      }
    }
    // 6. engine
    await guard('engine', async () => {
      const e = audio.createEngine('hina');
      let sp = 0;
      const iv = setInterval(() => {
        sp = Math.min(1.2, sp + 0.02);
        e.update(sp, 1, sp > 0.9, sp > 0.5 && sp < 0.8);
      }, 16);
      R.engineRunning = await measure(1200);
      R.engineState = { ...e.state };
      audio.setPaused(true);
      await wait(250);
      R.enginePaused = await measure(200);
      audio.setPaused(false);
      await wait(150);
      R.engineResumed = await measure(200);
      clearInterval(iv);
      e.stop();
      await wait(600);
      R.engineAfterStop = await measure(200);
      R.enginesLeft = audio._engines.size;
    });
    // 7. every song
    for (const key of MUSIC_KEYS) {
      await guard(`music ${key}`, async () => {
        audio.playMusic(key, { fadeIn: 0.05, crossfade: 0.15 });
        await wait(250);
        R.music[key] = await measure(1300);
        if (R.music[key] < -50) R.silent.push(`music ${key}`);
      });
    }
    // 8. tempo glide + pause
    await guard('tempo', async () => {
      audio.playMusic('race', { fadeIn: 0.05, crossfade: 0.1 });
      await wait(1200);
      const b0 = audio.getMusicPosition();
      audio.setMusicTempo(1.12);
      const beats = [];
      for (let i = 0; i < 10; i++) {
        await wait(60);
        beats.push(audio.getMusicPosition().beat);
      }
      let mono = true;
      for (let i = 1; i < beats.length; i++) if (beats[i] < beats[i - 1] - 0.01 && beats[i] > 1) mono = false;
      await wait(800);
      R.tempo = { bpmBefore: b0?.bpm, bpmAfter: audio.getMusicPosition()?.bpm, monotonic: mono };
      audio.setPaused(true);
      await wait(700);
      const pb = audio.getMusicPosition()?.beat;
      R.musicPausedLevel = await measure(300);
      const pb2 = audio.getMusicPosition()?.beat;
      R.pauseFrozen = Math.abs((pb2 ?? 0) - (pb ?? 0)) < 0.05;
      audio.setPaused(false);
      await wait(500);
      R.musicResumedLevel = await measure(400);
      audio.stopMusic(0.5);
      await wait(900);
      R.afterStopMusic = await measure(300);
      audio.setMusicTempo(1);
    });
    R.stats = audio.getStats?.();
    R.done = true;
  }

  if (params.get('report')) {
    const which = params.get('report');
    levelReport({ sfx: which === '1' || which.includes('sfx'), music: which === '1' || which.includes('music'), voices: which === '1' || which.includes('voice') });
  }
}
