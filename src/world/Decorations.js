// Decorations beside the track (owner: world agent).
//
// def.decorations entries (ARCHITECTURE.md §4):
//   scatter: { kind, count, side: 'both'|'left'|'right'|'inside'|'outside', minOffset, maxOffset,
//              scale: n | [min,max], seed, tRange: [t0,t1] (may wrap, e.g. [0.9, 0.1]) }
//   regular: { kind, every, side, offset, start? (distance of the first one), tRange? }
// Extra (optional) fields understood here:
//   color, color2, variant, text        prop options (variant may be an array -> picked per instance)
//   y: n | [min,max]                    extra height (floating kinds default to PROP_META.float)
//   yaw: n                              fixed extra yaw (radians); face: 'road'|'along'|'random'|'out'
//   spacing: n                          minimum distance between instances (default from footprint)
//   variants: n                         number of shape variants (default 2 for natural kinds)
//   shadow: false                       don't cast shadows
// Offsets are measured OUTWARD from the corridor boundary (road edge + off-road). Negative = inside the
// off-road strip (never on the road itself). Positions touching another part of the corridor are skipped.

import * as THREE from 'three';
import { mulberry32, hashString, lerp, clamp } from '../core/utils.js';
import { PROP_META } from './Props.js';
import { createInstancedProps } from './Instancer.js';

const NATURAL = new Set(['palm', 'cactus', 'rock', 'boulder', 'pine', 'tree', 'bush', 'sakuraTree', 'crystal', 'iceSpike', 'lavaRock', 'cloud', 'dune', 'ruin', 'building', 'flowerBed']);

export function loopOrientation(path) {
  let sum = 0;
  for (const s of path.samples) sum += s.curvature;
  return sum >= 0 ? 1 : -1; // +1: mostly right turns -> inside is the right side
}

/**
 * Spatial registry of placed footprints (decorations + scenery) to avoid overlaps.
 */
export class Footprints {
  constructor(cell = 12) {
    this.cell = cell;
    this.map = new Map();
  }
  _k(ix, iz) {
    return `${ix},${iz}`;
  }
  overlaps(x, z, r, factor = 0.75) {
    const c = this.cell;
    const R = r + 12;
    for (let ix = Math.floor((x - R) / c); ix <= Math.floor((x + R) / c); ix++)
      for (let iz = Math.floor((z - R) / c); iz <= Math.floor((z + R) / c); iz++) {
        const b = this.map.get(this._k(ix, iz));
        if (!b) continue;
        for (const f of b) {
          const d = Math.hypot(x - f.x, z - f.z);
          if (d < (r + f.r) * factor) return true;
        }
      }
    return false;
  }
  add(x, z, r) {
    const k = this._k(Math.floor(x / this.cell), Math.floor(z / this.cell));
    let b = this.map.get(k);
    if (!b) this.map.set(k, (b = []));
    b.push({ x, z, r });
  }
}

function randScale(rng, s) {
  if (Array.isArray(s)) return lerp(s[0], s[1], rng());
  return s ?? 1;
}

function inRange(t, tr) {
  if (!tr) return true;
  const [a, b] = tr;
  if (a <= b) return t >= a && t <= b;
  return t >= a || t <= b; // wrapping range
}

