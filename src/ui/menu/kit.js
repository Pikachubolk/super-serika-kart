// Frontend UI kit (owner: frontend agent): DOM helpers, persistence helpers, spatial navigation, SVG icons
// and small animation helpers shared by every menu screen.

import { CHARACTERS } from '../../data/characters.js';

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Build a single element from an HTML string. */
export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = String(html).trim();
  return t.content.firstElementChild;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

// ------------------------------------------------------------------------------------------------
// Persistence
// ------------------------------------------------------------------------------------------------

export function loadJSON(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}

export function saveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}

/** Best Time Trial time for a track (seconds) or null. Accepts a plain number or a JSON object value. */
export function getTTBest(trackId) {
  try {
    const raw = localStorage.getItem(`ssk.tt.${trackId}`);
    if (raw == null || raw === '') return null;
    let v;
    try {
      v = JSON.parse(raw);
    } catch {
      v = parseFloat(raw);
    }
    if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : null;
    if (v && typeof v === 'object') {
      const t = v.time ?? v.best ?? v.total;
      return typeof t === 'number' && t > 0 ? t : null;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** Extra record info (character, lap splits) saved alongside the plain-number record. */
export function getTTDetails(trackId) {
  const x = loadJSON(`ssk.ttx.${trackId}`, null);
  const main = loadJSON(`ssk.tt.${trackId}`, null); // Race writes { time, lapTimes, characterId }
  if (main && typeof main === 'object' && typeof main.time === 'number') {
    if (x && Math.abs(Number(x.time) - main.time) < 0.01) return { ...x, ...main };
    return main;
  }
  return x;
}

export function setTTBest(trackId, time, extra = {}) {
  try {
    // same shape as Race's writeTTRecord (src/race/raceUtils.js)
    const r3 = (t) => Math.round(t * 1000) / 1000;
    const rec = { time: r3(time), lapTimes: (extra.lapTimes || []).map(r3), characterId: extra.characterId ?? null };
    localStorage.setItem(`ssk.tt.${trackId}`, JSON.stringify(rec));
    localStorage.setItem(`ssk.ttx.${trackId}`, JSON.stringify({ time, ...extra, date: Date.now() }));
  } catch {
    /* ignore */
  }
}

/** Trophies: { '<cupId>:<cc>': bestRank (1..3) } */
export function getTrophies() {
  return loadJSON('ssk.trophies', {}) || {};
}

export function awardTrophy(cupId, cc, rank) {
  if (rank < 1 || rank > 3) return false;
  const t = getTrophies();
  const key = `${cupId}:${cc}`;
  if (!t[key] || rank < t[key]) {
    t[key] = rank;
    saveJSON('ssk.trophies', t);
    return true;
  }
  return false;
}

// ------------------------------------------------------------------------------------------------
// Spatial navigation
// ------------------------------------------------------------------------------------------------

const overlap = (a0, a1, b0, b1) => Math.min(a1, b1) - Math.max(a0, b0);

/**
 * Pick the best element in a direction from `fromEl` among `els` using their bounding rects.
 * Returns null if nothing lies in that direction (caller may wrap).
 */
export function pickDirectional(fromEl, dir, els, { wrap = false } = {}) {
  const from = fromEl.getBoundingClientRect();
  const fx = from.left + from.width / 2;
  const fy = from.top + from.height / 2;
  const horizontal = dir === 'left' || dir === 'right';
  const sgn = dir === 'right' || dir === 'down' ? 1 : -1;
  let best = null;
  let bestScore = Infinity;
  const rects = [];
  for (const e of els) {
    if (e === fromEl) continue;
    const r = e.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    rects.push({ e, r });
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const main = (horizontal ? cx - fx : cy - fy) * sgn;
    const cross = horizontal ? cy - fy : cx - fx;
    if (main <= 2) continue;
    const ov = horizontal ? overlap(from.top, from.bottom, r.top, r.bottom) : overlap(from.left, from.right, r.left, r.right);
    const score = main + Math.abs(cross) * (ov > 0 ? 0.35 : 2.2);
    if (score < bestScore) {
      bestScore = score;
      best = e;
    }
  }
  if (best || !wrap) return best;
  // wrap around: farthest element in the opposite direction, best aligned on the cross axis
  bestScore = Infinity;
  for (const { e, r } of rects) {
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const main = (horizontal ? cx - fx : cy - fy) * sgn; // negative for elements "behind"
    if (main >= -2) continue;
    const cross = horizontal ? cy - fy : cx - fx;
    const ov = horizontal ? overlap(from.top, from.bottom, r.top, r.bottom) : overlap(from.left, from.right, r.left, r.right);
    if (ov <= 0) continue;
    const score = main + Math.abs(cross) * 0.5; // most negative main wins
    if (score < bestScore) {
      bestScore = score;
      best = e;
    }
  }
  return best;
}

// ------------------------------------------------------------------------------------------------
// Animation helpers
// ------------------------------------------------------------------------------------------------

export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeOutBack = (t) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

/** Tween a number with requestAnimationFrame. Returns a cancel function. */
export function tween(from, to, duration, onUpdate, { ease = easeOutCubic, onDone } = {}) {
  const t0 = performance.now();
  let raf = 0;
  let cancelled = false;
  const step = (now) => {
    if (cancelled) return;
    const t = Math.min(1, (now - t0) / Math.max(1, duration));
    onUpdate(from + (to - from) * ease(t), t);
    if (t < 1) raf = requestAnimationFrame(step);
    else onDone?.();
  };
  raf = requestAnimationFrame(step);
  return () => {
    cancelled = true;
    cancelAnimationFrame(raf);
  };
}

/** FLIP-animate children of `container` after `mutate()` reorders them. */
export function flip(container, mutate, { duration = 600, easing = 'cubic-bezier(.2,.9,.25,1.15)' } = {}) {
  const kids = [...container.children];
  const first = new Map(kids.map((k) => [k, k.getBoundingClientRect()]));
  mutate();
  for (const k of container.children) {
    const a = first.get(k);
    if (!a) continue;
    const b = k.getBoundingClientRect();
    const dx = a.left - b.left;
    const dy = a.top - b.top;
    if (!dx && !dy) continue;
    k.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }], { duration, easing });
  }
}

