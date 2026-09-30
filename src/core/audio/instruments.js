// Synthesized music instruments + drum kits (owner: audio agent).
//
// Melodic instrument signature:
//   INSTRUMENTS[name](ctx, out, t, freq, dur, vel, P, slideFrom) -> end time
//     ctx: BaseAudioContext, out: AudioNode (track input), t: start time, freq: Hz, dur: gate length (s),
//     vel: 0..1, P: track params (instrument options), slideFrom: previous frequency for a portamento or 0.
// Drum signature: playDrum(ctx, out, kitName, voice, t, vel)
//
// Every note builds a small throw-away node graph, stops its sources and disconnects itself when done.

import { pulseWave, harmonicWave, adsr, noiseSource, cleanupOnEnd, rnd } from './dsp.js';

const TAU = Math.PI * 2;

function mkOsc(ctx, type, f, t, slideFrom, glide) {
  const o = ctx.createOscillator();
  if (typeof type === 'string') o.type = type;
  else o.setPeriodicWave(type);
  if (slideFrom && slideFrom !== f) {
    o.frequency.setValueAtTime(slideFrom, t);
    o.frequency.exponentialRampToValueAtTime(f, t + glide);
  } else {
    o.frequency.setValueAtTime(f, t);
  }
  return o;
}

function mkGain(ctx, v = 1) {
  const g = ctx.createGain();
  g.gain.value = v;
  return g;
}

function mkFilter(ctx, type, f, Q = 0.7) {
  const b = ctx.createBiquadFilter();
  b.type = type;
  b.frequency.value = f;
  b.Q.value = Q;
  return b;
}

/** Delayed-onset vibrato into the given detune params. Returns the LFO source (or null). */
function vibrato(ctx, t, dur, end, params, depth, rate = 5.6, delay = 0.18) {
  if (!depth || dur < delay + 0.08) return null;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = rate;
  const lg = ctx.createGain();
  lg.gain.setValueAtTime(0, t);
  lg.gain.setValueAtTime(0, t + delay);
  lg.gain.linearRampToValueAtTime(depth, t + delay + 0.22);
  lfo.connect(lg);
  for (const p of params) lg.connect(p);
  lfo.start(t);
  lfo.stop(end);
  cleanupOnEnd(lfo, [lfo, lg]);
  return lfo;
}

function startAll(srcs, t, end) {
  for (const s of srcs) {
    s.start(t);
    s.stop(end + 0.02);
  }
}

// ------------------------------------------------------------------------------------------------------------
// Melodic instruments
// ------------------------------------------------------------------------------------------------------------

/** Pulse / square lead: duty, vib (cents), lp, detune (2nd osc cents), a d s r, glide */
function pulse(ctx, out, t, f, dur, vel, P, slide) {
  const glide = P.glide ?? 0.05;
  const wave = pulseWave(ctx, P.duty ?? 0.25);
  const o1 = mkOsc(ctx, wave, f, t, slide, glide);
  const srcs = [o1];
  const g = mkGain(ctx, 0);
  const lp = mkFilter(ctx, 'lowpass', P.lp ?? 7000, 0.5);
  o1.connect(lp);
  let o2 = null;
  if (P.detune) {
    o2 = mkOsc(ctx, wave, f, t, slide, glide);
    o2.detune.value = P.detune;
    const g2 = mkGain(ctx, 0.6);
    o2.connect(g2).connect(lp);
    srcs.push(o2);
  }
  if (P.octave) {
    const o3 = mkOsc(ctx, pulseWave(ctx, 0.5), f * 0.5, t, slide ? slide * 0.5 : 0, glide);
    const g3 = mkGain(ctx, P.octave);
    o3.connect(g3).connect(lp);
    srcs.push(o3);
  }
  lp.connect(g).connect(out);
  const end = adsr(g.gain, t, dur, { a: P.a ?? 0.006, d: P.d ?? 0.25, s: P.s ?? 0.65, r: P.r ?? 0.07, peak: vel });
  vibrato(ctx, t, dur, end, srcs.map((s) => s.detune), P.vib ?? 0, P.vibRate, P.vibDelay);
  startAll(srcs, t, end);
  cleanupOnEnd(o1, [g, lp]);
  return end;
}

/** Saw lead / supersaw: voices, spread (cents), lp, fenv (filter env Hz), q */
function saw(ctx, out, t, f, dur, vel, P, slide) {
  const glide = P.glide ?? 0.05;
  const n = P.voices ?? 1;
  const spread = P.spread ?? 10;
  const lp = mkFilter(ctx, 'lowpass', P.lp ?? 3200, P.q ?? 1);
  const g = mkGain(ctx, 0);
  const srcs = [];
  const norm = 1 / Math.sqrt(n);
  for (let i = 0; i < n; i++) {
    const o = mkOsc(ctx, 'sawtooth', f, t, slide, glide);
    o.detune.value = n > 1 ? (i / (n - 1) - 0.5) * 2 * spread : 0;
    const og = mkGain(ctx, norm);
    o.connect(og).connect(lp);
    srcs.push(o);
  }
  if (P.sub) {
    const s = mkOsc(ctx, 'square', f * 0.5, t, slide ? slide * 0.5 : 0, glide);
    const sg = mkGain(ctx, P.sub);
    s.connect(sg).connect(lp);
    srcs.push(s);
  }
  if (P.fenv) {
    const base = P.lp ?? 3200;
    lp.frequency.setValueAtTime(base + P.fenv, t);
    lp.frequency.setTargetAtTime(base, t + 0.01, (P.fdecay ?? 0.2) / 3);
  }
  lp.connect(g).connect(out);
  const end = adsr(g.gain, t, dur, { a: P.a ?? 0.01, d: P.d ?? 0.3, s: P.s ?? 0.7, r: P.r ?? 0.12, peak: vel });
  vibrato(ctx, t, dur, end, srcs.map((s) => s.detune), P.vib ?? 0, P.vibRate, P.vibDelay);
  startAll(srcs, t, end);
  cleanupOnEnd(srcs[0], [g, lp]);
  return end;
}

