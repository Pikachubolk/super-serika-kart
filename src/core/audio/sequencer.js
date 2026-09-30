// Lookahead step sequencer for compiled songs (owner: audio agent).
//
//   const p = new MusicPlayer(ctx, destination, compiledSong, { tempo })
//   p.start(time, fadeIn)            begin at `time` (ctx seconds)
//   p.scheduleUntil(t)               schedule every event that starts before ctx time t (call from a timer, ~120 ms ahead)
//   p.setTempo(mult, immediate?)     tempo multiplier, glides smoothly
//   p.stop(fadeOut)                  fade out, then disconnect (returns the time it is silent)
//   p.pause() / p.resume()           freeze / continue the song position (fader dips while paused)
//   p.getPosition()                  { beat, bar, beatInBar, loops, section, bpm } for visuals
//
// Works with OfflineAudioContext too (call scheduleUntil(duration) once before rendering).

import { INSTRUMENTS, playDrum } from './instruments.js';
import { mtof, reverbIR, driveCurve } from './dsp.js';
import { swingBeat } from './notation.js';

const STEP = 0.25; // beats per scheduling step (16th)

export class MusicPlayer {
  constructor(ctx, dest, song, { tempo = 1, reverbBuffer = null } = {}) {
    this.ctx = ctx;
    this.song = song;
    this.key = song.key;
    this.tempo = tempo;
    this.targetTempo = tempo;
    this.started = false;
    this.stopped = false;
    this.paused = false;
    this.loops = 0;

    // --- graph ---------------------------------------------------------------------------------------------
    this.fader = ctx.createGain();
    this.fader.gain.value = 0;
    this.fader.connect(dest);
    this.bus = ctx.createGain();
    this.bus.gain.value = song.gain;
    this.bus.connect(this.fader);

    this.revIn = ctx.createGain();
    this.conv = ctx.createConvolver();
    this.conv.buffer = reverbBuffer || reverbIR(ctx, { seconds: 2.4, decay: 3 });
    this.revOut = ctx.createGain();
    this.revOut.gain.value = song.reverb;
    this.revIn.connect(this.conv).connect(this.revOut).connect(this.bus);

    const dl = song.delay || { beats: 0.75, fb: 0.3, mix: 0.35 };
    this.delayBeats = dl.beats ?? 0.75;
    this.dlyIn = ctx.createGain();
    this.delay = ctx.createDelay(4);
    this.delay.delayTime.value = this._spb() * this.delayBeats;
    this.dlyFb = ctx.createGain();
    this.dlyFb.gain.value = dl.fb ?? 0.3;
    this.dlyLp = ctx.createBiquadFilter();
    this.dlyLp.type = 'lowpass';
    this.dlyLp.frequency.value = dl.lp ?? 3200;
    this.dlyOut = ctx.createGain();
    this.dlyOut.gain.value = dl.mix ?? 0.35;
    this.dlyIn.connect(this.delay).connect(this.dlyLp).connect(this.dlyFb).connect(this.delay);
    this.dlyLp.connect(this.dlyOut).connect(this.bus);
    this.dlyOut.connect(this.revIn);

    this.nodes = [this.fader, this.bus, this.revIn, this.conv, this.revOut, this.dlyIn, this.delay, this.dlyFb, this.dlyLp, this.dlyOut];
    this.tracks = song.tracks.map((t) => this._buildTrack(t));

    this.beat = 0;
    this.time = 0;
    this.idx = this.tracks.map(() => 0);
    this.lastFreq = this.tracks.map(() => 0);
  }