// ------------------------------------------------------------------------------------------------
// Character helpers
// ------------------------------------------------------------------------------------------------

export const STAT_META = [
  { key: 'speed', label: 'Speed', color: '#ff4d6d' },
  { key: 'accel', label: 'Accel', color: '#ffae1f' },
  { key: 'weight', label: 'Weight', color: '#9b6bff' },
  { key: 'handling', label: 'Handling', color: '#1fa8ff' },
  { key: 'traction', label: 'Traction', color: '#2fd27e' },
];

export const KART_STYLE_NAMES = {
  standard: 'Standard Frame',
  sport: 'Sport Frame',
  heavy: 'Heavy Frame',
  light: 'Light Frame',
  luxury: 'Luxury Frame',
};

export const ENGINE_META = {
  50: { name: 'Chill Ride', desc: 'Relaxed rivals and gentle speed. Perfect for new Sensei.', color: '#2fd27e', color2: '#0fa968', stars: 1 },
  100: { name: 'Standard', desc: 'A proper race. Your rivals start fighting back.', color: '#1fb6ff', color2: '#0a6cff', stars: 2 },
  150: { name: 'Fast', desc: 'The classic challenge. Drift well or get left behind!', color: '#ff5fa2', color2: '#e5307a', stars: 3 },
  200: { name: 'Mayhem', desc: 'Blistering speed and ruthless rivals. Brakes are a suggestion.', color: '#ff7a1f', color2: '#e8304f', stars: 4 },
};

export const MODE_LABEL = { gp: 'Grand Prix', vs: 'VS Race', tt: 'Time Trial' };

export const characterOrder = () => CHARACTERS.map((c) => c.id);