/** Simple waveform (triangle/sine) with optional vibrato. */
function simple(type) {
  return (ctx, out, t, f, dur, vel, P, slide) => {
    const o = mkOsc(ctx, type, f, t, slide, P.glide ?? 0.05);
    const g = mkGain(ctx, 0);
    o.connect(g).connect(out);
    const end = adsr(g.gain, t, dur, { a: P.a ?? 0.008, d: P.d ?? 0.3, s: P.s ?? 0.75, r: P.r ?? 0.1, peak: vel });
    vibrato(ctx, t, dur, end, [o.detune], P.vib ?? 0, P.vibRate, P.vibDelay);
    startAll([o], t, end);
    cleanupOnEnd(o, [g]);
    return end;
  };
}

/** Saw bass with a resonant filter envelope and sine sub. */
function sawBass(ctx, out, t, f, dur, vel, P, slide) {
  const o = mkOsc(ctx, 'sawtooth', f, t, slide, 0.04);
  const sub = mkOsc(ctx, 'sine', f, t, slide, 0.04);
  const lp = mkFilter(ctx, 'lowpass', P.lp ?? 380, P.q ?? 5);
  const cut = P.lp ?? 380;
  lp.frequency.setValueAtTime(cut + (P.fenv ?? 1500) * (0.6 + vel * 0.4), t);
  lp.frequency.setTargetAtTime(cut, t + 0.005, (P.fdecay ?? 0.14) / 3);
  const sg = mkGain(ctx, P.subLevel ?? 0.6);
  const g = mkGain(ctx, 0);
  o.connect(lp);
  sub.connect(sg).connect(g);
  lp.connect(g).connect(out);
  const end = adsr(g.gain, t, dur, { a: 0.004, d: P.d ?? 0.2, s: P.s ?? 0.7, r: P.r ?? 0.05, peak: vel });
  startAll([o, sub], t, end);
  cleanupOnEnd(o, [g, lp, sg]);
  return end;
}

/** NES-style triangle bass with a touch of sine weight. */
function triBass(ctx, out, t, f, dur, vel, P, slide) {
  const o = mkOsc(ctx, 'triangle', f, t, slide, 0.03);
  const s = mkOsc(ctx, 'sine', f, t, slide, 0.03);
  const g = mkGain(ctx, 0);
  const sg = mkGain(ctx, 0.5);
  o.connect(g);
  s.connect(sg).connect(g);
  g.connect(out);
  const end = adsr(g.gain, t, dur, { a: 0.004, d: P.d ?? 0.3, s: P.s ?? 0.85, r: P.r ?? 0.04, peak: vel });
  startAll([o, s], t, end);
  cleanupOnEnd(o, [g, sg]);
  return end;
}

/** FM slap / funk bass. */
function slapBass(ctx, out, t, f, dur, vel, P, slide) {
  const car = mkOsc(ctx, 'sine', f, t, slide, 0.03);
  const mod = mkOsc(ctx, 'sine', f * (P.ratio ?? 1), t, slide ? slide * (P.ratio ?? 1) : 0, 0.03);
  const mg = mkGain(ctx, 0);
  const idx = (P.index ?? 2.6) * f * (0.5 + vel * 0.7);
  mg.gain.setValueAtTime(idx, t);
  mg.gain.setTargetAtTime(idx * 0.12, t + 0.004, 0.035);
  mod.connect(mg).connect(car.frequency);
  const saw = mkOsc(ctx, 'sawtooth', f, t, slide, 0.03);
  const lp = mkFilter(ctx, 'lowpass', 900, 2);
  lp.frequency.setValueAtTime(2400, t);
  lp.frequency.setTargetAtTime(500, t + 0.005, 0.04);
  const sawG = mkGain(ctx, 0.35);
  saw.connect(lp).connect(sawG);
  const g = mkGain(ctx, 0);
  car.connect(g);
  sawG.connect(g);
  g.connect(out);
  const end = adsr(g.gain, t, dur, { a: 0.003, d: P.d ?? 0.25, s: P.s ?? 0.6, r: P.r ?? 0.05, peak: vel });
  startAll([car, mod, saw], t, end);
  cleanupOnEnd(car, [g, mg, lp, sawG]);
  return end;
}

/** Sub bass (808-ish) with a small pitch drop. */
function subBass(ctx, out, t, f, dur, vel, P, slide) {
  const o = mkOsc(ctx, 'sine', f, t, slide, 0.05);
  if (!slide) {
    o.frequency.setValueAtTime(f * 1.5, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.04);
  }
  const tri = mkOsc(ctx, 'triangle', f * 2, t, slide ? slide * 2 : 0, 0.05);
  const tg = mkGain(ctx, P.bite ?? 0.12);
  const g = mkGain(ctx, 0);
  o.connect(g);
  tri.connect(tg).connect(g);
  g.connect(out);
  const end = adsr(g.gain, t, dur, { a: 0.004, d: P.d ?? 0.4, s: P.s ?? 0.8, r: P.r ?? 0.08, peak: vel });
  startAll([o, tri], t, end);
  cleanupOnEnd(o, [g, tg]);
  return end;
}

