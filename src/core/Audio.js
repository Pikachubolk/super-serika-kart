// AudioManager (owner: audio agent) - every sound in Super Serika Kart is synthesized live with the Web Audio API.
//
// API CONTRACT (ARCHITECTURE.md §12):
//   new AudioManager()
//   audio.unlock()                               call from any user gesture; safe to call repeatedly
//   audio.setVolumes({ master, music, sfx })      0..1 each (any subset; other keys ignored). Perceptual (squared) taper.
//   audio.playMusic(key, { fadeIn=0.5, crossfade=0.6, restart=false, delay=0, tempo=1 })
//        key: title|menu|charselect|results|victory|defeat|trophy|abydos|shibaseki|trinity|millennium|hyakkiyako|
//             redwinter|gehenna|arona (unknown keys -> default race theme). Same key while playing = no-op.
//        Requested before unlock() -> starts automatically once audio is unlocked.
//   audio.setMusicTempo(mult)                     e.g. 1.12 on the final lap (glides smoothly; reset by playMusic)
//   audio.stopMusic(fadeOut=0.5)
//   audio.sfx(name, { volume=1, pitch=1, pan=0 }) -> { stop() } | null   (unknown names / before unlock: null)
//   audio.createEngine(characterId) -> { update(speedNorm, throttle, boosting, drifting), setVolume(v), stop() }
//   audio.voice(characterId, 'select'|'hit'|'win'|'lose'|'item', { volume })
//   audio.dispose()
// ADDITIONS:
//   audio.setPaused(bool)      pause: music sequencer frozen + faded, engines muted (sfx such as menu sounds still play)
//   audio.pauseMusic() / audio.resumeMusic()
//   audio.duckMusic(amount 0..1, seconds)
//   audio.getMusicPosition() -> { key, beat, bar, beatInBar, loops, section, bpm, tempo } | null  (for beat-synced UI)
//   audio.musicKey, audio.unlocked, audio.analyser (AnalyserNode after the limiter), audio.ctx
//   audio.stopAllEngines(), audio.getStats() -> { ctx, music, paused, sfxVoices, engines, tempo, position, played: { name: count } }
//   exports MUSIC_KEYS, SFX_NAMES, VOICE_KINDS
//   Engines are muted automatically while the tab is hidden; music keeps scheduling (1.6 s look-ahead when hidden).

import { SFX, SFX_META, SFX_NAMES, SfxBuilder } from './audio/sfx.js';
import { SONGS, DEFAULT_SONG } from './audio/songs.js';
import { compileSong } from './audio/notation.js';
import { MusicPlayer } from './audio/sequencer.js';
import { EngineSound } from './audio/engine.js';
import { playVoice, VOICE_KINDS } from './audio/voices.js';
import { reverbIR, pulseWave } from './audio/dsp.js';
import { getCharacter } from '../data/characters.js';

export const MUSIC_KEYS = Object.keys(SONGS);
export { SFX_NAMES, VOICE_KINDS };

