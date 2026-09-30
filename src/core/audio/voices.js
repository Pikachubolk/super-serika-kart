// Tiny formant-synthesized character "voices" (owner: audio agent): cute vowel blips with consonant onsets,
// pitch contours and vibrato, per character and situation. Not speech - just expressive chirps in the spirit
// of each student (Serika's startled "nya!?", Shiroko's "nn.", Hoshino's "uhe~", Arisu's fanfare syllables...).

import { noiseBuffer, rnd } from './dsp.js';

// formant frequencies (F1, F2, F3) for a bright young voice
const VOWELS = {
  a: [880, 1500, 2900],
  i: [330, 2750, 3400],
  u: [390, 1350, 2650],
  e: [540, 2250, 3000],
  o: [540, 980, 2800],
  n: [270, 1800, 2750],
};
const GLIDE_FROM = { y: 'i', w: 'u' };

/** syllable: consonant, vowel ('a' | 'ya' glide | 'n' nasal hum), duration, pitch start/end (x base), gain, vibrato */
const S = (c, v, d, p0, p1 = p0, g = 1, vib = 0) => ({ c, v, d, p0, p1, g, vib });
const GAP = (d) => ({ c: '_', v: '', d, p0: 1, p1: 1, g: 0, vib: 0 });

const GENERIC = {
  select: [S('y', 'o', 0.08, 1.0, 1.1), S('sh', 'i', 0.2, 1.3, 1.2, 1, 1)],
  hit: [S('k', 'ya', 0.1, 1.5, 1.7), S('', 'a', 0.22, 1.7, 1.2, 0.9, 1)],
  win: [S('y', 'a', 0.08, 1.1, 1.2), S('t', 'a', 0.09, 1.35, 1.35), S('', 'a', 0.3, 1.45, 1.3, 1, 1)],
  lose: [S('', 'u', 0.25, 1.0, 0.92, 0.8), S('', 'u', 0.45, 0.95, 0.72, 0.7, 1)],
  item: [S('h', 'e', 0.07, 1.2, 1.25), S('h', 'e', 0.12, 1.3, 1.15)],
};