/** Warm pad: detuned saws + triangle through a lowpass. */
function pad(ctx, out, t, f, dur, vel, P) {
  const lp = mkFilter(ctx, 'lowpass', P.lp ?? 1600, 0.6);
  const g = mkGain(ctx, 0);
  const spread = P.spread ?? 9;
  const srcs = [];
  for (const dt of [-spread, spread]) {
    const o = mkOsc(ctx, P.wave ?? 'sawtooth', f, t);
    o.detune.value = dt;
    const og = mkGain(ctx, 0.5);
    o.connect(og).connect(lp);
    srcs.push(o);
  }
  const tri = mkOsc(ctx, 'triangle', f, t);
  const tg = mkGain(ctx, 0.5);
  tri.connect(tg).connect(lp);
  srcs.push(tri);
  if (P.swell) {
    lp.frequency.setValueAtTime((P.lp ?? 1600) * 0.4, t);
    lp.frequency.linearRampToValueAtTime(P.lp ?? 1600, t + Math.min(dur, P.swell));
  }
  lp.connect(g).connect(out);
  const end = adsr(g.gain, t, dur, { a: P.a ?? 0.18, d: P.d ?? 0.6, s: P.s ?? 0.85, r: P.r ?? 0.5, peak: vel });
  startAll(srcs, t, end);
  cleanupOnEnd(srcs[0], [g, lp]);
  return end;
}

/** String ensemble: 3 detuned saws, gentle vibrato. */
function strings(ctx, out, t, f, dur, vel, P) {
  return saw(ctx, out, t, f, dur, vel, {
    voices: 3,
    spread: P.spread ?? 12,
    lp: P.lp ?? 2600,
    q: 0.5,
    a: P.a ?? 0.12,
    d: 0.5,
    s: 0.9,
    r: P.r ?? 0.45,
    vib: P.vib ?? 8,
    vibRate: 5,
    vibDelay: 0.3,
  });
}

/** Synth brass: saws with a filter swell ("bwaah"). */
function brass(ctx, out, t, f, dur, vel, P, slide) {
  const lp = mkFilter(ctx, 'lowpass', f * 2, P.q ?? 1.2);
  const top = Math.min(P.bright ?? 6000, f * (P.harm ?? 9));
  lp.frequency.setValueAtTime(f * 1.2, t);
  lp.frequency.linearRampToValueAtTime(top, t + (P.swell ?? 0.07));
  lp.frequency.setTargetAtTime(top * 0.6, t + (P.swell ?? 0.07), 0.2);
  const g = mkGain(ctx, 0);
  const srcs = [];
  for (const dt of [-7, 6]) {
    const o = mkOsc(ctx, 'sawtooth', f, t, slide, 0.05);
    o.detune.value = dt;
    o.connect(lp);
    srcs.push(o);
  }
  const pg = mkGain(ctx, 0.5);
  lp.connect(pg).connect(g).connect(out);
  const end = adsr(g.gain, t, dur, { a: P.a ?? 0.025, d: P.d ?? 0.3, s: P.s ?? 0.75, r: P.r ?? 0.12, peak: vel });
  vibrato(ctx, t, dur, end, srcs.map((s) => s.detune), P.vib ?? 10, 5.2, 0.25);
  startAll(srcs, t, end);
  cleanupOnEnd(srcs[0], [g, lp, pg]);
  return end;
}

/** FM bell: ratio, index, decay. */
function bell(ctx, out, t, f, dur, vel, P) {
  const decay = P.decay ?? 1.4;
  const car = mkOsc(ctx, 'sine', f, t);
  const mod = mkOsc(ctx, 'sine', f * (P.ratio ?? 3.5), t);
  const mg = mkGain(ctx, 0);
  const idx = (P.index ?? 2.2) * f;
  mg.gain.setValueAtTime(idx, t);
  mg.gain.setTargetAtTime(idx * 0.15, t, decay / 5);
  mod.connect(mg).connect(car.frequency);
  const g = mkGain(ctx, 0);
  car.connect(g).connect(out);
  const len = Math.max(decay, Math.min(dur, decay * 1.5));
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vel, t + 0.003);
  g.gain.setTargetAtTime(0, t + 0.003, len / 5);
  const end = t + len + 0.05;
  startAll([car, mod], t, end);
  cleanupOnEnd(car, [g, mg]);
  return end;
}