/** Place colour classes for result boards. */
export const placeClass = (p) => (p === 1 ? 'mn-p1' : p === 2 ? 'mn-p2' : p === 3 ? 'mn-p3' : 'mn-pn');

// ------------------------------------------------------------------------------------------------
// Icons (inline SVG strings). Glyphs use currentColor.
// ------------------------------------------------------------------------------------------------

const svg = (body, vb = '0 0 64 64', cls = 'mn-ico') =>
  `<svg class="${cls}" viewBox="${vb}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  gp: svg(
    `<path d="M18 7h28v11c0 11-6.5 19-14 19S18 29 18 18z" fill="currentColor"/>
     <path d="M18 12H9.5c0 9 4.5 14.5 11.5 15.5M46 12h8.5c0 9-4.5 14.5-11.5 15.5" fill="none" stroke="currentColor" stroke-width="4.5" stroke-linecap="round"/>
     <rect x="28.5" y="36" width="7" height="9" fill="currentColor"/>
     <path d="M19 57h26l-3.5-11h-19z" fill="currentColor"/>
     <path d="M32 13l2.3 4.7 5.2.8-3.8 3.6.9 5.1-4.6-2.4-4.6 2.4.9-5.1-3.8-3.6 5.2-.8z" fill="#fff" opacity=".85"/>`
  ),
  vs: svg(
    `<path d="M32 3l6.5 12.5L52 9l-4.5 14L62 27l-12.5 7L56 47l-14-3-4 14-6-12-6 12-4-14-14 3 6.5-13L2 27l14.5-4L12 9l13.5 6.5z" fill="currentColor"/>
     <text x="32" y="40.5" text-anchor="middle" font-size="20" font-family="Lilita One, Arial Black, sans-serif" fill="#fff" class="mn-ico-text">VS</text>`
  ),
  tt: svg(
    `<circle cx="32" cy="37" r="20" fill="none" stroke="currentColor" stroke-width="5.5"/>
     <rect x="26" y="4" width="12" height="7" rx="2.5" fill="currentColor"/>
     <path d="M32 11v5M49 17l4.5-4.5" stroke="currentColor" stroke-width="5" stroke-linecap="round"/>
     <path d="M32 37V25" stroke="currentColor" stroke-width="4.5" stroke-linecap="round"/>
     <path d="M32 37l8 5" stroke="currentColor" stroke-width="4.5" stroke-linecap="round"/>
     <circle cx="32" cy="37" r="3.2" fill="currentColor"/>`
  ),
  options: svg(
    `<circle cx="32" cy="32" r="21" fill="none" stroke="currentColor" stroke-width="9" stroke-dasharray="7.2 6"/>
     <circle cx="32" cy="32" r="15" fill="none" stroke="currentColor" stroke-width="7"/>
     <circle cx="32" cy="32" r="5" fill="currentColor"/>`
  ),
  howto: svg(
    `<path d="M6 13c9-4 18-3 24 3v38c-6-5-15-6-24-2z" fill="currentColor"/>
     <path d="M58 13c-9-4-18-3-24 3v38c6-5 15-6 24-2z" fill="currentColor" opacity=".75"/>
     <text x="18" y="41" text-anchor="middle" font-size="22" font-family="Lilita One, Arial Black, sans-serif" fill="#fff" class="mn-ico-text">?</text>`
  ),
  back: svg(`<path d="M38 14L20 32l18 18" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`),
  arrowL: svg(`<path d="M40 12L20 32l20 20" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>`),
  arrowR: svg(`<path d="M24 12l20 20-20 20" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>`),
  play: svg(`<path d="M20 12l32 20-32 20z" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/>`),
  retry: svg(
    `<path d="M50 30a18 18 0 1 1-6-13.5" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round"/><path d="M52 6v16H36z" fill="currentColor"/>`
  ),
  home: svg(`<path d="M8 30L32 9l24 21M15 25v28h12V39h10v14h12V25" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`),
  people: svg(
    `<circle cx="24" cy="20" r="10" fill="currentColor"/><path d="M6 54c0-12 8-19 18-19s18 7 18 19z" fill="currentColor"/>
     <circle cx="44" cy="22" r="8" fill="currentColor" opacity=".7"/><path d="M40 36c10-2 19 4 19 16H45" fill="currentColor" opacity=".7"/>`
  ),
  flag: svg(
    `<path d="M14 58V8" stroke="currentColor" stroke-width="5" stroke-linecap="round"/>
     <path d="M16 9h36l-7 11 7 11H16z" fill="currentColor"/>
     <path d="M22 9h6v6h-6zM34 9h6v6h-6zM28 15h6v5h-6zM40 15h6v5h-6zM22 20h6v6h-6zM34 20h6v6h-6zM28 26h6v5h-6z" fill="#fff" opacity=".85"/>`
  ),
  map: svg(
    `<path d="M8 14l16-6 16 6 16-6v42l-16 6-16-6-16 6z" fill="none" stroke="currentColor" stroke-width="5" stroke-linejoin="round"/><path d="M24 8v42M40 14v42" stroke="currentColor" stroke-width="4"/>`
  ),
  star: svg(`<path d="M32 4l8.2 17 18.6 2.6-13.5 13 3.3 18.4L32 46.2 15.4 55l3.3-18.4-13.5-13L23.8 21z" fill="currentColor"/>`),
  check: svg(`<path d="M12 33l13 13 27-28" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>`),
  lock: svg(
    `<rect x="12" y="28" width="40" height="30" rx="6" fill="currentColor"/><path d="M20 28v-8a12 12 0 0 1 24 0v8" fill="none" stroke="currentColor" stroke-width="6"/>`
  ),
};

