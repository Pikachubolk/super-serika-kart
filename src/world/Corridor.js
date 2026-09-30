// Spatial queries around the track corridor + per-sample analysis (owner: world agent).
//
//   const corridor = new Corridor(path)
//   corridor.isClear(x, z, r, { margin, ignoreIndex, ignoreSpan })   // circle does not touch road/off-road/walls
//   corridor.nearest(x, z)          -> { index, dist, lateral, side, ext } (horizontal)
//   corridor.query(x, z, radius, fn(sampleIndex))
//
//   analyzeTrack(path, theme, corridor) -> {
//     bridge: Uint8Array(N)          1 = elevated section above another part of the track (deck + pillars)
//     voidSide(i, side)              true if that side of sample i has no wall
//     hasVoid, solid, liquid, floating
//     groundBase                     natural terrain level near the track (solid themes)
//     voidY                          height of the void / liquid surface (lava, water, cloud sea, abyss)
//     edge(i, side, out)             outer corridor edge point {x,y,z} of sample i (side -1 left / +1 right)
//     limit(i, side)                 |lateral| of the corridor edge on that side
//   }

import { isSolidGround, isLiquidGround, isFloatingGround } from './themes.js';

export const WALL_THICKNESS = 0.9;

export class Corridor {
  constructor(path, { cell = 16 } = {}) {
    this.path = path;
    this.cell = cell;
    this.buckets = new Map();
    this.maxExt = 0;
    const S = path.samples;
    for (const s of S) {
      const k = this._key(Math.floor(s.pos.x / cell), Math.floor(s.pos.z / cell));
      let b = this.buckets.get(k);
      if (!b) this.buckets.set(k, (b = []));
      b.push(s.index);
      this.maxExt = Math.max(this.maxExt, s.halfWidth + Math.max(s.offL, s.offR) + WALL_THICKNESS);
    }
  }

  _key(ix, iz) {
    return (ix + 32768) * 65536 + (iz + 32768);
  }

  /** Call fn(index) for samples whose centre may lie within `radius` of (x, z). */
  query(x, z, radius, fn) {
    const c = this.cell;
    const x0 = Math.floor((x - radius) / c);
    const x1 = Math.floor((x + radius) / c);
    const z0 = Math.floor((z - radius) / c);
    const z1 = Math.floor((z + radius) / c);
    for (let ix = x0; ix <= x1; ix++)
      for (let iz = z0; iz <= z1; iz++) {
        const b = this.buckets.get(this._key(ix, iz));
        if (!b) continue;
        for (let k = 0; k < b.length; k++) if (fn(b[k]) === true) return true;
      }
    return false;
  }

  /** Half-extent of the corridor on one side of a sample (road + off-road + wall thickness). */
  ext(s, side, margin = WALL_THICKNESS) {
    return s.halfWidth + (side > 0 ? s.offR + (s.wallR ? margin : 0) : s.offL + (s.wallL ? margin : 0));
  }

  /**
   * True if a circle (x, z, r) does not touch the corridor (road + off-road + walls).
   * opts.margin: extra clearance; opts.ignoreIndex + opts.ignoreSpan: ignore samples whose path distance
   * to ignoreIndex is below ignoreSpan samples (used for pillars under a bridge).
   */
  isClear(x, z, r = 0, opts = {}) {
    const margin = opts.margin ?? 0;
    const S = this.path.samples;
    const N = this.path.count;
    const step = this.path.step;
    const hasIgnore = opts.ignoreIndex !== undefined;
    const reach = this.maxExt + r + margin + 2;
    const hit = this.query(x, z, reach, (i) => {
      if (hasIgnore) {
        let gap = Math.abs(i - opts.ignoreIndex);
        gap = Math.min(gap, N - gap);
        if (gap < opts.ignoreSpan) return false;
      }
      const s = S[i];
      const dx = x - s.pos.x;
      const dz = z - s.pos.z;
      const th = Math.hypot(s.tan.x, s.tan.z) || 1;
      const along = (dx * s.tan.x + dz * s.tan.z) / th;
      if (Math.abs(along) > step * 0.75 + 0.05) return false;
      const lat = dx * s.rightH.x + dz * s.rightH.z;
      const e = this.ext(s, lat >= 0 ? 1 : -1) + margin + r;
      return Math.abs(lat) < e;
    });
    return !hit;
  }