/** FM electric piano (tine). */
function epiano(ctx, out, t, f, dur, vel, P) {
  const car = mkOsc(ctx, 'sine', f, t);
  const mod = mkOsc(ctx, 'sine', f, t);
  const mg = mkGain(ctx, 0);
  const idx = (P.index ?? 1.6) * f * (0.4 + vel * 0.8);
  mg.gain.setValueAtTime(idx, t);
  mg.gain.setTargetAtTime(idx * 0.08, t, 0.12);
  mod.connect(mg).connect(car.frequency);
  // tine "ping"
  const tine = mkOsc(ctx, 'sine', f * 7.1, t);
  const tg = mkGain(ctx, 0);
  tg.gain.setValueAtTime(0.12 * vel, t);
  tg.gain.setTargetAtTime(0, t, 0.02);
  tine.connect(tg);
  const g = mkGain(ctx, 0);
  const tr = mkGain(ctx, 1);
  car.connect(tr);
  tg.connect(tr);
  tr.connect(g).connect(out);
  const end = adsr(g.gain, t, dur, { a: 0.003, d: P.d ?? 1.2, s: P.s ?? 0.35, r: P.r ?? 0.25, peak: vel });
  // subtle tremolo
  const trem = ctx.createOscillator();
  trem.frequency.value = P.trem ?? 4.5;
  const trg = mkGain(ctx, 0.12);
  trem.connect(trg).connect(tr.gain);
  startAll([car, mod, tine, trem], t, end);
  cleanupOnEnd(car, [g, tr, mg, tg, trg]);
  return end;
}

/** Plucked string (harp / pizzicato / clav): bright attack, filter + amp decay. P.ring = let it ring past note-off. */
function pluck(ctx, out, t, f, dur, vel, P, slide) {
  const o = mkOsc(ctx, P.wave ?? 'sawtooth', f, t, slide, 0.03);
  const o2 = mkOsc(ctx, 'triangle', f, t, slide, 0.03);
  const lp = mkFilter(ctx, 'lowpass', f * 2, P.q ?? 2);
  const bright = Math.min(P.bright ?? 5200, f * 16);
  lp.frequency.setValueAtTime(bright, t);
  lp.frequency.setTargetAtTime(Math.max(f * 1.2, 300), t + 0.002, (P.fdecay ?? 0.18) / 3);
  const og = mkGain(ctx, 0.55);
  o.connect(og).connect(lp);
  o2.connect(lp);
  const g = mkGain(ctx, 0);
  const nodes = [g, lp, og];
  if (P.peakF) {
    const pk = mkFilter(ctx, 'peaking', P.peakF, 1.2);
    pk.gain.value = P.peakGain ?? 6;
    lp.connect(pk).connect(g);
    nodes.push(pk);
  } else lp.connect(g);
  g.connect(out);
  const decay = P.decay ?? 0.6;
  const r = P.r ?? 0.06;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vel, t + 0.002);
  g.gain.setTargetAtTime(0, t + 0.002, decay / 4);
  let stopAt = t + decay * 1.1;
  if (!P.ring && dur + r < decay) {
    g.gain.setTargetAtTime(0, t + Math.max(0.01, dur), r / 4);
    stopAt = t + Math.max(0.01, dur) + r;
  }
  const end = stopAt + 0.03;
  const srcs = [o, o2];
  if (P.bend) {
    // koto / oud style pitch settle
    for (const s of srcs) {
      s.detune.setValueAtTime(P.bend, t);
      s.detune.setTargetAtTime(0, t + 0.005, 0.02);
    }
  }
  startAll(srcs, t, end);
  cleanupOnEnd(o, nodes);
  return end;
}

/** Koto: bright pluck with pitch settle and faint octave shimmer. */
function koto(ctx, out, t, f, dur, vel, P, slide) {
  pluck(ctx, out, t, f * 2, dur, vel * 0.18, { wave: 'triangle', bright: 7000, decay: 0.35, fdecay: 0.1, ring: true });
  return pluck(ctx, out, t, f, dur, vel, { wave: 'sawtooth', bright: P.bright ?? 6500, decay: P.decay ?? 1.1, fdecay: 0.12, q: 3, bend: P.bend ?? 28, ring: true }, slide);
}

/** Oud / saz-ish: pluck with a slight downward bend and a nasal mid band. */
function oud(ctx, out, t, f, dur, vel, P, slide) {
  return pluck(ctx, out, t, f, dur, vel, { wave: 'sawtooth', bright: 4200, decay: P.decay ?? 0.7, fdecay: 0.16, q: 4, bend: -22, peakF: 1400, peakGain: 7, ring: P.ring }, slide);
}

/** Hammond-ish organ. */
function organ(ctx, out, t, f, dur, vel, P) {
  const o = mkOsc(ctx, harmonicWave(ctx, 'organ', [1, 0.7, 0.5, 0.35, 0.1, 0.25, 0, 0.18]), f, t);
  const g = mkGain(ctx, 0);
  o.connect(g).connect(out);
  const end = adsr(g.gain, t, dur, { a: 0.008, d: 0.1, s: 0.95, r: P.r ?? 0.06, peak: vel });
  vibrato(ctx, t, dur, end, [o.detune], P.vib ?? 6, 6.5, 0.02);
  startAll([o], t, end);
  cleanupOnEnd(o, [g]);
  return end;
}

/** Guitar: detuned saws + sub. Put distortion on the track (fx.drive). P.palm = palm mute. */
function guitar(ctx, out, t, f, dur, vel, P, slide) {
  const lp = mkFilter(ctx, 'lowpass', P.palm ? 1400 : P.lp ?? 5000, 0.8);
  if (P.palm) {
    lp.frequency.setValueAtTime(2600, t);
    lp.frequency.setTargetAtTime(700, t, 0.03);
  }
  const g = mkGain(ctx, 0);
  const srcs = [];
  for (const dt of [-9, 7]) {
    const o = mkOsc(ctx, 'sawtooth', f, t, slide, P.glide ?? 0.06);
    o.detune.value = dt;
    o.connect(lp);
    srcs.push(o);
  }
  lp.connect(g).connect(out);
  const env = P.palm
    ? { a: 0.002, d: 0.08, s: 0.3, r: 0.03, peak: vel }
    : { a: 0.003, d: P.d ?? 0.5, s: P.s ?? 0.7, r: P.r ?? 0.06, peak: vel };
  const end = adsr(g.gain, t, dur, env);
  vibrato(ctx, t, dur, end, srcs.map((s) => s.detune), P.vib ?? 0, 6, 0.2);
  startAll(srcs, t, end);
  cleanupOnEnd(srcs[0], [g, lp]);
  return end;
}