const LOOKAHEAD = 0.14; // seconds scheduled ahead of the audio clock
const TICK_MS = 25;
const MUSIC_LEVEL = 1.0; // internal trims (tuned with the offline level report in the sound test)
const SFX_LEVEL = 1.0;
const VOICE_LEVEL = 0.5; // voices measured ~6 dB hotter than sfx in the live self-test
const MAX_SFX_VOICES = 40;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const taper = (v) => v * v;

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.volumes = { master: 0.8, music: 0.6, sfx: 0.9 };
    this.musicKey = null;
    this.player = null;
    this.paused = false;
    this._musicOpts = {};
    this._tempo = 1;
    this._compiled = new Map();
    this._engines = new Set();
    this._active = new Map(); // sfx name -> [{ b, g, end, vol, name }]
    this._activeCount = 0;
    this._last = new Map(); // sfx name -> { t, vol }
    this._voiceBusy = new Map(); // characterId -> end time
    this._timer = null;
    this._holdUntil = 0;
    this._warned = new Set();
    this._onVis = null;
    this._counts = {}; // name -> times played (sfx + 'voice:<kind>'), for tests
  }

  get unlocked() {
    return !!this.ctx && this.ctx.state === 'running';
  }

  /** Number of sfx voices still sounding (expired voices are pruned). */
  get activeSfxCount() {
    if (this.ctx) this._pruneAll(this.ctx.currentTime);
    return this._activeCount;
  }

  get analyser() {
    return this._analyser || null;
  }

  // ----------------------------------------------------------------------------------------------------------
  // context & graph
  // ----------------------------------------------------------------------------------------------------------

  unlock() {
    if (typeof window === 'undefined') return;
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try {
        this.ctx = new AC({ latencyHint: 'interactive' });
      } catch {
        try {
          this.ctx = new AC();
        } catch {
          return;
        }
      }
      this._buildGraph();
      this.ctx.onstatechange = () => {
        if (this.ctx?.state === 'running') this._onRunning();
      };
    }
    if (this.ctx.state === 'closed') return;
    if (this.ctx.state !== 'running') {
      try {
        const p = this.ctx.resume();
        if (p && p.then) p.then(() => this._onRunning()).catch(() => {});
      } catch {
        /* ignore */
      }
    } else this._onRunning();
  }

  _buildGraph() {
    const ctx = this.ctx;
    const G = (v = 1) => {
      const g = ctx.createGain();
      g.gain.value = v;
      return g;
    };
    this._master = G(taper(this.volumes.master));
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -4;
    lim.knee.value = 3;
    lim.ratio.value = 16;
    lim.attack.value = 0.002;
    lim.release.value = 0.18;
    this._limiter = lim;
    this._analyser = ctx.createAnalyser();
    this._analyser.fftSize = 2048;
    this._analyser.smoothingTimeConstant = 0.7;
    this._master.connect(lim).connect(this._analyser).connect(ctx.destination);

    this._musicVol = G(taper(this.volumes.music) * MUSIC_LEVEL);
    this._musicDuck = G(1);
    this._musicBus = G(1);
    this._musicBus.connect(this._musicDuck).connect(this._musicVol).connect(this._master);

    this._sfxVol = G(taper(this.volumes.sfx) * SFX_LEVEL);
    this._sfxVol.connect(this._master);
    this._sfxBus = G(1);
    this._sfxBus.connect(this._sfxVol);
    this._engineBus = G(1);
    this._engineBus.connect(this._sfxVol);
    this._voiceBus = G(VOICE_LEVEL);
    this._voiceBus.connect(this._sfxVol);

    // shared sfx reverb
    this._sfxRevIn = G(1);
    const conv = ctx.createConvolver();
    conv.buffer = reverbIR(ctx, { seconds: 1.6, decay: 3.4, damp: 0.7 });
    const rOut = G(0.7);
    this._sfxRevIn.connect(conv).connect(rOut).connect(this._sfxVol);
    this._voiceRev = G(0.12);
    this._voiceBus.connect(this._voiceRev).connect(this._sfxRevIn);

    this._musicIR = reverbIR(ctx, { seconds: 2.4, decay: 3, damp: 0.75 });
  }

  _onRunning() {
    if (!this.ctx || this.ctx.state !== 'running') return;
    if (!this._timer) {
      this._timer = setInterval(() => this._tick(), TICK_MS);
      if (typeof document !== 'undefined' && !this._onVis) {
        this._onVis = () => {
          this._tick();
          this._applyEngineGain();
        };
        document.addEventListener('visibilitychange', this._onVis);
      }
    }
    if (this.musicKey && !this.player) this._startMusic(this.musicKey, this._musicOpts);
  }

  _tick() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const hidden = typeof document !== 'undefined' && document.hidden;
    const until = ctx.currentTime + (hidden ? 1.6 : LOOKAHEAD);
    if (this.player) this.player.scheduleUntil(until);
  }

  _pulse(duty) {
    return pulseWave(this.ctx, duty);
  }

  _warnOnce(key, ...args) {
    if (this._warned.has(key)) return;
    this._warned.add(key);
    console.warn('[audio]', ...args);
  }

  // ----------------------------------------------------------------------------------------------------------
  // volumes
  // ----------------------------------------------------------------------------------------------------------

  setVolumes(v = {}) {
    for (const k of ['master', 'music', 'sfx']) {
      const x = Number(v[k]);
      if (v[k] !== undefined && v[k] !== null && Number.isFinite(x)) this.volumes[k] = clamp01(x);
    }
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this._master.gain.setTargetAtTime(taper(this.volumes.master), now, 0.03);
    this._musicVol.gain.setTargetAtTime(taper(this.volumes.music) * MUSIC_LEVEL, now, 0.03);
    this._sfxVol.gain.setTargetAtTime(taper(this.volumes.sfx) * SFX_LEVEL, now, 0.03);
  }

  // ----------------------------------------------------------------------------------------------------------
  // music
  // ----------------------------------------------------------------------------------------------------------

  _compile(key) {
    let c = this._compiled.get(key);
    if (!c) {
      c = compileSong(key, SONGS[key]);
      if (c.warnings.length) this._warnOnce(`song:${key}`, `song "${key}" warnings:`, c.warnings.slice(0, 6).join('; '));
      this._compiled.set(key, c);
    }
    return c;
  }

  playMusic(key, opts = {}) {
    if (typeof key !== 'string' || !key) return;
    const songKey = SONGS[key] ? key : DEFAULT_SONG;
    const same = this.musicKey === songKey && this.player && !this.player.stopped;
    this._tempo = opts.tempo ?? 1;
    if (same && !opts.restart) {
      this.player.setTempo(this._tempo);
      if (this.player.paused && !this.paused) this.player.resume();
      return;
    }
    this.musicKey = songKey;
    this._musicOpts = { fadeIn: opts.fadeIn ?? 0.5, crossfade: opts.crossfade ?? opts.fadeOut ?? 0.6, delay: opts.delay ?? 0 };
    if (!this.unlocked) return; // deferred until unlock()
    this._startMusic(songKey, this._musicOpts);
  }

  _startMusic(key, { fadeIn = 0.5, crossfade = 0.6, delay = 0 } = {}) {
    const ctx = this.ctx;
    let song;
    try {
      song = this._compile(key);
    } catch (e) {
      this._warnOnce(`compile:${key}`, 'music compile failed', key, e);
      return;
    }
    if (this.player) this.player.stop(crossfade);
    const now = ctx.currentTime;
    const start = Math.max(now + 0.05 + delay, this._holdUntil);
    const p = new MusicPlayer(ctx, this._musicBus, song, { tempo: this._tempo, reverbBuffer: this._musicIR });
    p.start(start, start > now + 0.2 ? Math.min(fadeIn, 0.05) : fadeIn);
    p.startedAt = now;
    this.player = p;
    if (this.paused) p.pause();
    p.scheduleUntil(now + LOOKAHEAD);
  }

  setMusicTempo(mult) {
    const m = Number(mult);
    if (!Number.isFinite(m) || m <= 0) return;
    this._tempo = m;
    this.player?.setTempo(m);
  }

  stopMusic(fadeOut = 0.5) {
    this.musicKey = null;
    if (this.player) {
      this.player.stop(Number.isFinite(fadeOut) ? fadeOut : 0.5);
      this.player = null;
    }
  }

  pauseMusic() {
    this.player?.pause();
  }

  resumeMusic() {
    if (!this.paused) this.player?.resume();
  }

  setPaused(paused) {
    this.paused = !!paused;
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (this.paused) this.player?.pause();
    else this.player?.resume();
    this._applyEngineGain(now);
  }

  /** Engines are silent while paused or while the tab is hidden (the game loop stops updating them). */
  _applyEngineGain(now = this.ctx?.currentTime) {
    if (!this.ctx || !this._engineBus) return;
    const hidden = typeof document !== 'undefined' && document.hidden;
    this._engineBus.gain.setTargetAtTime(this.paused || hidden ? 0 : 1, now, 0.03);
  }

  /** Stops every engine voice (e.g. when a race is torn down without stopping its engines). */
  stopAllEngines() {
    for (const e of [...this._engines]) e.stop();
    this._engines.clear();
  }

  /** Debug/test info: live sfx voices, engines, music state. */
  getStats() {
    return {
      ctx: this.ctx?.state || 'none',
      music: this.musicKey,
      paused: this.paused,
      sfxVoices: this.activeSfxCount,
      engines: this._engines.size,
      tempo: this._tempo,
      position: this.getMusicPosition(),
      played: { ...this._counts },
    };
  }

  duckMusic(amount = 0.6, seconds = 1) {
    if (!this.ctx) return;
    const g = this._musicDuck.gain;
    const now = this.ctx.currentTime;
    const lvl = 1 - clamp01(amount);
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(lvl, now + 0.05);
    g.setValueAtTime(lvl, now + Math.max(0.06, seconds));
    g.linearRampToValueAtTime(1, now + Math.max(0.06, seconds) + 0.7);
  }

  getMusicPosition() {
    if (!this.player || !this.ctx) return null;
    return this.player.getPosition();
  }

  // ----------------------------------------------------------------------------------------------------------
  // sfx
  // ----------------------------------------------------------------------------------------------------------

  sfx(name, opts) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return null;
    const fn = SFX[name];
    if (!fn) return null;
    const o = opts || {};
    const vol = o.volume === undefined ? 1 : Number(o.volume);
    if (!(vol > 0.01)) return null;
    const meta = SFX_META[name] || {};
    const now = ctx.currentTime;

    // retrigger guard (a louder request may still cut through)
    const last = this._last.get(name);
    if (last && now - last.t < (meta.gap ?? 0.03) && vol <= last.vol * 1.5) return null;

    // voice limiting
    let list = this._active.get(name);
    if (!list) this._active.set(name, (list = []));
    for (let i = list.length - 1; i >= 0; i--) if (list[i].end < now) list.splice(i, 1);
    if (list.length >= (meta.max ?? 3)) this._steal(list.shift(), now);
    this._pruneAll(now);

    const g = ctx.createGain();
    g.gain.value = Math.min(4, vol) * (meta.gain ?? 1);
    const extra = [g];
    if (o.pan) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, Number(o.pan) || 0));
      g.connect(p).connect(this._sfxBus);
      extra.push(p);
    } else g.connect(this._sfxBus);
    const pitch = Math.max(0.25, Math.min(4, Number(o.pitch) || 1));
    const b = new SfxBuilder(ctx, g, now + 0.004, pitch, this._sfxRevIn);
    try {
      fn(b, o);
    } catch (e) {
      this._warnOnce(`sfx:${name}`, `sfx "${name}" failed`, e);
    }
    b.finalize(extra);
    this._counts[name] = (this._counts[name] || 0) + 1;
    const entry = { b, g, end: b.end, vol, name };
    list.push(entry);
    this._activeCount++;
    this._last.set(name, { t: now, vol });
    if (meta.duck) this.duckMusic(meta.duck[0], meta.duck[1]);
    if (name === 'finish') this._holdForJingle(now + 2.3);
    return {
      stop: () => this._steal(entry, ctx.currentTime),
    };
  }

  _steal(entry, now) {
    if (!entry || entry.stolen) return;
    entry.stolen = true;
    entry.end = now;
    this._activeCount = Math.max(0, this._activeCount - 1);
    try {
      entry.g.gain.cancelScheduledValues(now);
      entry.g.gain.setValueAtTime(entry.g.gain.value, now);
      entry.g.gain.linearRampToValueAtTime(0, now + 0.03);
    } catch {
      /* noop */
    }
    entry.b.kill(now + 0.04);
  }

  _pruneAll(now) {
    let count = 0;
    let oldest = null;
    for (const list of this._active.values()) {
      for (let i = list.length - 1; i >= 0; i--) if (list[i].end < now) list.splice(i, 1);
      count += list.length;
      for (const e of list) if (!oldest || e.end < oldest.end) oldest = e;
    }
    this._activeCount = count;
    if (count > MAX_SFX_VOICES && oldest) {
      this._steal(oldest, now);
      const l = this._active.get(oldest.name);
      const i = l ? l.indexOf(oldest) : -1;
      if (i >= 0) l.splice(i, 1);
    }
  }

  /** A finish-style jingle holds back newly requested music until it is done. */
  _holdForJingle(until) {
    this._holdUntil = until;
    const p = this.player;
    // music requested just before the jingle (same frame) is restarted after it
    if (p && p.startedAt !== undefined && this.ctx.currentTime - p.startedAt < 0.3 && this.musicKey) {
      p.stop(0.02);
      this.player = null;
      this._startMusic(this.musicKey, { ...this._musicOpts, crossfade: 0.02 });
    }
  }

  // ----------------------------------------------------------------------------------------------------------
  // engine & voices
  // ----------------------------------------------------------------------------------------------------------

  createEngine(characterId) {
    const e = new EngineSound(this, characterId);
    this._engines.add(e);
    return e;
  }

  voice(characterId, kind, opts = {}) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    if (!VOICE_KINDS.includes(kind)) return;
    const id = String(characterId || 'serika');
    const now = ctx.currentTime;
    const busy = this._voiceBusy.get(id) || 0;
    if (busy > now && kind !== 'hit') return;
    const ch = getCharacter(id);
    const pitch = ch?.voice?.pitch ?? 1;
    try {
      const end = playVoice(ctx, this._voiceBus, now + 0.01, ch?.id || id, kind, pitch, opts.volume ?? 1);
      this._voiceBusy.set(id, end);
      const vk = `voice:${kind}`;
      this._counts[vk] = (this._counts[vk] || 0) + 1;
    } catch (e) {
      this._warnOnce('voice', 'voice failed', e);
    }
  }

  // ----------------------------------------------------------------------------------------------------------

  dispose() {
    clearInterval(this._timer);
    this._timer = null;
    if (this._onVis) document.removeEventListener('visibilitychange', this._onVis);
    for (const e of [...this._engines]) e.stop();
    this._engines.clear();
    this.player?.disposeNow();
    this.player = null;
    try {
      this.ctx?.close();
    } catch {
      /* noop */
    }
    this.ctx = null;
  }
}