export function buildDecorations(W) {
  const { path, theme, def, quality, corridor, analysis: A, terrain } = W;
  const list = def.decorations || [];
  const S = path.samples;
  const L = path.length;
  const inside = loopOrientation(path);
  const qMul = quality === 'low' ? 0.5 : quality === 'medium' ? 0.8 : 1;
  const islets = { sky: [], lava: [], water: [] };
  let totalInstances = 0;

  list.forEach((spec, di) => {
    try {
      const kind = spec.kind;
      if (!kind) return;
      const meta = PROP_META[kind] || { r: 1, h: 2 };
      const seed = (spec.seed ?? di + 1) * 7919 + hashString(`${def.id}:${kind}:${di}`);
      const rng = mulberry32(seed);
      const transforms = [];
      const sideOf = (k) => {
        const sd = spec.side || 'both';
        if (sd === 'left') return -1;
        if (sd === 'right') return 1;
        if (sd === 'inside') return inside;
        if (sd === 'outside') return -inside;
        if (sd === 'alternate') return k % 2 ? 1 : -1;
        return rng() < 0.5 ? -1 : 1;
      };
      const floatRange = spec.y !== undefined ? (Array.isArray(spec.y) ? spec.y : [spec.y, spec.y]) : meta.float || null;
      const isFloating = !!meta.float;

      const tryPlace = (d, side, offset, scale, strict) => {
        const s = path.sampleAt(d);
        const f = path.frameAt(d);
        const lim = f.halfWidth + (side > 0 ? f.offR : f.offL);
        const r = meta.r * scale;
        const lat = side * (lim + offset + (offset >= 0 ? r * (meta.big ? 1 : 0.35) : 0));
        const x = f.pos.x + f.rightH.x * lat;
        const z = f.pos.z + f.rightH.z * lat;
        // corridor clearance
        if (offset >= 0) {
          if (!corridor.isClear(x, z, r * 0.8, { margin: 0.2 })) return false;
        } else {
          if (Math.abs(lat) - r < f.halfWidth + 0.8) return false;
          if (!corridor.isClear(x, z, r, { ignoreIndex: s.index, ignoreSpan: 30 })) return false;
        }
        const spacing = spec.spacing ?? r * 1.5;
        if (W.footprints.overlaps(x, z, Math.max(r, spacing / 2), strict ? 0.9 : 0.75)) return false;
        // height
        const roadY = f.pos.y + lat * f.slope;
        let y;
        let islet = null;
        if (isFloating) {
          y = roadY + lerp(floatRange[0], floatRange[1], rng());
        } else {
          const g = terrain.groundAt(x, z);
          if (g === null || g === undefined) {
            // floating world: put it on a little sky island
            y = roadY - 0.5 - rng() * 3;
            islet = 'sky';
          } else if (A.liquid && g <= A.voidY + 0.05) {
            if (meta.wet) y = A.voidY - 0.3 * scale;
            else {
              y = A.voidY + 0.2;
              islet = theme.ground.type === 'lava' ? 'lava' : 'water';
            }
          } else if (A.solid && g < roadY - 6 && !meta.wet) {
            return false; // would sit at the bottom of a chasm
          } else y = g;
          if (floatRange && spec.y !== undefined) y += lerp(floatRange[0], floatRange[1], rng());
        }
        // rotation
        let rotY;
        const face = spec.face || (meta.facing ? 'road' : 'random');
        if (face === 'road') rotY = Math.atan2(-side * f.rightH.x, -side * f.rightH.z);
        else if (face === 'out') rotY = Math.atan2(side * f.rightH.x, side * f.rightH.z);
        else if (face === 'along') rotY = f.yaw;
        else rotY = rng() * Math.PI * 2;
        if (!strict && face !== 'random') rotY += (rng() - 0.5) * 0.25;
        if (spec.yaw !== undefined) rotY += spec.yaw;
        const t = { x, y, z, rotY, scale };
        if (spec.tilt) {
          t.rotX = (rng() - 0.5) * spec.tilt;
          t.rotZ = (rng() - 0.5) * spec.tilt;
        }
        transforms.push(t);
        W.footprints.add(x, z, r);
        if (islet) islets[islet].push({ x, y: islet === 'sky' ? y : A.voidY, z, rotY: rng() * 6.28, scale: Math.max(1.2, r * 1.15) });
        return true;
      };

      if (spec.every) {
        const every = spec.every / (quality === 'low' ? 0.66 : 1);
        const offset = spec.offset ?? spec.minOffset ?? 1.5;
        const start = spec.start ?? every / 2;
        let k = 0;
        for (let d = start; d < L; d += every, k++) {
          if (!inRange(d / L, spec.tRange)) continue;
          const scale = randScale(rng, spec.scale);
          const sd = spec.side || 'both';
          const sides = sd === 'both' ? [-1, 1] : [sideOf(k)];
          for (const side of sides) tryPlace(d, side, offset, scale, true);
        }
      } else {
        const count = Math.round((spec.count ?? 20) * qMul);
        const [t0, t1] = spec.tRange || [0, 1];
        const span = t1 >= t0 ? t1 - t0 : 1 - t0 + t1;
        const minO = spec.minOffset ?? 2;
        const maxO = Math.max(minO, spec.maxOffset ?? minO + 30);
        let placed = 0;
        for (let tries = 0; placed < count && tries < count * 8; tries++) {
          const t = (t0 + rng() * span) % 1;
          const d = t * L;
          const side = sideOf(tries);
          const offset = lerp(minO, maxO, Math.pow(rng(), spec.bias ?? 1));
          const scale = randScale(rng, spec.scale);
          if (tryPlace(d, side, offset, scale, false)) placed++;
        }
      }
      if (!transforms.length) return;
      totalInstances += transforms.length;

      // split into shape variants
      const nVar = spec.variants ?? (NATURAL.has(kind) ? (quality === 'low' ? 1 : kind === 'building' ? 3 : 2) : 1);
      const variantList = Array.isArray(spec.variant) ? spec.variant : null;
      const buckets = new Map();
      transforms.forEach((t, i) => {
        const vi = variantList ? i % variantList.length : i % nVar;
        let b = buckets.get(vi);
        if (!b) buckets.set(vi, (b = []));
        b.push(t);
      });
      for (const [vi, tl] of buckets) {
        const opts = {
          color: spec.color,
          color2: spec.color2,
          variant: variantList ? variantList[vi] : spec.variant,
          text: spec.text,
          seed: (spec.seed ?? di) * 31 + vi,
          night: theme.night,
          castShadow: spec.shadow !== false && quality !== 'low' && !meta.float,
          brightness: NATURAL.has(kind) ? 0.12 : 0.05,
        };
        const g = createInstancedProps(kind, tl, opts);
        g.name = `deco:${kind}`;
        W.group.add(g);
        W.instancedGroups.push(g);
      }
    } catch (err) {
      console.warn(`[TrackBuilder] decoration #${di} (${spec?.kind}) failed:`, err);
    }
  });

  // islets under props that have no solid ground
  for (const style of ['sky', 'lava', 'water']) {
    const tl = islets[style];
    if (!tl.length) continue;
    const colorOpts =
      style === 'sky'
        ? { color: theme.offroad.type === 'none' ? '#8fd46a' : theme.offroad.color, color2: '#9a7a5a' }
        : style === 'lava'
          ? { color: '#3a2e2c', color2: '#4a3a36' }
          : { color: '#d9c28a', color2: theme.offroad.color };
    const g = createInstancedProps('islet', tl, { variant: style, ...colorOpts, castShadow: quality !== 'low', brightness: 0.1 });
    g.name = `islets:${style}`;
    W.group.add(g);
    W.instancedGroups.push(g);
  }
  W.stats.decorations = totalInstances;
  void S;
  void clamp;
}