  /** Nearest sample (horizontal). */
  nearest(x, z, maxR = 400) {
    const S = this.path.samples;
    let best = -1;
    let bestD = Infinity;
    for (let r = this.cell; r <= maxR * 2; r *= 2) {
      this.query(x, z, r, (i) => {
        const s = S[i];
        const d = (x - s.pos.x) ** 2 + (z - s.pos.z) ** 2;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      if (best >= 0 && Math.sqrt(bestD) <= r) break;
    }
    if (best < 0) {
      for (let i = 0; i < S.length; i++) {
        const s = S[i];
        const d = (x - s.pos.x) ** 2 + (z - s.pos.z) ** 2;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
    }
    const s = S[best];
    const lat = (x - s.pos.x) * s.rightH.x + (z - s.pos.z) * s.rightH.z;
    const side = lat >= 0 ? 1 : -1;
    return { index: best, dist: Math.sqrt(bestD), lateral: lat, side, ext: this.ext(s, side, 0), s };
  }
}

/** Analyse a track for the builders: bridges, void sides, ground levels. */
export function analyzeTrack(path, theme, corridor) {
  const S = path.samples;
  const N = path.count;
  const gType = theme.ground.type;
  const solid = isSolidGround(gType);
  const liquid = isLiquidGround(gType);
  const floating = isFloatingGround(gType);
  const minY = path.bounds.min.y;
  let hasVoid = false;
  for (const s of S) if (!s.wallL || !s.wallR) hasVoid = true;

  const groundBase = minY - 0.35;
  let voidY;
  if (liquid) voidY = minY - 9;
  else if (floating) voidY = minY - (gType === 'space' || theme.void.type === 'abyss' ? 70 : 48);
  else voidY = minY - 14; // chasm floor for wall-less edges on solid ground
  // A sky-type void always sits far below, even on solid ground.
  if (!liquid && !floating && theme.void.type === 'sky') voidY = minY - 40;

  const limit = (i, side) => {
    const s = S[i];
    return s.halfWidth + (side > 0 ? s.offR : s.offL);
  };
  const edge = (i, side, out = { x: 0, y: 0, z: 0 }) => {
    const s = S[i];
    const lat = side * limit(i, side);
    out.x = s.pos.x + s.rightH.x * lat;
    out.z = s.pos.z + s.rightH.z * lat;
    out.y = s.pos.y + lat * s.slope;
    return out;
  };
  const voidSide = (i, side) => (side > 0 ? !S[i].wallR : !S[i].wallL);

  // --- bridge detection: a sample whose embankment footprint would cover a lower part of the track
  const bridge = new Uint8Array(N);
  const base = liquid ? voidY : groundBase;
  for (let i = 0; i < N; i++) {
    const s = S[i];
    const ext = s.halfWidth + Math.max(s.offL, s.offR) + WALL_THICKNESS;
    const reach = floating ? 2 : Math.min(55, Math.max(1, (s.pos.y - base) * 1.4));
    const R = ext + reach + corridor.maxExt;
    corridor.query(s.pos.x, s.pos.z, R, (j) => {
      let gap = Math.abs(i - j);
      gap = Math.min(gap, N - gap) * path.step;
      const o = S[j];
      const extJ = o.halfWidth + Math.max(o.offL, o.offR) + WALL_THICKNESS;
      if (gap < Math.max(45, (ext + extJ) * 2.5)) return false;
      if (s.pos.y - o.pos.y < 1.0) return false;
      const dh = Math.hypot(s.pos.x - o.pos.x, s.pos.z - o.pos.z);
      if (dh < ext + reach + extJ) {
        bridge[i] = 1;
        return true;
      }
      return false;
    });
  }
  // dilate so the deck starts a little before the crossing
  const dil = 10;
  const flagged = bridge.slice();
  for (let i = 0; i < N; i++) {
    if (!flagged[i]) continue;
    for (let k = -dil; k <= dil; k++) bridge[(i + k + N) % N] = 1;
  }
  let bridgeCount = 0;
  for (let i = 0; i < N; i++) bridgeCount += bridge[i];

  return { bridge, bridgeCount, hasVoid, solid, liquid, floating, groundBase, voidY, edge, limit, voidSide };
}