/** Breathy flute / shakuhachi. */
function flute(ctx, out, t, f, dur, vel, P, slide) {
  const o = mkOsc(ctx, 'sine', f, t, slide, P.glide ?? 0.08);
  const o2 = mkOsc(ctx, 'triangle', f * 2, t, slide ? slide * 2 : 0, P.glide ?? 0.08);
  const o2g = mkGain(ctx, 0.12);
  const n = noiseSource(ctx, 'white');
  const bp = mkFilter(ctx, 'bandpass', f * 1.02, 9);
  const ng = mkGain(ctx, P.breath ?? 0.55);
  n.connect(bp).connect(ng);
  const g = mkGain(ctx, 0);
  o.connect(g);
  o2.connect(o2g).connect(g);
  ng.connect(g);
  // chiff
  const ch = mkGain(ctx, 0);
  const hp = mkFilter(ctx, 'highpass', 2500, 0.7);
  n.connect(hp).connect(ch).connect(g);
  ch.gain.setValueAtTime(0.25 * vel, t);
  ch.gain.setTargetAtTime(0, t + 0.01, 0.02);
  g.connect(out);
  const end = adsr(g.gain, t, dur, { a: P.a ?? 0.05, d: 0.3, s: 0.85, r: P.r ?? 0.12, peak: vel });
  vibrato(ctx, t, dur, end, [o.detune, o2.detune], P.vib ?? 18, P.vibRate ?? 5, 0.28);
  o.start(t);
  o2.start(t);
  n.start(t, rnd() * 1.5);
  o.stop(end);
  o2.stop(end);
  n.stop(end);
  cleanupOnEnd(o, [g, o2g, bp, ng, ch, hp]);
  return end;
}

/** Choir "aah": saw through two formant bandpasses. */
function choir(ctx, out, t, f, dur, vel, P) {
  const g = mkGain(ctx, 0);
  const srcs = [];
  const mix = mkGain(ctx, 1);
  for (const dt of [-8, 8]) {
    const o = mkOsc(ctx, 'sawtooth', f, t);
    o.detune.value = dt;
    o.connect(mix);
    srcs.push(o);
  }
  const f1 = mkFilter(ctx, 'bandpass', P.f1 ?? 750, 5);
  const f2 = mkFilter(ctx, 'bandpass', P.f2 ?? 1150, 7);
  const f3 = mkFilter(ctx, 'bandpass', 2700, 9);
  const g1 = mkGain(ctx, 1.4);
  const g2 = mkGain(ctx, 0.9);
  const g3 = mkGain(ctx, 0.35);
  mix.connect(f1).connect(g1).connect(g);
  mix.connect(f2).connect(g2).connect(g);
  mix.connect(f3).connect(g3).connect(g);
  g.connect(out);
  const end = adsr(g.gain, t, dur, { a: P.a ?? 0.25, d: 0.5, s: 0.9, r: P.r ?? 0.5, peak: vel });
  vibrato(ctx, t, dur, end, srcs.map((s) => s.detune), P.vib ?? 12, 5, 0.3);
  startAll(srcs, t, end);
  cleanupOnEnd(srcs[0], [g, mix, f1, f2, f3, g1, g2, g3]);
  return end;
}

/** Tuned timpani. */
function timpani(ctx, out, t, f, dur, vel, P) {
  const o = mkOsc(ctx, 'sine', f, t);
  o.frequency.setValueAtTime(f * 1.25, t);
  o.frequency.exponentialRampToValueAtTime(f, t + 0.06);
  const o2 = mkOsc(ctx, 'sine', f * 1.5, t);
  const o2g = mkGain(ctx, 0.3);
  const n = noiseSource(ctx, 'pink');
  const lp = mkFilter(ctx, 'lowpass', 600, 0.8);
  const ng = mkGain(ctx, 0);
  ng.gain.setValueAtTime(0.7 * vel, t);
  ng.gain.setTargetAtTime(0, t, 0.03);
  n.connect(lp).connect(ng);
  const g = mkGain(ctx, 0);
  const decay = P.decay ?? 1.3;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vel, t + 0.004);
  g.gain.setTargetAtTime(0, t + 0.004, decay / 4);
  o.connect(g);
  o2.connect(o2g).connect(g);
  ng.connect(out);
  g.connect(out);
  const end = t + decay + 0.1;
  o.start(t);
  o2.start(t);
  n.start(t, rnd());
  o.stop(end);
  o2.stop(end);
  n.stop(t + 0.3);
  cleanupOnEnd(o, [g, o2g, lp, ng]);
  return end;
}

