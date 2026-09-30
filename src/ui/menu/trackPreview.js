// Track outline previews for cup / track select and the loading screen (owner: frontend agent).
// Outlines come from `new TrackPath(def).outline2D()` and are cached per track id.

import { loadTrackDef, getTrackEntry, TRACKS } from '../../data/tracks/index.js';
import { TrackPath } from '../../world/TrackPath.js';

const cache = new Map(); // id -> Promise<Outline|null>

/**
 * @typedef {{ d: string, start: {x:number,y:number,ang:number}, vb: string, length: number, aspect: number }} Outline
 */

function buildOutline(def) {
  const path = new TrackPath(def);
  const every = Math.max(1, Math.round(path.count / 220));
  const pts = path.outline2D(every);
  if (!pts.length) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  const w = Math.max(1, maxX - minX);
  const h = Math.max(1, maxZ - minZ);
  const S = 100 / Math.max(w, h);
  const pad = 10;
  // true top-down view (camera above, looking down, screen-up = -Z): +x right, +z down
  const tx = (x) => pad + (x - minX) * S + (100 - w * S) / 2;
  const ty = (z) => pad + (z - minZ) * S + (100 - h * S) / 2;
  let d = '';
  pts.forEach((p, i) => {
    d += `${i ? 'L' : 'M'}${tx(p.x).toFixed(2)} ${ty(p.z).toFixed(2)}`;
  });
  d += 'Z';
  const p0 = pts[0];
  const p1 = pts[Math.min(pts.length - 1, 2)];
  const ang = (Math.atan2(ty(p1.z) - ty(p0.z), tx(p1.x) - tx(p0.x)) * 180) / Math.PI;
  return { d, start: { x: tx(p0.x), y: ty(p0.z), ang }, vb: `0 0 ${100 + pad * 2} ${100 + pad * 2}`, length: path.length, aspect: w / h };
}

/** Promise<Outline|null> (never rejects). */
export function getOutline(trackId) {
  if (!cache.has(trackId)) {
    const pr = (async () => {
      try {
        const def = await loadTrackDef(trackId);
        return buildOutline(def);
      } catch (err) {
        console.warn(`[menus] outline for "${trackId}" failed:`, err?.message || err);
        return null;
      }
    })();
    cache.set(trackId, pr);
  }
  return cache.get(trackId);
}

/** Warm the cache in idle time (one track at a time so we don't jank the menus). */
export function preloadOutlines(ids = TRACKS.map((t) => t.id)) {
  const queue = [...ids];
  const idle = window.requestIdleCallback || ((fn) => setTimeout(() => fn({ timeRemaining: () => 8 }), 60));
  const next = () => {
    const id = queue.shift();
    if (!id) return;
    getOutline(id).finally(() => idle(next));
  };
  idle(next);
}

/** SVG markup for an outline. */
export function outlineSVG(o, { color = '#1fb6ff', cls = 'mn-outline', animated = false } = {}) {
  if (!o) return `<svg class="${cls} is-empty" viewBox="0 0 120 120"><circle cx="60" cy="60" r="34" fill="none" stroke="#fff" stroke-width="8" stroke-dasharray="4 10" opacity=".6"/></svg>`;
  const { d, start, vb } = o;
  return `<svg class="${cls}${animated ? ' is-anim' : ''}" viewBox="${vb}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="${d}" fill="none" stroke="#0b2451" stroke-opacity=".35" stroke-width="15" stroke-linejoin="round" transform="translate(1.5 3)"/>
    <path d="${d}" fill="none" stroke="#fff" stroke-width="13" stroke-linejoin="round"/>
    <path class="mn-outline-road" d="${d}" pathLength="1000" fill="none" stroke="${color}" stroke-width="6.5" stroke-linejoin="round"/>
    <path d="${d}" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="1.2" stroke-dasharray="3 4" stroke-linejoin="round"/>
    <g transform="translate(${start.x.toFixed(2)} ${start.y.toFixed(2)}) rotate(${start.ang.toFixed(1)})">
      <rect x="-2.6" y="-8" width="5.2" height="16" fill="#16213a" stroke="#fff" stroke-width="1.6"/>
      <rect x="-2.6" y="-8" width="2.6" height="4" fill="#fff"/><rect x="0" y="-4" width="2.6" height="4" fill="#fff"/>
      <rect x="-2.6" y="0" width="2.6" height="4" fill="#fff"/><rect x="0" y="4" width="2.6" height="4" fill="#fff"/>
    </g>
  </svg>`;
}

/** Fill `container` with the outline of `trackId` asynchronously (placeholder first). */
export function mountOutline(container, trackId, opts = {}) {
  const entry = getTrackEntry(trackId);
  const color = opts.color || entry?.color || '#1fb6ff';
  container.innerHTML = outlineSVG(null, opts);
  getOutline(trackId).then((o) => {
    container.innerHTML = outlineSVG(o, { ...opts, color });
  });
}
