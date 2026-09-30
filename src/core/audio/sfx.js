// Synthesized sound effects (owner: audio agent). No samples: every effect is a small Web Audio graph built on
// demand by a SfxBuilder. SFX[name](b, o) receives a builder (b.t = start time, b.p = pitch multiplier) and the
// caller's options.
//
// Builder primitives (all times relative to the sound's start, all frequencies multiplied by the pitch option):
//   b.tone({ type|wave, f, f1, sweep, fenv, at, dur, a, vol, hold, env, vib, vibRate, lp, hp, bp, Q, detune, dest })
//   b.noise({ kind, at, dur, a, vol, hold, env, type, f, f1, sweep, fenv, Q, rate, dest })
//   b.fm({ f, ratio, index, at, dur, vol, dest })       FM bell / chime
//   b.bus(gain) / b.filter(type, f, Q, dest)             sub-mix nodes

import { pulseWave, noiseBuffer, rnd } from './dsp.js';

const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** 'C#6' -> Hz */
export function nf(name) {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  if (!m) return 440;
  let n = NOTE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  const midi = (Number(m[3]) + 1) * 12 + n;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export class SfxBuilder {
  constructor(ctx, dest, t0, pitch = 1, send = null) {
    this.ctx = ctx;
    this.t = t0;
    this.p = pitch;
    this.out = dest;
    this.send = send; // reverb send input (optional)
    this.srcs = [];
    this.nodes = [];
    this.end = t0;
  }

  _node(n) {
    this.nodes.push(n);
    return n;
  }

  _src(s, start, stop) {
    s.start(start);
    s.stop(stop);
    this.srcs.push(s);
    if (stop > this.end) this.end = stop;
    return s;
  }

  bus(gain = 1, dest = this.out) {
    const g = this._node(this.ctx.createGain());
    g.gain.value = gain;
    g.connect(dest);
    return g;
  }

  /** Send part of the signal to the reverb (if the manager provided one). */
  reverb(amount = 0.3) {
    if (!this.send || amount <= 0) return this.out;
    const g = this._node(this.ctx.createGain());
    g.gain.value = amount;
    g.connect(this.send);
    const mix = this._node(this.ctx.createGain());
    mix.connect(this.out);
    mix.connect(g);
    return mix;
  }

  filter(type, f, Q = 0.7, dest = this.out) {
    const b = this._node(this.ctx.createBiquadFilter());
    b.type = type;
    b.frequency.value = f;
    b.Q.value = Q;
    b.connect(dest);
    return b;
  }

  _env(param, o, t0, t1) {
    const vol = o.vol ?? 0.3;
    if (o.env) {
      param.setValueAtTime(0, t0);
      for (const [tt, v] of o.env) param.linearRampToValueAtTime(v * vol, t0 + tt);
      param.linearRampToValueAtTime(0, t1);
      return;
    }
    const a = o.a ?? 0.004;
    const holdT = t0 + a + Math.max(0, (t1 - t0 - a) * (o.hold ?? 0));
    param.setValueAtTime(0, t0);
    param.linearRampToValueAtTime(vol, t0 + a);
    if (holdT > t0 + a) param.setValueAtTime(vol, holdT);
    param.setTargetAtTime(0, holdT, Math.max(0.004, (t1 - holdT) / 5));
  }

  _freq(param, o, t0, t1, base) {
    const p = this.p;
    if (o.fenv) {
      param.setValueAtTime(o.fenv[0][1] * p, t0);
      param.setValueAtTime(o.fenv[0][1] * p, t0 + o.fenv[0][0]);
      for (let i = 1; i < o.fenv.length; i++) {
        const [tt, f] = o.fenv[i];
        if (o.step) param.setValueAtTime(f * p, t0 + tt);
        else param.exponentialRampToValueAtTime(Math.max(1, f * p), t0 + tt);
      }
      return;
    }
    param.setValueAtTime(base * p, t0);
    if (o.f1) {
      const te = t0 + (o.sweep ?? t1 - t0);
      if (o.lin) param.linearRampToValueAtTime(o.f1 * p, te);
      else param.exponentialRampToValueAtTime(Math.max(1, o.f1 * p), te);
    }
  }

  /** Oscillator voice with pitch and amplitude envelopes. Returns the gain node. */
  tone(o) {
    const ctx = this.ctx;
    const t0 = this.t + (o.at ?? 0);
    const t1 = t0 + (o.dur ?? 0.2);
    const osc = ctx.createOscillator();
    if (o.wave) osc.setPeriodicWave(o.wave);
    else osc.type = o.type ?? 'sine';
    this._freq(osc.frequency, o, t0, t1, o.f ?? 440);
    if (o.detune) osc.detune.value = o.detune;
    let node = osc;
    const g = this._node(ctx.createGain());
    g.gain.value = 0;
    if (o.lp || o.hp || o.bp) {
      const f = this._node(ctx.createBiquadFilter());
      f.type = o.lp ? 'lowpass' : o.hp ? 'highpass' : 'bandpass';
      f.frequency.value = o.lp || o.hp || o.bp;
      f.Q.value = o.Q ?? 0.8;
      node.connect(f);
      node = f;
    }
    node.connect(g);
    g.connect(o.dest ?? this.out);
    this._env(g.gain, o, t0, t1);
    if (o.vib) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = o.vibRate ?? 6;
      const lg = this._node(ctx.createGain());
      lg.gain.value = o.vib;
      lfo.connect(lg).connect(osc.detune);
      this._src(lfo, t0, t1 + 0.02);
    }
    this._src(osc, t0, t1 + 0.02);
    return g;
  }

  /** Filtered noise burst. Returns the gain node. */
  noise(o) {
    const ctx = this.ctx;
    const t0 = this.t + (o.at ?? 0);
    const t1 = t0 + (o.dur ?? 0.2);
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx, o.kind ?? 'white');
    src.loop = true;
    if (o.rate) src.playbackRate.value = o.rate;
    let node = src;
    if (o.type !== 'none') {
      const f = this._node(ctx.createBiquadFilter());
      f.type = o.type ?? 'bandpass';
      f.Q.value = o.Q ?? 1;
      this._freq(f.frequency, o, t0, t1, o.f ?? 1000);
      node.connect(f);
      node = f;
      if (o.type2) {
        const f2 = this._node(ctx.createBiquadFilter());
        f2.type = o.type2;
        f2.frequency.value = o.f2 ?? 500;
        node.connect(f2);
        node = f2;
      }
    }
    const g = this._node(ctx.createGain());
    g.gain.value = 0;
    node.connect(g);
    g.connect(o.dest ?? this.out);
    this._env(g.gain, o, t0, t1);
    src.start(t0, rnd() * 1.8);
    src.stop(t1 + 0.02);
    this.srcs.push(src);
    if (t1 + 0.02 > this.end) this.end = t1 + 0.02;
    return g;
  }

  /** FM chime. */
  fm(o) {
    const ctx = this.ctx;
    const t0 = this.t + (o.at ?? 0);
    const dur = o.dur ?? 0.6;
    const t1 = t0 + dur;
    const f = (o.f ?? 880) * this.p;
    const car = ctx.createOscillator();
    car.frequency.value = f;
    const mod = ctx.createOscillator();
    mod.frequency.value = f * (o.ratio ?? 3.5);
    const mg = this._node(ctx.createGain());
    const idx = (o.index ?? 2) * f;
    mg.gain.setValueAtTime(idx, t0);
    mg.gain.setTargetAtTime(idx * 0.1, t0, dur / 4);
    mod.connect(mg).connect(car.frequency);
    const g = this._node(ctx.createGain());
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(o.vol ?? 0.2, t0 + 0.003);
    g.gain.setTargetAtTime(0, t0 + 0.003, dur / 5);
    car.connect(g).connect(o.dest ?? this.out);
    this._src(car, t0, t1 + 0.02);
    this._src(mod, t0, t1 + 0.02);
    return g;
  }

  /** Sequence of notes: [[time, noteName|Hz, dur, vol?], ...] with a shared tone config. */
  seq(notes, cfg) {
    for (const [at, n, dur, vol] of notes) {
      const f = typeof n === 'number' ? n : nf(n);
      this.tone({ ...cfg, at: (cfg.at ?? 0) + at, f, dur, vol: (vol ?? 1) * (cfg.vol ?? 0.2) });
    }
  }

  /** Called by the manager after the sfx function: clean the graph up once every source has ended. */
  finalize(extra = []) {
    const nodes = this.nodes.concat(extra);
    let pending = this.srcs.length;
    if (!pending) {
      for (const n of nodes) n.disconnect();
      return;
    }
    const done = () => {
      if (--pending > 0) return;
      for (const n of nodes) {
        try {
          n.disconnect();
        } catch {
          /* noop */
        }
      }
    };
    for (const s of this.srcs) s.onended = done;
  }

  /** Stop everything early (voice stealing). */
  kill(at) {
    for (const s of this.srcs) {
      try {
        s.stop(at);
      } catch {
        /* noop */
      }
    }
  }
}