/** Mallet (marimba / kalimba / music box): sine + inharmonic partial. */
function mallet(ctx, out, t, f, dur, vel, P) {
  const decay = P.decay ?? 0.5;
  const o = mkOsc(ctx, 'sine', f, t);
  const o2 = mkOsc(ctx, 'sine', f * (P.partial ?? 4), t);
  const g2 = mkGain(ctx, 0);
  g2.gain.setValueAtTime(vel * (P.bright ?? 0.35), t);
  g2.gain.setTargetAtTime(0, t, (P.pdecay ?? 0.03));
  const g = mkGain(ctx, 0);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vel, t + 0.002);
  g.gain.setTargetAtTime(0, t + 0.002, decay / 4);
  const nodes = [g, g2];
  const srcs = [o, o2];
  if (P.trem) {
    const tr = mkGain(ctx, 1);
    const trem = ctx.createOscillator();
    trem.frequency.value = P.trem;
    const tg = mkGain(ctx, 0.3);
    trem.connect(tg).connect(tr.gain);
    o.connect(tr).connect(g);
    nodes.push(tr, tg);
    srcs.push(trem);
  } else o.connect(g);
  o2.connect(g2).connect(out);
  g.connect(out);
  const end = t + decay * 1.3 + 0.05;
  startAll(srcs, t, end);
  cleanupOnEnd(o, nodes);
  return end;
}

/** Chiptune pulse (12.5%) - dry and snappy. */
function chip(ctx, out, t, f, dur, vel, P, slide) {
  return pulse(ctx, out, t, f, dur, vel, { duty: P.duty ?? 0.125, a: 0.002, d: P.d ?? 0.12, s: P.s ?? 0.55, r: 0.02, lp: 9000, vib: P.vib ?? 0, glide: 0.03 }, slide);
}

export const INSTRUMENTS = {
  pulse,
  square: (ctx, out, t, f, dur, vel, P, s) => pulse(ctx, out, t, f, dur, vel, { duty: 0.5, ...P }, s),
  saw,
  supersaw: (ctx, out, t, f, dur, vel, P, s) => saw(ctx, out, t, f, dur, vel, { voices: 3, spread: 16, ...P }, s),
  tri: simple('triangle'),
  sine: simple('sine'),
  sawBass,
  triBass,
  slapBass,
  subBass,
  pad,
  strings,
  brass,
  bell,
  epiano,
  pluck,
  koto,
  oud,
  organ,
  guitar,
  flute,
  choir,
  timpani,
  mallet,
  chip,
};

// ------------------------------------------------------------------------------------------------------------
// Drum kits
// ------------------------------------------------------------------------------------------------------------

const KITS = {
  pop: { kick: { f0: 150, f1: 48, dec: 0.32, click: 0.35, gain: 1 }, snare: { tone: 190, dec: 0.18, noise: 0.75, bp: 3200, body: 0.5 }, hat: { hp: 7800, dec: 0.045 }, crash: { dec: 1.4 } },
  rock: { kick: { f0: 170, f1: 50, dec: 0.3, click: 0.6, gain: 1.1 }, snare: { tone: 200, dec: 0.24, noise: 0.9, bp: 2800, body: 0.6 }, hat: { hp: 7000, dec: 0.05 }, crash: { dec: 1.8 } },
  synth: { kick: { f0: 130, f1: 42, dec: 0.55, click: 0.2, gain: 1.1 }, snare: { tone: 180, dec: 0.28, noise: 1, bp: 2200, body: 0.35 }, hat: { hp: 8500, dec: 0.035 }, crash: { dec: 2 } },
  jazz: { kick: { f0: 110, f1: 55, dec: 0.25, click: 0.1, gain: 0.8 }, snare: { tone: 210, dec: 0.22, noise: 0.55, bp: 4200, body: 0.25, brush: true }, hat: { hp: 6500, dec: 0.06 }, crash: { dec: 1.6 } },
  orch: { kick: { f0: 95, f1: 42, dec: 0.7, click: 0.05, gain: 1.1 }, snare: { tone: 230, dec: 0.2, noise: 0.95, bp: 3800, body: 0.3 }, hat: { hp: 8000, dec: 0.05 }, crash: { dec: 2.4 } },
  chip: { kick: { f0: 200, f1: 45, dec: 0.18, click: 0.4, gain: 1, tri: true }, snare: { tone: 240, dec: 0.12, noise: 0.9, bp: 5000, body: 0.3 }, hat: { hp: 9000, dec: 0.025 }, crash: { dec: 0.9 } },
  taiko: { kick: { f0: 140, f1: 50, dec: 0.5, click: 0.2, gain: 1.1 }, snare: { tone: 260, dec: 0.12, noise: 0.6, bp: 3000, body: 0.5 }, hat: { hp: 7500, dec: 0.04 }, crash: { dec: 1.5 } },
};

function drumOut(ctx, out, t, vel) {
  const g = mkGain(ctx, 0);
  g.connect(out);
  return g;
}

function kick(ctx, out, t, vel, K) {
  const k = K.kick;
  const o = ctx.createOscillator();
  o.type = k.tri ? 'triangle' : 'sine';
  o.frequency.setValueAtTime(k.f0 * 2.2, t);
  o.frequency.exponentialRampToValueAtTime(k.f0, t + 0.012);
  o.frequency.exponentialRampToValueAtTime(k.f1, t + 0.09);
  const g = drumOut(ctx, out, t, vel);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vel * k.gain, t + 0.002);
  g.gain.setTargetAtTime(0, t + 0.02, k.dec / 4);
  o.connect(g);
  o.start(t);
  o.stop(t + k.dec + 0.1);
  cleanupOnEnd(o, [g]);
  if (k.click > 0) {
    const n = noiseSource(ctx, 'white');
    const hp = mkFilter(ctx, 'highpass', 1800, 0.7);
    const cg = mkGain(ctx, 0);
    cg.gain.setValueAtTime(vel * k.click * 0.5, t);
    cg.gain.setTargetAtTime(0, t, 0.006);
    n.connect(hp).connect(cg).connect(out);
    n.start(t, rnd());
    n.stop(t + 0.05);
    cleanupOnEnd(n, [hp, cg]);
  }
}