  _buildTrack(t) {
    const ctx = this.ctx;
    const P = t.params;
    const input = ctx.createGain();
    input.gain.value = P.vol ?? 0.5;
    let node = input;
    const nodes = [input];
    const fx = P.fx || {};
    if (fx.hp) {
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = fx.hp;
      node.connect(hp);
      node = hp;
      nodes.push(hp);
    }
    if (fx.drive) {
      const sh = ctx.createWaveShaper();
      sh.curve = driveCurve(fx.drive);
      sh.oversample = '2x';
      const post = ctx.createGain();
      post.gain.value = fx.post ?? 0.35;
      node.connect(sh).connect(post);
      node = post;
      nodes.push(sh, post);
    }
    if (fx.lp) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = fx.lp;
      lp.Q.value = fx.q ?? 0.7;
      node.connect(lp);
      node = lp;
      nodes.push(lp);
    }
    let out = node;
    if (P.pan) {
      const pan = ctx.createStereoPanner();
      pan.pan.value = P.pan;
      node.connect(pan);
      out = pan;
      nodes.push(pan);
    }
    out.connect(this.bus);
    if (P.rev) {
      const s = ctx.createGain();
      s.gain.value = P.rev;
      out.connect(s).connect(this.revIn);
      nodes.push(s);
    }
    if (P.dly) {
      const s = ctx.createGain();
      s.gain.value = P.dly;
      out.connect(s).connect(this.dlyIn);
      nodes.push(s);
    }
    this.nodes.push(...nodes);
    const inst = t.drum ? null : INSTRUMENTS[P.inst] || INSTRUMENTS.pulse;
    return { def: t, input, inst, P, transpose: P.transpose || 0 };
  }

  _spb() {
    return 60 / (this.song.bpm * this.tempo);
  }

  start(time, fadeIn = 0.5) {
    this.started = true;
    this.time = time;
    this.beat = 0;
    const g = this.fader.gain;
    g.cancelScheduledValues(time);
    g.setValueAtTime(fadeIn > 0.02 ? 0.0001 : 1, time);
    if (fadeIn > 0.02) g.linearRampToValueAtTime(1, time + fadeIn);
  }

  setTempo(mult, immediate = false) {
    this.targetTempo = Math.max(0.25, Math.min(3, mult));
    if (immediate) this.tempo = this.targetTempo;
  }

  pause() {
    if (this.paused || this.stopped) return;
    this.paused = true;
    const now = this.ctx.currentTime;
    // rewind the position to "now" so resume continues where the listener was
    const spb = this._spb();
    let pb = this.beat - Math.max(0, this.time - now) / spb;
    if (pb < this.song.loopStart && this.loops > 0) pb += this.song.length - this.song.loopStart;
    this._pausedBeat = Math.max(0, pb);
    const g = this.fader.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0.0001, now + 0.08);
  }

  resume() {
    if (!this.paused || this.stopped) return;
    this.paused = false;
    const now = this.ctx.currentTime;
    // restart on the next 16th from the paused position
    const b = Math.ceil((this._pausedBeat ?? this.beat) / STEP) * STEP;
    this.beat = b >= this.song.length ? this.song.loopStart : b;
    this._seek(this.beat);
    this.time = now + 0.06;
    const g = this.fader.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(0.0001, now);
    g.linearRampToValueAtTime(1, now + 0.25);
  }

  _seek(beat) {
    this.tracks.forEach((tr, i) => {
      const evs = tr.def.events;
      let lo = 0;
      let hi = evs.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (evs[mid].b < beat - 1e-6) lo = mid + 1;
        else hi = mid;
      }
      this.idx[i] = lo;
    });
  }

  /** Schedule everything that starts before ctx time `until`. */
  scheduleUntil(until) {
    if (!this.started || this.stopped || this.paused) return;
    const song = this.song;
    let guard = 0;
    while (this.time < until && guard++ < 512) {
      // tempo glide (~1.2 s time constant)
      if (this.tempo !== this.targetTempo) {
        const k = Math.min(1, (STEP * this._spb()) / 0.9);
        this.tempo += (this.targetTempo - this.tempo) * k;
        if (Math.abs(this.tempo - this.targetTempo) < 0.002) this.tempo = this.targetTempo;
        this.delay.delayTime.setTargetAtTime(this._spb() * this.delayBeats, this.time, 0.2);
      }
      const spb = this._spb();
      const b0 = this.beat;
      const b1 = b0 + STEP;
      for (let ti = 0; ti < this.tracks.length; ti++) {
        const tr = this.tracks[ti];
        const evs = tr.def.events;
        let i = this.idx[ti];
        while (i < evs.length && evs[i].b < b1 - 1e-9) {
          const ev = evs[i];
          if (ev.b >= b0 - 1e-9) this._play(tr, ti, ev, b0, spb);
          i++;
        }
        this.idx[ti] = i;
      }
      this.beat = b1;
      this.time += STEP * spb;
      if (this.beat >= song.length - 1e-9) {
        this.beat = song.loopStart;
        this.loops++;
        this._seek(this.beat);
      }
    }
  }

  _play(tr, ti, ev, b0, spb) {
    const song = this.song;
    // straight time of the event + swing displacement
    const sb = swingBeat(ev.b, song.swing, song.swing16);
    const t = Math.max(this.ctx.currentTime, this.time + (sb - b0) * spb);
    try {
      if (tr.def.drum) {
        playDrum(this.ctx, tr.input, tr.P.kit, ev.dv, t, ev.v);
      } else {
        const f = mtof(ev.n + tr.transpose);
        const dur = Math.max(0.03, ev.d * spb * (ev.g ?? 0.9));
        const slideFrom = ev.s ? this.lastFreq[ti] : 0;
        tr.inst(this.ctx, tr.input, t, f, dur, ev.v, tr.P, slideFrom);
        this.lastFreq[ti] = f;
      }
    } catch (e) {
      if (!this._warned) {
        this._warned = true;
        console.warn('[audio] note error', e);
      }
    }
  }

  getPosition() {
    const spb = this._spb();
    const now = this.ctx.currentTime;
    let beat = this.paused ? this._pausedBeat ?? this.beat : this.beat - (this.time - now) / spb;
    if (beat < 0) beat += this.song.length - this.song.loopStart;
    let section = null;
    for (const s of this.song.sections) if (beat >= s.start - 1e-6) section = s.name;
    return {
      key: this.key,
      beat,
      bar: Math.floor(beat / 4) + 1,
      beatInBar: beat % 4,
      loops: this.loops,
      section,
      bpm: this.song.bpm * this.tempo,
      tempo: this.tempo,
    };
  }

  /** Fade out and tear down. Returns the ctx time at which it is silent. */
  stop(fadeOut = 0.5) {
    if (this.stopped) return this.ctx.currentTime;
    this.stopped = true;
    const now = this.ctx.currentTime;
    const g = this.fader.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(Math.max(0.0001, g.value), now);
    const end = now + Math.max(0.02, fadeOut);
    g.linearRampToValueAtTime(0.0001, end);
    const nodes = this.nodes;
    this._teardown = setTimeout(() => {
      for (const n of nodes) {
        try {
          n.disconnect();
        } catch {
          /* noop */
        }
      }
    }, (end - now) * 1000 + 2500); // keep reverb/delay tails alive under the fade, then drop
    return end;
  }

  disposeNow() {
    this.stopped = true;
    clearTimeout(this._teardown);
    for (const n of this.nodes) {
      try {
        n.disconnect();
      } catch {
        /* noop */
      }
    }
  }
}