// ------------------------------------------------------------------------------------------------------------
// Sound designs
// ------------------------------------------------------------------------------------------------------------

const sparkle = (b, { at = 0, n = 6, lo = 3000, hi = 7000, span = 0.4, vol = 0.04, dest } = {}) => {
  for (let i = 0; i < n; i++) {
    const f = lo + rnd() * (hi - lo);
    b.tone({ type: 'sine', f, f1: f * 1.04, at: at + rnd() * span, dur: 0.05 + rnd() * 0.08, vol: vol * (0.6 + rnd() * 0.6), dest });
  }
};

const coinDing = (b, at, n1, n2, vol = 1) => {
  const w = pulseWave(b.ctx, 0.5);
  b.tone({ wave: w, f: nf(n1), at, dur: 0.075, vol: 0.1 * vol, hold: 0.8, lp: 6000 });
  b.tone({ type: 'sine', f: nf(n1), at, dur: 0.075, vol: 0.12 * vol, hold: 0.8 });
  b.tone({ wave: w, f: nf(n2), at: at + 0.07, dur: 0.42, vol: 0.1 * vol, hold: 0.12, lp: 7000 });
  b.tone({ type: 'sine', f: nf(n2), at: at + 0.07, dur: 0.5, vol: 0.14 * vol, hold: 0.1 });
};

const brassHit = (b, at, notes, dur, vol, dest) => {
  for (const n of notes) {
    const f = nf(n);
    for (const dt of [-6, 7]) {
      b.tone({ type: 'sawtooth', f, detune: dt, at, dur, vol: vol * 0.5, a: 0.02, hold: 0.55, lp: Math.min(5200, f * 6), Q: 1, dest });
    }
    b.tone({ wave: pulseWave(b.ctx, 0.25), f, at, dur, vol: vol * 0.35, a: 0.01, hold: 0.55, lp: 6000, vib: dur > 0.4 ? 10 : 0, vibRate: 5.5, dest });
  }
};

const snareRoll = (b, at, dur, vol = 0.2, dest) => {
  const n = Math.floor(dur / 0.045);
  for (let i = 0; i < n; i++) {
    b.noise({ at: at + i * 0.045, dur: 0.06, vol: vol * (0.5 + (i / n) * 0.6), type: 'bandpass', f: 3500, Q: 0.7, dest });
  }
};

const crash = (b, at, vol = 0.3, dur = 1.6, dest) => {
  b.noise({ at, dur, vol, type: 'highpass', f: 3800, Q: 0.6, a: 0.002, dest });
  b.noise({ at, dur: dur * 0.6, vol: vol * 0.4, type: 'bandpass', f: 6500, Q: 2, a: 0.002, dest });
};

const thump = (b, at, f0, f1, dur, vol, dest) => b.tone({ type: 'sine', f: f0, f1, at, dur, vol, a: 0.002, dest });