const TEMPLATES = {
  serika: {
    select: [S('h', 'n', 0.13, 0.95, 0.85, 0.75), GAP(0.1), S('', 'i', 0.06, 1.1, 1.1), S('k', 'u', 0.06, 1.15, 1.15, 0.8), S('y', 'o', 0.22, 1.35, 1.25, 1, 1)],
    hit: [S('n', 'ya', 0.24, 1.35, 1.8, 1, 0)],
    win: [S('y', 'a', 0.08, 1.15, 1.2), S('t', 'a', 0.09, 1.4, 1.4), S('', 'a', 0.34, 1.55, 1.4, 1, 1)],
    lose: [S('m', 'u', 0.38, 1.1, 0.92, 0.9, 1), GAP(0.06), S('', 'n', 0.18, 0.9, 0.85, 0.6)],
    item: [S('h', 'e', 0.1, 1.25, 1.38)],
  },
  shiroko: {
    select: [S('', 'n', 0.24, 1.0, 0.96, 0.85)],
    hit: [S('', 'n', 0.16, 1.0, 1.38, 0.9)],
    win: [S('', 'n', 0.12, 1.0, 1.08, 0.8), GAP(0.05), S('', 'n', 0.3, 1.15, 1.22, 0.9, 1)],
    lose: [S('', 'n', 0.42, 0.95, 0.8, 0.75)],
    item: [S('', 'n', 0.16, 1.05, 1.12, 0.8)],
  },
  hoshino: {
    select: [S('', 'u', 0.1, 1.0, 1.05, 0.8), S('h', 'e', 0.42, 1.2, 1.0, 1, 1)],
    hit: [S('', 'au', 0.36, 1.25, 0.9, 0.9, 1)],
    win: [S('', 'u', 0.08, 1.0, 1.05), S('h', 'e', 0.1, 1.2, 1.2), S('h', 'e', 0.32, 1.25, 1.1, 1, 1)],
    lose: [S('f', 'ua', 0.72, 1.1, 0.78, 0.8, 1)],
    item: [S('', 'o', 0.3, 1.0, 1.25, 0.9, 1)],
  },
  nonomi: {
    select: [S('', 'n', 0.08, 1.0, 1.0, 0.6), S('f', 'u', 0.08, 1.2, 1.2, 0.9), S('f', 'u', 0.3, 1.3, 1.1, 1, 1)],
    hit: GENERIC.hit,
    win: [S('y', 'ei', 0.42, 1.2, 1.5, 1, 1)],
    lose: [S('', 'au', 0.5, 1.1, 0.8, 0.9, 1)],
    item: [S('', 'o', 0.3, 1.1, 1.3, 0.9, 1)],
  },
  ayane: {
    select: [S('h', 'ai', 0.22, 1.15, 1.3)],
    hit: [S('h', 'ya', 0.28, 1.5, 1.3, 1, 1)],
    win: GENERIC.win,
    lose: GENERIC.lose,
    item: [S('', 'a', 0.13, 1.3, 1.42)],
  },
  aru: {
    select: [S('k', 'u', 0.07, 1.0, 1.0, 0.9), S('f', 'u', 0.07, 1.05, 1.05, 0.8), S('f', 'u', 0.17, 1.1, 1.0, 0.8)],
    hit: [S('h', 'i', 0.5, 1.55, 1.95, 1, 1)],
    win: [S('h', 'a', 0.1, 1.1, 1.15), S('h', 'a', 0.1, 1.2, 1.25), S('h', 'a', 0.3, 1.35, 1.25, 1, 1)],
    lose: [S('', 'e', 0.38, 1.2, 1.6, 1, 1)],
    item: [S('f', 'u', 0.08, 1.1, 1.1, 0.8), S('f', 'u', 0.15, 1.15, 1.05, 0.8)],
  },
  arisu: {
    select: [S('p', 'a', 0.07, 1.1, 1.1), S('', 'n', 0.05, 1.1, 1.1, 0.7), S('p', 'a', 0.07, 1.2, 1.2), S('k', 'a', 0.07, 1.3, 1.3), S('p', 'a', 0.34, 1.5, 1.55, 1, 1)],
    hit: [S('', 'u', 0.06, 1.3, 1.35), S('w', 'a', 0.26, 1.5, 1.2, 1, 1)],
    win: [S('p', 'a', 0.07, 1.25, 1.25), S('', 'n', 0.05, 1.25, 1.25, 0.7), S('p', 'a', 0.07, 1.35, 1.35), S('k', 'a', 0.07, 1.45, 1.45), S('p', 'a', 0.4, 1.7, 1.75, 1, 1)],
    lose: [S('g', 'e', 0.1, 1.05, 1.05), S('m', 'u', 0.08, 1.0, 1.0), S('', 'o', 0.12, 0.95, 0.95), S('b', 'a', 0.32, 0.9, 0.75, 0.8, 1)],
    item: [S('p', 'i', 0.06, 1.4, 1.4), S('p', 'i', 0.13, 1.6, 1.68)],
  },
  hina: {
    select: [S('h', 'n', 0.2, 0.9, 0.85, 0.7)],
    hit: [S('ch', 'a', 0.08, 1.0, 0.9, 0.7)],
    win: [S('f', 'a', 0.1, 1.0, 0.98, 0.8), S('', 'i', 0.22, 0.97, 0.9, 0.8)],
    lose: [S('h', 'n', 0.22, 0.92, 0.8, 0.7)],
    item: [S('h', 'n', 0.14, 0.95, 0.92, 0.6)],
  },
};

export const VOICE_KINDS = ['select', 'hit', 'win', 'lose', 'item'];

function vowelPath(v) {
  if (!v) return ['a'];
  if (v.length === 1) return [v];
  const a = GLIDE_FROM[v[0]] || v[0];
  return [a, v[1]];
}

/**
 * Play a voice chirp. Returns the end time.
 * @param {BaseAudioContext} ctx
 * @param {AudioNode} dest
 * @param {number} t0 start time
 * @param {string} characterId
 * @param {string} kind select|hit|win|lose|item
 * @param {number} pitch character voice pitch multiplier (characters.js voice.pitch)
 */
