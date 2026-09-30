// Shared math / misc helpers. Pure functions only (safe to import from Node tools).

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (a === b ? 0 : (v - a) / (b - a));
export const remap = (v, a0, a1, b0, b1) => lerp(b0, b1, clamp01(invLerp(a0, a1, v)));
export const smoothstep = (a, b, v) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export const sign = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);

/** Frame-rate independent exponential smoothing. `rate` ~ 1/time-constant (per second). */
export const damp = (current, target, rate, dt) => lerp(current, target, 1 - Math.exp(-rate * dt));

/** Move `current` towards `target` by at most `maxDelta`. */
export const approach = (current, target, maxDelta) => {
  if (current < target) return Math.min(current + maxDelta, target);
  return Math.max(current - maxDelta, target);
};

/** Wrap angle to (-PI, PI]. */
export const wrapAngle = (a) => {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
};

/** Shortest signed difference b - a between two angles. */
export const angleDiff = (a, b) => wrapAngle(b - a);

export const dampAngle = (current, target, rate, dt) =>
  current + angleDiff(current, target) * (1 - Math.exp(-rate * dt));

/** Positive modulo. */
export const mod = (a, n) => ((a % n) + n) % n;

/** Deterministic PRNG (mulberry32). Returns a function producing floats in [0,1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hash a string to a 32-bit seed. */
export function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export const randRange = (rng, lo, hi) => lo + (hi - lo) * rng();
export const randInt = (rng, lo, hi) => Math.floor(lo + (hi - lo + 1) * rng());
export const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];

/** Weighted pick from an object { key: weight }. Returns a key (or null if all weights are 0). */
export function weightedPick(rng, weights) {
  let total = 0;
  for (const k in weights) total += Math.max(0, weights[k]);
  if (total <= 0) return null;
  let r = rng() * total;
  for (const k in weights) {
    r -= Math.max(0, weights[k]);
    if (r <= 0) return k;
  }
  return Object.keys(weights).pop();
}

/** 1st, 2nd, 3rd, 4th ... */
export function ordinalSuffix(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

/** Mario-Kart style race time: 1'23"456 */
export function formatRaceTime(seconds) {
  if (!isFinite(seconds) || seconds < 0) seconds = 0;
  const totalMs = Math.floor(seconds * 1000);
  const m = Math.floor(totalMs / 60000);
  const s = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;
  return `${m}'${String(s).padStart(2, '0')}"${String(ms).padStart(3, '0')}`;
}

/** Convert '#rrggbb' or 0xrrggbb to a numeric hex. */
export function toHex(c) {
  if (typeof c === 'number') return c;
  if (typeof c === 'string' && c[0] === '#') return parseInt(c.slice(1), 16);
  return 0xffffff;
}