export const SFX = {
  // ---------------- menus ----------------
  menuMove(b) {
    b.tone({ type: 'sine', f: 1568, f1: 1760, sweep: 0.03, dur: 0.07, vol: 0.28 });
    b.tone({ type: 'triangle', f: 784, dur: 0.05, vol: 0.12 });
    b.noise({ type: 'highpass', f: 6000, dur: 0.012, vol: 0.05 });
  },
  menuSelect(b) {
    const w = pulseWave(b.ctx, 0.25);
    const out = b.reverb(0.15);
    b.tone({ wave: w, f: nf('E6'), dur: 0.075, vol: 0.12, hold: 0.7, lp: 7000, dest: out });
    b.tone({ type: 'sine', f: nf('E6'), dur: 0.075, vol: 0.12, hold: 0.7, dest: out });
    b.tone({ wave: w, f: nf('B6'), at: 0.065, dur: 0.26, vol: 0.12, hold: 0.2, lp: 8000, dest: out });
    b.tone({ type: 'sine', f: nf('B6'), at: 0.065, dur: 0.3, vol: 0.16, hold: 0.15, dest: out });
    b.fm({ f: nf('E7'), at: 0.07, dur: 0.4, vol: 0.05, ratio: 3.5, index: 1.2, dest: out });
  },
  menuBack(b) {
    const w = pulseWave(b.ctx, 0.25);
    b.tone({ wave: w, f: nf('B5'), dur: 0.07, vol: 0.1, hold: 0.7, lp: 3500 });
    b.tone({ type: 'sine', f: nf('B5'), dur: 0.07, vol: 0.1, hold: 0.7 });
    b.tone({ wave: w, f: nf('E5'), at: 0.065, dur: 0.16, vol: 0.1, hold: 0.3, lp: 3000 });
    b.tone({ type: 'sine', f: nf('E5'), at: 0.065, dur: 0.18, vol: 0.12, hold: 0.3 });
  },
  menuError(b) {
    for (const at of [0, 0.12]) {
      b.tone({ type: 'square', f: 170, at, dur: 0.09, vol: 0.14, hold: 0.8, lp: 1400 });
      b.tone({ type: 'square', f: 178, at, dur: 0.09, vol: 0.1, hold: 0.8, lp: 1400 });
    }
  },
  pause(b) {
    const w = pulseWave(b.ctx, 0.5);
    b.tone({ wave: w, f: nf('G6'), dur: 0.08, vol: 0.1, hold: 0.6, lp: 3000 });
    b.tone({ wave: w, f: nf('D6'), at: 0.075, dur: 0.16, vol: 0.1, hold: 0.3, lp: 2600 });
    b.tone({ type: 'sine', f: nf('D5'), at: 0.075, dur: 0.18, vol: 0.14 });
  },
  unpause(b) {
    const w = pulseWave(b.ctx, 0.5);
    b.tone({ wave: w, f: nf('D6'), dur: 0.08, vol: 0.1, hold: 0.6, lp: 3000 });
    b.tone({ wave: w, f: nf('G6'), at: 0.075, dur: 0.16, vol: 0.1, hold: 0.3, lp: 3000 });
    b.tone({ type: 'sine', f: nf('G5'), at: 0.075, dur: 0.18, vol: 0.14 });
  },

  // ---------------- countdown ----------------
  countdownBeep(b) {
    const f = nf('C5');
    b.tone({ type: 'square', f, dur: 0.36, vol: 0.13, hold: 0.72, lp: 2400, a: 0.003 });
    b.tone({ type: 'sine', f, dur: 0.36, vol: 0.28, hold: 0.72, a: 0.003 });
    b.tone({ type: 'sine', f: f * 2, dur: 0.25, vol: 0.05, hold: 0.5 });
  },
  countdownGo(b) {
    const f = nf('C6');
    const out = b.reverb(0.25);
    b.tone({ type: 'square', f, dur: 1.05, vol: 0.13, hold: 0.62, lp: 3600, a: 0.003, vib: 14, vibRate: 6, dest: out });
    b.tone({ type: 'sine', f, dur: 1.1, vol: 0.28, hold: 0.62, a: 0.003, dest: out });
    b.tone({ type: 'sine', f: f * 1.5, dur: 0.9, vol: 0.07, hold: 0.5, dest: out });
    b.tone({ type: 'sine', f: f / 2, dur: 0.9, vol: 0.12, hold: 0.5, dest: out });
  },

  // ---------------- items ----------------
  itemBox(b) {
    const out = b.reverb(0.2);
    // glassy shatter
    for (let i = 0; i < 9; i++) {
      const f = 2200 + rnd() * 5200;
      b.tone({ type: 'sine', f, f1: f * (0.97 + rnd() * 0.06), at: rnd() * 0.05, dur: 0.07 + rnd() * 0.2, vol: 0.045 + rnd() * 0.03, dest: out });
    }
    b.noise({ type: 'highpass', f: 3500, dur: 0.18, vol: 0.2, a: 0.001, dest: out });
    b.noise({ type: 'bandpass', f: 1800, Q: 2, dur: 0.06, vol: 0.2, a: 0.001 });
    // chime
    b.fm({ f: nf('C7'), at: 0.03, dur: 0.55, vol: 0.09, ratio: 3.5, index: 1.4, dest: out });
    b.fm({ f: nf('G7'), at: 0.1, dur: 0.5, vol: 0.06, ratio: 3.5, index: 1.2, dest: out });
  },
  rouletteTick(b) {
    const f = 1500 * (0.95 + rnd() * 0.1);
    b.tone({ type: 'square', f, dur: 0.02, vol: 0.09, lp: 4500, a: 0.001 });
    b.tone({ type: 'sine', f: f / 2, dur: 0.025, vol: 0.08, a: 0.001 });
  },
  itemGet(b) {
    const out = b.reverb(0.2);
    const w = pulseWave(b.ctx, 0.25);
    b.tone({ wave: w, f: nf('A6'), dur: 0.08, vol: 0.09, hold: 0.7, lp: 7000, dest: out });
    b.tone({ type: 'sine', f: nf('A6'), dur: 0.08, vol: 0.1, hold: 0.7, dest: out });
    b.tone({ wave: w, f: nf('E7'), at: 0.075, dur: 0.35, vol: 0.08, hold: 0.2, lp: 8000, vib: 12, dest: out });
    b.fm({ f: nf('E7'), at: 0.075, dur: 0.6, vol: 0.09, ratio: 3.5, index: 1.3, dest: out });
    sparkle(b, { at: 0.08, n: 5, span: 0.25, vol: 0.03, dest: out });
  },
  itemUse(b) {
    b.noise({ kind: 'pink', type: 'bandpass', f: 600, f1: 2600, Q: 1.4, dur: 0.22, vol: 0.4, a: 0.02 });
    b.tone({ type: 'sine', f: 500, f1: 950, dur: 0.1, vol: 0.1 });
  },
  boost(b) {
    b.noise({ kind: 'pink', type: 'bandpass', f: 280, f1: 3000, sweep: 0.45, Q: 1.3, dur: 0.85, vol: 0.75, a: 0.03, hold: 0.25 });
    b.tone({ type: 'sawtooth', f: 160, f1: 520, sweep: 0.5, dur: 0.6, vol: 0.12, lp: 1600, a: 0.02, hold: 0.3 });
    b.tone({ type: 'sine', f: 900, f1: 2200, sweep: 0.14, dur: 0.16, vol: 0.07 });
    thump(b, 0, 110, 55, 0.18, 0.3);
  },
  boostPad(b) {
    const out = b.reverb(0.15);
    for (const [f, d] of [
      [880, 0],
      [1109, 0.02],
      [1319, 0.04],
    ]) {
      b.tone({ type: 'sine', f, f1: f * 2, sweep: 0.22, at: d, dur: 0.34, vol: 0.075, dest: out });
    }
    b.noise({ kind: 'pink', type: 'bandpass', f: 700, f1: 4200, sweep: 0.3, Q: 1.2, dur: 0.5, vol: 0.55, a: 0.02 });
    thump(b, 0, 120, 60, 0.12, 0.2);
  },
  coin(b) {
    coinDing(b, 0, 'C6', 'G6');
  },
  credits(b) {
    const out = b.reverb(0.15);
    const w = pulseWave(b.ctx, 0.5);
    ['C6', 'E6', 'G6', 'C7'].forEach((n, i) => {
      b.tone({ wave: w, f: nf(n), at: i * 0.06, dur: 0.09, vol: 0.08, hold: 0.6, lp: 7000, dest: out });
      b.tone({ type: 'sine', f: nf(n), at: i * 0.06, dur: 0.1, vol: 0.1, hold: 0.6, dest: out });
    });
    b.noise({ type: 'highpass', f: 4500, at: 0.26, dur: 0.14, vol: 0.18, a: 0.002 });
    b.fm({ f: nf('C7'), at: 0.27, dur: 0.7, vol: 0.1, ratio: 3.5, index: 1.5, dest: out });
    b.fm({ f: nf('E7'), at: 0.29, dur: 0.7, vol: 0.08, ratio: 3.5, index: 1.5, dest: out });
    sparkle(b, { at: 0.3, n: 6, span: 0.35, vol: 0.03, dest: out });
  },
  fire(b) {
    b.tone({ type: 'square', f: 1400, f1: 170, sweep: 0.15, dur: 0.17, vol: 0.13, lp: 3000 });
    b.noise({ kind: 'pink', type: 'lowpass', f: 2500, f1: 400, dur: 0.12, vol: 0.45, a: 0.001 });
    thump(b, 0, 160, 55, 0.14, 0.35);
  },
  throw(b) {
    b.noise({ kind: 'pink', type: 'bandpass', f: 2600, f1: 450, Q: 1.5, dur: 0.32, vol: 0.4, a: 0.03 });
    b.tone({ type: 'sine', f: 380, f1: 720, dur: 0.1, vol: 0.12 });
  },
  missileLock(b) {
    const w = pulseWave(b.ctx, 0.25);
    for (let i = 0; i < 3; i++) {
      b.tone({ wave: w, f: 1760, at: i * 0.1, dur: 0.05, vol: 0.1, hold: 0.8, lp: 6000 });
    }
    b.tone({ wave: w, f: 2349, at: 0.3, dur: 0.3, vol: 0.1, hold: 0.8, lp: 6000 });
    b.tone({ type: 'sine', f: 2349, at: 0.3, dur: 0.3, vol: 0.08, hold: 0.8 });
  },
  seekerWarning(b) {
    const fenv = [];
    for (let i = 0; i <= 8; i++) fenv.push([i * 0.15, i % 2 ? 660 : 880]);
    b.tone({ type: 'square', fenv, step: true, dur: 1.3, vol: 0.1, hold: 0.85, lp: 2800, a: 0.01 });
    b.tone({ type: 'sine', fenv, step: true, dur: 1.3, vol: 0.12, hold: 0.85, a: 0.01 });
    b.tone({ type: 'sawtooth', f: 300, f1: 1300, dur: 1.3, vol: 0.05, lp: 2000, a: 0.3, hold: 0.7 });
  },
  shrink(b) {
    b.tone({ type: 'sine', f: 1500, f1: 170, dur: 0.85, vol: 0.18, vib: 70, vibRate: 13, hold: 0.5 });
    b.tone({ type: 'triangle', f: 750, f1: 85, dur: 0.85, vol: 0.1, vib: 70, vibRate: 13, hold: 0.5 });
    b.noise({ type: 'highpass', f: 5000, dur: 0.2, vol: 0.12 });
  },
  grow(b) {
    const out = b.reverb(0.2);
    b.tone({ type: 'sine', f: 170, f1: 1300, dur: 0.75, vol: 0.18, vib: 60, vibRate: 11, hold: 0.6, dest: out });
    b.tone({ type: 'triangle', f: 85, f1: 650, dur: 0.75, vol: 0.1, vib: 60, vibRate: 11, hold: 0.6, dest: out });
    b.fm({ f: nf('C7'), at: 0.72, dur: 0.5, vol: 0.08, dest: out });
  },
  halo(b) {
    const out = b.reverb(0.45);
    const notes = ['C6', 'E6', 'G6', 'B6', 'C7', 'E7', 'G7', 'C8'];
    notes.forEach((n, i) => b.fm({ f: nf(n), at: i * 0.045, dur: 0.8, vol: 0.065, ratio: 3.5, index: 1.1, dest: out }));
    notes.slice(0, 5).forEach((n, i) => b.fm({ f: nf(n), at: 0.4 + i * 0.05, dur: 0.6, vol: 0.035, ratio: 2, index: 0.8, dest: out }));
    for (const n of ['C5', 'E5', 'G5']) b.tone({ type: 'sine', f: nf(n), dur: 1.5, a: 0.15, hold: 0.4, vol: 0.05, vib: 12, vibRate: 7, dest: out });
    b.noise({ type: 'highpass', f: 8000, dur: 1.3, vol: 0.05, a: 0.2, hold: 0.3, dest: out });
    sparkle(b, { at: 0.2, n: 10, span: 1, lo: 4000, hi: 9000, vol: 0.025, dest: out });
  },
  tablet(b) {
    const out = b.reverb(0.15);
    // crackling zap
    const fenv = [];
    for (let i = 0; i <= 22; i++) fenv.push([i * 0.025, 200 + rnd() * 1300]);
    b.tone({ type: 'sawtooth', fenv, step: true, dur: 0.6, vol: 0.12, bp: 1800, Q: 1.5, hold: 0.6 });
    const env = [];
    for (let i = 0; i <= 24; i++) env.push([i * 0.025, rnd() > 0.45 ? 1 : 0.15]);
    b.noise({ type: 'highpass', f: 4500, dur: 0.65, vol: 0.2, env });
    b.tone({ type: 'square', f: 900, f1: 80, dur: 0.7, vol: 0.09, lp: 2200, hold: 0.3 });
    thump(b, 0, 200, 60, 0.2, 0.25);
    // Arona-blue screen blips
    b.tone({ type: 'sine', f: 1320, at: 0.62, dur: 0.06, vol: 0.12, hold: 0.8, dest: out });
    b.tone({ type: 'sine', f: 1760, at: 0.7, dur: 0.1, vol: 0.12, hold: 0.8, dest: out });
    b.tone({ type: 'sine', f: 2637, at: 0.8, dur: 0.18, vol: 0.08, hold: 0.3, dest: out });
  },
  ramenSplat(b) {
    b.noise({ kind: 'pink', type: 'lowpass', f: 2600, f1: 280, Q: 2, dur: 0.38, vol: 0.7, a: 0.004 });
    b.tone({ type: 'sine', f: 330, f1: 85, dur: 0.32, vol: 0.28, vib: 120, vibRate: 18 });
    b.tone({ type: 'sine', f: 900, f1: 1400, at: 0.22, dur: 0.05, vol: 0.07 });
    b.tone({ type: 'sine', f: 1100, f1: 1600, at: 0.33, dur: 0.04, vol: 0.05 });
  },
  decoy(b) {
    b.tone({ type: 'sine', f: 950, dur: 0.05, vol: 0.2, a: 0.001 });
    b.noise({ type: 'bandpass', f: 1200, Q: 3, dur: 0.03, vol: 0.2 });
    b.tone({ type: 'sine', fenv: [[0.04, 200], [0.18, 620], [0.45, 280]], at: 0, dur: 0.5, vol: 0.2, vib: 90, vibRate: 14, a: 0.05 });
    b.tone({ type: 'triangle', fenv: [[0.04, 400], [0.18, 1240], [0.45, 560]], at: 0, dur: 0.5, vol: 0.06, a: 0.05 });
  },
  explosion(b) {
    const out = b.reverb(0.3);
    b.noise({ kind: 'pink', type: 'lowpass', f: 7000, f1: 160, sweep: 0.9, Q: 0.8, dur: 1.5, vol: 1.0, a: 0.003, dest: out });
    b.noise({ kind: 'brown', type: 'lowpass', f: 180, Q: 0.7, dur: 1.7, vol: 0.9, a: 0.01, dest: out });
    thump(b, 0, 120, 28, 0.8, 0.8, out);
    for (let i = 0; i < 7; i++) b.noise({ type: 'highpass', f: 2500, at: 0.05 + rnd() * 0.7, dur: 0.03, vol: 0.12 + rnd() * 0.1 });
  },

  // ---------------- driving ----------------
  driftHop(b) {
    b.tone({ type: 'sine', f: 250, f1: 440, sweep: 0.06, dur: 0.1, vol: 0.14 });
    thump(b, 0.02, 130, 70, 0.07, 0.14);
  },
  driftStart(b) {
    b.noise({ type: 'bandpass', fenv: [[0, 2300], [0.12, 2700], [0.3, 2400], [0.45, 2200]], Q: 7, dur: 0.45, vol: 0.45, a: 0.02, hold: 0.4 });
    b.tone({ type: 'triangle', f: 1150, f1: 1260, dur: 0.4, vol: 0.035, vib: 40, vibRate: 22, a: 0.03, hold: 0.4 });
    b.noise({ kind: 'pink', type: 'lowpass', f: 600, dur: 0.25, vol: 0.18, a: 0.01 });
  },
  sparkBlue(b) {
    b.tone({ type: 'sine', f: nf('E6'), f1: nf('A6'), sweep: 0.07, dur: 0.24, vol: 0.13 });
    b.tone({ type: 'sine', f: nf('A7'), at: 0.05, dur: 0.14, vol: 0.04 });
    b.noise({ type: 'highpass', f: 7000, dur: 0.16, vol: 0.08, env: [[0.01, 1], [0.04, 0.2], [0.07, 0.9], [0.1, 0.1], [0.13, 0.6]] });
  },
  sparkOrange(b) {
    b.tone({ type: 'sine', f: nf('A6'), f1: nf('D7'), sweep: 0.07, dur: 0.28, vol: 0.13 });
    b.tone({ type: 'sine', f: nf('D7') * 1.5, at: 0.06, dur: 0.16, vol: 0.045 });
    b.tone({ type: 'triangle', f: nf('D6'), f1: nf('A6'), sweep: 0.07, dur: 0.2, vol: 0.05 });
    b.noise({ type: 'highpass', f: 6500, dur: 0.2, vol: 0.1, env: [[0.01, 1], [0.04, 0.2], [0.07, 1], [0.1, 0.1], [0.14, 0.7], [0.17, 0.1]] });
  },
  sparkPurple(b) {
    const out = b.reverb(0.2);
    b.tone({ type: 'sine', f: nf('D7'), f1: nf('G7'), sweep: 0.08, dur: 0.34, vol: 0.12, dest: out });
    b.tone({ type: 'sine', f: nf('B6'), at: 0.03, dur: 0.3, vol: 0.06, dest: out });
    b.tone({ type: 'sine', f: nf('G6'), at: 0.06, dur: 0.3, vol: 0.06, dest: out });
    b.tone({ type: 'triangle', f: nf('G6'), f1: nf('D7'), sweep: 0.08, dur: 0.24, vol: 0.05 });
    b.noise({ type: 'highpass', f: 6000, dur: 0.26, vol: 0.12, env: [[0.01, 1], [0.04, 0.2], [0.07, 1], [0.1, 0.1], [0.14, 1], [0.18, 0.1], [0.22, 0.6]] });
  },
  miniTurbo(b) {
    b.noise({ kind: 'pink', type: 'lowpass', f: 1800, dur: 0.07, vol: 0.7, a: 0.001 });
    thump(b, 0, 190, 55, 0.16, 0.45);
    b.noise({ kind: 'pink', type: 'bandpass', f: 500, f1: 2400, sweep: 0.3, Q: 1.3, dur: 0.45, vol: 0.5, a: 0.02 });
    b.tone({ type: 'sawtooth', f: 150, f1: 330, dur: 0.38, vol: 0.09, lp: 1400 });
  },
  jump(b) {
    b.tone({ type: 'sine', f: 220, f1: 700, sweep: 0.15, dur: 0.2, vol: 0.18 });
    b.noise({ kind: 'pink', type: 'bandpass', f: 900, f1: 3200, Q: 1.3, dur: 0.22, vol: 0.25, a: 0.02 });
  },
  trick(b) {
    const out = b.reverb(0.25);
    b.noise({ kind: 'pink', type: 'bandpass', f: 1400, f1: 5500, Q: 1.5, dur: 0.14, vol: 0.4, a: 0.01 });
    ['G6', 'B6', 'D7', 'G7'].forEach((n, i) => b.fm({ f: nf(n), at: 0.03 + i * 0.05, dur: 0.4, vol: 0.07, ratio: 3.5, index: 1.2, dest: out }));
    b.tone({ wave: pulseWave(b.ctx, 0.25), f: nf('G7'), at: 0.18, dur: 0.2, vol: 0.05, lp: 9000, dest: out });
  },
  land(b) {
    thump(b, 0, 140, 45, 0.16, 0.45);
    b.noise({ kind: 'pink', type: 'lowpass', f: 500, dur: 0.14, vol: 0.45, a: 0.002 });
    b.noise({ type: 'highpass', f: 3000, dur: 0.07, vol: 0.05 });
  },
  wallBump(b) {
    b.noise({ kind: 'pink', type: 'lowpass', f: 1000, dur: 0.13, vol: 0.7, a: 0.001 });
    thump(b, 0, 210, 80, 0.13, 0.35);
    b.tone({ type: 'square', f: 523, dur: 0.14, vol: 0.035, bp: 1500, Q: 3 });
    b.tone({ type: 'square', f: 787, dur: 0.12, vol: 0.03, bp: 2400, Q: 3 });
  },
  kartBump(b) {
    b.tone({ type: 'sine', f: 330, f1: 170, dur: 0.13, vol: 0.28, vib: 60, vibRate: 30 });
    b.tone({ type: 'sine', f: 520, f1: 260, dur: 0.08, vol: 0.1 });
    b.noise({ kind: 'pink', type: 'lowpass', f: 1300, dur: 0.07, vol: 0.4, a: 0.001 });
  },
  hit(b) {
    const out = b.reverb(0.15);
    b.noise({ kind: 'pink', type: 'bandpass', f: 1500, Q: 0.8, dur: 0.12, vol: 0.8, a: 0.001 });
    thump(b, 0, 220, 70, 0.15, 0.4);
    b.tone({ type: 'square', f: 950, f1: 170, sweep: 0.28, dur: 0.32, vol: 0.1, lp: 2600 });
    [2637, 3136, 2349, 2794].forEach((f, i) => b.tone({ type: 'sine', f, at: 0.12 + i * 0.06, dur: 0.2, vol: 0.05, dest: out }));
  },
  spin(b) {
    b.tone({ type: 'sine', f: 1150, f1: 420, dur: 1.05, vol: 0.15, vib: 380, vibRate: 7, hold: 0.6 });
    b.tone({ type: 'triangle', f: 575, f1: 210, dur: 1.05, vol: 0.07, vib: 380, vibRate: 7, hold: 0.6 });
    b.noise({ kind: 'pink', type: 'bandpass', f: 1500, f1: 700, Q: 2, dur: 0.9, vol: 0.15, hold: 0.5 });
  },
  launch(b) {
    const out = b.reverb(0.25);
    b.noise({ kind: 'pink', type: 'lowpass', f: 4000, f1: 220, sweep: 0.5, dur: 0.7, vol: 0.9, a: 0.003, dest: out });
    thump(b, 0, 100, 35, 0.55, 0.7, out);
    b.tone({ type: 'sine', f: 600, f1: 2300, at: 0.08, dur: 0.85, vol: 0.09, a: 0.12, hold: 0.5 });
    b.tone({ type: 'triangle', f: 300, f1: 1150, at: 0.08, dur: 0.85, vol: 0.05, a: 0.12, hold: 0.5 });
  },
  fall(b) {
    b.tone({ type: 'sine', f: 1900, f1: 200, dur: 1.4, vol: 0.14, vib: 20, vibRate: 6, hold: 0.7, a: 0.03 });
    b.tone({ type: 'triangle', f: 950, f1: 100, dur: 1.4, vol: 0.06, hold: 0.7, a: 0.03 });
  },
  respawn(b) {
    const out = b.reverb(0.3);
    ['C6', 'G6', 'C7', 'E7'].forEach((n, i) => b.fm({ f: nf(n), at: i * 0.08, dur: 0.5, vol: 0.07, ratio: 3.5, index: 1.1, dest: out }));
    b.tone({ type: 'sawtooth', f: 180, f1: 240, dur: 0.95, vol: 0.05, lp: 900, a: 0.1, hold: 0.5, vib: 50, vibRate: 28 });
    b.noise({ type: 'highpass', f: 7000, dur: 0.8, vol: 0.05, a: 0.1, hold: 0.3, dest: out });
  },
  wrongWay(b) {
    for (const at of [0, 0.2]) {
      b.tone({ type: 'square', f: 330, at, dur: 0.13, vol: 0.11, hold: 0.8, lp: 1600 });
      b.tone({ type: 'square', f: 336, at, dur: 0.13, vol: 0.08, hold: 0.8, lp: 1600 });
    }
  },
  placeUp(b) {
    const w = pulseWave(b.ctx, 0.25);
    b.tone({ wave: w, f: nf('G5'), dur: 0.07, vol: 0.1, hold: 0.7, lp: 6000 });
    b.tone({ wave: w, f: nf('D6'), at: 0.065, dur: 0.18, vol: 0.1, hold: 0.3, lp: 6000 });
    b.tone({ type: 'sine', f: nf('D6'), at: 0.065, dur: 0.2, vol: 0.12, hold: 0.3 });
  },
  placeDown(b) {
    const w = pulseWave(b.ctx, 0.5);
    b.tone({ wave: w, f: nf('D5'), dur: 0.08, vol: 0.09, hold: 0.7, lp: 1800 });
    b.tone({ wave: w, f: nf('G4'), at: 0.075, dur: 0.2, vol: 0.09, hold: 0.3, lp: 1500 });
    b.tone({ type: 'triangle', f: nf('G4'), at: 0.075, dur: 0.2, vol: 0.12, hold: 0.3 });
  },
  rocketStart(b) {
    const out = b.reverb(0.2);
    b.noise({ kind: 'pink', type: 'bandpass', f: 200, f1: 3600, sweep: 0.5, Q: 1.2, dur: 0.9, vol: 0.8, a: 0.02, hold: 0.2 });
    b.tone({ type: 'sawtooth', f: 110, f1: 440, sweep: 0.5, dur: 0.65, vol: 0.13, lp: 2000 });
    thump(b, 0, 90, 45, 0.25, 0.4);
    b.tone({ type: 'sine', f: nf('C6'), at: 0.08, dur: 0.45, vol: 0.08, dest: out });
    b.tone({ type: 'sine', f: nf('G6'), at: 0.12, dur: 0.45, vol: 0.07, dest: out });
  },
  stall(b) {
    [0, 0.1, 0.22, 0.29, 0.45].forEach((at, i) => {
      const v = 1 - i * 0.15;
      b.noise({ kind: 'brown', type: 'lowpass', f: 500, at, dur: 0.07, vol: 0.5 * v, a: 0.002 });
      b.tone({ type: 'square', f: 58 + i * 3, at, dur: 0.06, vol: 0.1 * v, lp: 400 });
    });
    b.noise({ type: 'highpass', f: 2500, at: 0.52, dur: 0.25, vol: 0.08, a: 0.02 });
  },
  confetti(b) {
    const out = b.reverb(0.2);
    b.noise({ type: 'bandpass', f: 1200, Q: 1, dur: 0.05, vol: 0.7, a: 0.001 });
    b.tone({ type: 'sine', f: 700, f1: 1500, dur: 0.08, vol: 0.12 });
    sparkle(b, { at: 0.04, n: 16, span: 1.0, lo: 3000, hi: 8000, vol: 0.04, dest: out });
    b.noise({ type: 'highpass', f: 6000, at: 0.05, dur: 1.0, vol: 0.05, env: [[0.05, 1], [0.3, 0.6], [0.6, 0.3], [0.9, 0.1]], dest: out });
  },

  // ---------------- jingles ----------------
  lap(b) {
    const out = b.reverb(0.25);
    const w = pulseWave(b.ctx, 0.25);
    const notes = [
      [0, 'G5', 0.07],
      [0.075, 'C6', 0.07],
      [0.15, 'D6', 0.07],
      [0.225, 'E6', 0.07],
      [0.3, 'G6', 0.12],
      [0.45, 'C7', 0.45],
    ];
    b.seq(notes, { wave: w, vol: 0.09, hold: 0.6, lp: 7000, dest: out });
    b.seq(notes, { type: 'sine', vol: 0.1, hold: 0.6, dest: out });
    b.fm({ f: nf('E7'), at: 0.45, dur: 0.7, vol: 0.05, dest: out });
    b.fm({ f: nf('G7'), at: 0.47, dur: 0.7, vol: 0.04, dest: out });
  },
  finalLap(b) {
    const out = b.reverb(0.3);
    const lead = [
      [0, 'G5', 0.1],
      [0.12, 'G5', 0.1],
      [0.24, 'G5', 0.1],
      [0.36, 'C6', 0.3],
      [0.72, 'D6', 0.12],
      [0.84, 'E6', 0.12],
      [0.96, 'F6', 0.3],
      [1.32, 'E6', 0.12],
      [1.44, 'F6', 0.12],
      [1.56, 'G6', 0.8],
    ];
    for (const [at, n, d] of lead) brassHit(b, at, [n], d, 0.11, out);
    brassHit(b, 0.36, ['E5', 'G5'], 0.3, 0.06, out);
    brassHit(b, 0.96, ['A5', 'C6'], 0.3, 0.06, out);
    brassHit(b, 1.56, ['B5', 'D6'], 0.8, 0.06, out);
    snareRoll(b, 1.1, 0.45, 0.14, out);
    crash(b, 1.56, 0.18, 1.3, out);
    thump(b, 1.56, 110, 45, 0.4, 0.4, out);
    thump(b, 0.36, 110, 45, 0.3, 0.3, out);
    thump(b, 0.96, 110, 45, 0.3, 0.3, out);
  },
  finish(b) {
    const out = b.reverb(0.35);
    const hits = [
      [0, ['G5'], 0.11],
      [0.13, ['G5'], 0.11],
      [0.26, ['G5'], 0.11],
      [0.39, ['C6', 'E6', 'G6'], 0.55],
      [1.0, ['Bb5', 'D6', 'F6'], 0.22],
      [1.25, ['C6', 'E6', 'G6', 'C7'], 1.4],
    ];
    for (const [at, ns, d] of hits) brassHit(b, at, ns, d, ns.length > 1 ? 0.06 : 0.1, out);
    b.fm({ f: nf('C7'), at: 1.25, dur: 1.5, vol: 0.06, dest: out });
    b.fm({ f: nf('G7'), at: 1.3, dur: 1.5, vol: 0.04, dest: out });
    snareRoll(b, 0.62, 0.62, 0.15, out);
    crash(b, 1.25, 0.22, 2, out);
    crash(b, 0.39, 0.12, 0.8, out);
    thump(b, 0.39, 100, 45, 0.5, 0.45, out);
    thump(b, 1.25, 100, 40, 0.8, 0.55, out);
    sparkle(b, { at: 1.3, n: 10, span: 1, vol: 0.025, dest: out });
  },
};