/** Tiny halo glyph used as a decoration in title plates. */
export const haloGlyph = (color = '#ff3355') =>
  `<svg class="mn-halo-glyph" viewBox="0 0 64 32" aria-hidden="true"><ellipse cx="32" cy="16" rx="26" ry="9" fill="none" stroke="${color}" stroke-width="4"/>
   <path d="M2 16h8M54 16h8M32 3v5M32 24v5" stroke="${color}" stroke-width="4" stroke-linecap="round"/></svg>`;

const TROPHY_TONES = {
  1: { a: '#fff6b8', b: '#ffd23f', c: '#d58e00', label: 'Gold' },
  2: { a: '#ffffff', b: '#cfd9e8', c: '#7f8ea6', label: 'Silver' },
  3: { a: '#ffe0c2', b: '#e39a5f', c: '#9a5226', label: 'Bronze' },
};
export const trophyTone = (rank) => TROPHY_TONES[rank] || null;

/** Big trophy illustration (rank 1..3 picks the metal). */
export function trophySVG(rank = 1, { id = 'mnt', cls = 'mn-trophy-svg' } = {}) {
  const t = TROPHY_TONES[rank] || TROPHY_TONES[1];
  return `<svg class="${cls}" viewBox="0 0 200 240" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <linearGradient id="${id}-m" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${t.c}"/><stop offset=".28" stop-color="${t.a}"/><stop offset=".55" stop-color="${t.b}"/><stop offset="1" stop-color="${t.c}"/>
    </linearGradient>
    <linearGradient id="${id}-b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a4d7a"/><stop offset="1" stop-color="#16213a"/></linearGradient>
  </defs>
  <path d="M52 34c-30 0-36 14-34 30 3 22 22 34 44 38" fill="none" stroke="url(#${id}-m)" stroke-width="12" stroke-linecap="round"/>
  <path d="M148 34c30 0 36 14 34 30-3 22-22 34-44 38" fill="none" stroke="url(#${id}-m)" stroke-width="12" stroke-linecap="round"/>
  <path d="M44 18h112v40c0 42-26 70-56 70S44 100 44 58z" fill="url(#${id}-m)" stroke="#fff" stroke-width="4"/>
  <ellipse cx="100" cy="19" rx="56" ry="9" fill="${t.c}" opacity=".55"/>
  <path d="M60 30c2 30 10 55 26 70" stroke="#fff" stroke-width="7" stroke-linecap="round" opacity=".55" fill="none"/>
  <g transform="translate(100 66)">
    <ellipse rx="26" ry="9" fill="none" stroke="#ff3355" stroke-width="4.5"/>
    <path d="M-34 0h8M26 0h8M0 -14v6M0 8v6" stroke="#ff3355" stroke-width="4" stroke-linecap="round"/>
    <path d="M0-24l5 10 11 1.5-8 7.5 2 11L0 1 -10 6 -8-5 -16-12.5 -5-14z" fill="#fff" opacity=".9"/>
  </g>
  <path d="M88 126h24v26H88z" fill="url(#${id}-m)"/>
  <path d="M70 150h60l8 18H62z" fill="url(#${id}-m)" stroke="#fff" stroke-width="3"/>
  <rect x="50" y="168" width="100" height="44" rx="8" fill="url(#${id}-b)" stroke="#fff" stroke-width="4"/>
  <rect x="64" y="180" width="72" height="20" rx="4" fill="url(#${id}-m)"/>
  <text x="100" y="196" text-anchor="middle" font-size="16" font-family="Lilita One, Arial Black, sans-serif" fill="#16213a">${t.label.toUpperCase()}</text>
</svg>`;
}

