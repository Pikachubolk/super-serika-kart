// Low-level Web Audio helpers shared by music, sfx, engine and voice synthesis (owner: audio agent).
// Everything here works with any BaseAudioContext (realtime or OfflineAudioContext); per-context resources
// (noise buffers, periodic waves, impulse responses) are cached in a WeakMap keyed by the context.

import { mulberry32 } from '../utils.js';

export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
export const dbToGain = (db) => Math.pow(10, db / 20);
export const centsToRatio = (c) => Math.pow(2, c / 1200);

const caches = new WeakMap();
function cacheFor(ctx) {
  let c = caches.get(ctx);
  if (!c) {
    c = new Map();
    caches.set(ctx, c);
  }
  return c;
}

/** Looping 2 s noise buffer: 'white' | 'pink' | 'brown'. */
export function noiseBuffer(ctx, kind = 'white') {
  const cache = cacheFor(ctx);
  const key = `noise:${kind}`;
  let buf = cache.get(key);
  if (buf) return buf;
  const len = Math.floor(ctx.sampleRate * 2);
  buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  const rng = mulberry32(kind === 'white' ? 0x5eed : kind === 'pink' ? 0xbeef : 0xcafe);
  if (kind === 'pink') {
    // Paul Kellet's economy pink filter
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = rng() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
    }
  } else if (kind === 'brown') {
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = rng() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    }
  } else {
    for (let i = 0; i < len; i++) d[i] = rng() * 2 - 1;
  }
  // tiny crossfade at the loop point to avoid a click
  const fade = 256;
  for (let i = 0; i < fade; i++) {
    const t = i / fade;
    d[len - fade + i] = d[len - fade + i] * (1 - t) + d[i] * t;
  }
  cache.set(key, buf);
  return buf;
}

/** Band-limited pulse wave with the given duty cycle (0..1). */
export function pulseWave(ctx, duty = 0.25) {
  const cache = cacheFor(ctx);
  const key = `pulse:${duty.toFixed(3)}`;
  let w = cache.get(key);
  if (w) return w;
  const n = 48;
  const real = new Float32Array(n);
  const imag = new Float32Array(n);
  for (let k = 1; k < n; k++) real[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
  w = ctx.createPeriodicWave(real, imag);
  cache.set(key, w);
  return w;
}

/** Additive wave from a list of harmonic amplitudes [h1, h2, h3...] (sine phase). */
export function harmonicWave(ctx, name, harmonics) {
  const cache = cacheFor(ctx);
  const key = `harm:${name}`;
  let w = cache.get(key);
  if (w) return w;
  const n = harmonics.length + 1;
  const real = new Float32Array(n);
  const imag = new Float32Array(n);
  for (let k = 1; k < n; k++) imag[k] = harmonics[k - 1];
  w = ctx.createPeriodicWave(real, imag);
  cache.set(key, w);
  return w;
}

/** Synthesized stereo reverb impulse response (decaying, darkening noise with a few early reflections). */
export function reverbIR(ctx, { seconds = 2.2, decay = 3.2, damp = 0.75, pre = 0.012 } = {}) {
  const cache = cacheFor(ctx);
  const key = `ir:${seconds}:${decay}:${damp}:${pre}`;
  let buf = cache.get(key);
  if (buf) return buf;
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * seconds);
  buf = ctx.createBuffer(2, len, rate);
  const preN = Math.floor(pre * rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    const rng = mulberry32(0x1234 + ch * 77);
    let lp = 0;
    for (let i = preN; i < len; i++) {
      const t = (i - preN) / (len - preN);
      const env = Math.pow(1 - t, decay) * Math.min(1, (i - preN) / (rate * 0.004));
      const k = 0.92 - damp * 0.8 * t; // high frequencies die faster
      lp += k * (rng() * 2 - 1 - lp);
      d[i] = lp * env;
    }
    // early reflections
    const taps = ch ? [0.011, 0.019, 0.029, 0.041, 0.053] : [0.009, 0.017, 0.026, 0.037, 0.049];
    taps.forEach((tt, j) => {
      const i = preN + Math.floor(tt * rate);
      if (i < len) d[i] += (ch ? -1 : 1) * (0.5 - j * 0.07);
    });
  }
  cache.set(key, buf);
  return buf;
}

const curveCache = new Map();
/** Soft-clip waveshaper curve; amount ~1 (warm) .. 60 (fuzz). */
export function driveCurve(amount = 10) {
  const key = Math.round(amount * 10);
  let c = curveCache.get(key);
  if (c) return c;
  const n = 2048;
  c = new Float32Array(n);
  const k = amount;
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / (n - 1) - 1;
    c[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  curveCache.set(key, c);
  return c;
}

/**
 * ADSR on a gain AudioParam. Returns the time at which the release has (practically) finished.
 * env: { a, d, s (0..1 of peak), r, peak }
 */
export function adsr(param, t, dur, env) {
  const a = Math.max(0.001, env.a ?? 0.005);
  const d = Math.max(0.005, env.d ?? 0.1);
  const s = env.s ?? 0.7;
  const r = Math.max(0.01, env.r ?? 0.08);
  const peak = env.peak ?? 1;
  param.cancelScheduledValues(t);
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(peak, t + a);
  if (s < 0.999) param.setTargetAtTime(peak * s, t + a, d / 3);
  const off = Math.max(t + a, t + dur);
  param.setTargetAtTime(0, off, r / 5);
  return off + r;
}

/** Percussive envelope: linear attack then exponential-ish decay. Returns end time. */
export function percEnv(param, t, peak, a, decay) {
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(peak, t + a);
  param.setTargetAtTime(0, t + a, decay / 5);
  return t + a + decay;
}

/** Disconnect a list of nodes when `src` ends. */
export function cleanupOnEnd(src, nodes) {
  src.onended = () => {
    for (const n of nodes) {
      try {
        n.disconnect();
      } catch {
        /* already gone */
      }
    }
  };
}

/** Random offset into a looped noise buffer so repeated hits do not sound identical. */
export function noiseSource(ctx, kind = 'white', rate = 1) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, kind);
  src.loop = true;
  src.playbackRate.value = rate;
  return src;
}

let _rs = 0x9e3779b9;
/** Cheap non-deterministic random for runtime variation (no Math.random dependency in hot paths). */
export function rnd() {
  _rs ^= _rs << 13;
  _rs ^= _rs >>> 17;
  _rs ^= _rs << 5;
  return ((_rs >>> 0) % 100000) / 100000;
}