/** Per-sfx metadata: gain trim, max simultaneous voices, min retrigger interval (s), music duck. */
export const SFX_META = {
  menuMove: { max: 2, gap: 0.03 },
  menuSelect: { max: 2, gap: 0.05 },
  menuBack: { max: 2, gap: 0.05 },
  menuError: { max: 1, gap: 0.1 },
  pause: { max: 1, gap: 0.1 },
  unpause: { max: 1, gap: 0.1 },
  countdownBeep: { max: 1, gap: 0.2 },
  countdownGo: { max: 1, gap: 0.2 },
  itemBox: { gain: 0.75, max: 3, gap: 0.04 },
  rouletteTick: { gain: 0.5, max: 2, gap: 0.025 },
  itemGet: { gain: 0.8, max: 1, gap: 0.1 },
  itemUse: { gain: 2.0, max: 2, gap: 0.05 },
  boost: { max: 2, gap: 0.08 },
  boostPad: { max: 2, gap: 0.1 },
  coin: { max: 4, gap: 0.03 },
  credits: { max: 1, gap: 0.2 },
  fire: { max: 3, gap: 0.05 },
  throw: { gain: 1.9, max: 2, gap: 0.05 },
  missileLock: { gain: 1.7, max: 1, gap: 0.5 },
  seekerWarning: { max: 1, gap: 1.0 },
  shrink: { max: 2, gap: 0.2 },
  grow: { max: 2, gap: 0.2 },
  halo: { max: 1, gap: 0.3 },
  tablet: { max: 1, gap: 0.3 },
  ramenSplat: { max: 2, gap: 0.08 },
  decoy: { max: 2, gap: 0.1 },
  explosion: { gain: 0.72, max: 3, gap: 0.06 },
  driftHop: { max: 2, gap: 0.08 },
  driftStart: { gain: 1.3, max: 1, gap: 0.15 },
  sparkBlue: { gain: 1.4, max: 1, gap: 0.15 },
  sparkOrange: { gain: 1.4, max: 1, gap: 0.15 },
  sparkPurple: { gain: 1.3, max: 1, gap: 0.15 },
  miniTurbo: { max: 2, gap: 0.1 },
  jump: { gain: 1.4, max: 2, gap: 0.1 },
  trick: { gain: 1.8, max: 1, gap: 0.15 },
  land: { max: 2, gap: 0.12 },
  wallBump: { max: 2, gap: 0.14 },
  kartBump: { max: 2, gap: 0.12 },
  hit: { max: 2, gap: 0.08 },
  spin: { max: 2, gap: 0.2 },
  launch: { gain: 0.8, max: 2, gap: 0.15 },
  fall: { max: 1, gap: 0.3 },
  respawn: { max: 1, gap: 0.3 },
  wrongWay: { max: 1, gap: 0.5 },
  placeUp: { max: 1, gap: 0.08 },
  placeDown: { max: 1, gap: 0.08 },
  rocketStart: { max: 1, gap: 0.3 },
  stall: { gain: 1.3, max: 1, gap: 0.3 },
  confetti: { gain: 1.5, max: 3, gap: 0.1 },
  lap: { max: 1, gap: 0.5, duck: [0.55, 1.0] },
  finalLap: { max: 1, gap: 0.5, duck: [0.85, 2.3] },
  finish: { max: 1, gap: 0.5, duck: [0.9, 2.8] },
};

export const SFX_NAMES = Object.keys(SFX);

/** Categories for the debug sound test. */
export const SFX_GROUPS = {
  Menu: ['menuMove', 'menuSelect', 'menuBack', 'menuError', 'pause', 'unpause'],
  Race: ['countdownBeep', 'countdownGo', 'rocketStart', 'stall', 'lap', 'finalLap', 'finish', 'placeUp', 'placeDown', 'wrongWay', 'confetti'],
  Driving: ['driftHop', 'driftStart', 'sparkBlue', 'sparkOrange', 'sparkPurple', 'miniTurbo', 'boost', 'boostPad', 'jump', 'trick', 'land', 'wallBump', 'kartBump', 'fall', 'respawn'],
  Items: ['itemBox', 'rouletteTick', 'itemGet', 'itemUse', 'coin', 'credits', 'fire', 'throw', 'missileLock', 'seekerWarning', 'halo', 'tablet', 'ramenSplat', 'decoy', 'shrink', 'grow'],
  Hits: ['hit', 'spin', 'launch', 'explosion'],
};