/** Little trophy badge (for cup cards). */
export const trophyBadge = (rank) => {
  const t = TROPHY_TONES[rank];
  if (!t) return '';
  return `<svg class="mn-trophy-badge" viewBox="0 0 64 64" aria-label="${t.label} trophy"><path d="M18 7h28v11c0 11-6.5 19-14 19S18 29 18 18z" fill="${t.b}" stroke="${t.c}" stroke-width="3"/>
  <path d="M18 12H9.5c0 9 4.5 14.5 11.5 15.5M46 12h8.5c0 9-4.5 14.5-11.5 15.5" fill="none" stroke="${t.c}" stroke-width="4" stroke-linecap="round"/>
  <rect x="28.5" y="36" width="7" height="9" fill="${t.c}"/><path d="M19 57h26l-3.5-11h-19z" fill="${t.b}" stroke="${t.c}" stroke-width="3"/></svg>`;
};

/** Speedometer gauge for engine class cards. */
export function gaugeSVG(level /* 1..4 */, color) {
  const a0 = Math.PI * 0.85;
  const a1 = Math.PI * 2.15;
  const ang = a0 + ((a1 - a0) * (level - 0.35)) / 4;
  const R = 40;
  const arc = (from, to, r) => {
    const x0 = 50 + Math.cos(from) * r;
    const y0 = 54 + Math.sin(from) * r;
    const x1 = 50 + Math.cos(to) * r;
    const y1 = 54 + Math.sin(to) * r;
    const large = to - from > Math.PI ? 1 : 0;
    return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  };
  let ticks = '';
  for (let i = 0; i <= 8; i++) {
    const a = a0 + ((a1 - a0) * i) / 8;
    const r0 = i % 2 ? 31 : 28;
    ticks += `<path d="M${(50 + Math.cos(a) * r0).toFixed(1)} ${(54 + Math.sin(a) * r0).toFixed(1)}L${(50 + Math.cos(a) * 35).toFixed(1)} ${(54 + Math.sin(a) * 35).toFixed(1)}" stroke="#16213a" stroke-opacity=".35" stroke-width="2.5" stroke-linecap="round"/>`;
  }
  const nx = 50 + Math.cos(ang) * 30;
  const ny = 54 + Math.sin(ang) * 30;
  return `<svg class="mn-gauge" viewBox="0 0 100 80" aria-hidden="true">
    <path d="${arc(a0, a1, R)}" fill="none" stroke="#dfe9f7" stroke-width="9" stroke-linecap="round"/>
    <path class="mn-gauge-fill" d="${arc(a0, ang, R)}" fill="none" stroke="${color}" stroke-width="9" stroke-linecap="round"/>
    ${ticks}
    <path class="mn-gauge-needle" d="M50 54L${nx.toFixed(2)} ${ny.toFixed(2)}" stroke="#16213a" stroke-width="4.5" stroke-linecap="round"/>
    <circle cx="50" cy="54" r="6" fill="#16213a"/><circle cx="50" cy="54" r="2.5" fill="${color}"/>
  </svg>`;
}