function snare(ctx, out, t, vel, K) {
  const s = K.snare;
  const o = ctx.createOscillator();
  o.type = 'triangle';
  o.frequency.setValueAtTime(s.tone * 1.6, t);
  o.frequency.exponentialRampToValueAtTime(s.tone, t + 0.03);
  const og = mkGain(ctx, 0);
  og.gain.setValueAtTime(vel * s.body, t);
  og.gain.setTargetAtTime(0, t, 0.035);
  o.connect(og).connect(out);
  o.start(t);
  o.stop(t + 0.25);
  cleanupOnEnd(o, [og]);
  const n = noiseSource(ctx, 'white');
  const bp = mkFilter(ctx, 'bandpass', s.bp, 0.6);
  const hp = mkFilter(ctx, 'highpass', 900, 0.7);
  const ng = mkGain(ctx, 0);
  if (s.brush) {
    ng.gain.setValueAtTime(0, t);
    ng.gain.linearRampToValueAtTime(vel * s.noise * 0.6, t + 0.018);
    ng.gain.setTargetAtTime(0, t + 0.018, s.dec / 4);
  } else {
    ng.gain.setValueAtTime(vel * s.noise, t);
    ng.gain.setTargetAtTime(0, t + 0.004, s.dec / 4);
  }
  n.connect(bp).connect(hp).connect(ng).connect(out);
  n.start(t, rnd());
  n.stop(t + s.dec + 0.1);
  cleanupOnEnd(n, [bp, hp, ng]);
}

function clap(ctx, out, t, vel) {
  const n = noiseSource(ctx, 'white');
  const bp = mkFilter(ctx, 'bandpass', 1300, 1.4);
  const g = mkGain(ctx, 0);
  const p = g.gain;
  p.setValueAtTime(0, t);
  for (let i = 0; i < 3; i++) {
    const tt = t + i * 0.011;
    p.setValueAtTime(vel * 0.9, tt);
    p.setTargetAtTime(0, tt + 0.001, 0.003);
  }
  p.setValueAtTime(vel * 0.8, t + 0.034);
  p.setTargetAtTime(0, t + 0.035, 0.045);
  n.connect(bp).connect(g).connect(out);
  n.start(t, rnd());
  n.stop(t + 0.35);
  cleanupOnEnd(n, [bp, g]);
}

function hat(ctx, out, t, vel, K, open) {
  const h = K.hat;
  const n = noiseSource(ctx, 'white');
  const hp = mkFilter(ctx, 'highpass', h.hp, 0.9);
  const pk = mkFilter(ctx, 'peaking', 10000, 1);
  pk.gain.value = 6;
  const g = mkGain(ctx, 0);
  const dec = open ? 0.32 : h.dec;
  g.gain.setValueAtTime(vel * (open ? 0.5 : 0.55), t);
  g.gain.setTargetAtTime(0, t + 0.002, dec / 4);
  n.connect(hp).connect(pk).connect(g).connect(out);
  n.start(t, rnd());
  n.stop(t + dec + 0.05);
  cleanupOnEnd(n, [hp, pk, g]);
}

function tom(ctx, out, t, vel, f, dec = 0.35) {
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(f * 1.6, t);
  o.frequency.exponentialRampToValueAtTime(f, t + 0.05);
  const g = mkGain(ctx, 0);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vel * 0.9, t + 0.002);
  g.gain.setTargetAtTime(0, t + 0.01, dec / 4);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dec + 0.1);
  cleanupOnEnd(o, [g]);
  const n = noiseSource(ctx, 'pink');
  const lp = mkFilter(ctx, 'lowpass', f * 8, 0.7);
  const ng = mkGain(ctx, 0);
  ng.gain.setValueAtTime(vel * 0.25, t);
  ng.gain.setTargetAtTime(0, t, 0.02);
  n.connect(lp).connect(ng).connect(out);
  n.start(t, rnd());
  n.stop(t + 0.12);
  cleanupOnEnd(n, [lp, ng]);
}

function cymbal(ctx, out, t, vel, dec, ride) {
  const n = noiseSource(ctx, 'white');
  const hp = mkFilter(ctx, 'highpass', ride ? 5000 : 3500, 0.6);
  const g = mkGain(ctx, 0);
  g.gain.setValueAtTime(vel * (ride ? 0.22 : 0.55), t);
  g.gain.setTargetAtTime(0, t + 0.004, (ride ? 0.35 : dec) / 4);
  n.connect(hp).connect(g).connect(out);
  n.start(t, rnd());
  const end = t + (ride ? 0.45 : dec) + 0.1;
  n.stop(end);
  cleanupOnEnd(n, [hp, g]);
  // metallic partials
  const freqs = ride ? [3140, 4410, 5230] : [3210, 4820, 6620];
  const mg = mkGain(ctx, 0);
  mg.gain.setValueAtTime(vel * (ride ? 0.05 : 0.035), t);
  mg.gain.setTargetAtTime(0, t, (ride ? 0.5 : dec * 0.6) / 4);
  const bp = mkFilter(ctx, 'highpass', 2500, 0.7);
  mg.connect(bp).connect(out);
  let first = null;
  for (const f of freqs) {
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = f;
    o.connect(mg);
    o.start(t);
    o.stop(end);
    first = first || o;
  }
  cleanupOnEnd(first, [mg, bp]);
}