export function playVoice(ctx, dest, t0, characterId, kind, pitch = 1, volume = 1) {
  const tpl = (TEMPLATES[characterId] && TEMPLATES[characterId][kind]) || GENERIC[kind];
  if (!tpl) return t0;
  const f0 = 290 * pitch * (0.98 + rnd() * 0.04);
  const fs = Math.sqrt(pitch); // formant scale (smaller vocal tract for higher voices)
  const nodes = [];
  const mk = (n) => (nodes.push(n), n);

  const out = mk(ctx.createGain());
  out.gain.value = volume;
  out.connect(dest);
  const presence = mk(ctx.createBiquadFilter());
  presence.type = 'lowpass';
  presence.frequency.value = 7000;
  presence.connect(out);
  const sum = mk(ctx.createGain());
  sum.connect(presence);

  // voiced source
  const src = ctx.createOscillator();
  src.type = 'sawtooth';
  const src2 = ctx.createOscillator();
  src2.type = 'triangle';
  const voiced = mk(ctx.createGain());
  voiced.gain.value = 0;
  src.connect(voiced);
  const s2g = mk(ctx.createGain());
  s2g.gain.value = 0.6;
  src2.connect(s2g).connect(voiced);

  // noise source
  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer(ctx, 'white');
  noise.loop = true;
  const asp = mk(ctx.createGain()); // aspiration through the formants
  asp.gain.value = 0;
  noise.connect(asp);
  const fricF = mk(ctx.createBiquadFilter());
  fricF.type = 'bandpass';
  fricF.Q.value = 1.2;
  fricF.frequency.value = 4000;
  const fric = mk(ctx.createGain());
  fric.gain.value = 0;
  noise.connect(fricF).connect(fric).connect(sum);

  // formant bank
  const formants = [0, 1, 2].map((k) => {
    const f = mk(ctx.createBiquadFilter());
    f.type = 'bandpass';
    f.Q.value = [5, 9, 11][k];
    f.frequency.value = VOWELS.a[k] * fs;
    const g = mk(ctx.createGain());
    g.gain.value = [3.2, 2.4, 1.1][k];
    voiced.connect(f);
    asp.connect(f);
    f.connect(g).connect(sum);
    return f;
  });
  // nasal murmur path
  const nasalF = mk(ctx.createBiquadFilter());
  nasalF.type = 'lowpass';
  nasalF.frequency.value = 420;
  const nasal = mk(ctx.createGain());
  nasal.gain.value = 0;
  voiced.connect(nasalF).connect(nasal).connect(sum);

  // vibrato
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 6.2;
  const lfoG = mk(ctx.createGain());
  lfoG.gain.value = 0;
  lfo.connect(lfoG);
  lfoG.connect(src.detune);
  lfoG.connect(src2.detune);

  const setVowel = (v, t, tc = 0.012) => {
    const F = VOWELS[v] || VOWELS.a;
    for (let k = 0; k < 3; k++) formants[k].frequency.setTargetAtTime(F[k] * fs, t, tc);
  };

  let t = t0 + 0.01;
  src.frequency.setValueAtTime(f0, t0);
  src2.frequency.setValueAtTime(f0, t0);
  for (const syl of tpl) {
    if (syl.c === '_') {
      t += syl.d;
      continue;
    }
    const path = vowelPath(syl.v);
    const isNasal = path[0] === 'n' && path.length === 1;
    const g = syl.g * 0.5;
    // ---- consonant ----
    const c = syl.c;
    if (c === 'k' || c === 't' || c === 'p' || c === 'ch' || c === 'g' || c === 'b') {
      const bf = { k: 2600, t: 4500, p: 900, ch: 3600, g: 1800, b: 700 }[c];
      fricF.frequency.setValueAtTime(bf, t);
      fric.gain.setValueAtTime(0, t);
      fric.gain.linearRampToValueAtTime(g * (c === 'g' || c === 'b' ? 0.5 : 1.1), t + 0.004);
      fric.gain.setTargetAtTime(0, t + 0.006, c === 'ch' ? 0.02 : 0.008);
      t += c === 'ch' ? 0.05 : 0.028;
    } else if (c === 's' || c === 'sh' || c === 'f') {
      fricF.frequency.setValueAtTime(c === 's' ? 6000 : c === 'sh' ? 3200 : 2200, t);
      fric.gain.setValueAtTime(0, t);
      fric.gain.linearRampToValueAtTime(g * (c === 'f' ? 0.35 : 0.7), t + 0.03);
      fric.gain.linearRampToValueAtTime(0, t + 0.075);
      t += 0.06;
    } else if (c === 'h') {
      setVowel(path[0], t, 0.005);
      asp.gain.setValueAtTime(0, t);
      asp.gain.linearRampToValueAtTime(g * 0.9, t + 0.03);
      asp.gain.linearRampToValueAtTime(0, t + 0.07);
      t += 0.045;
    } else if (c === 'n' || c === 'm') {
      setVowel('n', t, 0.004);
      nasal.gain.setValueAtTime(0, t);
      nasal.gain.linearRampToValueAtTime(g * 2.2, t + 0.015);
      voiced.gain.setValueAtTime(0, t);
      voiced.gain.linearRampToValueAtTime(g * 0.35, t + 0.015);
      src.frequency.setValueAtTime(f0 * syl.p0 * 0.97, t);
      src2.frequency.setValueAtTime(f0 * syl.p0 * 0.97, t);
      t += 0.05;
    } else if (c === 'y' || c === 'w' || c === 'r') {
      setVowel(c === 'y' ? 'i' : c === 'w' ? 'u' : 'e', t, 0.004);
    }
    // ---- vowel ----
    const d = syl.d;
    const pa = f0 * syl.p0;
    const pb = f0 * syl.p1;
    for (const o of [src, src2]) {
      o.frequency.setValueAtTime(pa * 0.94, t);
      o.frequency.linearRampToValueAtTime(pa, t + 0.035);
      o.frequency.linearRampToValueAtTime(pb, t + d);
    }
    if (c !== 'y' && c !== 'w') setVowel(path[0], t, c === 'n' || c === 'm' ? 0.02 : 0.008);
    if (path.length > 1) setVowel(path[1], t + d * 0.25, d * 0.12);
    else if (c === 'y' || c === 'w' || c === 'r') setVowel(path[0], t + 0.02, 0.02);
    voiced.gain.setValueAtTime(c === 'n' || c === 'm' ? g * 0.35 : 0, t);
    if (isNasal) {
      nasal.gain.setValueAtTime(0, t);
      nasal.gain.linearRampToValueAtTime(g * 2.4, t + 0.02);
      nasal.gain.setValueAtTime(g * 2.4, t + d - 0.04);
      nasal.gain.linearRampToValueAtTime(0, t + d);
      voiced.gain.setValueAtTime(0, t);
      voiced.gain.linearRampToValueAtTime(g * 0.3, t + 0.02);
      voiced.gain.setValueAtTime(g * 0.3, t + d - 0.04);
      voiced.gain.linearRampToValueAtTime(0, t + d);
    } else {
      nasal.gain.setTargetAtTime(0, t, 0.01);
      voiced.gain.linearRampToValueAtTime(g, t + 0.018);
      voiced.gain.setValueAtTime(g, t + Math.max(0.02, d - 0.045));
      voiced.gain.linearRampToValueAtTime(0, t + d);
    }
    if (syl.vib) {
      lfoG.gain.setValueAtTime(0, t);
      lfoG.gain.linearRampToValueAtTime(45, t + Math.min(0.15, d * 0.6));
      lfoG.gain.setValueAtTime(45, t + d);
      lfoG.gain.linearRampToValueAtTime(0, t + d + 0.01);
    }
    t += d + 0.025;
  }
  const end = t + 0.05;
  const srcs = [src, src2, noise, lfo];
  for (const s of srcs) {
    if (s === noise) s.start(t0, rnd() * 1.5);
    else s.start(t0);
    s.stop(end);
  }
  src.onended = () => {
    for (const n of nodes) {
      try {
        n.disconnect();
      } catch {
        /* noop */
      }
    }
  };
  return end;
}