// ------------------------------------------------------------------------------------------------
// Controls reference (keyboard / gamepad)
// ------------------------------------------------------------------------------------------------

export const CONTROLS = [
  { action: 'Accelerate', keys: ['W', '↑'], pad: ['A'] },
  { action: 'Brake / Reverse', keys: ['S', '↓'], pad: ['B'] },
  { action: 'Steer', keys: ['A', 'D', '←', '→'], pad: ['L-Stick', 'D-Pad'] },
  { action: 'Drift / Hop', keys: ['Space', 'Shift'], pad: ['RB', 'RT'] },
  { action: 'Use Item', keys: ['E', 'J', 'X', 'L'], pad: ['X', 'LB'] },
  { action: 'Look Back', keys: ['Q', 'C'], pad: ['Y'] },
  { action: 'Pause', keys: ['Esc', 'P'], pad: ['Start'] },
];

export const kbd = (k) => `<kbd class="mn-kbd">${esc(k)}</kbd>`;
export const pad = (k) => {
  const cls = /^[ABXY]$/.test(k) ? ` mn-pad-${k.toLowerCase()}` : '';
  return `<kbd class="mn-kbd mn-padkey${cls}">${esc(k)}</kbd>`;
};

/** Footer button hints; `list` = [[action, label], ...] with action confirm|back|move|lr|ud|pause */
export function hintsHTML(list) {
  const map = {
    confirm: [kbd('Enter'), pad('A')],
    back: [kbd('Esc'), pad('B')],
    move: [kbd('←↑↓→'), pad('D-Pad')],
    lr: [kbd('← →'), pad('◀ ▶')],
    ud: [kbd('↑ ↓'), pad('▲ ▼')],
    pause: [kbd('Esc'), pad('Start')],
  };
  return list
    .map(([a, label]) => {
      const [k, p] = map[a] || [kbd(a), pad(a)];
      return `<span class="mn-hint"><span class="mn-hint-kb">${k}</span><span class="mn-hint-pad">${p}</span>${esc(label)}</span>`;
    })
    .join('');
}

// ------------------------------------------------------------------------------------------------
// Blue-Archive-flavoured loading tips
// ------------------------------------------------------------------------------------------------

export const TIPS = [
  'Keep drifting until the sparks turn <b class="mn-c-purple">purple</b> for an Ultra Mini-Turbo!',
  'Hit accelerate right as the <b>2</b> disappears for a Rocket Start. Serika never misses it... usually.',
  'Every Credit you carry adds a little top speed. Getting hit makes you drop three!',
  'The <b>Shittim Tablet</b> shrinks every rival. Arona says sorry in advance.',
  'Hold the item button to keep a <b>Spilled Ramen</b> behind you as a shield.',
  'Press drift in mid-air off a ramp to do a trick and land with a boost.',
  'The <b>Blue Seeker</b> always hunts whoever is in 1st. Being on top is lonely, Sensei.',
  "<b>Sensei's Card</b>: swipe it as often as you like for a few seconds of unlimited boosts.",
  'Off-road slows you down. Racers with high <b>Traction</b> barely notice the sand.',
  "Serika's shifts at Shibaseki Ramen pay for her kart's tune-ups. Every podium helps Abydos!",
  '<b>Halo Overdrive</b> makes you invincible - ram rivals to send them spinning!',
  'Look back with <b>Q</b> / <b>C</b> (or <b>Y</b>) to aim items behind you.',
  'Heavy racers like Hina and Nonomi barely budge when bumped. Light racers accelerate faster.',
  'Dash panels and mini-turbos stack with Credits. Chain them for maximum speed!',
  'In a Grand Prix, the leader starts at the back of the grid. Stay sharp, Sensei.',
  'Ayane calculated it: a clean racing line beats a reckless one. (Aru disagrees.)',
];