function shaker(ctx, out, t, vel, jingle) {
  const n = noiseSource(ctx, 'white');
  const bp = mkFilter(ctx, jingle ? 'highpass' : 'bandpass', jingle ? 6000 : 6500, jingle ? 0.7 : 1.5);
  const g = mkGain(ctx, 0);
  const dec = jingle ? 0.16 : 0.07;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vel * (jingle ? 0.35 : 0.3), t + 0.008);
  g.gain.setTargetAtTime(0, t + 0.01, dec / 4);
  n.connect(bp).connect(g).connect(out);
  n.start(t, rnd());
  n.stop(t + dec + 0.05);
  cleanupOnEnd(n, [bp, g]);
  if (jingle) {
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = 5200 + rnd() * 900;
    const og = mkGain(ctx, 0);
    og.gain.setValueAtTime(vel * 0.03, t);
    og.gain.setTargetAtTime(0, t, 0.03);
    o.connect(og).connect(out);
    o.start(t);
    o.stop(t + 0.2);
    cleanupOnEnd(o, [og]);
  }
}

function metal(ctx, out, t, vel, freqs, bpF, dec, level) {
  const bp = mkFilter(ctx, 'bandpass', bpF, 2.5);
  const g = mkGain(ctx, 0);
  g.gain.setValueAtTime(vel * level, t);
  g.gain.setTargetAtTime(0, t + 0.003, dec / 4);
  bp.connect(g).connect(out);
  let first = null;
  for (const f of freqs) {
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = f;
    o.connect(bp);
    o.start(t);
    o.stop(t + dec + 0.05);
    first = first || o;
  }
  cleanupOnEnd(first, [bp, g]);
}

function block(ctx, out, t, vel, f, dec) {
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(f, t);
  const g = mkGain(ctx, 0);
  g.gain.setValueAtTime(vel * 0.7, t);
  g.gain.setTargetAtTime(0, t, dec / 4);
  const bp = mkFilter(ctx, 'bandpass', f, 3);
  const n = noiseSource(ctx, 'white');
  const ng = mkGain(ctx, 0);
  ng.gain.setValueAtTime(vel * 0.5, t);
  ng.gain.setTargetAtTime(0, t, 0.004);
  n.connect(bp).connect(ng).connect(out);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dec + 0.05);
  n.start(t, rnd());
  n.stop(t + 0.03);
  cleanupOnEnd(o, [g]);
  cleanupOnEnd(n, [bp, ng]);
}

function taikoHit(ctx, out, t, vel, f, dec) {
  tom(ctx, out, t, vel * 1.1, f, dec);
  const n = noiseSource(ctx, 'brown');
  const lp = mkFilter(ctx, 'lowpass', 400, 0.7);
  const g = mkGain(ctx, 0);
  g.gain.setValueAtTime(vel * 0.9, t);
  g.gain.setTargetAtTime(0, t, 0.06);
  n.connect(lp).connect(g).connect(out);
  n.start(t, rnd());
  n.stop(t + 0.4);
  cleanupOnEnd(n, [lp, g]);
}

/** Drum voice names used in patterns (line keys). */
export const DRUM_VOICES = ['k', 's', 'c', 'h', 'o', 't', 'm', 'f', 'x', 'r', 'sh', 'cb', 'rim', 'tk', 'sm', 'tb', 'wb', 'jb', 'sn'];

export function playDrum(ctx, out, kitName, v, t, vel) {
  const K = KITS[kitName] || KITS.pop;
  switch (v) {
    case 'k':
      return kick(ctx, out, t, vel, K);
    case 's':
      return snare(ctx, out, t, vel, K);
    case 'sn': // soft snare (side stick / rim click)
      return block(ctx, out, t, vel * 0.8, 1700, 0.05);
    case 'c':
      return clap(ctx, out, t, vel);
    case 'h':
      return hat(ctx, out, t, vel, K, false);
    case 'o':
      return hat(ctx, out, t, vel, K, true);
    case 't':
      return tom(ctx, out, t, vel, 210);
    case 'm':
      return tom(ctx, out, t, vel, 150);
    case 'f':
      return tom(ctx, out, t, vel, 100, 0.45);
    case 'x':
      return cymbal(ctx, out, t, vel, K.crash.dec, false);
    case 'r':
      return cymbal(ctx, out, t, vel, 0.5, true);
    case 'sh':
      return shaker(ctx, out, t, vel, false);
    case 'jb':
    case 'tb':
      return shaker(ctx, out, t, vel, true);
    case 'cb':
      return metal(ctx, out, t, vel, [540, 800], 900, 0.18, 0.9);
    case 'rim':
      return block(ctx, out, t, vel, 2400, 0.04);
    case 'wb':
      return block(ctx, out, t, vel, 1100, 0.08);
    case 'tk':
      return taikoHit(ctx, out, t, vel, 72, 0.7);
    case 'sm':
      return block(ctx, out, t, vel, 520, 0.09);
    default:
      return undefined;
  }
}

export const KIT_NAMES = Object.keys(KITS);
export { TAU };
